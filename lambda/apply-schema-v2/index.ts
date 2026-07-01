// Apply Schema v2 — Event Sourcing schema.
// Same pattern as apply-schema: import SQL as text via esbuild loader.
// Invoke manually after deploy:
//   aws lambda invoke --function-name nextrade-apply-schema-v2 --region ap-southeast-3 /tmp/out.json

import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import pg from "pg";
// esbuild text loader inlines schema-v2.sql as a string at bundle time
import schemaSql from "../../db/schema-v2.sql";

const sm = new SecretsManagerClient({});

export const handler = async () => {
  const secret = await sm.send(new GetSecretValueCommand({ SecretId: process.env.DB_SECRET_ARN! }));
  const creds = JSON.parse(secret.SecretString!);

  const pool = new pg.Pool({
    host: creds.host, port: creds.port, database: creds.dbname,
    user: creds.username, password: creds.password, ssl: { rejectUnauthorized: false },
    max: 1,
  });

  try {
    await pool.query(schemaSql as string);
    return { success: true, message: "Schema v2.0 applied — event sourcing foundation ready" };
  } catch (err: any) {
    console.error("Schema v2 apply failed:", err.message);
    return { success: false, error: err.message };
  } finally {
    await pool.end();
  }
};
