import { Handler } from 'aws-lambda';
import { getPool } from '../shared/dbPool.js';
import schema from '../../db/schema.sql';

export const handler: Handler = async () => {
  const pool = await getPool();
  const client = await pool.connect();
  try {
    await client.query(schema);
    return { success: true, message: 'Ship-X v2 schema applied' };
  } finally {
    client.release();
  }
};
