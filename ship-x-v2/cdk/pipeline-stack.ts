import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3notifications from 'aws-cdk-lib/aws-s3-notifications';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

interface PipelineStackProps extends cdk.StackProps {
  documentsBucket: s3.IBucket;
  dbSecret: secretsmanager.ISecret;
  cognitoUserPoolId: string;
}

export class ShipXPipelineStack extends cdk.Stack {
  public readonly classifyExtractQueue: sqs.Queue;
  public readonly resolutionQueue: sqs.Queue;
  public readonly classifyExtractFn: lambda.Function;
  public readonly resolutionEngineFn: lambda.Function;
  public readonly applySchemaFn: lambda.Function;
  public readonly seedDataFn: lambda.Function;

  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);

    const { documentsBucket, dbSecret } = props;

    // ── Dead Letter Queues ────────────────────────────────────────────────────
    const classifyDLQ = new sqs.Queue(this, 'ClassifyDLQ', {
      queueName: 'ship-x-classify-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    const resolutionDLQ = new sqs.Queue(this, 'ResolutionDLQ', {
      queueName: 'ship-x-resolution-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    // ── Queues ────────────────────────────────────────────────────────────────
    this.classifyExtractQueue = new sqs.Queue(this, 'ClassifyExtractQueue', {
      queueName: 'ship-x-classify-extract',
      visibilityTimeout: cdk.Duration.minutes(15),  // Lambda timeout × 6
      deadLetterQueue: { queue: classifyDLQ, maxReceiveCount: 3 },
    });

    this.resolutionQueue = new sqs.Queue(this, 'ResolutionQueue', {
      queueName: 'ship-x-resolution-engine',
      visibilityTimeout: cdk.Duration.minutes(6),
      deadLetterQueue: { queue: resolutionDLQ, maxReceiveCount: 3 },
    });

    // ── Common Lambda config ──────────────────────────────────────────────────
    const commonEnv = {
      DB_SECRET_ARN: dbSecret.secretArn,
      DOCUMENTS_BUCKET_NAME: documentsBucket.bucketName,
      CLASSIFY_EXTRACT_QUEUE_URL: this.classifyExtractQueue.queueUrl,
      RESOLUTION_QUEUE_URL: this.resolutionQueue.queueUrl,
      USER_POOL_ID: props.cognitoUserPoolId,
      NODE_OPTIONS: '--enable-source-maps',
    };

    const commonPolicy = [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [dbSecret.secretArn],
      }),
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
        resources: [`${documentsBucket.bucketArn}/*`],
      }),
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['sqs:SendMessage'],
        resources: [this.classifyExtractQueue.queueArn, this.resolutionQueue.queueArn],
      }),
    ];

    // ── classify-extract Lambda ───────────────────────────────────────────────
    this.classifyExtractFn = new lambda.Function(this, 'ClassifyExtract', {
      functionName: 'ship-x-classify-extract',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('/tmp/lambda-classify-extract.zip'),
      timeout: cdk.Duration.minutes(10),   // PDF splitting + AI calls can be slow
      memorySize: 1024,
      environment: commonEnv,
      description: 'Ship-X: Classify and extract fields from uploaded documents (ADR-010)',
    });

    this.classifyExtractFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['secretsmanager:GetSecretValue'],
      resources: [dbSecret.secretArn],
    }));

    for (const stmt of commonPolicy) {
      this.classifyExtractFn.addToRolePolicy(stmt);
    }

    // Trigger from classify-extract SQS
    this.classifyExtractFn.addEventSource(new lambdaEventSources.SqsEventSource(this.classifyExtractQueue, {
      batchSize: 1,      // Process one file at a time (AI calls are expensive)
      maxConcurrency: 10,
    }));

    // ── resolution-engine Lambda ──────────────────────────────────────────────
    this.resolutionEngineFn = new lambda.Function(this, 'ResolutionEngine', {
      functionName: 'ship-x-resolution-engine',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('/tmp/lambda-resolution-engine.zip'),
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: commonEnv,
      description: 'Ship-X: BFS connected component resolution engine (ADR-010)',
    });

    for (const stmt of commonPolicy) {
      this.resolutionEngineFn.addToRolePolicy(stmt);
    }

    this.resolutionEngineFn.addEventSource(new lambdaEventSources.SqsEventSource(this.resolutionQueue, {
      batchSize: 5,
      maxConcurrency: 5,
    }));

    // ── apply-schema Lambda ───────────────────────────────────────────────────
    this.applySchemaFn = new lambda.Function(this, 'ApplySchema', {
      functionName: 'ship-x-apply-schema',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('/tmp/lambda-apply-schema.zip'),
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      environment: { DB_SECRET_ARN: dbSecret.secretArn },
      description: 'Ship-X: Apply database schema',
    });

    this.applySchemaFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['secretsmanager:GetSecretValue'],
      resources: [dbSecret.secretArn],
    }));

    // ── seed-data Lambda ──────────────────────────────────────────────────────
    this.seedDataFn = new lambda.Function(this, 'SeedData', {
      functionName: 'ship-x-seed-data',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('/tmp/lambda-seed-data.zip'),
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      environment: {
        DB_SECRET_ARN: dbSecret.secretArn,
        USER_POOL_ID: props.cognitoUserPoolId,
      },
      description: 'Ship-X: Seed tenant, doc types, field configs, matching rules',
    });

    this.seedDataFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['secretsmanager:GetSecretValue'],
      resources: [dbSecret.secretArn],
    }));

    this.seedDataFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['cognito-idp:AdminCreateUser', 'cognito-idp:AdminSetUserPassword',
                'cognito-idp:AdminAddUserToGroup', 'cognito-idp:AdminUpdateUserAttributes'],
      resources: [`arn:aws:cognito-idp:*:*:userpool/${props.cognitoUserPoolId}`],
    }));

    // ── S3 → SQS trigger ─────────────────────────────────────────────────────
    // When file uploaded to S3, queue classify-extract
    // NOTE: S3 event notification set up via custom resource or console
    // because CDK S3 notifications can conflict with existing bucket config
    new cdk.CfnOutput(this, 'ClassifyExtractQueueUrl', {
      value: this.classifyExtractQueue.queueUrl,
      exportName: 'ShipXClassifyExtractQueueUrl',
    });

    new cdk.CfnOutput(this, 'ResolutionQueueUrl', {
      value: this.resolutionQueue.queueUrl,
      exportName: 'ShipXResolutionQueueUrl',
    });

    // Queue ARN for S3 notification
    new cdk.CfnOutput(this, 'ClassifyExtractQueueArn', {
      value: this.classifyExtractQueue.queueArn,
      exportName: 'ShipXClassifyExtractQueueArn',
    });
  }
}
