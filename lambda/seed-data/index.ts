// Seed Data — one-off utility Lambda, same pattern as apply-schema:
// manually invoked once, NOT a CDK custom resource. Creates exactly
// what's needed to test the system end-to-end for the first time: one
// tenant row, one Cognito user in the "admin" group with that tenant_id
// in their custom:tenant_ids claim.
//
// Invoke after Compute Stack (needs Cognito User Pool) is live:
//   aws lambda invoke --function-name nextrade-seed-data --region ap-southeast-3 \
//     --payload '{"tenantName":"PT Ungaran Sari Garments","tenantCode":"USG","adminEmail":"admin@ungaransari.test"}' \
//     --cli-binary-format raw-in-base64-out /tmp/seed-out.json
//   cat /tmp/seed-out.json
//
// The admin user is created with a TEMPORARY password (shown in the
// output) and FORCE_CHANGE_PASSWORD status.

import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import pg from "pg";
import crypto from "crypto";

interface SeedInput {
  tenantName: string;
  tenantCode: string;
  adminEmail: string;
}

export async function handler(event: SeedInput) {
  const { tenantName, tenantCode, adminEmail } = event;
  if (!tenantName || !tenantCode || !adminEmail) {
    return { success: false, error: "tenantName, tenantCode, and adminEmail are all required." };
  }

  const secretArn = process.env.DB_SECRET_ARN!;
  const smClient = new SecretsManagerClient({});
  const secretResult = await smClient.send(new GetSecretValueCommand({ SecretId: secretArn }));
  const creds = JSON.parse(secretResult.SecretString!);

  const pool = new pg.Pool({
    host: creds.host,
    port: creds.port,
    user: creds.username,
    password: creds.password,
    database: creds.dbname,
    ssl: { rejectUnauthorized: false },
  });

  let tenantId: string;
  try {
    const existing = await pool.query(`SELECT id FROM tenants WHERE code = $1`, [tenantCode]);
    if (existing.rows.length > 0) {
      tenantId = existing.rows[0].id;
    } else {
      const inserted = await pool.query(
        `INSERT INTO tenants (code, name, default_language) VALUES ($1, $2, 'id') RETURNING id`,
        [tenantCode, tenantName]
      );
      tenantId = inserted.rows[0].id;
    }
  } finally {
    await pool.end();
  }

  const userPoolId = process.env.COGNITO_USER_POOL_ID!;
  const cognito = new CognitoIdentityProviderClient({});
  const tempPassword = `Temp${crypto.randomBytes(6).toString("hex")}!1`;

  try {
    await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: adminEmail,
        UserAttributes: [
          { Name: "email", Value: adminEmail },
          { Name: "email_verified", Value: "true" },
          { Name: "given_name", Value: "Admin" },
          { Name: "family_name", Value: tenantName },
          { Name: "custom:tenant_ids", Value: tenantId },
          { Name: "custom:preferred_lang", Value: "id" },
        ],
        TemporaryPassword: tempPassword,
        MessageAction: "SUPPRESS",
      })
    );
    await cognito.send(
      new AdminAddUserToGroupCommand({ UserPoolId: userPoolId, Username: adminEmail, GroupName: "admin" })
    );
  } catch (err: any) {
    if (err.name === "UsernameExistsException") {
      return {
        success: true,
        tenantId,
        message: `Tenant ensured (${tenantId}). Cognito user ${adminEmail} already existed - not recreated.`,
      };
    }
    throw err;
  }

  return {
    success: true,
    tenantId,
    adminEmail,
    temporaryPassword: tempPassword,
    note: "Save this password now - it is not retrievable later. User must change it on first login.",
  };
}
