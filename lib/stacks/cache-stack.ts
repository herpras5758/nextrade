import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elasticache from "aws-cdk-lib/aws-elasticache";
import { Construct } from "constructs";

// Cache Stack — ElastiCache Redis, isolated subnet, private from the
// internet. Used for: session/JWT verification cache (avoid hitting
// Cognito JWKS endpoint on every request), CEISA readiness score cache
// for the dashboard KPI cards, and rate-limiting counters. Not used for
// anything that must survive a restart — Redis here is a cache, not a
// system of record (that's RDS).

interface CacheStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
}

export class CacheStack extends cdk.Stack {
  public readonly redisEndpoint: string;
  public readonly cacheSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: CacheStackProps) {
    super(scope, id, props);

    this.cacheSecurityGroup = new ec2.SecurityGroup(this, "CacheSecurityGroup", {
      vpc: props.vpc,
      description: "NexTrade ElastiCache Redis - app tier only",
      allowAllOutbound: false,
    });

    const subnetGroup = new elasticache.CfnSubnetGroup(this, "CacheSubnetGroup", {
      description: "NexTrade Redis subnet group",
      subnetIds: props.vpc.isolatedSubnets.map((s) => s.subnetId),
    });

    const replicationGroup = new elasticache.CfnReplicationGroup(this, "RedisReplicationGroup", {
      replicationGroupDescription: "NexTrade Redis (prod)",
      engine: "redis",
      // Verified via `aws elasticache describe-cache-engine-versions` and
      // `describe-reserved-cache-nodes-offerings` against ap-southeast-3:
      // Graviton (t4g) instances are not yet offered in this region, and
      // the newest Redis engine available is 6.x, not the more recent
      // 7.x default CDK might otherwise assume. Re-verify both at
      // upgrade time since AWS rolls out regional support over time.
      engineVersion: "6.0",
      cacheNodeType: "cache.t3.small",
      numCacheClusters: 2, // Multi-AZ per production-ready decision
      automaticFailoverEnabled: true,
      multiAzEnabled: true,
      cacheSubnetGroupName: subnetGroup.ref,
      securityGroupIds: [this.cacheSecurityGroup.securityGroupId],
      atRestEncryptionEnabled: true,
      transitEncryptionEnabled: true,
      transitEncryptionMode: "required",
    });
    replicationGroup.addDependency(subnetGroup);

    this.redisEndpoint = replicationGroup.attrPrimaryEndPointAddress;

    new cdk.CfnOutput(this, "RedisEndpoint", { value: this.redisEndpoint });
  }
}
