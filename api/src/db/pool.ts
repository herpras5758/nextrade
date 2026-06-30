import pg from "pg";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

// Rule #7 (Multi-Tenant Context Switch) enforcement, second line of
// defense: every query MUST run with app.current_tenant_id set on the
// session, because the RLS policies in schema.sql key off it. The
// `withTenant` helper below is the ONLY sanctioned way routes touch the
// database — it makes "forgot to scope by tenant" structurally
// impossible rather than relying on every route author remembering a
// WHERE clause.

let pool: pg.Pool | null = null;

async function getDbCredentials() {
  // Two different injection patterns exist in this codebase, both
  // valid for their respective compute platform:
  //   - ECS (Compute Stack): injects the SECRET VALUE directly as the
  //     DB_CREDENTIALS env var via ecs.Secret.fromSecretsManager — no
  //     extra API call needed at runtime, the container starts with it
  //     already resolved.
  //   - Lambda (Pipeline/Data/Auth stacks): only gets DB_SECRET_ARN as
  //     a plain env var and fetches the value itself via
  //     GetSecretValueCommand at invocation time.
  // This function supports both, preferring the already-resolved value
  // when present so the API doesn't make an unnecessary Secrets Manager
  // call on every cold connection.
  const injectedCredentials = process.env.DB_CREDENTIALS;
  if (injectedCredentials) {
    return JSON.parse(injectedCredentials) as {
      username: string;
      password: string;
      host: string;
      port: number;
      dbname: string;
    };
  }

  const secretArn = process.env.DB_SECRET_ARN;
  if (!secretArn) throw new Error("Neither DB_CREDENTIALS nor DB_SECRET_ARN is set");

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
    max: 10,
    ssl: { rejectUnauthorized: false }, // RDS managed cert
  });
  return pool;
}

/**
 * Runs `fn` with a dedicated client that has app.current_tenant_id set
 * for the duration of the transaction. Rule #7: this is the only path
 * into the database — there is no "raw pool.query" used in route
 * handlers, specifically so a tenant-scoping mistake can't compile.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
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
