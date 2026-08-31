#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { PlatformDatalakeStack } from '../lib/datalake-stack';

const hostedZone =
  process.env.CDK_DEFAULT_ACCOUNT == process.env.CDK_DEV_ACCOUNT
    ? "dev.euler.tools"
    : "euler.tools";

const domainCatalog =
  process.env.CDK_DEFAULT_ACCOUNT == process.env.CDK_DEV_ACCOUNT
    ? "opensearch.dev.euler.tools"
    : "catalog.euler.tools";

const app = new cdk.App();

new PlatformDatalakeStack(app, 'Datalake', {
  hostedZone,
  domainCatalog,
  description: "Data Catalog to store, manage and expose all our system entities",
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});