import { FastifyInstance } from 'fastify';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { createHash } from 'crypto';
import { withTenant } from '../lib/db.js';
import { assertTenantAccess } from '../middleware/auth.js';

const s3 = new S3Client({});
const sqs = new SQSClient({});
const BUCKET = process.env.DOCUMENTS_BUCKET_NAME!;
const CLASSIFY_QUEUE = process.env.CLASSIFY_EXTRACT_QUEUE_URL!;

export async function uploadRoutes(app: FastifyInstance) {

  // POST /tenants/:tenantId/upload-url
  // Step 1: Get presigned URL + create document record
  // Client then PUTs file directly to S3
  // S3 event → SQS → classify-extract Lambda handles the rest
  app.post('/tenants/:tenantId/upload-url', async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    assertTenantAccess(req.auth!, tenantId);

    const { fileName, contentType, fileSizeBytes } = req.body as {
      fileName: string;
      contentType: string;
      fileSizeBytes: number;
    };

    if (!fileName || !contentType) {
      return reply.code(400).send({ error: 'fileName and contentType required' });
    }

    return withTenant(tenantId, async (client) => {
      // Dedup check by filename + size (lightweight, hash not available yet)
      // Full dedup by SHA256 hash happens after upload via file_hash field
      const docId = crypto.randomUUID();
      const s3Key = `uploads/${tenantId}/${docId}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

      // Create document record immediately (status=uploaded)
      const { rows: [{ id: documentId }] } = await client.query(
        `INSERT INTO documents
           (id, tenant_id, file_name, s3_key, file_size_bytes, mime_type, status, intake_source)
         VALUES ($1,$2,$3,$4,$5,$6,'uploaded','upload')
         RETURNING id`,
        [docId, tenantId, fileName, s3Key, fileSizeBytes ?? null, contentType]
      );

      // Presign PUT URL (client uploads directly to S3)
      const uploadUrl = await getSignedUrl(s3, new PutObjectCommand({
        Bucket: BUCKET, Key: s3Key,
        ContentType: contentType,
      }), { expiresIn: 3600 });

      // Write evidence event
      await client.query(
        `INSERT INTO evidence_events (tenant_id, event_type, actor_type, entity_type, entity_id, payload)
         VALUES ($1,'DOCUMENT_UPLOADED','user','DOCUMENT',$2,$3)`,
        [tenantId, documentId, JSON.stringify({ file_name: fileName, s3_key: s3Key })]
      );

      return {
        documentId,
        uploadUrl,
        s3Key,
        message: 'PUT file to uploadUrl, then call /confirm-upload',
      };
    });
  });

  // POST /tenants/:tenantId/confirm-upload
  // Called after S3 PUT succeeds. Optionally updates file_hash.
  // Then queues for classify-extract.
  app.post('/tenants/:tenantId/confirm-upload', async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    assertTenantAccess(req.auth!, tenantId);

    const { documentId, fileHash } = req.body as {
      documentId: string;
      fileHash?: string;  // SHA256 hex from client (optional but recommended for dedup)
    };

    return withTenant(tenantId, async (client) => {
      const { rows: [doc] } = await client.query(
        `SELECT * FROM documents WHERE id=$1 AND tenant_id=$2`, [documentId, tenantId]
      );
      if (!doc) return reply.code(404).send({ error: 'Document not found' });
      if (doc.status !== 'uploaded') return reply.code(409).send({ error: `Document already in status: ${doc.status}` });

      // Check dedup by hash
      if (fileHash) {
        const { rows: [dup] } = await client.query(
          `SELECT id, file_name FROM documents
           WHERE tenant_id=$1 AND file_hash=$2 AND id!=$3 AND status!='archived'
           LIMIT 1`,
          [tenantId, fileHash, documentId]
        );
        if (dup) {
          // Mark as archived (duplicate), don't process
          await client.query(
            `UPDATE documents SET status='archived', error_message=$1 WHERE id=$2`,
            [`Duplicate of ${dup.id} (${dup.file_name})`, documentId]
          );
          return { isDuplicate: true, originalDocumentId: dup.id, originalFileName: dup.file_name };
        }

        await client.query(
          `UPDATE documents SET file_hash=$1 WHERE id=$2`, [fileHash, documentId]
        );
      }

      // Queue for classify-extract (non-blocking — returns immediately)
      await sqs.send(new SendMessageCommand({
        QueueUrl: CLASSIFY_QUEUE,
        MessageBody: JSON.stringify({ documentId, tenantId, s3Key: doc.s3_key }),
      }));

      await client.query(
        `UPDATE documents SET status='classifying', updated_at=NOW() WHERE id=$1`, [documentId]
      );

      return { documentId, status: 'classifying', message: 'Processing started' };
    });
  });
}
