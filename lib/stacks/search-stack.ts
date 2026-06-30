import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as opensearch from "aws-cdk-lib/aws-opensearchservice";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

// Search Stack — OpenSearch Service, powers the Trade Intelligence
// Engine's cross-entity search (Supplier, Shipment, Item, Container —
// "no manual linking whenever possible", per the vision doc) and
// full-text document search. RDS remains the system of record for CTDM;
// OpenSearch is a derived, eventually-consistent index kept in sync by
// the Pipeline Stack's CTDM Write step, not written to directly by the
// API for anything authoritative.

interface SearchStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
}

export class SearchStack extends cdk.Stack {
  public readonly domain: opensearch.Domain;
  public readonly searchSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: SearchStackProps) {
    super(scope, id, props);

    this.searchSecurityGroup = new ec2.SecurityGroup(this, "SearchSecurityGroup", {
      vpc: props.vpc,
      description: "NexTrade OpenSearch - app tier only",
      allowAllOutbound: false,
    });

    this.domain = new opensearch.Domain(this, "TradeIntelligenceDomain", {
      version: opensearch.EngineVersion.OPENSEARCH_2_15,
      vpc: props.vpc,
      vpcSubnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, onePerAz: true }],
      securityGroups: [this.searchSecurityGroup],
      // Production-ready, Multi-AZ per locked decision — OpenSearch
      // requires an EVEN data node count for a 2-AZ deployment (odd
      // counts like 3 are rejected outright), so 4 nodes (2 per AZ) is
      // the minimum sane HA topology here, not 3.
      capacity: {
        dataNodes: 4,
        dataNodeInstanceType: "r6g.large.search",
        multiAzWithStandbyEnabled: false,
      },
      zoneAwareness: { enabled: true, availabilityZoneCount: 2 },
      ebs: { volumeSize: 100, volumeType: ec2.EbsDeviceVolumeType.GP3 },
      encryptionAtRest: { enabled: true },
      nodeToNodeEncryption: true,
      enforceHttps: true,
      fineGrainedAccessControl: { masterUserName: "nextrade_admin" },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Only the API/Pipeline Lambda execution roles should reach this
    // domain — access policy is tightened per-principal once those roles
    // exist; placeholder here grants the account root so the domain is
    // usable immediately during early integration testing.
    this.domain.addAccessPolicies(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.AccountRootPrincipal()],
        actions: ["es:ESHttp*"],
        resources: [`${this.domain.domainArn}/*`],
      })
    );

    new cdk.CfnOutput(this, "OpenSearchEndpoint", { value: this.domain.domainEndpoint });
  }
}
