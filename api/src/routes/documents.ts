import { FastifyInstance } from "fastify";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { withTenant } from "../db/pool.js";
import { assertTenantAccess } from "../middleware/auth.js";

const s3 = new S3Client({});
const DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET!;

export async function documentRoutes(app: FastifyInstance) {
  // POST /tenants/:tenantId/documents/upload-url
  // Returns a presigned S3 PUT URL under the "uploads/" prefix AND
  // registers the documents row in the SAME call, in that order — the
  // document row exists in the DB BEFORE the client ever starts
  // uploading bytes. This eliminates the race condition where
  // trigger-pipeline (fired by the S3 EventBridge rule) could fire
  // before the documents row existed: with single-file upload that race
  // was rare; with bulk upload of hundreds of files in parallel, it
  // became common enough to be a real reliability problem.
  app.post<{
    Params: { tenantId: string };
    Body: { fileName: string; contentType: string; shipmentId?: string; uploadedBy: string; intakeSessionId?: string };
  }>("/tenants/:tenantId/documents/upload-url", async (request, reply) => {
    const { tenantId } = request.params;
    assertTenantAccess(request.auth!, tenantId);
    const { fileName, contentType, shipmentId, uploadedBy, intakeSessionId } = request.body;

    const key = `uploads/${tenantId}/${crypto.randomUUID()}-${fileName}`;

    return withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO documents (tenant_id, shipment_id, file_name, s3_key, document_type, status, uploaded_by, intake_session_id, intake_source)
         VALUES ($1, $2, $3, $4, 'UNCLASSIFIED', 'pending_upload', $5, $6, $7)
         RETURNING id`,
        [
          tenantId,
          shipmentId ?? null,
          fileName,
          key,
          uploadedBy,
          intakeSessionId ?? null,
          intakeSessionId ? "bulk_upload" : "manual_upload",
        ]
      );

      const command = new PutObjectCommand({
        Bucket: DOCUMENTS_BUCKET,
        Key: key,
        ContentType: contentType,
        ChecksumAlgorithm: undefined, // disable CRC32 checksum — newer AWS SDK adds it by default but browser fetch cannot compute and send a matching x-amz-checksum-crc32 header, causing S3 to return 403
      });
      const uploadUrl = await getSignedUrl(s3, command, {
        expiresIn: 300,
        unhoistableHeaders: new Set(["x-amz-checksum-crc32", "x-amz-sdk-checksum-algorithm"]),
      });

      return { uploadUrl, s3Key: key, documentId: rows[0].id };
    });
  });

  // PATCH /tenants/:tenantId/documents/:id/confirm-upload
  // Client calls this after the S3 PUT succeeds, flipping status from
  // "pending_upload" to "uploaded". trigger-pipeline only starts a
  // pipeline execution for documents already past "pending_upload" —
  // belt-and-suspenders against the same race from the other direction
  // (an EventBridge event arriving before this confirm call would now
  // just see "pending_upload" and skip, instead of crashing).
  app.patch<{ Params: { tenantId: string; id: string } }>(
    "/tenants/:tenantId/documents/:id/confirm-upload",
    async (request, reply) => {
      const { tenantId, id } = request.params;
      assertTenantAccess(request.auth!, tenantId);
      return withTenant(tenantId, async (client) => {
        await client.query(
          `UPDATE documents SET status = 'uploaded' WHERE id = $1 AND tenant_id = $2 AND status = 'pending_upload'`,
          [id, tenantId]
        );
        return { success: true };
      });
    }
  );

  app.get<{ Params: { tenantId: string } }>("/tenants/:tenantId/documents", async (request, reply) => {
    const { tenantId } = request.params;
    assertTenantAccess(request.auth!, tenantId);

    return withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT id, file_name, document_type, status, intake_source, uploaded_at
         FROM documents WHERE tenant_id = $1 ORDER BY uploaded_at DESC LIMIT 200`,
        [tenantId]
      );
      return rows;
    });
  });

  app.get<{ Params: { tenantId: string; id: string } }>(
    "/tenants/:tenantId/documents/:id",
    async (request, reply) => {
      const { tenantId, id } = request.params;
      assertTenantAccess(request.auth!, tenantId);
      return withTenant(tenantId, async (client) => {
        const { rows } = await client.query(
          `SELECT id, shipment_id, file_name, document_type, status, intake_source, s3_key, uploaded_at
           FROM documents WHERE id = $1 AND tenant_id = $2`,
          [id, tenantId]
        );
        if (rows.length === 0) return reply.code(404).send({ error: "Document not found" });
        return rows[0];
      });
    }
  );

  app.get<{ Params: { tenantId: string; id: string } }>(
    "/tenants/:tenantId/documents/:id/download-url",
    async (request, reply) => {
      const { tenantId, id } = request.params;
      assertTenantAccess(request.auth!, tenantId);
      return withTenant(tenantId, async (client) => {
        const { rows } = await client.query(
          `SELECT s3_key FROM documents WHERE id = $1 AND tenant_id = $2`,
          [id, tenantId]
        );
        if (rows.length === 0) return reply.code(404).send({ error: "Document not found" });
        const { GetObjectCommand } = await import("@aws-sdk/client-s3");
        const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
        const command = new GetObjectCommand({ Bucket: DOCUMENTS_BUCKET, Key: rows[0].s3_key });
        const downloadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
        return { downloadUrl };
      });
    }
  );

  app.get<{ Params: { tenantId: string; id: string } }>(
    "/tenants/:tenantId/documents/:id/extracted-fields",
    async (request, reply) => {
      const { tenantId, id } = request.params;
      assertTenantAccess(request.auth!, tenantId);
      return withTenant(tenantId, async (client) => {
        const { rows } = await client.query(
          `SELECT fs.id, cf.field_key, fs.raw_value, fs.confidence, fs.reasoning,
                  cf.resolved_value, cf.status as field_status
           FROM ctdm_field_sources fs
           JOIN ctdm_fields cf ON cf.id = fs.ctdm_field_id
           WHERE fs.document_id = $1 AND cf.tenant_id = $2
           ORDER BY fs.confidence DESC`,
          [id, tenantId]
        );
        return rows;
      });
    }
  );
}
