import { Handler } from 'aws-lambda';
import { S3Client, DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getPool } from '../shared/dbPool.js';

const s3 = new S3Client({ requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' });
const BUCKET = process.env.DOCUMENTS_BUCKET_NAME!;

// Runs every hour via EventBridge Scheduled Rule.
// Removes expired sessions (> 24 hours old, status != COMMITTED).
export const handler: Handler = async () => {
  const pool = await getPool();
  const client = await pool.connect();
  try {
    const { rows: expired } = await client.query(
      `SELECT id, s3_staging_prefix FROM upload_sessions
       WHERE expires_at < NOW() AND status NOT IN ('COMMITTED')`,
    );

    for (const session of expired) {
      // Delete staged files from S3
      if (session.s3_staging_prefix) {
        const listed = await s3.send(new ListObjectsV2Command({
          Bucket: BUCKET, Prefix: session.s3_staging_prefix,
        }));
        if (listed.Contents && listed.Contents.length > 0) {
          await s3.send(new DeleteObjectsCommand({
            Bucket: BUCKET,
            Delete: { Objects: listed.Contents.map(o => ({ Key: o.Key! })) },
          }));
        }
      }
      // Delete session records
      await client.query(`DELETE FROM upload_session_files WHERE session_id = $1`, [session.id]);
      await client.query(`UPDATE upload_sessions SET status = 'CANCELLED' WHERE id = $1`, [session.id]);
    }

    return { success: true, cleaned: expired.length };
  } finally {
    client.release();
  }
};
