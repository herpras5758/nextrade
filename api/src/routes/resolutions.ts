import { FastifyInstance } from 'fastify';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { withTenant } from '../lib/db.js';
import { assertTenantAccess } from '../middleware/auth.js';

const sqs = new SQSClient({});

export async function resolutionRoutes(app: FastifyInstance) {

  // GET /tenants/:tenantId/resolutions
  app.get('/tenants/:tenantId/resolutions', async (req, reply) => {
    const { tenantId } = req.params as any;
    assertTenantAccess(req.auth!, tenantId);
    const { status, limit = '20', offset = '0' } = req.query as any;

    return withTenant(tenantId, async (client) => {
      let where = 'WHERE r.tenant_id=$1';
      const params: any[] = [tenantId];
      if (status) where += ` AND r.status=$${params.push(status)}`;

      const { rows: resolutions } = await client.query(
        `SELECT r.*,
                COUNT(rd.id) as document_count,
                s.id as shipment_id, s.shipment_number, s.status as shipment_status
         FROM resolutions r
         LEFT JOIN resolution_documents rd ON rd.resolution_id=r.id
         LEFT JOIN shipments s ON s.resolution_id=r.id
         ${where}
         GROUP BY r.id, s.id
         ORDER BY r.updated_at DESC
         LIMIT $${params.push(parseInt(limit))} OFFSET $${params.push(parseInt(offset))}`,
        params
      );

      return { resolutions, total: resolutions.length };
    });
  });

  // GET /tenants/:tenantId/resolutions/:resId
  app.get('/tenants/:tenantId/resolutions/:resId', async (req, reply) => {
    const { tenantId, resId } = req.params as any;
    assertTenantAccess(req.auth!, tenantId);

    return withTenant(tenantId, async (client) => {
      const { rows: [resolution] } = await client.query(
        `SELECT r.*, s.id as shipment_id, s.shipment_number
         FROM resolutions r
         LEFT JOIN shipments s ON s.resolution_id=r.id
         WHERE r.id=$1 AND r.tenant_id=$2`,
        [resId, tenantId]
      );
      if (!resolution) return reply.code(404).send({ error: 'Resolution not found' });

      // Documents in this resolution
      const { rows: documents } = await client.query(
        `SELECT d.id, d.file_name, d.doc_type, d.doc_type_confidence, d.status,
                d.uploaded_at, d.is_split_child, d.page_range_start, d.page_range_end,
                rd.doc_role, rd.added_reason, rd.confidence as link_confidence
         FROM resolution_documents rd
         JOIN documents d ON d.id=rd.document_id
         WHERE rd.resolution_id=$1
         ORDER BY d.doc_type, d.uploaded_at`,
        [resId]
      );

      // Merged fields from all documents
      const docIds = documents.map(d => d.id);
      const { rows: fields } = await client.query(
        `SELECT fe.field_key, fe.raw_value, fe.normalized_value, fe.confidence,
                fe.status, fe.corrected_value,
                d.doc_type, d.file_name,
                tfc.display_name, tfc.is_mandatory_ceisa, tfc.ceisa_field_ref,
                COALESCE(fe.corrected_value, fe.raw_value) as effective_value
         FROM field_extractions fe
         JOIN documents d ON d.id=fe.document_id
         LEFT JOIN tenant_field_config tfc
           ON tfc.tenant_id=fe.tenant_id AND tfc.doc_type_code=d.doc_type AND tfc.field_key=fe.field_key
         WHERE fe.document_id=ANY($1::uuid[]) AND fe.tenant_id=$2
           AND fe.raw_value IS NOT NULL AND fe.raw_value!=''
         ORDER BY d.doc_type, tfc.sort_order NULLS LAST, fe.field_key`,
        [docIds, tenantId]
      );

      // Resolution history
      const { rows: events } = await client.query(
        `SELECT re.*, d.file_name as trigger_doc_name
         FROM resolution_events re
         LEFT JOIN documents d ON d.id=re.trigger_document_id
         WHERE re.resolution_id=$1
         ORDER BY re.created_at DESC LIMIT 20`,
        [resId]
      );

      // Confidence breakdown detail
      const { rows: sharedEntities } = await client.query(
        `SELECT gn.entity_type, gn.canonical_value, gn.display_value,
                COUNT(DISTINCT doc_node.document_id) as doc_count,
                AVG(ge.confidence) as avg_confidence
         FROM graph_nodes doc_node
         JOIN graph_edges ge ON ge.source_node_id=doc_node.id
         JOIN graph_nodes gn ON gn.id=ge.target_node_id
         WHERE doc_node.document_id=ANY($1::uuid[])
           AND doc_node.node_type='DOCUMENT' AND gn.node_type='ENTITY'
         GROUP BY gn.entity_type, gn.canonical_value, gn.display_value
         HAVING COUNT(DISTINCT doc_node.document_id) > 1
         ORDER BY doc_count DESC, avg_confidence DESC`,
        [docIds]
      );

      return { resolution, documents, fields, events, sharedEntities };
    });
  });

  // POST /tenants/:tenantId/resolutions/:resId/evidence
  // User submits facts — Resolution Engine re-runs (ADR-009)
  app.post('/tenants/:tenantId/resolutions/:resId/evidence', async (req, reply) => {
    const { tenantId, resId } = req.params as any;
    assertTenantAccess(req.auth!, tenantId);

    const { evidence_type, payload } = req.body as {
      evidence_type: string;
      payload: Record<string, any>;
    };

    const validTypes = [
      'DOCUMENT_BELONGS_HERE', 'DOCUMENT_DOES_NOT_BELONG',
      'FIELD_VALUE_INCORRECT', 'DOCUMENTS_ARE_RELATED', 'DOCUMENTS_ARE_NOT_RELATED',
    ];
    if (!validTypes.includes(evidence_type)) {
      return reply.code(400).send({ error: `Invalid evidence_type. Must be: ${validTypes.join(' | ')}` });
    }

    return withTenant(tenantId, async (client) => {
      const { rows: [evidence] } = await client.query(
        `INSERT INTO human_evidence (tenant_id, resolution_id, evidence_type, payload, submitted_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [tenantId, resId, evidence_type, JSON.stringify(payload), req.auth!.userId]
      );

      await client.query(
        `INSERT INTO evidence_events (tenant_id, event_type, actor_type, actor_id, entity_type, entity_id, payload)
         VALUES ($1,'HUMAN_EVIDENCE_SUBMITTED','user',$2,'RESOLUTION',$3,$4)`,
        [tenantId, req.auth!.userId, resId,
         JSON.stringify({ evidence_type, evidence_id: evidence.id })]
      );

      // Get resolution documents to trigger re-resolution
      const { rows: resDocs } = await client.query(
        `SELECT rd.document_id FROM resolution_documents rd WHERE rd.resolution_id=$1`, [resId]
      );

      // Apply evidence immediately if possible
      if (evidence_type === 'DOCUMENT_BELONGS_HERE' && payload.document_id) {
        // Add document to this resolution (manual override)
        await client.query(
          `INSERT INTO resolution_documents (resolution_id, document_id, tenant_id, doc_role, added_reason)
           VALUES ($1,$2,$3,'MANUAL','Human evidence: DOCUMENT_BELONGS_HERE')
           ON CONFLICT DO NOTHING`,
          [resId, payload.document_id, tenantId]
        );
      }

      if (evidence_type === 'DOCUMENT_DOES_NOT_BELONG' && payload.document_id) {
        await client.query(
          `DELETE FROM resolution_documents WHERE resolution_id=$1 AND document_id=$2`,
          [resId, payload.document_id]
        );
      }

      if (evidence_type === 'FIELD_VALUE_INCORRECT' && payload.document_id && payload.field_key) {
        await client.query(
          `UPDATE field_extractions SET
             corrected_value=$1, corrected_by=$2, corrected_at=NOW(),
             correction_reason='Human evidence', status='user_verified', updated_at=NOW()
           WHERE document_id=$3 AND field_key=$4`,
          [payload.correct_value, req.auth!.userId, payload.document_id, payload.field_key]
        );
      }

      // Mark evidence as processed
      await client.query(
        `UPDATE human_evidence SET processed_at=NOW() WHERE id=$1`, [evidence.id]
      );

      // Re-trigger resolution engine for affected docs
      if (resDocs.length > 0) {
        const triggerDoc = resDocs[0].document_id;
        await sqs.send(new SendMessageCommand({
          QueueUrl: process.env.RESOLUTION_QUEUE_URL!,
          MessageBody: JSON.stringify({ documentId: triggerDoc, tenantId, entityNodeIds: [], forceRecalculate: true }),
        }));
      }

      return { success: true, evidenceId: evidence.id };
    });
  });

  // PATCH /tenants/:tenantId/resolutions/:resId/approve
  // Human approves → promote to Shipment
  app.patch('/tenants/:tenantId/resolutions/:resId/approve', async (req, reply) => {
    const { tenantId, resId } = req.params as any;
    assertTenantAccess(req.auth!, tenantId);

    return withTenant(tenantId, async (client) => {
      const { rows: [resolution] } = await client.query(
        `UPDATE resolutions SET
           status='verified', human_approved_by=$1, human_approved_at=NOW(), updated_at=NOW()
         WHERE id=$2 AND tenant_id=$3
         RETURNING *`,
        [req.auth!.userId, resId, tenantId]
      );
      if (!resolution) return reply.code(404).send({ error: 'Resolution not found' });

      await client.query(
        `INSERT INTO resolution_events (tenant_id, resolution_id, event_type, reason)
         VALUES ($1,$2,'HUMAN_APPROVED',$3)`,
        [tenantId, resId, `Approved by ${req.auth!.userId}`]
      );

      await client.query(
        `INSERT INTO evidence_events (tenant_id, event_type, actor_type, actor_id, entity_type, entity_id)
         VALUES ($1,'RESOLUTION_APPROVED','user',$2,'RESOLUTION',$3)`,
        [tenantId, req.auth!.userId, resId]
      );

      // Create shipment
      const { rows: [{ nextval }] } = await client.query(`SELECT nextval('shipment_seq')`);
      const year = new Date().getFullYear();
      const shipmentNumber = `SHP-${year}-${String(nextval).padStart(4, '0')}`;

      const { rows: [shipment] } = await client.query(
        `INSERT INTO shipments (tenant_id, resolution_id, shipment_number, status, health)
         VALUES ($1,$2,$3,'verified','healthy')
         ON CONFLICT (resolution_id) DO UPDATE SET status='verified', updated_at=NOW()
         RETURNING *`,
        [tenantId, resId, shipmentNumber]
      );

      return { success: true, resolution, shipment };
    });
  });

  // POST /tenants/:tenantId/resolutions/recalculate
  // Force recalculate with optional preferred documents as hints (ADR-009)
  app.post('/tenants/:tenantId/resolutions/recalculate', async (req, reply) => {
    const { tenantId } = req.params as any;
    assertTenantAccess(req.auth!, tenantId);
    const { resolution_id, preferred_document_ids } = req.body as any;

    return withTenant(tenantId, async (client) => {
      // Find trigger document
      let triggerDocId: string | null = null;
      if (preferred_document_ids?.length > 0) {
        triggerDocId = preferred_document_ids[0];
      } else if (resolution_id) {
        const { rows: [rd] } = await client.query(
          `SELECT document_id FROM resolution_documents WHERE resolution_id=$1 LIMIT 1`, [resolution_id]
        );
        triggerDocId = rd?.document_id;
      }

      if (!triggerDocId) return reply.code(400).send({ error: 'Provide resolution_id or preferred_document_ids' });

      await sqs.send(new SendMessageCommand({
        QueueUrl: process.env.RESOLUTION_QUEUE_URL!,
        MessageBody: JSON.stringify({
          documentId: triggerDocId, tenantId, entityNodeIds: [], forceRecalculate: true,
        }),
      }));

      return { success: true, message: 'Recalculation queued' };
    });
  });
}
