import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { OpenSearchCatalogConstruct } from './constructus/opensearch-catalog-construct';


export interface PlatformStackProps extends cdk.StackProps {
  hostedZone: string;
  domainCatalog: string;
}

export class PlatformDatalakeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: PlatformStackProps) {
    super(scope, id, props);

    const { hostedZone, domainCatalog } = props!;

    new OpenSearchCatalogConstruct(this, "OpenSearchCatalogs", {
      hostedZone,
      domain: domainCatalog
    });
  }
}
