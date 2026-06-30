import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNode from "aws-cdk-lib/aws-lambda-nodejs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as path from "path";
import { Construct } from "constructs";

// Data Stack — RDS PostgreSQL Multi-AZ.
//
// IMPORTANT (Rule #1, PROJECT_RULES.md): the schema here implements the
// Canonical Trade Data Model from day one. We do NOT start with a generic
// "documents" table and bolt CTDM on later — every other rule (#2 Source
// Resolution, #3 Reconciliation, #5 CEISA Readiness, #6 Item Matching)
// depends on this shape existing first.
//
// The actual DDL lives in db/schema.sql and is applied via a CDK custom
// resource (see DbInitFunction below) the first time the stack deploys —
// this keeps the schema in version control and reviewable, instead of a
// ClickOps step.

interface DataStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
}

export class DataStack extends cdk.Stack {
  public readonly cluster: rds.DatabaseInstance;
  public readonly dbSecret: secretsmanager.ISecret;
  public readonly dbSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    this.dbSecurityGroup = new ec2.SecurityGroup(this, "DbSecurityGroup", {
      vpc: props.vpc,
      description: "NexTrade RDS PostgreSQL - only reachable from app tier",
      allowAllOutbound: false,
    });
    // Explicit egress rules — NOT allowAllOutbound, since this SG is
    // also attached to the RDS instance itself and to utility Lambdas
    // like ApplySchemaFn below that share it. "allowAllOutbound: false
    // + zero egress rules" silently blocks ALL outbound traffic
    // (including HTTPS to Secrets Manager), which is what broke
    // ApplySchemaFn's first deploy — it could reach neither Secrets
    // Manager nor the database itself. Scoped rules fix that without
    // going back to wide-open egress.
    this.dbSecurityGroup.addEgressRule(
      ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      ec2.Port.tcp(5432),
      "Allow Postgres traffic within the VPC"
    );
    this.dbSecurityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      "Allow HTTPS egress (Secrets Manager, etc) via NAT"
    );

    this.cluster = new rds.DatabaseInstance(this, "NexTradeDatabase", {
      engine: rds.DatabaseInstanceEngine.postgres({
        // Generic version constructor (not the VER_16_3 enum member) —
        // ap-southeast-3 (Jakarta) doesn't carry every minor version AWS
        // ships globally, and pinning to a real, currently-available
        // version (verified via `aws rds describe-db-engine-versions`)
        // avoids deploy failures from stale enum values in older CDK
        // releases.
        version: rds.PostgresEngineVersion.of("16.14", "16"),
      }),
      // Production-ready mode per locked decision: Multi-AZ, sized for
      // hundreds of shipments/month with headroom for the Trade
      // Intelligence Engine's relational query load.
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.R6G, ec2.InstanceSize.LARGE),
      multiAz: true,
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [this.dbSecurityGroup],
      databaseName: "nextrade",
      credentials: rds.Credentials.fromGeneratedSecret("nextrade_admin"),
      allocatedStorage: 100,
      maxAllocatedStorage: 500, // storage autoscaling as document volume grows
      storageEncrypted: true,
      backupRetention: cdk.Duration.days(14),
      deletionProtection: true, // intentional: this is the system of record
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
      cloudwatchLogsExports: ["postgresql"],
      monitoringInterval: cdk.Duration.seconds(60),
      enablePerformanceInsights: true,
    });

    this.dbSecret = this.cluster.secret!;

    // One-off schema-apply Lambda — see lambda/apply-schema/index.ts for
    // the full rationale. Sits in the private-with-egress subnet (needs
    // outbound to Secrets Manager) but shares the DB security group, so
    // it's covered by the VPC-CIDR ingress rule ComputeStack already
    // adds to that group for the API tier — no extra SG rule needed
    // here.
    const applySchemaFn = new lambdaNode.NodejsFunction(this, "ApplySchemaFn", {
      functionName: "nextrade-apply-schema",
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, "../../lambda/apply-schema/index.ts"),
      timeout: cdk.Duration.minutes(2),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [this.dbSecurityGroup],
      environment: { DB_SECRET_ARN: this.dbSecret.secretArn },
      bundling: {
        externalModules: ["@aws-sdk/*"],
        loader: { ".sql": "text" }, // inlines db/schema.sql content as a string at bundle time
      },
    });
    applySchemaFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: [this.dbSecret.secretArn],
      })
    );

    new cdk.CfnOutput(this, "DbEndpoint", { value: this.cluster.dbInstanceEndpointAddress });
    new cdk.CfnOutput(this, "DbSecretArn", { value: this.dbSecret.secretArn });
    new cdk.CfnOutput(this, "ApplySchemaFunctionName", { value: applySchemaFn.functionName });
  }
}
