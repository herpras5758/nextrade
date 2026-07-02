import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import pg from 'pg';

const { Pool } = pg;
let pool: pg.Pool | null = null;

export async function getPool(): Promise<pg.Pool> {
  if (pool) return pool;

  const secretArn = process.env.DB_SECRET_ARN!;
  const sm = new SecretsManagerClient({});
  const { SecretString } = await sm.send(new GetSecretValueCommand({ SecretId: secretArn }));
  const secret = JSON.parse(SecretString!);

  pool = new Pool({
    host:     secret.host,
    port:     secret.port ?? 5432,
    database: secret.dbname,
    user:     secret.username,
    password: secret.password,
    ssl:      { rejectUnauthorized: false },
    max:      3,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  return pool;
}
