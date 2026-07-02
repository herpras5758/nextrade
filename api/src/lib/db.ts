import pg from 'pg';

const { Pool } = pg;
let pool: pg.Pool | null = null;

export async function getPool(): Promise<pg.Pool> {
  if (pool) return pool;

  // ECS injects DB_CREDENTIALS as JSON string from Secrets Manager
  const creds = JSON.parse(process.env.DB_CREDENTIALS!);

  pool = new Pool({
    host:     creds.host,
    port:     creds.port ?? 5432,
    database: creds.dbname,
    user:     creds.username,
    password: creds.password,
    ssl:      { rejectUnauthorized: false },
    max:      10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  return pool;
}

export async function withTenant<T>(
  tenantId: string,
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const p = await getPool();
  const client = await p.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
