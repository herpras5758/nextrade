import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNode from "aws-cdk-lib/aws-lambda-nodejs";
import * as ses from "aws-cdk-lib/aws-ses";
import * as sesActions from "aws-cdk-lib/aws-ses-actions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as path from "path";
import { Construct } from "constructs";

// Email Intake Stack — "no human touch" document intake via registered
// forwarding address. Confirmed design: tenant sets an auto-forwarding
// rule (mail-server level) in their real mailbox, not OAuth mailbox
// integration (that's a future-phase option).
//
// *** REGION CONSTRAINT - VERIFY BEFORE DEPLOYING ***
// SES inbound email RECEIVING is historically only available in a
// handful of AWS regions (us-east-1, us-west-2, eu-west-1 longest
// standing). ap-southeast-3 (Jakarta) almost certainly does not have it
// given how new that region is. This stack therefore takes its OWN
// region, independent of core Jakarta infra — same cross-region pattern
// already used for the AI Engine Adapter's Bedrock calls. Re-verify with
// `aws ses describe-receipt-rule-set --region <candidate>` before
// picking a region.
//
// *** DOMAIN OWNERSHIP PREREQUISITE ***
// SES receiving requires a verified domain with MX records pointing at
// SES — code alone cannot provision DNS. This stack creates the SES
// domain identity + receipt rules; the MX record itself is a manual DNS
// step documented in DEPLOY.md.

interface EmailIntakeStackProps extends cdk.StackProps {
  intakeDomain: string; // e.g. "mail.nextrade.id" — must be owned & DNS-controllable
  documentsBucketName: string;
  dbSecretArn: string;
}

export class EmailIntakeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: EmailIntakeStackProps) {
    super(scope, id, props);

    const rawEmailBucket = new s3.Bucket(this, "RawEmailBucket", {
      bucketName: `nextrade-raw-email-${this.account}-${this.region}`,
      lifecycleRules: [{ expiration: cdk.Duration.days(30) }],
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    rawEmailBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "AllowSESPuts",
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal("ses.amazonaws.com")],
        actions: ["s3:PutObject"],
        resources: [rawEmailBucket.arnForObjects("*")],
        conditions: { StringEquals: { "aws:Referer": this.account } },
      })
    );

    new ses.EmailIdentity(this, "IntakeDomainIdentity", {
      identity: ses.Identity.domain(props.intakeDomain),
    });

    const parseEmailFn = new lambdaNode.NodejsFunction(this, "ParseInboundEmailFn", {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, "../../lambda/parse-inbound-email/index.ts"),
      timeout: cdk.Duration.minutes(2),
      memorySize: 512,
      environment: {
        EMAIL_RAW_BUCKET: rawEmailBucket.bucketName,
        DOCUMENTS_BUCKET: props.documentsBucketName,
        DB_SECRET_ARN: props.dbSecretArn,
      },
      bundling: { externalModules: ["@aws-sdk/*"] },
    });

    // Cross-region S3 write — parsed attachments land in the Jakarta
    // documents bucket directly via the S3 API regardless of which
    // region this Lambda itself runs in (S3 endpoints are global).
    parseEmailFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:PutObject"],
        resources: [`arn:aws:s3:::${props.documentsBucketName}/uploads/*`],
      })
    );
    parseEmailFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: [props.dbSecretArn],
      })
    );
    rawEmailBucket.grantRead(parseEmailFn);

    // NOTE: parseEmailFn is NOT in the Jakarta VPC (it may live in a
    // different region entirely), so it reaches RDS over the public
    // endpoint via Secrets Manager credentials. Follow-up hardening:
    // expose an internal API ingestion endpoint instead of querying
    // Postgres directly cross-region — not yet implemented.

    const ruleSet = new ses.ReceiptRuleSet(this, "IntakeRuleSet", {
      receiptRuleSetName: "nextrade-email-intake",
    });

    ruleSet.addRule("StoreAndProcess", {
      recipients: [props.intakeDomain],
      actions: [new sesActions.S3({ bucket: rawEmailBucket }), new sesActions.Lambda({ function: parseEmailFn })],
      scanEnabled: true,
    });

    new cdk.CfnOutput(this, "IntakeDomain", { value: props.intakeDomain });
    new cdk.CfnOutput(this, "RawEmailBucketName", { value: rawEmailBucket.bucketName });
    new cdk.CfnOutput(this, "DnsSetupNote", {
      value: "After deploy: verify domain (TXT record SES provides), then add MX record -> inbound-smtp.<region>.amazonaws.com priority 10. See DEPLOY.md.",
    });
  }
}
