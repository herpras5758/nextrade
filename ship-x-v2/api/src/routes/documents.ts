import { FastifyInstance } from 'fastify';
import { withTenant } from '../lib/db.js';
import { assertTenantAccess } from '../middleware/auth.js';

export async function documentRoutes(app: FastifyInstance) {

  // GET /tenants/:tenantId/documents
  app.get('/tenants/:tenantId/documents', async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    assertTenantAccess(req.auth!, tenantId);
    const { status, doc_type, limit = '50', offset = '0' } = req.query as any;

    return withTenant(tenantId, async (client) => {
      let where = 'WHERE d.tenant_id=$1 AND d.is_split_child=false';
      const params: any[] = [tenantId];
      if (status) { where += ` AND d.status=$${params.push(status)}`; }
      if (doc_type) { where += ` AND d.doc_type=$${params.push(doc_type)}`; }

      const { rows: documents } = await client.query(
        `SELECT d.*,
                r.id as resolution_id, r.status as resolution_status,
                r.confidence_score,
                (SELECT COUNT(*) FROM documents c WHERE c.parent_document_id=d.id) as child_count
         FROM documents d
         LEFT JOIN resolution_documents rd ON rd.document_id=d.id
         LEFT JOIN resolutions r ON r.id=rd.resolution_id
         ${where}
         ORDER BY d.uploaded_at DESC
         LIMIT $${params.push(parseInt(limit))} OFFSET $${params.push(parseInt(offset))}`,
        params
      );

      const { rows: [{ count }] } = await client.query(
        `SELECT COUNT(*) FROM documents d ${where}`,
        params.slice(0, params.length - 2)
      );

      return { documents, total: parseInt(count), limit: parseInt(limit), offset: parseInt(offset) };
    });
  });

  // GET /tenants/:tenantId/documents/:docId
  app.get('/tenants/:tenantId/documents/:docId', async (req, reply) => {
    const { tenantId, docId } = req.params as any;
    assertTenantAccess(req.auth!, tenantId);

    return withTenant(tenantId, async (client) => {
      const { rows: [doc] } = await client.query(
        `SELECT d.*,
                r.id as resolution_id, r.status as resolution_status, r.confidence_score
         FROM documents d
         LEFT JOIN resolution_documents rd ON rd.document_id=d.id
         LEFT JOIN resolutions r ON r.id=rd.resolution_id
         WHERE d.id=$1 AND d.tenant_id=$2`,
        [docId, tenantId]
      );
      if (!doc) return reply.code(404).send({ error: 'Document not found' });

      // Children (if split)
      const { rows: children } = await client.query(
        `SELECT id, file_name, doc_type, doc_type_confidence, status,
                page_range_start, page_range_end
         FROM documents WHERE parent_document_id=$1 ORDER BY page_range_start`,
        [docId]
      );

      return { ...doc, children };
    });
  });

  // GET /tenants/:tenantId/documents/:docId/fields
  app.get('/tenants/:tenantId/documents/:docId/fields', async (req, reply) => {
    const { tenantId, docId } = req.params as any;
    assertTenantAccess(req.auth!, tenantId);

    return withTenant(tenantId, async (client) => {
      const { rows: fields } = await client.query(
        `SELECT fe.*, tfc.display_name, tfc.is_mandatory_ceisa, tfc.ceisa_field_ref,
                tfc.is_graph_signal, tfc.graph_entity_type
         FROM field_extractions fe
         LEFT JOIN tenant_field_config tfc
           ON tfc.tenant_id=fe.tenant_id AND tfc.field_key=fe.field_key
         WHERE fe.document_id=$1 AND fe.tenant_id=$2
         ORDER BY tfc.sort_order NULLS LAST`,
        [docId, tenantId]
      );
      return { fields, count: fields.length };
    });
  });

  // PATCH /tenants/:tenantId/documents/:docId/fields/:fieldKey
  // User corrects an extracted value — this is evidence, not direct graph edit
  app.patch('/tenants/:tenantId/documents/:docId/fields/:fieldKey', async (req, reply) => {
    const { tenantId, docId, fieldKey } = req.params as any;
    assertTenantAccess(req.auth!, tenantId);
    const { corrected_value, reason } = req.body as any;

    return withTenant(tenantId, async (client) => {
      await client.query(
        `UPDATE field_extractions SET
           corrected_value=$1, corrected_by=$2, corrected_at=NOW(),
           correction_reason=$3, status='user_verified', updated_at=NOW()
         WHERE document_id=$4 AND field_key=$5 AND tenant_id=$6`,
        [corrected_value, req.auth!.userId, reason ?? null, docId, fieldKey, tenantId]
      );

      // Write evidence event
      await client.query(
        `INSERT INTO evidence_events (tenant_id, event_type, actor_type, actor_id, entity_type, entity_id, payload)
         VALUES ($1,'FIELD_CORRECTED','user',$2,'DOCUMENT',$3,$4)`,
        [tenantId, req.auth!.userId, docId,
         JSON.stringify({ field_key: fieldKey, new_value: corrected_value })]
      );

      return { success: true };
    });
  });

  // GET /tenants/:tenantId/documents/:docId/graph
  // Show graph neighborhood of a document
  app.get('/tenants/:tenantId/documents/:docId/graph', async (req, reply) => {
    const { tenantId, docId } = req.params as any;
    assertTenantAccess(req.auth!, tenantId);

    return withTenant(tenantId, async (client) => {
      // This document's entity nodes
      const { rows: entities } = await client.query(
        `SELECT gn.id, gn.entity_type, gn.canonical_value, gn.display_value,
                gn.observation_count, ge.confidence, ge.field_key
         FROM graph_nodes doc_node
         JOIN graph_edges ge ON ge.source_node_id=doc_node.id
         JOIN graph_nodes gn ON gn.id=ge.target_node_id
         WHERE doc_node.document_id=$1 AND doc_node.node_type='DOCUMENT'
           AND gn.node_type='ENTITY'`,
        [docId]
      );

      // Other documents sharing these entities
      const entityIds = entities.map(e => e.id);
      let connectedDocs: any[] = [];
      if (entityIds.length > 0) {
        const { rows } = await client.query(
          `SELECT DISTINCT d.id, d.file_name, d.doc_type, d.status,
                  gn.entity_type as via_entity, gn.canonical_value as via_value
           FROM graph_nodes doc_node
           JOIN graph_edges ge ON ge.source_node_id=doc_node.id
           JOIN documents d ON d.id=doc_node.document_id
           JOIN graph_nodes gn ON gn.id=ge.target_node_id
           WHERE ge.target_node_id=ANY($1::uuid[])
             AND d.id!=$2 AND d.tenant_id=$3`,
          [entityIds, docId, tenantId]
        );
        connectedDocs = rows;
      }

      return { entities, connectedDocs };
    });
  });
}
