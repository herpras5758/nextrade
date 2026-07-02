import { FastifyInstance } from 'fastify';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { withTenant } from '../db/pool.js';
import { assertTenantAccess } from '../middleware/auth.js';

const s3 = new S3Client({ requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' });
const lambda = new LambdaClient({});
const BUCKET = process.env.DOCUMENTS_BUCKET_NAME!;
const DRY_RUN_FN = process.env.DRY_RUN_ANALYZE_FUNCTION_NAME ?? 'nextrade-dry-run-analyze';
const COMMIT_FN  = process.env.SESSION_COMMIT_FUNCTION_NAME  ?? 'nextrade-session-commit';

export async function uploadSessionRoutes(app: FastifyInstance) {

  // POST /tenants/:id/upload-sessions — create session
  app.post<{ Params: { tenantId: string }; Body: { userId: string } }>(
    '/tenants/:tenantId/upload-sessions',
    async (req, reply) => {
      const { tenantId } = req.params;
      assertTenantAccess(req.auth!, tenantId);
      const userId = req.auth!.userId;
      const sessionId = crypto.randomUUID();
      const stagingPrefix = `staging/${tenantId}/${userId}/${sessionId}/`;
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      return withTenant(tenantId, async (client) => {
        const { rows: [session] } = await client.query(
          `INSERT INTO upload_sessions (id, tenant_id, created_by, status, s3_staging_prefix, expires_at)
           VALUES ($1,$2,$3,'STAGING',$4,$5) RETURNING id, status, expires_at`,
          [sessionId, tenantId, userId, stagingPrefix, expiresAt]
        );
        return session;
      });
    }
  );

  // POST /tenants/:id/upload-sessions/:sid/stage-file — get presigned URL for staging
  app.post<{
    Params: { tenantId: string; sessionId: string };
    Body: { fileName: string; contentType: string; fileSizeBytes: number };
  }>(
    '/tenants/:tenantId/upload-sessions/:sessionId/stage-file',
    async (req, reply) => {
      const { tenantId, sessionId } = req.params;
      assertTenantAccess(req.auth!, tenantId);
      const { fileName, contentType, fileSizeBytes } = req.body;

      return withTenant(tenantId, async (client) => {
        const { rows: [session] } = await client.query(
          `SELECT s3_staging_prefix, status FROM upload_sessions WHERE id = $1 AND tenant_id = $2`,
          [sessionId, tenantId]
        );
        if (!session) return reply.code(404).send({ error: 'Session not found' });
        if (session.status !== 'STAGING')
          return reply.code(409).send({ error: `Session is ${session.status}, cannot stage new files` });

        const stagingKey = `${session.s3_staging_prefix}${crypto.randomUUID()}-${fileName}`;
        const fileId = crypto.randomUUID();

        const uploadUrl = await getSignedUrl(s3, new PutObjectCommand({
          Bucket: BUCKET, Key: stagingKey, ContentType: contentType,
        }), { expiresIn: 3600, unhoistableHeaders: new Set() });

        // Check for duplicate by hash
          const fileHash = (req.body as any)?.file_hash ?? null;
          const fileHash = body.file_hash ?? null;
          if (fileHash) {
            const { rows: [dup] } = await client.query(
              `SELECT d.id, d.file_name FROM documents d
               WHERE d.tenant_id = $1 AND d.file_hash = $2 LIMIT 1`,
              [tenantId, fileHash]
            );
            if (dup) {
              return { fileId, stagingKey, uploadUrl, isDuplicate: true, duplicateOf: dup.file_name };
            }
          }

          await client.query(
          `INSERT INTO upload_session_files
             (id, session_id, original_filename, s3_staging_key, file_size_bytes, file_hash)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [fileId, sessionId, fileName, stagingKey, fileSizeBytes, fileHash]
        );

        return { fileId, uploadUrl };
      });
    }
  );

  // POST /tenants/:id/upload-sessions/:sid/analyze — trigger dry run
  app.post<{ Params: { tenantId: string; sessionId: string } }>(
    '/tenants/:tenantId/upload-sessions/:sessionId/analyze',
    async (req, reply) => {
      const { tenantId, sessionId } = req.params;
      assertTenantAccess(req.auth!, tenantId);

      await lambda.send(new InvokeCommand({
        FunctionName: DRY_RUN_FN,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({ sessionId, tenantId, userId: req.auth!.userId })),
      }));

      await withTenant(tenantId, async (client) => {
        await client.query(
          `UPDATE upload_sessions SET status = 'ANALYZING' WHERE id = $1`,
          [sessionId]
        );
      });

      return { status: 'ANALYZING', message: 'Dry run analysis started' };
    }
  );

  // GET /tenants/:id/upload-sessions/:sid/preview — poll for analysis result
  app.get<{ Params: { tenantId: string; sessionId: string } }>(
    '/tenants/:tenantId/upload-sessions/:sessionId/preview',
    async (req, reply) => {
      const { tenantId, sessionId } = req.params;
      assertTenantAccess(req.auth!, tenantId);

      return withTenant(tenantId, async (client) => {
        const { rows: [session] } = await client.query(
          `SELECT id, status, summary, expires_at FROM upload_sessions WHERE id = $1 AND tenant_id = $2`,
          [sessionId, tenantId]
        );
        if (!session) return reply.code(404).send({ error: 'Session not found' });

        const { rows: files } = await client.query(
          `SELECT usf.id, usf.original_filename, usf.detected_type, usf.detected_category,
                  usf.action, usf.confidence_tier, usf.match_confidence,
                  usf.matched_shipment_id, usf.is_duplicate_of, usf.user_override, usf.analysis_detail,
                  s.shipment_number
           FROM upload_session_files usf
           LEFT JOIN shipments s ON s.id = usf.matched_shipment_id
           WHERE usf.session_id = $1
           ORDER BY usf.action, usf.match_confidence DESC`,
          [sessionId]
        );

        return { session, files };
      });
    }
  );

  // PATCH /tenants/:id/upload-sessions/:sid/files/:fid — user override action
  app.patch<{
    Params: { tenantId: string; sessionId: string; fileId: string };
    Body: { action: string; matchedShipmentId?: string };
  }>(
    '/tenants/:tenantId/upload-sessions/:sessionId/files/:fileId',
    async (req, reply) => {
      const { tenantId, sessionId, fileId } = req.params;
      assertTenantAccess(req.auth!, tenantId);
      const { action, matchedShipmentId } = req.body;

      return withTenant(tenantId, async (client) => {
        await client.query(
          `UPDATE upload_session_files
           SET action = $1, matched_shipment_id = $2, user_override = true
           WHERE id = $3 AND session_id = $4`,
          [action, matchedShipmentId ?? null, fileId, sessionId]
        );

        // Recalculate if all conflicts resolved
        const { rows: remaining } = await client.query(
          `SELECT COUNT(*) as cnt FROM upload_session_files
           WHERE session_id = $1 AND action = 'PENDING_CONFLICT_RESOLUTION'`,
          [sessionId]
        );
        const summary = await getSessionSummary(client, sessionId);
        return { updated: true, conflictsRemaining: parseInt(remaining[0].cnt), summary };
      });
    }
  );

  // POST /tenants/:id/upload-sessions/:sid/commit — execute commit
  app.post<{ Params: { tenantId: string; sessionId: string } }>(
    '/tenants/:tenantId/upload-sessions/:sessionId/commit',
    async (req, reply) => {
      const { tenantId, sessionId } = req.params;
      assertTenantAccess(req.auth!, tenantId);

      const result = await lambda.send(new InvokeCommand({
        FunctionName: COMMIT_FN,
        InvocationType: 'RequestResponse',  // sync for commit
        Payload: Buffer.from(JSON.stringify({ sessionId, tenantId, userId: req.auth!.userId })),
      }));

      const response = JSON.parse(Buffer.from(result.Payload!).toString());
      if (!response.success) return reply.code(500).send(response);
      return response;
    }
  );

  // DELETE /tenants/:id/upload-sessions/:sid — cancel
  app.delete<{ Params: { tenantId: string; sessionId: string } }>(
    '/tenants/:tenantId/upload-sessions/:sessionId',
    async (req, reply) => {
      const { tenantId, sessionId } = req.params;
      assertTenantAccess(req.auth!, tenantId);
      return withTenant(tenantId, async (client) => {
        await client.query(
          `UPDATE upload_sessions SET status = 'CANCELLED' WHERE id = $1 AND tenant_id = $2`,
          [sessionId, tenantId]
        );
        return { cancelled: true };
      });
    }
  );
}

async function getSessionSummary(client: any, sessionId: string) {
  const { rows } = await client.query(
    `SELECT action, COUNT(*) as cnt FROM upload_session_files
     WHERE session_id = $1 GROUP BY action`,
    [sessionId]
  );
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.action] = parseInt(r.cnt);
  return {
    autoAttach: counts['AUTO_ATTACH'] ?? 0,
    suggest: counts['SUGGEST'] ?? 0,
    manualReview: counts['MANUAL_REVIEW'] ?? 0,
    newShipment: counts['NEW_SHIPMENT'] ?? 0,
    conflict: counts['PENDING_CONFLICT_RESOLUTION'] ?? 0,
    duplicate: counts['DUPLICATE'] ?? 0,
    canCommit: (counts['PENDING_CONFLICT_RESOLUTION'] ?? 0) === 0,
  };
}
