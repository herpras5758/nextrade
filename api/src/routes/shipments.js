"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shipmentRoutes = shipmentRoutes;
const pool_js_1 = require("../db/pool.js");
const auth_js_1 = require("../middleware/auth.js");
const audit_js_1 = require("../lib/audit.js");
async function shipmentRoutes(app) {
    // GET /tenants/:tenantId/shipments — list, scoped by tenant (Rule #7)
    app.get("/tenants/:tenantId/shipments", async (request, reply) => {
        const { tenantId } = request.params;
        (0, auth_js_1.assertTenantAccess)(request.auth, tenantId);
        return (0, pool_js_1.withTenant)(tenantId, async (client) => {
            const { rows } = await client.query(`SELECT s.id, s.shipment_number, s.bc_type, s.status, s.ceisa_readiness_score,
                pf.name AS party_from_name, pt.name AS party_to_name, s.created_at
         FROM shipments s
         LEFT JOIN parties pf ON pf.id = s.party_from_id
         LEFT JOIN parties pt ON pt.id = s.party_to_id
         WHERE s.tenant_id = $1
         ORDER BY s.created_at DESC`, [tenantId]);
            return rows;
        });
    });
    // GET /tenants/:tenantId/shipments/:id/checkpoint-summary
    // Backs the CheckpointSummary UI component directly — one query
    // returns exactly the shape the frontend's ShipmentReadiness type
    // expects, sources included, no client-side reshaping needed.
    app.get("/tenants/:tenantId/shipments/:id/checkpoint-summary", async (request, reply) => {
        const { tenantId, id } = request.params;
        (0, auth_js_1.assertTenantAccess)(request.auth, tenantId);
        return (0, pool_js_1.withTenant)(tenantId, async (client) => {
            const shipmentResult = await client.query(`SELECT s.id, s.shipment_number, s.bc_type, s.ceisa_readiness_score,
                  pf.name AS party_from, pt.name AS party_to
           FROM shipments s
           LEFT JOIN parties pf ON pf.id = s.party_from_id
           LEFT JOIN parties pt ON pt.id = s.party_to_id
           WHERE s.id = $1 AND s.tenant_id = $2`, [id, tenantId]);
            if (shipmentResult.rows.length === 0) {
                return reply.code(404).send({ error: "Shipment not found" });
            }
            const shipment = shipmentResult.rows[0];
            const fieldsResult = await client.query(`SELECT cf.id, cf.field_key, cf.resolved_value, cf.confidence, cf.status
           FROM ctdm_fields cf WHERE cf.shipment_id = $1`, [id]);
            const checkpoints = await Promise.all(fieldsResult.rows.map(async (field) => {
                const sourcesResult = await client.query(`SELECT d.document_type AS document_name, fs.raw_value AS value,
                      fs.confidence, fs.reasoning
               FROM ctdm_field_sources fs
               JOIN documents d ON d.id = fs.document_id
               WHERE fs.ctdm_field_id = $1
               ORDER BY fs.confidence DESC`, [field.id]);
                return {
                    id: field.field_key,
                    label: field.field_key,
                    value: field.resolved_value,
                    status: field.resolved_value ? field.status : "MISSING",
                    sources: sourcesResult.rows,
                };
            }));
            return {
                shipmentNumber: shipment.shipment_number,
                partyFrom: shipment.party_from,
                partyTo: shipment.party_to,
                bcType: shipment.bc_type,
                readinessScore: shipment.ceisa_readiness_score,
                checkpoints,
            };
        });
    });
    // POST /tenants/:tenantId/shipments/:id/fields/:fieldId/resolve
    // Conflict Resolution Dialog "Use Recommended" / "Choose Alternative"
    // action lands here — a manual resolution is itself a Learning Engine
    // signal (Rule #9), captured below, not just a UI state change.
    app.post("/tenants/:tenantId/shipments/:id/fields/:fieldId/resolve", async (request, reply) => {
        const { tenantId, fieldId } = request.params;
        const { chosenValue, correctedBy } = request.body;
        (0, auth_js_1.assertTenantAccess)(request.auth, tenantId);
        return (0, pool_js_1.withTenant)(tenantId, async (client) => {
            const existing = await client.query(`SELECT resolved_value, field_key FROM ctdm_fields WHERE id = $1 AND tenant_id = $2`, [fieldId, tenantId]);
            if (existing.rows.length === 0)
                return reply.code(404).send({ error: "Field not found" });
            await client.query(`UPDATE ctdm_fields SET resolved_value = $1, status = 'MANUALLY_RESOLVED', resolved_at = now()
         WHERE id = $2`, [chosenValue, fieldId]);
            // Rule #9 — every manual correction is captured for future model
            // improvement, never discarded after this single use.
            await client.query(`INSERT INTO learning_corrections (tenant_id, ctdm_field_id, original_value, corrected_value, corrected_by, field_key)
         VALUES ($1, $2, $3, $4, $5, $6)`, [tenantId, fieldId, existing.rows[0].resolved_value, chosenValue, correctedBy, existing.rows[0].field_key]);
            await (0, audit_js_1.writeAuditLog)(client, {
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
    app.get("/tenants/:tenantId/shipments/:id/validation-errors", async (request, reply) => {
        const { tenantId, id } = request.params;
        (0, auth_js_1.assertTenantAccess)(request.auth, tenantId);
        return (0, pool_js_1.withTenant)(tenantId, async (client) => {
            const { rows } = await client.query(`SELECT ve.id, ve.reference_type, ve.expected_value, ve.actual_value, ve.status, ve.created_at,
                  d.file_name AS conflicting_document_name
           FROM validation_errors ve
           LEFT JOIN documents d ON d.id = ve.conflicting_document_id
           WHERE ve.shipment_id = $1 AND ve.tenant_id = $2 AND ve.status = 'OPEN'
           ORDER BY ve.created_at DESC`, [id, tenantId]);
            return rows;
        });
    });
    // POST /tenants/:tenantId/validation-errors/:errorId/resolve
    app.post("/tenants/:tenantId/validation-errors/:errorId/resolve", async (request, reply) => {
        const { tenantId, errorId } = request.params;
        (0, auth_js_1.assertTenantAccess)(request.auth, tenantId);
        return (0, pool_js_1.withTenant)(tenantId, async (client) => {
            await client.query(`UPDATE validation_errors SET status = 'RESOLVED' WHERE id = $1 AND tenant_id = $2`, [
                errorId,
                tenantId,
            ]);
            await (0, audit_js_1.writeAuditLog)(client, {
                tenantId,
                actorId: request.body.resolvedBy,
                action: "VALIDATION_ERROR_RESOLVED",
                entityType: "validation_error",
                entityId: errorId,
            });
            return { success: true };
        });
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2hpcG1lbnRzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsic2hpcG1lbnRzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBS0Esd0NBcUxDO0FBekxELDJDQUEyQztBQUMzQyxtREFBMkQ7QUFDM0QsOENBQWdEO0FBRXpDLEtBQUssVUFBVSxjQUFjLENBQUMsR0FBb0I7SUFDdkQsc0VBQXNFO0lBQ3RFLEdBQUcsQ0FBQyxHQUFHLENBQW1DLDhCQUE4QixFQUFFLEtBQUssRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUFFLEVBQUU7UUFDakcsTUFBTSxFQUFFLFFBQVEsRUFBRSxHQUFHLE9BQU8sQ0FBQyxNQUFNLENBQUM7UUFDcEMsSUFBQSw0QkFBa0IsRUFBQyxPQUFPLENBQUMsSUFBSyxFQUFFLFFBQVEsQ0FBQyxDQUFDO1FBRTVDLE9BQU8sSUFBQSxvQkFBVSxFQUFDLFFBQVEsRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLEVBQUU7WUFDM0MsTUFBTSxFQUFFLElBQUksRUFBRSxHQUFHLE1BQU0sTUFBTSxDQUFDLEtBQUssQ0FDakM7Ozs7OztvQ0FNNEIsRUFDNUIsQ0FBQyxRQUFRLENBQUMsQ0FDWCxDQUFDO1lBQ0YsT0FBTyxJQUFJLENBQUM7UUFDZCxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0lBRUgsMERBQTBEO0lBQzFELGdFQUFnRTtJQUNoRSxrRUFBa0U7SUFDbEUsOERBQThEO0lBQzlELEdBQUcsQ0FBQyxHQUFHLENBQ0wscURBQXFELEVBQ3JELEtBQUssRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUFFLEVBQUU7UUFDdkIsTUFBTSxFQUFFLFFBQVEsRUFBRSxFQUFFLEVBQUUsR0FBRyxPQUFPLENBQUMsTUFBTSxDQUFDO1FBQ3hDLElBQUEsNEJBQWtCLEVBQUMsT0FBTyxDQUFDLElBQUssRUFBRSxRQUFRLENBQUMsQ0FBQztRQUU1QyxPQUFPLElBQUEsb0JBQVUsRUFBQyxRQUFRLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxFQUFFO1lBQzNDLE1BQU0sY0FBYyxHQUFHLE1BQU0sTUFBTSxDQUFDLEtBQUssQ0FDdkM7Ozs7O2dEQUtzQyxFQUN0QyxDQUFDLEVBQUUsRUFBRSxRQUFRLENBQUMsQ0FDZixDQUFDO1lBQ0YsSUFBSSxjQUFjLENBQUMsSUFBSSxDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUUsQ0FBQztnQkFDckMsT0FBTyxLQUFLLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxFQUFFLEtBQUssRUFBRSxvQkFBb0IsRUFBRSxDQUFDLENBQUM7WUFDL0QsQ0FBQztZQUNELE1BQU0sUUFBUSxHQUFHLGNBQWMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFFeEMsTUFBTSxZQUFZLEdBQUcsTUFBTSxNQUFNLENBQUMsS0FBSyxDQUNyQzt5REFDK0MsRUFDL0MsQ0FBQyxFQUFFLENBQUMsQ0FDTCxDQUFDO1lBRUYsTUFBTSxXQUFXLEdBQUcsTUFBTSxPQUFPLENBQUMsR0FBRyxDQUNuQyxZQUFZLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxLQUFLLEVBQUUsS0FBSyxFQUFFLEVBQUU7Z0JBQ3BDLE1BQU0sYUFBYSxHQUFHLE1BQU0sTUFBTSxDQUFDLEtBQUssQ0FDdEM7Ozs7OzJDQUs2QixFQUM3QixDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsQ0FDWCxDQUFDO2dCQUNGLE9BQU87b0JBQ0wsRUFBRSxFQUFFLEtBQUssQ0FBQyxTQUFTO29CQUNuQixLQUFLLEVBQUUsS0FBSyxDQUFDLFNBQVM7b0JBQ3RCLEtBQUssRUFBRSxLQUFLLENBQUMsY0FBYztvQkFDM0IsTUFBTSxFQUFFLEtBQUssQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLFNBQVM7b0JBQ3ZELE9BQU8sRUFBRSxhQUFhLENBQUMsSUFBSTtpQkFDNUIsQ0FBQztZQUNKLENBQUMsQ0FBQyxDQUNILENBQUM7WUFFRixPQUFPO2dCQUNMLGNBQWMsRUFBRSxRQUFRLENBQUMsZUFBZTtnQkFDeEMsU0FBUyxFQUFFLFFBQVEsQ0FBQyxVQUFVO2dCQUM5QixPQUFPLEVBQUUsUUFBUSxDQUFDLFFBQVE7Z0JBQzFCLE1BQU0sRUFBRSxRQUFRLENBQUMsT0FBTztnQkFDeEIsY0FBYyxFQUFFLFFBQVEsQ0FBQyxxQkFBcUI7Z0JBQzlDLFdBQVc7YUFDWixDQUFDO1FBQ0osQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQ0YsQ0FBQztJQUVGLGdFQUFnRTtJQUNoRSxzRUFBc0U7SUFDdEUsc0VBQXNFO0lBQ3RFLGdFQUFnRTtJQUNoRSxHQUFHLENBQUMsSUFBSSxDQUdMLDBEQUEwRCxFQUFFLEtBQUssRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUFFLEVBQUU7UUFDdEYsTUFBTSxFQUFFLFFBQVEsRUFBRSxPQUFPLEVBQUUsR0FBRyxPQUFPLENBQUMsTUFBTSxDQUFDO1FBQzdDLE1BQU0sRUFBRSxXQUFXLEVBQUUsV0FBVyxFQUFFLEdBQUcsT0FBTyxDQUFDLElBQUksQ0FBQztRQUNsRCxJQUFBLDRCQUFrQixFQUFDLE9BQU8sQ0FBQyxJQUFLLEVBQUUsUUFBUSxDQUFDLENBQUM7UUFFNUMsT0FBTyxJQUFBLG9CQUFVLEVBQUMsUUFBUSxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsRUFBRTtZQUMzQyxNQUFNLFFBQVEsR0FBRyxNQUFNLE1BQU0sQ0FBQyxLQUFLLENBQ2pDLG9GQUFvRixFQUNwRixDQUFDLE9BQU8sRUFBRSxRQUFRLENBQUMsQ0FDcEIsQ0FBQztZQUNGLElBQUksUUFBUSxDQUFDLElBQUksQ0FBQyxNQUFNLEtBQUssQ0FBQztnQkFBRSxPQUFPLEtBQUssQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLEVBQUUsS0FBSyxFQUFFLGlCQUFpQixFQUFFLENBQUMsQ0FBQztZQUUxRixNQUFNLE1BQU0sQ0FBQyxLQUFLLENBQ2hCO3VCQUNlLEVBQ2YsQ0FBQyxXQUFXLEVBQUUsT0FBTyxDQUFDLENBQ3ZCLENBQUM7WUFFRixpRUFBaUU7WUFDakUsc0RBQXNEO1lBQ3RELE1BQU0sTUFBTSxDQUFDLEtBQUssQ0FDaEI7eUNBQ2lDLEVBQ2pDLENBQUMsUUFBUSxFQUFFLE9BQU8sRUFBRSxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLGNBQWMsRUFBRSxXQUFXLEVBQUUsV0FBVyxFQUFFLFFBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQzNHLENBQUM7WUFFRixNQUFNLElBQUEsd0JBQWEsRUFBQyxNQUFNLEVBQUU7Z0JBQzFCLFFBQVE7Z0JBQ1IsT0FBTyxFQUFFLFdBQVc7Z0JBQ3BCLE1BQU0sRUFBRSx5QkFBeUI7Z0JBQ2pDLFVBQVUsRUFBRSxZQUFZO2dCQUN4QixRQUFRLEVBQUUsT0FBTztnQkFDakIsT0FBTyxFQUFFLEVBQUUsV0FBVyxFQUFFO2FBQ3pCLENBQUMsQ0FBQztZQUVILE9BQU8sRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLENBQUM7UUFDM0IsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztJQUVILHlEQUF5RDtJQUN6RCx3RUFBd0U7SUFDeEUsc0VBQXNFO0lBQ3RFLHVFQUF1RTtJQUN2RSxxRUFBcUU7SUFDckUsd0VBQXdFO0lBQ3hFLEdBQUcsQ0FBQyxHQUFHLENBQ0wsb0RBQW9ELEVBQ3BELEtBQUssRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUFFLEVBQUU7UUFDdkIsTUFBTSxFQUFFLFFBQVEsRUFBRSxFQUFFLEVBQUUsR0FBRyxPQUFPLENBQUMsTUFBTSxDQUFDO1FBQ3hDLElBQUEsNEJBQWtCLEVBQUMsT0FBTyxDQUFDLElBQUssRUFBRSxRQUFRLENBQUMsQ0FBQztRQUU1QyxPQUFPLElBQUEsb0JBQVUsRUFBQyxRQUFRLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxFQUFFO1lBQzNDLE1BQU0sRUFBRSxJQUFJLEVBQUUsR0FBRyxNQUFNLE1BQU0sQ0FBQyxLQUFLLENBQ2pDOzs7Ozt1Q0FLNkIsRUFDN0IsQ0FBQyxFQUFFLEVBQUUsUUFBUSxDQUFDLENBQ2YsQ0FBQztZQUNGLE9BQU8sSUFBSSxDQUFDO1FBQ2QsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQ0YsQ0FBQztJQUVGLDZEQUE2RDtJQUM3RCxHQUFHLENBQUMsSUFBSSxDQUNOLHVEQUF1RCxFQUN2RCxLQUFLLEVBQUUsT0FBTyxFQUFFLEtBQUssRUFBRSxFQUFFO1FBQ3ZCLE1BQU0sRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLEdBQUcsT0FBTyxDQUFDLE1BQU0sQ0FBQztRQUM3QyxJQUFBLDRCQUFrQixFQUFDLE9BQU8sQ0FBQyxJQUFLLEVBQUUsUUFBUSxDQUFDLENBQUM7UUFFNUMsT0FBTyxJQUFBLG9CQUFVLEVBQUMsUUFBUSxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsRUFBRTtZQUMzQyxNQUFNLE1BQU0sQ0FBQyxLQUFLLENBQUMsbUZBQW1GLEVBQUU7Z0JBQ3RHLE9BQU87Z0JBQ1AsUUFBUTthQUNULENBQUMsQ0FBQztZQUNILE1BQU0sSUFBQSx3QkFBYSxFQUFDLE1BQU0sRUFBRTtnQkFDMUIsUUFBUTtnQkFDUixPQUFPLEVBQUUsT0FBTyxDQUFDLElBQUksQ0FBQyxVQUFVO2dCQUNoQyxNQUFNLEVBQUUsMkJBQTJCO2dCQUNuQyxVQUFVLEVBQUUsa0JBQWtCO2dCQUM5QixRQUFRLEVBQUUsT0FBTzthQUNsQixDQUFDLENBQUM7WUFDSCxPQUFPLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRSxDQUFDO1FBQzNCLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUNGLENBQUM7QUFDSixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgRmFzdGlmeUluc3RhbmNlIH0gZnJvbSBcImZhc3RpZnlcIjtcbmltcG9ydCB7IHdpdGhUZW5hbnQgfSBmcm9tIFwiLi4vZGIvcG9vbC5qc1wiO1xuaW1wb3J0IHsgYXNzZXJ0VGVuYW50QWNjZXNzIH0gZnJvbSBcIi4uL21pZGRsZXdhcmUvYXV0aC5qc1wiO1xuaW1wb3J0IHsgd3JpdGVBdWRpdExvZyB9IGZyb20gXCIuLi9saWIvYXVkaXQuanNcIjtcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHNoaXBtZW50Um91dGVzKGFwcDogRmFzdGlmeUluc3RhbmNlKSB7XG4gIC8vIEdFVCAvdGVuYW50cy86dGVuYW50SWQvc2hpcG1lbnRzIOKAlCBsaXN0LCBzY29wZWQgYnkgdGVuYW50IChSdWxlICM3KVxuICBhcHAuZ2V0PHsgUGFyYW1zOiB7IHRlbmFudElkOiBzdHJpbmcgfSB9PihcIi90ZW5hbnRzLzp0ZW5hbnRJZC9zaGlwbWVudHNcIiwgYXN5bmMgKHJlcXVlc3QsIHJlcGx5KSA9PiB7XG4gICAgY29uc3QgeyB0ZW5hbnRJZCB9ID0gcmVxdWVzdC5wYXJhbXM7XG4gICAgYXNzZXJ0VGVuYW50QWNjZXNzKHJlcXVlc3QuYXV0aCEsIHRlbmFudElkKTtcblxuICAgIHJldHVybiB3aXRoVGVuYW50KHRlbmFudElkLCBhc3luYyAoY2xpZW50KSA9PiB7XG4gICAgICBjb25zdCB7IHJvd3MgfSA9IGF3YWl0IGNsaWVudC5xdWVyeShcbiAgICAgICAgYFNFTEVDVCBzLmlkLCBzLnNoaXBtZW50X251bWJlciwgcy5iY190eXBlLCBzLnN0YXR1cywgcy5jZWlzYV9yZWFkaW5lc3Nfc2NvcmUsXG4gICAgICAgICAgICAgICAgcGYubmFtZSBBUyBwYXJ0eV9mcm9tX25hbWUsIHB0Lm5hbWUgQVMgcGFydHlfdG9fbmFtZSwgcy5jcmVhdGVkX2F0XG4gICAgICAgICBGUk9NIHNoaXBtZW50cyBzXG4gICAgICAgICBMRUZUIEpPSU4gcGFydGllcyBwZiBPTiBwZi5pZCA9IHMucGFydHlfZnJvbV9pZFxuICAgICAgICAgTEVGVCBKT0lOIHBhcnRpZXMgcHQgT04gcHQuaWQgPSBzLnBhcnR5X3RvX2lkXG4gICAgICAgICBXSEVSRSBzLnRlbmFudF9pZCA9ICQxXG4gICAgICAgICBPUkRFUiBCWSBzLmNyZWF0ZWRfYXQgREVTQ2AsXG4gICAgICAgIFt0ZW5hbnRJZF1cbiAgICAgICk7XG4gICAgICByZXR1cm4gcm93cztcbiAgICB9KTtcbiAgfSk7XG5cbiAgLy8gR0VUIC90ZW5hbnRzLzp0ZW5hbnRJZC9zaGlwbWVudHMvOmlkL2NoZWNrcG9pbnQtc3VtbWFyeVxuICAvLyBCYWNrcyB0aGUgQ2hlY2twb2ludFN1bW1hcnkgVUkgY29tcG9uZW50IGRpcmVjdGx5IOKAlCBvbmUgcXVlcnlcbiAgLy8gcmV0dXJucyBleGFjdGx5IHRoZSBzaGFwZSB0aGUgZnJvbnRlbmQncyBTaGlwbWVudFJlYWRpbmVzcyB0eXBlXG4gIC8vIGV4cGVjdHMsIHNvdXJjZXMgaW5jbHVkZWQsIG5vIGNsaWVudC1zaWRlIHJlc2hhcGluZyBuZWVkZWQuXG4gIGFwcC5nZXQ8eyBQYXJhbXM6IHsgdGVuYW50SWQ6IHN0cmluZzsgaWQ6IHN0cmluZyB9IH0+KFxuICAgIFwiL3RlbmFudHMvOnRlbmFudElkL3NoaXBtZW50cy86aWQvY2hlY2twb2ludC1zdW1tYXJ5XCIsXG4gICAgYXN5bmMgKHJlcXVlc3QsIHJlcGx5KSA9PiB7XG4gICAgICBjb25zdCB7IHRlbmFudElkLCBpZCB9ID0gcmVxdWVzdC5wYXJhbXM7XG4gICAgICBhc3NlcnRUZW5hbnRBY2Nlc3MocmVxdWVzdC5hdXRoISwgdGVuYW50SWQpO1xuXG4gICAgICByZXR1cm4gd2l0aFRlbmFudCh0ZW5hbnRJZCwgYXN5bmMgKGNsaWVudCkgPT4ge1xuICAgICAgICBjb25zdCBzaGlwbWVudFJlc3VsdCA9IGF3YWl0IGNsaWVudC5xdWVyeShcbiAgICAgICAgICBgU0VMRUNUIHMuaWQsIHMuc2hpcG1lbnRfbnVtYmVyLCBzLmJjX3R5cGUsIHMuY2Vpc2FfcmVhZGluZXNzX3Njb3JlLFxuICAgICAgICAgICAgICAgICAgcGYubmFtZSBBUyBwYXJ0eV9mcm9tLCBwdC5uYW1lIEFTIHBhcnR5X3RvXG4gICAgICAgICAgIEZST00gc2hpcG1lbnRzIHNcbiAgICAgICAgICAgTEVGVCBKT0lOIHBhcnRpZXMgcGYgT04gcGYuaWQgPSBzLnBhcnR5X2Zyb21faWRcbiAgICAgICAgICAgTEVGVCBKT0lOIHBhcnRpZXMgcHQgT04gcHQuaWQgPSBzLnBhcnR5X3RvX2lkXG4gICAgICAgICAgIFdIRVJFIHMuaWQgPSAkMSBBTkQgcy50ZW5hbnRfaWQgPSAkMmAsXG4gICAgICAgICAgW2lkLCB0ZW5hbnRJZF1cbiAgICAgICAgKTtcbiAgICAgICAgaWYgKHNoaXBtZW50UmVzdWx0LnJvd3MubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgcmV0dXJuIHJlcGx5LmNvZGUoNDA0KS5zZW5kKHsgZXJyb3I6IFwiU2hpcG1lbnQgbm90IGZvdW5kXCIgfSk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3Qgc2hpcG1lbnQgPSBzaGlwbWVudFJlc3VsdC5yb3dzWzBdO1xuXG4gICAgICAgIGNvbnN0IGZpZWxkc1Jlc3VsdCA9IGF3YWl0IGNsaWVudC5xdWVyeShcbiAgICAgICAgICBgU0VMRUNUIGNmLmlkLCBjZi5maWVsZF9rZXksIGNmLnJlc29sdmVkX3ZhbHVlLCBjZi5jb25maWRlbmNlLCBjZi5zdGF0dXNcbiAgICAgICAgICAgRlJPTSBjdGRtX2ZpZWxkcyBjZiBXSEVSRSBjZi5zaGlwbWVudF9pZCA9ICQxYCxcbiAgICAgICAgICBbaWRdXG4gICAgICAgICk7XG5cbiAgICAgICAgY29uc3QgY2hlY2twb2ludHMgPSBhd2FpdCBQcm9taXNlLmFsbChcbiAgICAgICAgICBmaWVsZHNSZXN1bHQucm93cy5tYXAoYXN5bmMgKGZpZWxkKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBzb3VyY2VzUmVzdWx0ID0gYXdhaXQgY2xpZW50LnF1ZXJ5KFxuICAgICAgICAgICAgICBgU0VMRUNUIGQuZG9jdW1lbnRfdHlwZSBBUyBkb2N1bWVudF9uYW1lLCBmcy5yYXdfdmFsdWUgQVMgdmFsdWUsXG4gICAgICAgICAgICAgICAgICAgICAgZnMuY29uZmlkZW5jZSwgZnMucmVhc29uaW5nXG4gICAgICAgICAgICAgICBGUk9NIGN0ZG1fZmllbGRfc291cmNlcyBmc1xuICAgICAgICAgICAgICAgSk9JTiBkb2N1bWVudHMgZCBPTiBkLmlkID0gZnMuZG9jdW1lbnRfaWRcbiAgICAgICAgICAgICAgIFdIRVJFIGZzLmN0ZG1fZmllbGRfaWQgPSAkMVxuICAgICAgICAgICAgICAgT1JERVIgQlkgZnMuY29uZmlkZW5jZSBERVNDYCxcbiAgICAgICAgICAgICAgW2ZpZWxkLmlkXVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgIGlkOiBmaWVsZC5maWVsZF9rZXksXG4gICAgICAgICAgICAgIGxhYmVsOiBmaWVsZC5maWVsZF9rZXksXG4gICAgICAgICAgICAgIHZhbHVlOiBmaWVsZC5yZXNvbHZlZF92YWx1ZSxcbiAgICAgICAgICAgICAgc3RhdHVzOiBmaWVsZC5yZXNvbHZlZF92YWx1ZSA/IGZpZWxkLnN0YXR1cyA6IFwiTUlTU0lOR1wiLFxuICAgICAgICAgICAgICBzb3VyY2VzOiBzb3VyY2VzUmVzdWx0LnJvd3MsXG4gICAgICAgICAgICB9O1xuICAgICAgICAgIH0pXG4gICAgICAgICk7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBzaGlwbWVudE51bWJlcjogc2hpcG1lbnQuc2hpcG1lbnRfbnVtYmVyLFxuICAgICAgICAgIHBhcnR5RnJvbTogc2hpcG1lbnQucGFydHlfZnJvbSxcbiAgICAgICAgICBwYXJ0eVRvOiBzaGlwbWVudC5wYXJ0eV90byxcbiAgICAgICAgICBiY1R5cGU6IHNoaXBtZW50LmJjX3R5cGUsXG4gICAgICAgICAgcmVhZGluZXNzU2NvcmU6IHNoaXBtZW50LmNlaXNhX3JlYWRpbmVzc19zY29yZSxcbiAgICAgICAgICBjaGVja3BvaW50cyxcbiAgICAgICAgfTtcbiAgICAgIH0pO1xuICAgIH1cbiAgKTtcblxuICAvLyBQT1NUIC90ZW5hbnRzLzp0ZW5hbnRJZC9zaGlwbWVudHMvOmlkL2ZpZWxkcy86ZmllbGRJZC9yZXNvbHZlXG4gIC8vIENvbmZsaWN0IFJlc29sdXRpb24gRGlhbG9nIFwiVXNlIFJlY29tbWVuZGVkXCIgLyBcIkNob29zZSBBbHRlcm5hdGl2ZVwiXG4gIC8vIGFjdGlvbiBsYW5kcyBoZXJlIOKAlCBhIG1hbnVhbCByZXNvbHV0aW9uIGlzIGl0c2VsZiBhIExlYXJuaW5nIEVuZ2luZVxuICAvLyBzaWduYWwgKFJ1bGUgIzkpLCBjYXB0dXJlZCBiZWxvdywgbm90IGp1c3QgYSBVSSBzdGF0ZSBjaGFuZ2UuXG4gIGFwcC5wb3N0PHtcbiAgICBQYXJhbXM6IHsgdGVuYW50SWQ6IHN0cmluZzsgaWQ6IHN0cmluZzsgZmllbGRJZDogc3RyaW5nIH07XG4gICAgQm9keTogeyBjaG9zZW5WYWx1ZTogc3RyaW5nOyBjb3JyZWN0ZWRCeTogc3RyaW5nIH07XG4gIH0+KFwiL3RlbmFudHMvOnRlbmFudElkL3NoaXBtZW50cy86aWQvZmllbGRzLzpmaWVsZElkL3Jlc29sdmVcIiwgYXN5bmMgKHJlcXVlc3QsIHJlcGx5KSA9PiB7XG4gICAgY29uc3QgeyB0ZW5hbnRJZCwgZmllbGRJZCB9ID0gcmVxdWVzdC5wYXJhbXM7XG4gICAgY29uc3QgeyBjaG9zZW5WYWx1ZSwgY29ycmVjdGVkQnkgfSA9IHJlcXVlc3QuYm9keTtcbiAgICBhc3NlcnRUZW5hbnRBY2Nlc3MocmVxdWVzdC5hdXRoISwgdGVuYW50SWQpO1xuXG4gICAgcmV0dXJuIHdpdGhUZW5hbnQodGVuYW50SWQsIGFzeW5jIChjbGllbnQpID0+IHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgY2xpZW50LnF1ZXJ5KFxuICAgICAgICBgU0VMRUNUIHJlc29sdmVkX3ZhbHVlLCBmaWVsZF9rZXkgRlJPTSBjdGRtX2ZpZWxkcyBXSEVSRSBpZCA9ICQxIEFORCB0ZW5hbnRfaWQgPSAkMmAsXG4gICAgICAgIFtmaWVsZElkLCB0ZW5hbnRJZF1cbiAgICAgICk7XG4gICAgICBpZiAoZXhpc3Rpbmcucm93cy5sZW5ndGggPT09IDApIHJldHVybiByZXBseS5jb2RlKDQwNCkuc2VuZCh7IGVycm9yOiBcIkZpZWxkIG5vdCBmb3VuZFwiIH0pO1xuXG4gICAgICBhd2FpdCBjbGllbnQucXVlcnkoXG4gICAgICAgIGBVUERBVEUgY3RkbV9maWVsZHMgU0VUIHJlc29sdmVkX3ZhbHVlID0gJDEsIHN0YXR1cyA9ICdNQU5VQUxMWV9SRVNPTFZFRCcsIHJlc29sdmVkX2F0ID0gbm93KClcbiAgICAgICAgIFdIRVJFIGlkID0gJDJgLFxuICAgICAgICBbY2hvc2VuVmFsdWUsIGZpZWxkSWRdXG4gICAgICApO1xuXG4gICAgICAvLyBSdWxlICM5IOKAlCBldmVyeSBtYW51YWwgY29ycmVjdGlvbiBpcyBjYXB0dXJlZCBmb3IgZnV0dXJlIG1vZGVsXG4gICAgICAvLyBpbXByb3ZlbWVudCwgbmV2ZXIgZGlzY2FyZGVkIGFmdGVyIHRoaXMgc2luZ2xlIHVzZS5cbiAgICAgIGF3YWl0IGNsaWVudC5xdWVyeShcbiAgICAgICAgYElOU0VSVCBJTlRPIGxlYXJuaW5nX2NvcnJlY3Rpb25zICh0ZW5hbnRfaWQsIGN0ZG1fZmllbGRfaWQsIG9yaWdpbmFsX3ZhbHVlLCBjb3JyZWN0ZWRfdmFsdWUsIGNvcnJlY3RlZF9ieSwgZmllbGRfa2V5KVxuICAgICAgICAgVkFMVUVTICgkMSwgJDIsICQzLCAkNCwgJDUsICQ2KWAsXG4gICAgICAgIFt0ZW5hbnRJZCwgZmllbGRJZCwgZXhpc3Rpbmcucm93c1swXS5yZXNvbHZlZF92YWx1ZSwgY2hvc2VuVmFsdWUsIGNvcnJlY3RlZEJ5LCBleGlzdGluZy5yb3dzWzBdLmZpZWxkX2tleV1cbiAgICAgICk7XG5cbiAgICAgIGF3YWl0IHdyaXRlQXVkaXRMb2coY2xpZW50LCB7XG4gICAgICAgIHRlbmFudElkLFxuICAgICAgICBhY3RvcklkOiBjb3JyZWN0ZWRCeSxcbiAgICAgICAgYWN0aW9uOiBcIkZJRUxEX01BTlVBTExZX1JFU09MVkVEXCIsXG4gICAgICAgIGVudGl0eVR5cGU6IFwiY3RkbV9maWVsZFwiLFxuICAgICAgICBlbnRpdHlJZDogZmllbGRJZCxcbiAgICAgICAgY2hhbmdlczogeyBjaG9zZW5WYWx1ZSB9LFxuICAgICAgfSk7XG5cbiAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgLy8gR0VUIC90ZW5hbnRzLzp0ZW5hbnRJZC9zaGlwbWVudHMvOmlkL3ZhbGlkYXRpb24tZXJyb3JzXG4gIC8vIFRoZSBWYWxpZGF0aW9uIEVuZ2luZSByZXN1bHQgc2V0IOKAlCBkaXN0aW5jdCBmcm9tIGNoZWNrcG9pbnQtc3VtbWFyeSdzXG4gIC8vIHBlci1maWVsZCBjb25maWRlbmNlOiB0aGVzZSBhcmUgaGFyZCBjcm9zcy1yZWZlcmVuY2UgQ09OVFJBRElDVElPTlNcbiAgLy8gYmV0d2VlbiBzaWJsaW5nIGRvY3VtZW50cyAoZS5nLiBJbnZvaWNlIHNheXMgaW52b2ljZV9udW1iZXIgMDEyNjA1MSxcbiAgLy8gYSBsYXRlciBkb2N1bWVudCBzYXlzIDAxMjYwNTcgZm9yIHRoZSBzYW1lIHNoaXBtZW50KSwgbm90IGp1c3QgbG93XG4gIC8vIGNvbmZpZGVuY2UuIFN1cmZhY2VkIGFzIGEgYmxvY2tpbmcgYmFubmVyIGluIHRoZSBVSSwgbm90IGEgc29mdCBmbGFnLlxuICBhcHAuZ2V0PHsgUGFyYW1zOiB7IHRlbmFudElkOiBzdHJpbmc7IGlkOiBzdHJpbmcgfSB9PihcbiAgICBcIi90ZW5hbnRzLzp0ZW5hbnRJZC9zaGlwbWVudHMvOmlkL3ZhbGlkYXRpb24tZXJyb3JzXCIsXG4gICAgYXN5bmMgKHJlcXVlc3QsIHJlcGx5KSA9PiB7XG4gICAgICBjb25zdCB7IHRlbmFudElkLCBpZCB9ID0gcmVxdWVzdC5wYXJhbXM7XG4gICAgICBhc3NlcnRUZW5hbnRBY2Nlc3MocmVxdWVzdC5hdXRoISwgdGVuYW50SWQpO1xuXG4gICAgICByZXR1cm4gd2l0aFRlbmFudCh0ZW5hbnRJZCwgYXN5bmMgKGNsaWVudCkgPT4ge1xuICAgICAgICBjb25zdCB7IHJvd3MgfSA9IGF3YWl0IGNsaWVudC5xdWVyeShcbiAgICAgICAgICBgU0VMRUNUIHZlLmlkLCB2ZS5yZWZlcmVuY2VfdHlwZSwgdmUuZXhwZWN0ZWRfdmFsdWUsIHZlLmFjdHVhbF92YWx1ZSwgdmUuc3RhdHVzLCB2ZS5jcmVhdGVkX2F0LFxuICAgICAgICAgICAgICAgICAgZC5maWxlX25hbWUgQVMgY29uZmxpY3RpbmdfZG9jdW1lbnRfbmFtZVxuICAgICAgICAgICBGUk9NIHZhbGlkYXRpb25fZXJyb3JzIHZlXG4gICAgICAgICAgIExFRlQgSk9JTiBkb2N1bWVudHMgZCBPTiBkLmlkID0gdmUuY29uZmxpY3RpbmdfZG9jdW1lbnRfaWRcbiAgICAgICAgICAgV0hFUkUgdmUuc2hpcG1lbnRfaWQgPSAkMSBBTkQgdmUudGVuYW50X2lkID0gJDIgQU5EIHZlLnN0YXR1cyA9ICdPUEVOJ1xuICAgICAgICAgICBPUkRFUiBCWSB2ZS5jcmVhdGVkX2F0IERFU0NgLFxuICAgICAgICAgIFtpZCwgdGVuYW50SWRdXG4gICAgICAgICk7XG4gICAgICAgIHJldHVybiByb3dzO1xuICAgICAgfSk7XG4gICAgfVxuICApO1xuXG4gIC8vIFBPU1QgL3RlbmFudHMvOnRlbmFudElkL3ZhbGlkYXRpb24tZXJyb3JzLzplcnJvcklkL3Jlc29sdmVcbiAgYXBwLnBvc3Q8eyBQYXJhbXM6IHsgdGVuYW50SWQ6IHN0cmluZzsgZXJyb3JJZDogc3RyaW5nIH07IEJvZHk6IHsgcmVzb2x2ZWRCeTogc3RyaW5nIH0gfT4oXG4gICAgXCIvdGVuYW50cy86dGVuYW50SWQvdmFsaWRhdGlvbi1lcnJvcnMvOmVycm9ySWQvcmVzb2x2ZVwiLFxuICAgIGFzeW5jIChyZXF1ZXN0LCByZXBseSkgPT4ge1xuICAgICAgY29uc3QgeyB0ZW5hbnRJZCwgZXJyb3JJZCB9ID0gcmVxdWVzdC5wYXJhbXM7XG4gICAgICBhc3NlcnRUZW5hbnRBY2Nlc3MocmVxdWVzdC5hdXRoISwgdGVuYW50SWQpO1xuXG4gICAgICByZXR1cm4gd2l0aFRlbmFudCh0ZW5hbnRJZCwgYXN5bmMgKGNsaWVudCkgPT4ge1xuICAgICAgICBhd2FpdCBjbGllbnQucXVlcnkoYFVQREFURSB2YWxpZGF0aW9uX2Vycm9ycyBTRVQgc3RhdHVzID0gJ1JFU09MVkVEJyBXSEVSRSBpZCA9ICQxIEFORCB0ZW5hbnRfaWQgPSAkMmAsIFtcbiAgICAgICAgICBlcnJvcklkLFxuICAgICAgICAgIHRlbmFudElkLFxuICAgICAgICBdKTtcbiAgICAgICAgYXdhaXQgd3JpdGVBdWRpdExvZyhjbGllbnQsIHtcbiAgICAgICAgICB0ZW5hbnRJZCxcbiAgICAgICAgICBhY3RvcklkOiByZXF1ZXN0LmJvZHkucmVzb2x2ZWRCeSxcbiAgICAgICAgICBhY3Rpb246IFwiVkFMSURBVElPTl9FUlJPUl9SRVNPTFZFRFwiLFxuICAgICAgICAgIGVudGl0eVR5cGU6IFwidmFsaWRhdGlvbl9lcnJvclwiLFxuICAgICAgICAgIGVudGl0eUlkOiBlcnJvcklkLFxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xuICAgICAgfSk7XG4gICAgfVxuICApO1xufVxuIl19