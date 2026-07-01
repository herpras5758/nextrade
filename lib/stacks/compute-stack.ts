import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecsPatterns from "aws-cdk-lib/aws-ecs-patterns";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as path from "path";
import { Construct } from "constructs";

// Compute Stack — ECS Fargate running the NexTrade API (Node.js/TypeScript
// per the locked stack decision). Fargate, not EC2 launch type — this is
// deliberate after the cleanup ordeal: no container instances to leak,
// no orphaned EC2 to chase down in a future cleanup.

interface ComputeStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  dbSecret: secretsmanager.ISecret;
  dbSecurityGroup: ec2.SecurityGroup;
  documentsBucketName: string;
  userPoolId: string;
  userPoolClientId: string;
  // NOTE: CloudFront /api/* behavior is managed outside CDK — see comment in constructor
}

export class ComputeStack extends cdk.Stack {
  public readonly service: ecsPatterns.ApplicationLoadBalancedFargateService;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    const cluster = new ecs.Cluster(this, "NexTradeCluster", {
      vpc: props.vpc,
      clusterName: "nextrade-api-cluster",
      containerInsightsV2: ecs.ContainerInsights.ENABLED, // "Monitoring" enterprise quality standard
    });

    // Allow the API tier to reach the database tier — single rule, defined
    // once here, not duplicated per Lambda/service.
    props.dbSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      ec2.Port.tcp(5432),
      "Allow API tier to reach PostgreSQL"
    );

    this.service = new ecsPatterns.ApplicationLoadBalancedFargateService(this, "ApiService", {
      cluster,
      serviceName: "nextrade-api",
      cpu: 1024,
      memoryLimitMiB: 2048,
      desiredCount: 2, // Multi-AZ resilience per production-ready decision
      taskImageOptions: {
        // CDK builds this image from ../../Dockerfile + ../../api/src at
        // `cdk deploy` time and pushes it to a CDK-managed ECR asset
        // repo automatically — no manual docker build/push/ECR-login
        // dance, and critically: this is the REAL Fastify service with a
        // working /health route, not the inert node:20-alpine
        // placeholder that left the previous deploy attempt stuck
        // waiting forever for a health check that could never pass.
        image: ecs.ContainerImage.fromAsset(path.join(__dirname, "../.."), {
          file: "Dockerfile",
        }),
        containerPort: 3000,
        environment: {
          NODE_ENV: "production",
          DOCUMENTS_BUCKET: props.documentsBucketName,
          COGNITO_USER_POOL_ID: props.userPoolId,
          COGNITO_CLIENT_ID: props.userPoolClientId,
          AWS_REGION_CORE: this.region,
          // v2 Lambda function names — API calls these for dry run + commit
          DRY_RUN_ANALYZE_FUNCTION_NAME:    "nextrade-dry-run-analyze",
          SESSION_COMMIT_FUNCTION_NAME:     "nextrade-session-commit",
          REASONING_ENGINE_FUNCTION_NAME:   "nextrade-reasoning-engine",
          TRIGGER_PIPELINE_FUNCTION_NAME:   "nextrade-trigger-pipeline",
          DOCUMENTS_BUCKET_NAME:            props.documentsBucketName,
        },
        secrets: {
          DB_CREDENTIALS: ecs.Secret.fromSecretsManager(props.dbSecret),
        },
      },
      publicLoadBalancer: true,
      listenerPort: 80,
      protocol: cdk.aws_elasticloadbalancingv2.ApplicationProtocol.HTTP,
      // NOTE: HTTP only for now — no domain/ACM certificate configured yet.
      // Once a domain is chosen, switch listenerPort to 443, protocol to
      // HTTPS, and pass `domainName` + `domainZone` (Route53 hosted zone)
      // to this construct; CDK validates that requirement at synth time.
    });

    this.service.targetGroup.configureHealthCheck({
      path: "/health",
      interval: cdk.Duration.seconds(30),
      healthyThresholdCount: 2,
    });

    // Auto-scaling: hundreds of shipments/month is not a high-QPS API,
    // but burst traffic during month-end customs deadlines is real —
    // scale on CPU, floor at 2 tasks (Multi-AZ), ceiling generous enough
    // to absorb a burst without manual intervention.
    const scaling = this.service.service.autoScaleTaskCount({ minCapacity: 2, maxCapacity: 10 });
    scaling.scaleOnCpuUtilization("CpuScaling", {
      targetUtilizationPercent: 60,
      scaleInCooldown: cdk.Duration.minutes(5),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    // NOTE: CloudFront /api/* behavior is managed OUTSIDE CDK (added
    // manually via `aws cloudfront update-distribution` CLI) to avoid a
    // circular stack dependency: StorageStack already depends on
    // ComputeStack via ALB DNS name for its CloudFront origin, so
    // ComputeStack cannot also depend on StorageStack's Distribution
    // object or ID without creating a cycle CDK rejects at synth time.
    // The behavior is already live in the distribution (verified working).
    // Any future updates to it must go through CLI or a separate
    // standalone stack that depends on neither StorageStack nor
    // ComputeStack.

    new cdk.CfnOutput(this, "ApiUrl", { value: `https://${this.service.loadBalancer.loadBalancerDnsName}` });

    // ECS task role needs permission to invoke v2 Lambdas
    this.service.taskDefinition.taskRole.addToPrincipalPolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: [
          `arn:aws:lambda:${this.region}:${this.account}:function:nextrade-dry-run-analyze`,
          `arn:aws:lambda:${this.region}:${this.account}:function:nextrade-session-commit`,
          `arn:aws:lambda:${this.region}:${this.account}:function:nextrade-reasoning-engine`,
          `arn:aws:lambda:${this.region}:${this.account}:function:nextrade-trigger-pipeline`,
        ],
      })
    );
  }
}
