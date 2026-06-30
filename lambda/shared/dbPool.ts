import pg from "pg";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

// Same contract as api/src/db/pool.ts — Lambda functions in the
// pipeline are a second writer into CTDM (the API is the other), so they
// get the identical withTenant() guarantee: no query runs without
// app.current_tenant_id set, Rule #7 enforced regardless of which
// compute layer is doing the writing.

let pool: pg.Pool | null = null;

async function getDbCredentials() {
  const secretArn = process.env.DB_SECRET_ARN;
  if (!secretArn) throw new Error("DB_SECRET_ARN not set");
  const client = new SecretsManagerClient({});
  const result = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
  return JSON.parse(result.SecretString!) as {
    username: string;
    password: string;
    host: string;
    port: number;
    dbname: string;
  };
}

export async function getPool(): Promise<pg.Pool> {
  if (pool) return pool;
  const creds = await getDbCredentials();
  pool = new pg.Pool({
    host: creds.host,
    port: creds.port,
    user: creds.username,
    password: creds.password,
    database: creds.dbname,
    max: 3, // Lambdas are short-lived, keep the pool small per concurrent execution
    ssl: { rejectUnauthorized: false },
  });
  return pool;
}

export async function withTenant<T>(tenantId: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const p = await getPool();
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
