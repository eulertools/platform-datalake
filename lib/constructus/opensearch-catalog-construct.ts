import {
    App,
    aws_certificatemanager as cert,
    aws_opensearchservice as opensearch,
    aws_route53 as route53,
    CfnResource,
    Stack,
    StackProps,
  } from 'aws-cdk-lib';
  import * as ssm from 'aws-cdk-lib/aws-ssm';
  import * as iam from 'aws-cdk-lib/aws-iam';
  import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
  import * as cognito from 'aws-cdk-lib/aws-cognito';
  import {
    AnyPrincipal,
    Effect,
    ManagedPolicy,
    PolicyStatement,
    ServicePrincipal,
  } from 'aws-cdk-lib/aws-iam';
  import { RoleMapping } from 'cdk-aws-opensearch-api';
  import { Construct } from "constructs";
  import * as certificatemanager from "aws-cdk-lib/aws-certificatemanager";
import { ISecret } from 'aws-cdk-lib/aws-secretsmanager';
  
  export interface ConstructProps {
    hostedZone: string;
    domain:string;
  }
  
  export class OpenSearchCatalogConstruct extends Construct {
    constructor(scope: Stack, id: string, props?: ConstructProps) {
      super(scope, id);
  
      const { hostedZone, domain } = props!;

      const region = Stack.of(this).region;
      const account = Stack.of(this).account;
  
      new CfnResource(this, 'EsServiceLinkedRole', {
        type: 'AWS::IAM::ServiceLinkedRole',
        properties: {
          AWSServiceName: 'es.amazonaws.com',
          Description: 'Role for ES to access resources in my VPC',
        },
      });
  
      const publicZone = route53.HostedZone.fromLookup(this, 'PublicZone', {
        privateZone: false,
        domainName: hostedZone,
      });

      const certificate = new certificatemanager.Certificate(this, 'PublicCertificate', {
        domainName: domain,
        subjectAlternativeNames: [ "*." + domain ],
        validation: certificatemanager.CertificateValidation.fromDns(publicZone),
      });
  
      const userPool = cognito.UserPool.fromUserPoolId(
        this, 'CognitoUserPoolId',
        ssm.StringParameter.valueForStringParameter(
          this,
          '/directory/cognito/warden',
        ),
      );
  
      const userPoolClient = cognito.UserPoolClient.fromUserPoolClientId(
        this, 'CognitoClientId',
        ssm.StringParameter.valueForStringParameter(
          this,
          '/directory/cognito/poolClientId',
        ),
      );
  
      const userPoolClientApi = cognito.UserPoolClient.fromUserPoolClientId(
        this, 'CognitoClientApiId',
        ssm.StringParameter.valueForStringParameter(
          this,
          '/directory/cognito/user-pool-api-client-id',
        ),
      );      
  
      const identityPool = new cognito.CfnIdentityPool(this, 'CognitoIdentityPool', {
        allowUnauthenticatedIdentities: true,
        cognitoIdentityProviders: [
          {
            clientId: userPoolClient.userPoolClientId,
            providerName: `cognito-idp.${region}.amazonaws.com/${userPool.userPoolId}`,
          },
          {
            clientId: userPoolClientApi.userPoolClientId,
            providerName: `cognito-idp.${region}.amazonaws.com/${userPool.userPoolId}`,
          },
        ],
      });
  
      const isAnonymousCognitoGroupRole = new iam.Role(
        this, 'AnonymousGroupRole',
        {
          description: 'Default role for anonymous users',
          assumedBy: new iam.FederatedPrincipal(
            'cognito-identity.amazonaws.com',
            {
              StringEquals: {
                'cognito-identity.amazonaws.com:aud': identityPool.ref,
              },
              'ForAnyValue:StringLike': {
                'cognito-identity.amazonaws.com:amr': 'unauthenticated',
              },
            },
            'sts:AssumeRoleWithWebIdentity',
          ),
          managedPolicies: [
            iam.ManagedPolicy.fromAwsManagedPolicyName(
              'service-role/AWSLambdaBasicExecutionRole',
            ),
          ],
        },
      );
  
      const isUserCognitoGroupRole = new iam.Role(
        this, 'UsersGroupRole',
        {
          description: 'Default role for authenticated users',
          assumedBy: new iam.FederatedPrincipal(
            'cognito-identity.amazonaws.com',
            {
              StringEquals: {
                'cognito-identity.amazonaws.com:aud': identityPool.ref,
              },
              'ForAnyValue:StringLike': {
                'cognito-identity.amazonaws.com:amr': 'authenticated',
              },
            },
            'sts:AssumeRoleWithWebIdentity',
          ),
          managedPolicies: [
            iam.ManagedPolicy.fromAwsManagedPolicyName(
              'service-role/AWSLambdaBasicExecutionRole',
            ),
          ],
        });
  
      const isAdministratorGroupRole = new iam.Role(
        this, 'AdministratorsGroupRole',
        {
          description: 'Default role for administrator users',
          assumedBy: new iam.FederatedPrincipal(
            'cognito-identity.amazonaws.com',
            {
              StringEquals: {
                'cognito-identity.amazonaws.com:aud': identityPool.ref,
              },
              'ForAnyValue:StringLike': {
                'cognito-identity.amazonaws.com:amr': 'authenticated',
              },
            },
            'sts:AssumeRoleWithWebIdentity',
          ),
          managedPolicies: [
            iam.ManagedPolicy.fromAwsManagedPolicyName(
              'service-role/AWSLambdaBasicExecutionRole',
            ),
          ],
        }
      );
  
     new cognito.CfnUserPoolGroup(this, 'AdministratorsGroup', {
        userPoolId: userPool.userPoolId,
        // the properties below are optional
        description: 'Administrators only group',
        precedence: 1,
        roleArn: isAdministratorGroupRole.roleArn,
      });
  
      new cognito.CfnIdentityPoolRoleAttachment(
        this, 'IdentityPoolRoleAttachment',
        {
          identityPoolId: identityPool.ref,
          roles: {
            authenticated: isUserCognitoGroupRole.roleArn,
            unauthenticated: isAnonymousCognitoGroupRole.roleArn,
          },
          roleMappings: {
            mapping: {
              type: 'Token',
              ambiguousRoleResolution: 'Deny',
              identityProvider: `cognito-idp.${region}.amazonaws.com/${userPool.userPoolId}:${userPoolClient.userPoolClientId}`,
            },
            userPool: {
              type: 'Token',
              ambiguousRoleResolution: 'Deny',
              identityProvider: `cognito-idp.${region}.amazonaws.com/${userPool.userPoolId}:${userPoolClientApi.userPoolClientId}`,
            },
          },
        },
      );
  
      const opensearchHttpPolicy = new ManagedPolicy(
        this, 'OpensearchHttpPolicy',
        {
          roles: [isAnonymousCognitoGroupRole, isUserCognitoGroupRole],
        },
      );
  
      opensearchHttpPolicy.addStatements(
        new PolicyStatement({
          effect: Effect.ALLOW,
          resources: [
            `arn:aws:es:${region}:${account}:domain/${domain}/*`,
          ],
          actions: ['es:*'],
        }),
      );
  
      const role = new iam.Role(this, 'CognitoRole', {
        assumedBy: new ServicePrincipal('opensearchservice.amazonaws.com'),
        managedPolicies: [
          ManagedPolicy.fromAwsManagedPolicyName(
            'AmazonOpenSearchServiceCognitoAccess',
          ),
        ],
      });
      
      const apiCreds = new secretsmanager.Secret(this, 'Credentials', {
        generateSecretString: {
          secretStringTemplate: JSON.stringify(
          { 
            username: 'admin',
          }),
          generateStringKey: 'password',
        },
      });

      new ssm.StringParameter(this, `SSMCredentials`, {
        stringValue: apiCreds.secretName,
        parameterName: `/datalake/opensearch/credentials-secret-name`,
      });

      const osdomain = new opensearch.Domain(this, 'Domain', {
        version: opensearch.EngineVersion.OPENSEARCH_1_3,
        cognitoDashboardsAuth: {
          identityPoolId: identityPool.ref,
          role: role,
          userPoolId: userPool.userPoolId,
        },
        enforceHttps: true,
        nodeToNodeEncryption: true,
        encryptionAtRest: {
          enabled: true,
        },
        fineGrainedAccessControl: {
          masterUserName: 'admin',
          masterUserPassword: apiCreds.secretValueFromJson('password')
        },
        capacity: {
          masterNodeInstanceType: 't3.medium.search',
          dataNodeInstanceType: 't3.medium.search',
          dataNodes: 1,
        },
        ebs: {
          volumeSize: 20,
        },
        logging: {
          slowSearchLogEnabled: true,
          appLogEnabled: true,
          slowIndexLogEnabled: true,
        },
        customEndpoint: {
          domainName: domain,
          certificate: certificate,
          hostedZone: publicZone,
        },
      });

      osdomain.addAccessPolicies(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['es:*'],
          principals: [
            new AnyPrincipal()
          ]
        })
      )

      new RoleMapping(this, 'ReadOnlyMapping', {
        domain: osdomain,
        roleName: 'opensearch_dashboards_read_only',
        masterUserPasswordSecret: apiCreds,
  
        // this definition is what you'd PUT to the OpenSearch API:
        // https://opensearch.org/docs/latest/security-plugin/access-control/api/#create-role-mapping
        roleMappingDefinition: {
          backend_roles: [isUserCognitoGroupRole.roleArn],
          hosts: ['*'],
          users: [],
        },
      });
  
      new RoleMapping(this, 'AllAccessRoleMapping', {
        domain: osdomain,
        roleName: 'all_access',
        masterUserPasswordSecret: apiCreds,
  
        // this definition is what you'd PUT to the OpenSearch API:
        // https://opensearch.org/docs/latest/security-plugin/access-control/api/#create-role-mapping
        roleMappingDefinition: {
          backend_roles: [isAdministratorGroupRole.roleArn],
          hosts: ['*'],
          users: ['admin'],
        },
      });
  
      new RoleMapping(this, 'SecurityManagerRoleMapping', {
        domain: osdomain,
        roleName: 'security_manager',
        masterUserPasswordSecret: apiCreds,
  
        // this definition is what you'd PUT to the OpenSearch API:
        // https://opensearch.org/docs/latest/security-plugin/access-control/api/#create-role-mapping
        roleMappingDefinition: {
          backend_roles: [isAdministratorGroupRole.roleArn],
          hosts: ['*'],
          users: ['admin'],
        },
      });
  
      new ssm.StringParameter(this, `SSMDomain`, {
        stringValue: domain,
        parameterName: `/datalake/opensearch/domain`,
      });
    }
  }
  