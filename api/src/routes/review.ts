import { FastifyInstance } from "fastify";
import { withTenant } from "../db/pool.js";
import { assertTenantAccess } from "../middleware/auth.js";
import { computeUnifiedShipmentStatus } from "../lib/shipmentStatus.js";
import { mapToCeisaBc23 } from "../lib/mappers/ceisaMapper.js";

export async function reviewRoutes(app: FastifyInstance) {
  app.get<{ Params: { tenantId: string; id: string } }>(
    "/tenants/:tenantId/shipments/:id/status",
    async (request, reply) => {
      const { tenantId, id } = request.params;
      assertTenantAccess(request.auth!, tenantId);
      return withTenant(tenantId, (client) => computeUnifiedShipmentStatus(client, id, tenantId));
    }
  );

  app.get<{ Params: { tenantId: string } }>("/tenants/:tenantId/review-queue", async (request, reply) => {
    const { tenantId } = request.params;
    assertTenantAccess(request.auth!, tenantId);

    return withTenant(tenantId, async (client) => {
      const { rows: mismatches } = await client.query(
        `SELECT 've_' || ve.id AS queue_item_id, 'DOCUMENT_MISMATCH' AS item_type, ve.shipment_id,
                s.shipment_number, ve.reference_type, ve.expected_value, ve.actual_value, ve.created_at
         FROM validation_errors ve
         JOIN shipments s ON s.id = ve.shipment_id
         WHERE ve.tenant_id = $1 AND ve.status = 'OPEN'`,
        [tenantId]
      );

      const { rows: needsReview } = await client.query(
        `SELECT 'cf_' || cf.id AS queue_item_id, 'FIELD_REVIEW' AS item_type, cf.shipment_id,
                s.shipment_number, cf.field_key AS reference_type, cf.resolved_value AS actual_value,
                cf.confidence, cf.resolved_at AS created_at
         FROM ctdm_fields cf
         JOIN shipments s ON s.id = cf.shipment_id
         WHERE cf.tenant_id = $1 AND cf.status = 'REVIEW_REQUIRED'`,
        [tenantId]
      );

      const { rows: processing } = await client.query(
        `SELECT 'doc_' || d.id AS queue_item_id, 'PROCESSING' AS item_type, d.shipment_id,
                s.shipment_number, d.file_name AS reference_type, d.status AS actual_value, d.uploaded_at AS created_at
         FROM documents d
         LEFT JOIN shipments s ON s.id = d.shipment_id
         WHERE d.tenant_id = $1 AND d.status IN ('uploaded', 'extracting')`,
        [tenantId]
      );

      const sortByAge = (a: { created_at: Date }, b: { created_at: Date }) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime();

      return [...mismatches.sort(sortByAge), ...needsReview.sort(sortByAge), ...processing.sort(sortByAge)];
    });
  });

  app.get<{ Params: { tenantId: string; id: string } }>(
    "/tenants/:tenantId/shipments/:id/evidence-registry",
    async (request, reply) => {
      const { tenantId, id } = request.params;
      assertTenantAccess(request.auth!, tenantId);

      return withTenant(tenantId, async (client) => {
        const fieldsResult = await client.query(
          `SELECT cf.id, cf.field_key, cf.resolved_value, cf.confidence, cf.status, cf.resolved_at
           FROM ctdm_fields cf WHERE cf.shipment_id = $1 ORDER BY cf.field_key`,
          [id]
        );

        const evidenceTrail = await Promise.all(
          fieldsResult.rows.map(async (field) => {
            const sources = await client.query(
              `SELECT fs.raw_value, fs.confidence, fs.reasoning, fs.created_at,
                      d.id AS document_id, d.file_name, d.document_type, d.s3_key
               FROM ctdm_field_sources fs
               JOIN documents d ON d.id = fs.document_id
               WHERE fs.ctdm_field_id = $1 ORDER BY fs.confidence DESC`,
              [field.id]
            );
            return { ...field, sources: sources.rows };
          })
        );

        const auditTrail = await client.query(
          `SELECT action, entity_type, entity_id, changes, actor_id, created_at
           FROM audit_log
           WHERE tenant_id = $1 AND entity_id::text = $2
           ORDER BY created_at ASC`,
          [tenantId, id]
        );

        return { shipmentId: id, evidenceTrail, auditTrail: auditTrail.rows };
      });
    }
  );

  // GET /tenants/:tenantId/shipments/:id/ceisa-payload
  // CEISA Mapping (IDP Engine module #12). Refuses to generate a payload
  // unless the unified status is READY_FOR_CEISA — generating a
  // declaration payload from a shipment that still has open mismatches
  // or fields needing review would be actively harmful, not just
  // incomplete.
  app.get<{ Params: { tenantId: string; id: string } }>(
    "/tenants/:tenantId/shipments/:id/ceisa-payload",
    async (request, reply) => {
      const { tenantId, id } = request.params;
      assertTenantAccess(request.auth!, tenantId);

      return withTenant(tenantId, async (client) => {
        const statusResult = await computeUnifiedShipmentStatus(client, id, tenantId);
        if (statusResult.status !== "READY_FOR_CEISA") {
          return reply.code(409).send({
            error: "Shipment is not READY_FOR_CEISA",
            currentStatus: statusResult.status,
            blockingIssues: {
              openValidationErrors: statusResult.openValidationErrorCount,
              fieldsNeedingReview: statusResult.fieldsNeedingReviewCount,
            },
          });
        }
        const payload = await mapToCeisaBc23(client, id, tenantId);
        return { shipmentId: id, status: statusResult.status, payload };
      });
    }
  );

  // GET /tenants/:tenantId/dashboard/summary — the single endpoint the
  // Dashboard UI reads from. Combines unified shipment status and
  // intake source identity into one consistent view instead of the
  // frontend stitching together several calls that could drift out of
  // sync with each other.
  app.get<{ Params: { tenantId: string } }>("/tenants/:tenantId/dashboard/summary", async (request, reply) => {
    const { tenantId } = request.params;
    assertTenantAccess(request.auth!, tenantId);

    return withTenant(tenantId, async (client) => {
      const statusCounts = await client.query(
        `SELECT status, COUNT(*) AS count FROM shipments WHERE tenant_id = $1 GROUP BY status`,
        [tenantId]
      );

      const sourceBreakdown = await client.query(
        `SELECT intake_source, COUNT(*) AS document_count
         FROM documents WHERE tenant_id = $1 GROUP BY intake_source`,
        [tenantId]
      );

      const pendingReviewCount = await client.query(
        `SELECT COUNT(DISTINCT shipment_id) AS count FROM ctdm_fields
         WHERE tenant_id = $1 AND status = 'REVIEW_REQUIRED' AND shipment_id IS NOT NULL`,
        [tenantId]
      );

      const mismatchCount = await client.query(
        `SELECT COUNT(DISTINCT shipment_id) AS count FROM validation_errors
         WHERE tenant_id = $1 AND status = 'OPEN'`,
        [tenantId]
      );

      // Auto-approval rate: of every CTDM field ever resolved, what
      // fraction never needed a human to touch it. This is the metric
      // that demonstrates platform value over time — "AI assists users,
      // users only review exceptions" from the vision doc, made
      // measurable instead of aspirational.
      const autoApprovalResult = await client.query<{ total: string; auto_approved: string }>(
        `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'AUTO_APPROVED') AS auto_approved
         FROM ctdm_fields WHERE tenant_id = $1`,
        [tenantId]
      );
      const total = Number(autoApprovalResult.rows[0]?.total ?? 0);
      const autoApproved = Number(autoApprovalResult.rows[0]?.auto_approved ?? 0);
      const autoApprovalRate = total > 0 ? Math.round((autoApproved / total) * 100) : null;

      const recentDocuments = await client.query(
        `SELECT id, file_name, document_type, status, intake_source, uploaded_at
         FROM documents WHERE tenant_id = $1 ORDER BY uploaded_at DESC LIMIT 10`,
        [tenantId]
      );

      return {
        shipmentStatusCounts: Object.fromEntries(statusCounts.rows.map((r) => [r.status, Number(r.count)])),
        sourceBreakdown: sourceBreakdown.rows.map((r) => ({
          source: r.intake_source,
          count: Number(r.document_count),
        })),
        pendingReviewShipments: Number(pendingReviewCount.rows[0]?.count ?? 0),
        documentMismatchShipments: Number(mismatchCount.rows[0]?.count ?? 0),
        autoApprovalRate,
        recentDocuments: recentDocuments.rows,
      };
    });
  });
}
