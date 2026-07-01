import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53targets from "aws-cdk-lib/aws-route53-targets";
import { Construct } from "constructs";

interface StorageStackProps extends cdk.StackProps {
  // Optional: set once domain is ordered and hosted zone created.
  // Leave undefined to use default CloudFront domain (current setup).
  // When set: CloudFront gets custom domain + ACM cert automatically.
  domainName?: string;     // e.g. "nextrade.io"
  hostedZoneId?: string;  // Route 53 Hosted Zone ID
}

// Storage Stack — document storage + frontend static hosting.
//
// Two distinct buckets with different lifecycle/access patterns:
//  - documentsBucket: raw uploads + Textract output. Private, encrypted,
//    versioned (documents are evidence — Rule "Evidence First" — we never
//    silently overwrite a prior version).
//  - frontendBucket: the built React app, served via CloudFront. Public
//    only through CloudFront OAC, never directly.

export class StorageStack extends cdk.Stack {
  public readonly documentsBucket: s3.Bucket;
  public readonly frontendBucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props?: StorageStackProps) {
    super(scope, id, props);

    this.documentsBucket = new s3.Bucket(this, "DocumentsBucket", {
      bucketName: `nextrade-documents-${this.account}-${this.region}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      eventBridgeEnabled: true, // lets PipelineStack subscribe via an
                                 // EventBridge Rule instead of a direct S3
                                 // notification config — avoids a circular
                                 // CDK dependency between Storage and
                                 // Pipeline stacks.
      lifecycleRules: [
        {
          // Raw originals move to cheaper storage after 90 days but are
          // never deleted automatically — these are the evidentiary
          // source for customs audits.
          transitions: [
            { storageClass: s3.StorageClass.INFREQUENT_ACCESS, transitionAfter: cdk.Duration.days(90) },
          ],
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.frontendBucket = new s3.Bucket(this, "FrontendBucket", {
      bucketName: `nextrade-frontend-${this.account}-${this.region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // rebuildable static assets, safe to drop on stack teardown
      autoDeleteObjects: true,
    });

    const oac = new cloudfront.S3OriginAccessControl(this, "FrontendOac", {});

    // Custom domain setup — optional, activated when domain is ordered.
    // ACM certificate MUST be in us-east-1 for CloudFront (global requirement).
    let certificate: acm.ICertificate | undefined;
    let domainNames: string[] | undefined;

    if (props?.domainName && props?.hostedZoneId) {
      const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, "HostedZone", {
        hostedZoneId: props.hostedZoneId,
        zoneName: props.domainName,
      });

      // Certificate must be in us-east-1 — use DnsValidatedCertificate
      // which auto-creates the Route 53 validation record.
      certificate = new acm.Certificate(this, "Certificate", {
        domainName: props.domainName,
        subjectAlternativeNames: [`app.${props.domainName}`, `*.${props.domainName}`],
        validation: acm.CertificateValidation.fromDns(hostedZone),
      });

      domainNames = [props.domainName, `app.${props.domainName}`];
    }

    this.distribution = new cloudfront.Distribution(this, "FrontendDistribution", {
      comment: "NexTrade frontend (S3 + CloudFront)",
      defaultRootObject: "index.html",
      // Custom domain — only set when domain is configured
      ...(domainNames && certificate ? { domainNames, certificate } : {}),
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.frontendBucket, {
          originAccessControl: oac,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      // SPA routing: any 403/404 from S3 (path doesn't physically exist)
      // falls back to index.html so React Router can handle the route.
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: "/index.html" },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: "/index.html" },
      ],
    });

    // DNS record — only create when domain is configured
    if (props?.domainName && props?.hostedZoneId) {
      const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, "HostedZoneRef", {
        hostedZoneId: props.hostedZoneId,
        zoneName: props.domainName,
      });
      new route53.ARecord(this, "AppDnsRecord", {
        zone: hostedZone,
        recordName: props.domainName,
        target: route53.RecordTarget.fromAlias(
          new route53targets.CloudFrontTarget(this.distribution)
        ),
      });
    }

    new cdk.CfnOutput(this, "DocumentsBucketName", { value: this.documentsBucket.bucketName });
    new cdk.CfnOutput(this, "FrontendBucketName", { value: this.frontendBucket.bucketName });
    new cdk.CfnOutput(this, "CloudFrontUrl", { value: `https://${this.distribution.distributionDomainName}` });
  }
}
