import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";

// Network Stack — single VPC in Jakarta (ap-southeast-3) per the region
// decision locked with the user. Public subnets for ALB, private subnets
// (egress via NAT) for ECS tasks, isolated subnets for RDS/ElastiCache —
// standard 3-tier separation so the database is never directly reachable
// from the internet, satisfying "Security First" (PROJECT_RULES.md core
// principles inherited from the vision doc).

export class NetworkStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, "NexTradeVpc", {
      vpcName: "nextrade-vpc",
      ipAddresses: ec2.IpAddresses.cidr("10.20.0.0/16"),
      maxAzs: 2, // Multi-AZ per production-ready decision
      natGateways: 2, // one per AZ for HA — avoid the single-NAT bottleneck
      subnetConfiguration: [
        {
          name: "public",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: "private-app",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          name: "isolated-data",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    // Gateway endpoint for S3 — keeps document traffic (Textract input/
    // output, CTDM artifacts) off the NAT Gateway, which is both cheaper
    // and reduces blast radius of egress misconfiguration.
    this.vpc.addGatewayEndpoint("S3Endpoint", {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });

    new cdk.CfnOutput(this, "VpcId", { value: this.vpc.vpcId });
  }
}
