import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNode from "aws-cdk-lib/aws-lambda-nodejs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as path from "path";
import { Construct } from "constructs";

// Auth Stack — Cognito User Pool.
//
// Rule #7 (Multi-Tenant Context Switch): every user carries a custom
// attribute listing the tenant IDs they can access. The frontend's
// TenantProvider reads this at login to populate availableTenants — a
// user can never request a tenant ID that isn't in this claim, even if
// they try to forge the request, because API Gateway authorizers check
// the JWT claim, not a client-supplied parameter.
//
// RBAC: implemented as Cognito Groups (one per role), not as a custom
// attribute, so we get IAM-integrated authorization for free on any
// API Gateway route that needs it.

interface AuthStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  dbSecurityGroup: ec2.SecurityGroup;
  dbSecretArn: string;
}

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    this.userPool = new cognito.UserPool(this, "NexTradeUserPool", {
      userPoolName: "nextrade-users",
      selfSignUpEnabled: false, // enterprise B2B — accounts are provisioned by admins
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        givenName: { required: true, mutable: true },
        familyName: { required: true, mutable: true },
      },
      customAttributes: {
        // CSV of tenant IDs this user can access — the source of truth
        // for TenantProvider.availableTenants on the frontend.
        tenant_ids: new cognito.StringAttribute({ mutable: true, maxLen: 2048 }),
        // User-selected UI language, persisted per Rule (i18n decision):
        // chosen manually at first login, not auto-detected.
        preferred_lang: new cognito.StringAttribute({ mutable: true, maxLen: 5 }),
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // never accidentally drop user accounts
    });

    // RBAC groups — mirrors the role matrix from the spec. Adding a role
    // later means adding a group here + IAM policy, not new application
    // code (Rule #4, Configuration-First).
    const roles = [
      { name: "operator", description: "Uploads documents, reviews AI flags" },
      { name: "compliance_officer", description: "Approves CEISA submission, manages rules" },
      { name: "finance", description: "Views CTDM commercial data, read-only on documents" },
      { name: "executive", description: "Dashboard & analytics only, read-only everywhere" },
      { name: "admin", description: "Tenant/user management, full configuration access" },
    ];
    roles.forEach(
      (role) =>
        new cognito.CfnUserPoolGroup(this, `Group-${role.name}`, {
          userPoolId: this.userPool.userPoolId,
          groupName: role.name,
          description: role.description,
        })
    );

    this.userPoolClient = this.userPool.addClient("NexTradeWebClient", {
      authFlows: { userSrp: true },
      generateSecret: false, // SPA — public client, PKCE handled by frontend SDK
      accessTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // One-off seed-data Lambda — see lambda/seed-data/index.ts. Same
    // pattern as ApplySchemaFn in DataStack: manually invoked once, not
    // a custom resource, since "create the first tenant + admin user"
    // is a one-time bootstrap action, not infrastructure that should
    // re-run on every stack update.
    const seedDataFn = new lambdaNode.NodejsFunction(this, "SeedDataFn", {
      functionName: "nextrade-seed-data",
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, "../../lambda/seed-data/index.ts"),
      timeout: cdk.Duration.minutes(2),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [props.dbSecurityGroup],
      environment: {
        DB_SECRET_ARN: props.dbSecretArn,
        COGNITO_USER_POOL_ID: this.userPool.userPoolId,
      },
      bundling: { externalModules: ["@aws-sdk/*"] },
    });
    seedDataFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: [props.dbSecretArn],
      })
    );
    seedDataFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cognito-idp:AdminCreateUser", "cognito-idp:AdminAddUserToGroup"],
        resources: [this.userPool.userPoolArn],
      })
    );

    new cdk.CfnOutput(this, "UserPoolId", { value: this.userPool.userPoolId });
    new cdk.CfnOutput(this, "UserPoolClientId", { value: this.userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, "SeedDataFunctionName", { value: seedDataFn.functionName });
  }
}
