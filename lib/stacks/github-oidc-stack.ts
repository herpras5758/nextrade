import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

// GitHub OIDC Stack — lets GitHub Actions deploy via `cdk deploy`
// without ever storing a long-lived AWS access key in GitHub Secrets.
// GitHub's runner requests a short-lived OIDC token, AWS verifies it
// against this trust policy (scoped to one specific repo + branch), and
// issues temporary credentials for exactly one role with exactly the
// permissions needed: assuming the SAME cdk-hnb659fds-* bootstrap roles
// CloudShell has been using all along. No new permission surface is
// created — this just changes WHERE `cdk deploy` runs from.

interface GitHubOidcStackProps extends cdk.StackProps {
  githubOrg: string;
  githubRepo: string;
  /** Branches allowed to deploy, e.g. ["main"] */
  allowedBranches: string[];
}

export class GitHubOidcStack extends cdk.Stack {
  public readonly deployRole: iam.Role;

  constructor(scope: Construct, id: string, props: GitHubOidcStackProps) {
    super(scope, id, props);

    // GitHub's OIDC provider already exists in this account (a residual
    // from an earlier, unrelated setup — found via `aws iam
    // list-open-id-connect-providers` after a CREATE_FAILED
    // EntityAlreadyExistsException). AWS allows exactly one OIDC
    // provider per unique URL per account, so we import the existing
    // one rather than creating a duplicate.
    const provider = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      this,
      "GitHubOidcProvider",
      `arn:aws:iam::${this.account}:oidc-provider/token.actions.githubusercontent.com`
    );

    const subjectConditions = props.allowedBranches.map(
      (branch) => `repo:${props.githubOrg}/${props.githubRepo}:ref:refs/heads/${branch}`
    );

    this.deployRole = new iam.Role(this, "GitHubDeployRole", {
      roleName: "nextrade-github-actions-deploy",
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
        StringLike: { "token.actions.githubusercontent.com:sub": subjectConditions },
      }),
      description: "Assumed by GitHub Actions to run cdk deploy - scoped to one repo/branch via OIDC trust condition.",
      maxSessionDuration: cdk.Duration.hours(1),
    });

    // This role's ONLY permission is assuming the CDK bootstrap roles —
    // same roles CloudShell already uses (cdk-hnb659fds-deploy-role,
    // file-publishing-role, lookup-role, image-publishing-role). It has
    // no direct service permissions of its own, so even a compromised
    // GitHub Actions run is bounded by exactly what those bootstrap
    // roles already allow — no new privilege escalation surface.
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["sts:AssumeRole"],
        resources: [`arn:aws:iam::${this.account}:role/cdk-hnb659fds-*-${this.account}-*`],
      })
    );

    new cdk.CfnOutput(this, "GitHubDeployRoleArn", { value: this.deployRole.roleArn });
  }
}
