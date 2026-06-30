import { FastifyInstance } from "fastify";
import { withTenant } from "../db/pool.js";
import { assertTenantAccess } from "../middleware/auth.js";
import { writeAuditLog } from "../lib/audit.js";

export async function shipmentRoutes(app: FastifyInstance) {
  // GET /tenants/:tenantId/shipments — list, scoped by tenant (Rule #7)
  app.get<{ Params: { tenantId: string } }>("/tenants/:tenantId/shipments", async (request, reply) => {
    const { tenantId } = request.params;
    assertTenantAccess(request.auth!, tenantId);

    return withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT s.id, s.shipment_number, s.bc_type, s.status, s.ceisa_readiness_score,
                pf.name AS party_from_name, pt.name AS party_to_name, s.created_at
         FROM shipments s
         LEFT JOIN parties pf ON pf.id = s.party_from_id
         LEFT JOIN parties pt ON pt.id = s.party_to_id
         WHERE s.tenant_id = $1
         ORDER BY s.created_at DESC`,
        [tenantId]
      );
      return rows;
    });
  });

  // GET /tenants/:tenantId/shipments/:id/checkpoint-summary
  // Backs the CheckpointSummary UI component directly — one query
  // returns exactly the shape the frontend's ShipmentReadiness type
  // expects, sources included, no client-side reshaping needed.
  app.get<{ Params: { tenantId: string; id: string } }>(
    "/tenants/:tenantId/shipments/:id/checkpoint-summary",
    async (request, reply) => {
      const { tenantId, id } = request.params;
      assertTenantAccess(request.auth!, tenantId);

      return withTenant(tenantId, async (client) => {
        const shipmentResult = await client.query(
          `SELECT s.id, s.shipment_number, s.bc_type, s.ceisa_readiness_score,
                  pf.name AS party_from, pt.name AS party_to
           FROM shipments s
           LEFT JOIN parties pf ON pf.id = s.party_from_id
           LEFT JOIN parties pt ON pt.id = s.party_to_id
           WHERE s.id = $1 AND s.tenant_id = $2`,
          [id, tenantId]
        );
        if (shipmentResult.rows.length === 0) {
          return reply.code(404).send({ error: "Shipment not found" });
        }
        const shipment = shipmentResult.rows[0];

        const fieldsResult = await client.query(
          `SELECT cf.id, cf.field_key, cf.resolved_value, cf.confidence, cf.status
           FROM ctdm_fields cf WHERE cf.shipment_id = $1`,
          [id]
        );

        const checkpoints = await Promise.all(
          fieldsResult.rows.map(async (field) => {
            const sourcesResult = await client.query(
              `SELECT d.document_type AS document_name, fs.raw_value AS value,
                      fs.confidence, fs.reasoning
               FROM ctdm_field_sources fs
               JOIN documents d ON d.id = fs.document_id
               WHERE fs.ctdm_field_id = $1
               ORDER BY fs.confidence DESC`,
              [field.id]
            );
            return {
              id: field.field_key,
              label: field.field_key,
              value: field.resolved_value,
              status: field.resolved_value ? field.status : "MISSING",
              sources: sourcesResult.rows,
            };
          })
        );

        return {
          shipmentNumber: shipment.shipment_number,
          partyFrom: shipment.party_from,
          partyTo: shipment.party_to,
          bcType: shipment.bc_type,
          readinessScore: shipment.ceisa_readiness_score,
          checkpoints,
        };
      });
    }
  );

  // POST /tenants/:tenantId/shipments/:id/fields/:fieldId/resolve
  // Conflict Resolution Dialog "Use Recommended" / "Choose Alternative"
  // action lands here — a manual resolution is itself a Learning Engine
  // signal (Rule #9), captured below, not just a UI state change.
  app.post<{
    Params: { tenantId: string; id: string; fieldId: string };
    Body: { chosenValue: string; correctedBy: string };
  }>("/tenants/:tenantId/shipments/:id/fields/:fieldId/resolve", async (request, reply) => {
    const { tenantId, fieldId } = request.params;
    const { chosenValue, correctedBy } = request.body;
    assertTenantAccess(request.auth!, tenantId);

    return withTenant(tenantId, async (client) => {
      const existing = await client.query(
        `SELECT resolved_value, field_key FROM ctdm_fields WHERE id = $1 AND tenant_id = $2`,
        [fieldId, tenantId]
      );
      if (existing.rows.length === 0) return reply.code(404).send({ error: "Field not found" });

      await client.query(
        `UPDATE ctdm_fields SET resolved_value = $1, status = 'MANUALLY_RESOLVED', resolved_at = now()
         WHERE id = $2`,
        [chosenValue, fieldId]
      );

      // Rule #9 — every manual correction is captured for future model
      // improvement, never discarded after this single use.
      await client.query(
        `INSERT INTO learning_corrections (tenant_id, ctdm_field_id, original_value, corrected_value, corrected_by, field_key)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tenantId, fieldId, existing.rows[0].resolved_value, chosenValue, correctedBy, existing.rows[0].field_key]
      );

      await writeAuditLog(client, {
        tenantId,
        actorId: correctedBy,
        action: "FIELD_MANUALLY_RESOLVED",
        entityType: "ctdm_field",
        entityId: fieldId,
        changes: { chosenValue },
      });

      return { success: true };
    });
  });

  // GET /tenants/:tenantId/shipments/:id/validation-errors
  // The Validation Engine result set — distinct from checkpoint-summary's
  // per-field confidence: these are hard cross-reference CONTRADICTIONS
  // between sibling documents (e.g. Invoice says invoice_number 0126051,
  // a later document says 0126057 for the same shipment), not just low
  // confidence. Surfaced as a blocking banner in the UI, not a soft flag.
  app.get<{ Params: { tenantId: string; id: string } }>(
    "/tenants/:tenantId/shipments/:id/validation-errors",
    async (request, reply) => {
      const { tenantId, id } = request.params;
      assertTenantAccess(request.auth!, tenantId);

      return withTenant(tenantId, async (client) => {
        const { rows } = await client.query(
          `SELECT ve.id, ve.reference_type, ve.expected_value, ve.actual_value, ve.status, ve.created_at,
                  d.file_name AS conflicting_document_name
           FROM validation_errors ve
           LEFT JOIN documents d ON d.id = ve.conflicting_document_id
           WHERE ve.shipment_id = $1 AND ve.tenant_id = $2 AND ve.status = 'OPEN'
           ORDER BY ve.created_at DESC`,
          [id, tenantId]
        );
        return rows;
      });
    }
  );

  // POST /tenants/:tenantId/validation-errors/:errorId/resolve
  app.post<{ Params: { tenantId: string; errorId: string }; Body: { resolvedBy: string } }>(
    "/tenants/:tenantId/validation-errors/:errorId/resolve",
    async (request, reply) => {
      const { tenantId, errorId } = request.params;
      assertTenantAccess(request.auth!, tenantId);

      return withTenant(tenantId, async (client) => {
        await client.query(`UPDATE validation_errors SET status = 'RESOLVED' WHERE id = $1 AND tenant_id = $2`, [
          errorId,
          tenantId,
        ]);
        await writeAuditLog(client, {
          tenantId,
          actorId: request.body.resolvedBy,
          action: "VALIDATION_ERROR_RESOLVED",
          entityType: "validation_error",
          entityId: errorId,
        });
        return { success: true };
      });
    }
  );
}
