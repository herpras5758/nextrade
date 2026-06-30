#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { NetworkStack } from "../lib/stacks/network-stack";
import { DataStack } from "../lib/stacks/data-stack";
import { AuthStack } from "../lib/stacks/auth-stack";
import { StorageStack } from "../lib/stacks/storage-stack";
import { PipelineStack } from "../lib/stacks/pipeline-stack";
import { ComputeStack } from "../lib/stacks/compute-stack";
import { CacheStack } from "../lib/stacks/cache-stack";
import { SearchStack } from "../lib/stacks/search-stack";
import { EmailIntakeStack } from "../lib/stacks/email-intake-stack";
import { GitHubOidcStack } from "../lib/stacks/github-oidc-stack";

// ============================================================================
// NexTrade — CDK App Entry Point
// ============================================================================
// Deploy order matters (dependencies flow top to bottom). Run individually
// via CloudShell, NOT `cdk deploy --all` blind — review each stack's diff
// first given the cost profile we just spent two rounds cleaning up:
//
//   cdk deploy NexTrade-Network
//   cdk deploy NexTrade-Data        (takes ~10-15 min, RDS Multi-AZ)
//   cdk deploy NexTrade-Auth
//   cdk deploy NexTrade-Storage
//   cdk deploy NexTrade-Cache       (ElastiCache Redis, ~10-15 min)
//   cdk deploy NexTrade-Search      (OpenSearch, ~15-20 min, slowest stack)
//   cdk deploy NexTrade-Pipeline
//   cdk deploy NexTrade-Compute
//
// Region: ap-southeast-3 (Jakarta) for all core infra, per the locked
// region decision. AI Engine calls cross-region to ap-southeast-1
// (Bedrock) via the adapter in lambda/ai-engine-adapter — verify Bedrock
// regional availability again at deploy time since AWS adds regions
// faster than this comment gets updated.
// ============================================================================

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: "ap-southeast-3",
};

const networkStack = new NetworkStack(app, "NexTrade-Network", { env });

const dataStack = new DataStack(app, "NexTrade-Data", {
  env,
  vpc: networkStack.vpc,
});

const authStack = new AuthStack(app, "NexTrade-Auth", {
  env,
  vpc: networkStack.vpc,
  dbSecurityGroup: dataStack.dbSecurityGroup,
  dbSecretArn: dataStack.dbSecret.secretArn,
});

const storageStack = new StorageStack(app, "NexTrade-Storage", { env });

const cacheStack = new CacheStack(app, "NexTrade-Cache", {
  env,
  vpc: networkStack.vpc,
});

const searchStack = new SearchStack(app, "NexTrade-Search", {
  env,
  vpc: networkStack.vpc,
});

const pipelineStack = new PipelineStack(app, "NexTrade-Pipeline", {
  env,
  vpc: networkStack.vpc,
  documentsBucket: storageStack.documentsBucket,
  dbSecretArn: dataStack.dbSecret.secretArn,
  dbSecurityGroup: dataStack.dbSecurityGroup,
});

const computeStack = new ComputeStack(app, "NexTrade-Compute", {
  env,
  vpc: networkStack.vpc,
  dbSecret: dataStack.dbSecret,
  dbSecurityGroup: dataStack.dbSecurityGroup,
  documentsBucketName: storageStack.documentsBucket.bucketName,
  userPoolId: authStack.userPool.userPoolId,
  userPoolClientId: authStack.userPoolClient.userPoolClientId,
});

cdk.Tags.of(app).add("Project", "NexTrade");
cdk.Tags.of(app).add("ManagedBy", "CDK");

// GitHub Actions OIDC deploy role — enable once the GitHub repo exists:
//   cdk deploy NexTrade-GitHubOidc -c githubOrg=your-org -c githubRepo=nextrade --exclusively
const githubOrg = app.node.tryGetContext("githubOrg");
const githubRepo = app.node.tryGetContext("githubRepo");
if (githubOrg && githubRepo) {
  new GitHubOidcStack(app, "NexTrade-GitHubOidc", {
    env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: "ap-southeast-3" },
    githubOrg,
    githubRepo,
    allowedBranches: ["main"],
  });
}

// Email Intake Stack — NOT deployed by default. Requires a decision on
// (a) intake domain ownership and (b) which region actually supports
// SES inbound receiving (see email-intake-stack.ts header comment).
// Enable explicitly once both are decided:
//   cdk deploy NexTrade-EmailIntake -c intakeDomain=mail.nextrade.id -c emailRegion=us-east-1
const intakeDomain = app.node.tryGetContext("intakeDomain");
if (intakeDomain) {
  new EmailIntakeStack(app, "NexTrade-EmailIntake", {
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: app.node.tryGetContext("emailRegion") ?? "us-east-1",
    },
    intakeDomain,
    documentsBucketName: storageStack.documentsBucket.bucketName,
    dbSecretArn: dataStack.dbSecret.secretArn,
  });
}
