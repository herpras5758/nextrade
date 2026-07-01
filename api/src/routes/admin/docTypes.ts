import { FastifyInstance } from 'fastify';
import { withTenant } from '../../db/pool.js';
import { assertTenantAccess } from '../../middleware/auth.js';

export async function docTypeRoutes(app: FastifyInstance) {

  // GET all doc types
  app.get('/tenants/:tenantId/admin/doc-types', async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    assertTenantAccess(req.auth!, tenantId);
    return withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM tenant_doc_type_config WHERE tenant_id = $1 ORDER BY category, display_name`,
        [tenantId]
      );
      return rows;
    });
  });

  // PUT update doc type
  app.put('/tenants/:tenantId/admin/doc-types/:docTypeCode', async (req, reply) => {
    const { tenantId, docTypeCode } = req.params as { tenantId: string; docTypeCode: string };
    assertTenantAccess(req.auth!, tenantId);
    if (!req.auth!.roles.includes('admin')) return reply.code(403).send({ error: 'Admin only' });
    const body = req.body as any;
    return withTenant(tenantId, async (client) => {
      const { rows: [row] } = await client.query(
        `UPDATE tenant_doc_type_config SET
           display_name = $1, is_enabled = $2, classification_hints = $3,
           extraction_prompt_override = $4, updated_at = NOW()
         WHERE tenant_id = $5 AND doc_type_code = $6
         RETURNING *`,
        [body.display_name, body.is_enabled, body.classification_hints,
         body.extraction_prompt_override ?? null, tenantId, docTypeCode]
      );
      return row;
    });
  });

  // GET all fields
  app.get('/tenants/:tenantId/admin/doc-fields', async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    assertTenantAccess(req.auth!, tenantId);
    return withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM tenant_doc_field_config WHERE tenant_id = $1 ORDER BY doc_type_code, sort_order`,
        [tenantId]
      );
      return rows;
    });
  });

  // PUT update field
  app.put('/tenants/:tenantId/admin/doc-fields/:docTypeCode/:fieldKey', async (req, reply) => {
    const { tenantId, docTypeCode, fieldKey } = req.params as any;
    assertTenantAccess(req.auth!, tenantId);
    if (!req.auth!.roles.includes('admin')) return reply.code(403).send({ error: 'Admin only' });
    const body = req.body as any;
    return withTenant(tenantId, async (client) => {
      const { rows: [row] } = await client.query(
        `UPDATE tenant_doc_field_config SET
           display_name = $1, is_enabled = $2, is_mandatory = $3,
           is_mandatory_ceisa = $4, ceisa_field_ref = $5,
           confidence_threshold = $6, updated_at = NOW()
         WHERE tenant_id = $7 AND doc_type_code = $8 AND field_key = $9
         RETURNING *`,
        [body.display_name, body.is_enabled, body.is_mandatory,
         body.is_mandatory_ceisa, body.ceisa_field_ref ?? null,
         body.confidence_threshold ?? null, tenantId, docTypeCode, fieldKey]
      );
      return row;
    });
  });
}
