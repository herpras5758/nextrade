// Apply Schema — one-off utility Lambda, NOT part of the document
// pipeline. Runs db/schema.sql against RDS exactly once, manually
// invoked. RDS lives in an isolated subnet (no internet route, by
// design), so CloudShell can't reach it directly with psql. Rather than
// a bastion host/EC2 jump box just for this one task, a Lambda in the
// same VPC/security group does the job with far less infrastructure to
// manage and tear down afterward.
//
// NOT a CDK custom resource — deliberately. schema.sql is pure DDL
// (CREATE TABLE, not "IF NOT EXISTS"), so re-running it on every stack
// update would fail loudly the second time. Manual, explicit, once.
//
// Invoke after deploying this stack:
//   aws lambda invoke --function-name nextrade-apply-schema --region ap-southeast-3 /tmp/out.json
//   cat /tmp/out.json

import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import pg from "pg";
// esbuild's "text" loader (configured in the CDK construct) inlines the
// raw SQL file content as a string at bundle time.
// @ts-ignore - text loader import, no type declarations for .sql files
import schemaSql from "../../db/schema.sql";

export async function handler() {
  const secretArn = process.env.DB_SECRET_ARN!;
  const client = new SecretsManagerClient({});
  const result = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
  const creds = JSON.parse(result.SecretString!) as {
    username: string;
    password: string;
    host: string;
    port: number;
    dbname: string;
  };

  const pool = new pg.Pool({
    host: creds.host,
    port: creds.port,
    user: creds.username,
    password: creds.password,
    database: creds.dbname,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await pool.query(schemaSql as string);
    return { success: true, message: "Schema applied successfully." };
  } catch (err: any) {
    return { success: false, error: err.message, detail: err.detail ?? null };
  } finally {
    await pool.end();
  }
}
