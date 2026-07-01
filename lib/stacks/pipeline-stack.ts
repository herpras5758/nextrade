import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNode from "aws-cdk-lib/aws-lambda-nodejs";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as events from "aws-cdk-lib/aws-events";
import * as eventsTargets from "aws-cdk-lib/aws-events-targets";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as path from "path";
import { Construct } from "constructs";

// Pipeline Stack — Document Processing Pipeline.
//
// Orchestrates: S3 upload event -> Classify (Bedrock) -> Extract
// (Textract + Bedrock) -> Reconcile (Source Resolution + Smart
// Reconciliation) -> Item Match -> CTDM Write. Real implementations live
// in ../../lambda/* — this stack just wires them together; the actual
// extraction/reconciliation logic is in those files, built and verified
// against the OBOR/Ungaran Sari Garments sample shipment (7 real
// document types, the cross-format number discrepancy that motivated
// numberFormat.ts).
//
// Step Functions replaces BullMQ from the original spec — same
// conceptual pipeline, AWS-native orchestration instead of a
// Redis-backed job queue.

interface PipelineStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  documentsBucket: s3.Bucket;
  dbSecretArn: string;
  dbSecurityGroup: ec2.SecurityGroup;
}

export class PipelineStack extends cdk.Stack {
  public readonly stateMachine: sfn.StateMachine;
  public readonly deadLetterQueue: sqs.Queue;

  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);

    this.deadLetterQueue = new sqs.Queue(this, "PipelineDLQ", {
      queueName: "nextrade-pipeline-dlq",
      retentionPeriod: cdk.Duration.days(14),
    });

    const lambdaEnv = {
      DOCUMENTS_BUCKET: props.documentsBucket.bucketName,
      DB_SECRET_ARN: props.dbSecretArn,
    };

    const backendRoot = path.join(__dirname, "../..");

    const baseProps: Partial<lambdaNode.NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_20_X,
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [props.dbSecurityGroup],
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: lambdaEnv,
      bundling: {
        externalModules: ["@aws-sdk/*"], // present in the Lambda Node 20 runtime already
      },
    };

    const classifyFn = new lambdaNode.NodejsFunction(this, "ClassifyDocumentFn", {
      ...baseProps,
      functionName: "nextrade-classify-document",
      entry: path.join(backendRoot, "lambda/classify-document/index.ts"),
    } as lambdaNode.NodejsFunctionProps);

    // Image Enhancement — IDP Engine module #2, runs first. Uses sharp,
    // which ships platform-specific native bindings. NOTE: bundled via
    // local esbuild (nodeModules below), NOT forceDockerBundling — the
    // build host (CloudShell, Amazon Linux x64) already matches the
    // Lambda runtime architecture, so `npm install`'s locally-resolved
    // sharp binary is already correct; Docker cross-compilation isn't
    // needed and was burning CloudShell's limited disk quota on image
    // layers for no benefit. If this stack is ever deployed from a
    // different host architecture (e.g. Apple Silicon laptop), add
    // forceDockerBundling back for that environment specifically.
    const enhanceImageFn = new lambdaNode.NodejsFunction(this, "EnhanceImageFn", {
      ...baseProps,
      functionName: "nextrade-enhance-image",
      entry: path.join(backendRoot, "lambda/enhance-image/index.ts"),
      bundling: {
        ...baseProps.bundling,
        nodeModules: ["sharp"],
      },
    } as lambdaNode.NodejsFunctionProps);

    const extractFn = new lambdaNode.NodejsFunction(this, "ExtractFieldsFn", {
      ...baseProps,
      functionName: "nextrade-extract-fields",
      timeout: cdk.Duration.minutes(10), // Textract AnalyzeDocument + Bedrock reasoning on multi-page PDFs
      entry: path.join(backendRoot, "lambda/extract-fields/index.ts"),
    } as lambdaNode.NodejsFunctionProps);

    // Document Linking Engine — groups documents into shipments by
    // cross-reference number (PO/Invoice/BL), runs after Extract (needs
    // the reference numbers) and before Reconcile (needs a shipmentId to
    // attach CTDM fields to).
    const linkShipmentFn = new lambdaNode.NodejsFunction(this, "LinkShipmentFn", {
      ...baseProps,
      functionName: "nextrade-link-shipment",
      entry: path.join(backendRoot, "lambda/link-shipment/index.ts"),
    } as lambdaNode.NodejsFunctionProps);

    const reconcileFn = new lambdaNode.NodejsFunction(this, "ReconcileFieldsFn", {
      ...baseProps,
      functionName: "nextrade-reconcile-fields",
      entry: path.join(backendRoot, "lambda/reconcile-fields/index.ts"),
    } as lambdaNode.NodejsFunctionProps);

    // AI Validation — IDP Engine module #6. Business-rule checks on
    // resolved values (HS code format, positive weights, date sanity),
    // distinct from Reconcile's confidence scoring.
    const aiValidateFn = new lambdaNode.NodejsFunction(this, "AiValidateFn", {
      ...baseProps,
      functionName: "nextrade-ai-validate",
      entry: path.join(backendRoot, "lambda/ai-validate/index.ts"),
    } as lambdaNode.NodejsFunctionProps);

    const itemMatchFn = new lambdaNode.NodejsFunction(this, "ItemMatchFn", {
      ...baseProps,
      functionName: "nextrade-item-match",
      entry: path.join(backendRoot, "lambda/item-match/index.ts"),
    } as lambdaNode.NodejsFunctionProps);

    const ctdmWriteFn = new lambdaNode.NodejsFunction(this, "CtdmWriteFn", {
      ...baseProps,
      functionName: "nextrade-ctdm-write",
      entry: path.join(backendRoot, "lambda/ctdm-write/index.ts"),
    } as lambdaNode.NodejsFunctionProps);

    // Permissions: Textract for OCR/extraction, Bedrock for reasoning
    // (classify + extract both call the AI Engine Adapter), Secrets
    // Manager for DB credentials on every Lambda that talks to Postgres.
    for (const fn of [classifyFn, extractFn]) {
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ["textract:AnalyzeDocument", "textract:DetectDocumentText"],
          resources: ["*"],
        })
      );
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ["bedrock:InvokeModel"],
          resources: ["*"], // cross-region call to ap-southeast-1 per AI Engine Adapter default config
        })
      );
    }
    for (const fn of [linkShipmentFn, reconcileFn, aiValidateFn, itemMatchFn, ctdmWriteFn]) {
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ["secretsmanager:GetSecretValue"],
          resources: [props.dbSecretArn],
        })
      );
    }

    // --- State machine definition ---
    const enhanceImageStep = new tasks.LambdaInvoke(this, "EnhanceImage", {
      lambdaFunction: enhanceImageFn,
      outputPath: "$.Payload",
    });
    const classifyStep = new tasks.LambdaInvoke(this, "ClassifyDocument", {
      lambdaFunction: classifyFn,
      outputPath: "$.Payload",
    });
    const extractStep = new tasks.LambdaInvoke(this, "ExtractFields", {
      lambdaFunction: extractFn,
      outputPath: "$.Payload",
    });
    const linkShipmentStep = new tasks.LambdaInvoke(this, "LinkShipment", {
      lambdaFunction: linkShipmentFn,
      outputPath: "$.Payload",
    });
    const reconcileStep = new tasks.LambdaInvoke(this, "ReconcileFields", {
      lambdaFunction: reconcileFn,
      outputPath: "$.Payload",
    });
    const aiValidateStep = new tasks.LambdaInvoke(this, "AiValidate", {
      lambdaFunction: aiValidateFn,
      outputPath: "$.Payload",
    });
    const itemMatchStep = new tasks.LambdaInvoke(this, "MatchItems", {
      lambdaFunction: itemMatchFn,
      outputPath: "$.Payload",
    });
    const ctdmWriteStep = new tasks.LambdaInvoke(this, "WriteCtdm", {
      lambdaFunction: ctdmWriteFn,
      outputPath: "$.Payload",
    });

    const definition = enhanceImageStep
      .next(classifyStep)
      .next(extractStep)
      .next(linkShipmentStep)
      .next(reconcileStep)
      .next(aiValidateStep)
      .next(itemMatchStep)
      .next(ctdmWriteStep);

    this.stateMachine = new sfn.StateMachine(this, "DocumentProcessingPipeline", {
      stateMachineName: "nextrade-document-pipeline",
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: cdk.Duration.minutes(30),
      tracingEnabled: true, // X-Ray — needed for "Monitoring/Logging" enterprise quality standard
    });

    // Trigger function — real implementation now: parses the S3 event
    // detail off the EventBridge rule, derives tenantId/documentId from
    // the object key (uploads/{tenantId}/{uuid}-{filename}, see
    // api/src/routes/documents.ts upload-url route), and starts an
    // execution per uploaded document.
    const triggerFn = new lambdaNode.NodejsFunction(this, "TriggerPipelineFn", {
      functionName: "nextrade-trigger-pipeline",
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(120),  // Bedrock PDF extraction needs up to 2 min
      memorySize: 512,  // PDF processing needs more memory
      entry: path.join(backendRoot, "lambda/trigger-pipeline/index.ts"),
      environment: {
        STATE_MACHINE_ARN: this.stateMachine.stateMachineArn,
        DOCUMENTS_BUCKET_NAME: props.documentsBucket.bucketName,
        DB_SECRET_ARN: props.dbSecretArn,
        AWS_REGION_NAME: props.env?.region ?? 'ap-southeast-3',
      },
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [props.dbSecurityGroup],
      bundling: { externalModules: ["@aws-sdk/*"] },
    });
    this.stateMachine.grantStartExecution(triggerFn);
    triggerFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: [props.dbSecretArn],
      })
    );
    // Bedrock permission for extraction
    triggerFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel"],
        resources: ["*"],
      })
    );
    // S3 permission to read documents for extraction
    props.documentsBucket.grantRead(triggerFn);
    // Throttle pipeline starts to a controlled rate even under bulk
    // upload bursts (hundreds of files at once) — maxConcurrency on the
    // SQS event source caps how many trigger invocations run in
    // parallel, which in turn caps how fast Step Functions executions
    // (and therefore Textract/Bedrock calls) get kicked off. This is
    // preferred over reservedConcurrentExecutions, which carves a fixed
    // slice out of the ACCOUNT-WIDE concurrency pool — on accounts with
    // a low total limit (e.g. a fresh/sandbox account), that can push
    // the account's unreserved pool below AWS's required minimum of 10
    // and fail the deploy outright, which is exactly what happened here.

    // SQS buffer between EventBridge and the trigger Lambda. Without
    // this, a 200-file bulk upload fires 200 near-simultaneous
    // EventBridge events straight at the Lambda; with reservedConcurrency
    // alone (no buffer), the excess invocations would simply be
    // throttled and DROPPED by Lambda, not queued. SQS makes them queue
    // safely instead, and the existing deadLetterQueue catches anything
    // that fails repeatedly after retries.
    const triggerQueue = new sqs.Queue(this, "PipelineTriggerQueue", {
      queueName: "nextrade-pipeline-trigger-queue",
      visibilityTimeout: cdk.Duration.seconds(60),
      deadLetterQueue: { queue: this.deadLetterQueue, maxReceiveCount: 3 },
    });
    triggerFn.addEventSource(
      new lambdaEventSources.SqsEventSource(triggerQueue, { batchSize: 1, maxConcurrency: 5 })
    );

    // EventBridge Rule, not a direct S3 bucket notification — this is the
    // fix for the circular dependency between Storage and Pipeline stacks
    // (a direct s3 notification would mutate the bucket resource itself,
    // which lives in StorageStack, while Pipeline already depends on
    // StorageStack for the bucket name — EventBridge decouples that).
    // Requires `eventBridgeEnabled: true` on the bucket (set in
    // StorageStack).
    new events.Rule(this, "DocumentUploadedRule", {
      ruleName: "nextrade-document-uploaded",
      eventPattern: {
        source: ["aws.s3"],
        detailType: ["Object Created"],
        detail: {
          bucket: { name: [props.documentsBucket.bucketName] },
          object: { key: [{ prefix: "uploads/" }] },
        },
      },
      targets: [new eventsTargets.SqsQueue(triggerQueue)],
    });

    // ── New v2 Lambdas ──────────────────────────────────────────────────────

    const v2BaseProps = {
      runtime: lambda.Runtime.NODEJS_20_X,
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [props.dbSecurityGroup],
      bundling: { externalModules: ["@aws-sdk/*"] },
      environment: {
        DB_SECRET_ARN: props.dbSecretArn,
        DOCUMENTS_BUCKET_NAME: props.documentsBucket.bucketName,
      },
    };

    const dbSecretPolicy = new iam.PolicyStatement({
      actions: ["secretsmanager:GetSecretValue"],
      resources: [props.dbSecretArn],
    });

    // Identity Engine — entity resolution from identity_signals
    const identityEngineFn = new lambdaNode.NodejsFunction(this, "IdentityEngineFn", {
      functionName: "nextrade-identity-engine",
      entry: path.join(backendRoot, "lambda/identity-engine/index.ts"),
      timeout: cdk.Duration.minutes(5),
      ...v2BaseProps,
    });
    identityEngineFn.addToRolePolicy(dbSecretPolicy);

    // Dry Run Analyze — AI analysis before commit
    const dryRunFn = new lambdaNode.NodejsFunction(this, "DryRunAnalyzeFn", {
      functionName: "nextrade-dry-run-analyze",
      entry: path.join(backendRoot, "lambda/dry-run-analyze/index.ts"),
      timeout: cdk.Duration.minutes(10),
      ...v2BaseProps,
    });
    dryRunFn.addToRolePolicy(dbSecretPolicy);
    dryRunFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ["bedrock:InvokeModel"],
      resources: ["*"],
    }));
    props.documentsBucket.grantRead(dryRunFn);

    // Session Commit — moves files from staging to uploads, triggers pipeline
    const sessionCommitFn = new lambdaNode.NodejsFunction(this, "SessionCommitFn", {
      functionName: "nextrade-session-commit",
      entry: path.join(backendRoot, "lambda/session-commit/index.ts"),
      timeout: cdk.Duration.minutes(5),
      ...v2BaseProps,
      environment: {
        ...v2BaseProps.environment,
        TRIGGER_PIPELINE_FUNCTION_NAME: triggerFn.functionName,
      },
    });
    sessionCommitFn.addToRolePolicy(dbSecretPolicy);
    props.documentsBucket.grantReadWrite(sessionCommitFn);
    triggerFn.grantInvoke(sessionCommitFn);

    // Session Cleanup — removes expired dry-run sessions
    const sessionCleanupFn = new lambdaNode.NodejsFunction(this, "SessionCleanupFn", {
      functionName: "nextrade-session-cleanup",
      entry: path.join(backendRoot, "lambda/session-cleanup/index.ts"),
      timeout: cdk.Duration.minutes(5),
      ...v2BaseProps,
    });
    sessionCleanupFn.addToRolePolicy(dbSecretPolicy);
    props.documentsBucket.grantReadWrite(sessionCleanupFn);

    // Cleanup runs every hour via EventBridge scheduled rule
    new events.Rule(this, "SessionCleanupSchedule", {
      ruleName: "nextrade-session-cleanup-hourly",
      schedule: events.Schedule.rate(cdk.Duration.hours(1)),
      targets: [new eventsTargets.LambdaFunction(sessionCleanupFn)],
    });

    // Reasoning Engine — impact analysis after document changes to protected shipments
    const reasoningFn = new lambdaNode.NodejsFunction(this, "ReasoningEngineFn", {
      functionName: "nextrade-reasoning-engine",
      entry: path.join(backendRoot, "lambda/reasoning-engine/index.ts"),
      timeout: cdk.Duration.minutes(5),
      ...v2BaseProps,
    });
    reasoningFn.addToRolePolicy(dbSecretPolicy);
    reasoningFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ["bedrock:InvokeModel"],
      resources: ["*"],
    }));

    // Pass new function names to compute stack via outputs (API needs them)
    new cdk.CfnOutput(this, "DryRunAnalyzeFunctionName",  { value: dryRunFn.functionName });
    new cdk.CfnOutput(this, "SessionCommitFunctionName",  { value: sessionCommitFn.functionName });
    new cdk.CfnOutput(this, "ReasoningEngineFunctionName",{ value: reasoningFn.functionName });

    new cdk.CfnOutput(this, "StateMachineArn", { value: this.stateMachine.stateMachineArn });
  }
}
