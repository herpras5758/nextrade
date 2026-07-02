import { FastifyInstance } from 'fastify';
import { withTenant } from '../db/pool.js';
import { assertTenantAccess } from '../middleware/auth.js';

export async function shipmentRoutes(app: FastifyInstance) {

  // GET shipment list
  app.get('/tenants/:tenantId/shipments', async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    assertTenantAccess(req.auth!, tenantId);
    const q = req.query as any;
    return withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT s.*, COUNT(d.id) as doc_count
         FROM shipments s
         LEFT JOIN documents d ON d.shipment_id = s.id AND d.tenant_id = s.tenant_id
         WHERE s.tenant_id = $1
         GROUP BY s.id
         ORDER BY s.created_at DESC
         LIMIT 50`,
        [tenantId]
      );
      return rows;
    });
  });

  // GET single shipment
  app.get('/tenants/:tenantId/shipments/:shipmentId', async (req, reply) => {
    const { tenantId, shipmentId } = req.params as any;
    assertTenantAccess(req.auth!, tenantId);
    return withTenant(tenantId, async (client) => {
      const { rows: [shipment] } = await client.query(
        `SELECT s.*, COUNT(d.id) as doc_count
         FROM shipments s
         LEFT JOIN documents d ON d.shipment_id = s.id
         WHERE s.id = $1 AND s.tenant_id = $2
         GROUP BY s.id`,
        [shipmentId, tenantId]
      );
      if (!shipment) return reply.code(404).send({ error: 'Shipment not found' });
      return shipment;
    });
  });

  // GET documents for shipment
  app.get('/tenants/:tenantId/shipments/:shipmentId/documents', async (req, reply) => {
    const { tenantId, shipmentId } = req.params as any;
    assertTenantAccess(req.auth!, tenantId);
    return withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT d.*,
           COUNT(cf.id) as field_count,
           AVG(cf.confidence) as avg_confidence
         FROM documents d
         LEFT JOIN ctdm_fields cf ON cf.document_id = d.id
         WHERE d.shipment_id = $1 AND d.tenant_id = $2
         GROUP BY d.id
         ORDER BY d.created_at ASC`,
        [shipmentId, tenantId]
      );
      return rows;
    });
  });

  // GET ctdm_fields for shipment — Tab Fields
  app.get('/tenants/:tenantId/shipments/:shipmentId/fields', async (req, reply) => {
    const { tenantId, shipmentId } = req.params as any;
    assertTenantAccess(req.auth!, tenantId);
    return withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT
           cf.id, cf.field_key, cf.resolved_value, cf.confidence, cf.status,
           cf.document_id,
           d.document_type, d.file_name,
           dfc.display_name, dfc.is_mandatory, dfc.is_mandatory_ceisa, dfc.ceisa_field_ref
         FROM ctdm_fields cf
         JOIN documents d ON d.id = cf.document_id
         LEFT JOIN tenant_doc_field_config dfc
           ON dfc.tenant_id = cf.tenant_id
           AND dfc.doc_type_code = d.document_type
           AND dfc.field_key = cf.field_key
         WHERE cf.shipment_id = $1 AND cf.tenant_id = $2
         ORDER BY d.document_type, dfc.sort_order NULLS LAST, cf.field_key`,
        [shipmentId, tenantId]
      );

      // Group by document type
      const grouped: Record<string, any[]> = {};
      for (const row of rows) {
        const key = `${row.document_type}:${row.document_id}`;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(row);
      }

      return {
        shipmentId,
        totalFields: rows.length,
        autoApproved: rows.filter(r => r.status === 'auto_approved').length,
        needsReview: rows.filter(r => r.status === 'review_required').length,
        avgConfidence: rows.length > 0
          ? Math.round(rows.reduce((s, r) => s + parseFloat(r.confidence ?? 0), 0) / rows.length * 100) / 100
          : 0,
        byDocument: Object.entries(grouped).map(([key, fields]) => ({
          documentType: fields[0].document_type,
          documentId: fields[0].document_id,
          fileName: fields[0].file_name,
          fields,
        })),
        allFields: rows,
      };
    });
  });

  // GET validation errors for shipment
  app.get('/tenants/:tenantId/shipments/:shipmentId/validation-errors', async (req, reply) => {
    const { tenantId, shipmentId } = req.params as any;
    assertTenantAccess(req.auth!, tenantId);
    return withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT ve.*, d.file_name, d.document_type
         FROM validation_errors ve
         LEFT JOIN documents d ON d.id = ve.document_id_a
         WHERE ve.shipment_id = $1 AND ve.tenant_id = $2
         ORDER BY ve.created_at DESC`,
        [shipmentId, tenantId]
      );
      return rows;
    });
  });

  // GET identity signals for shipment
  app.get('/tenants/:tenantId/shipments/:shipmentId/signals', async (req, reply) => {
    const { tenantId, shipmentId } = req.params as any;
    assertTenantAccess(req.auth!, tenantId);
    return withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT is2.*, d.file_name, d.document_type
         FROM identity_signals is2
         LEFT JOIN documents d ON d.id = is2.source_document_id
         WHERE is2.tenant_id = $1 AND d.shipment_id = $2
         ORDER BY is2.signal_type`,
        [tenantId, shipmentId]
      );
      return rows;
    });
  });

  // GET evidence timeline for shipment
  app.get('/tenants/:tenantId/shipments/:shipmentId/timeline', async (req, reply) => {
    const { tenantId, shipmentId } = req.params as any;
    assertTenantAccess(req.auth!, tenantId);
    return withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT ee.*
         FROM evidence_events ee
         WHERE ee.tenant_id = $1
           AND (ee.entity_id = $2 OR ee.producer_ref = $2
                OR ee.entity_id IN (
                  SELECT id FROM documents WHERE shipment_id = $2
                ))
         ORDER BY ee.event_time DESC, ee.sequence_num DESC
         LIMIT 100`,
        [tenantId, shipmentId]
      );
      return rows;
    });
  });

  // PUT update field value (user correction)
  app.put('/tenants/:tenantId/shipments/:shipmentId/fields/:fieldId', async (req, reply) => {
    const { tenantId, shipmentId, fieldId } = req.params as any;
    assertTenantAccess(req.auth!, tenantId);
    const body = req.body as any;
    return withTenant(tenantId, async (client) => {
      const { rows: [field] } = await client.query(
        `UPDATE ctdm_fields SET
           resolved_value = $1,
           status = 'user_verified',
           confidence = 1.0
         WHERE id = $2 AND shipment_id = $3 AND tenant_id = $4
         RETURNING *`,
        [body.resolved_value, fieldId, shipmentId, tenantId]
      );

      // Record learning correction
      await client.query(
        `INSERT INTO learning_corrections
           (tenant_id, shipment_id, document_id, field_key,
            original_value, corrected_value, corrected_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT DO NOTHING`,
        [tenantId, shipmentId, field?.document_id, field?.field_key,
         body.original_value, body.resolved_value, req.auth!.userId]
      ).catch(() => {}); // table may not exist yet

      return field;
    });
  });
}
