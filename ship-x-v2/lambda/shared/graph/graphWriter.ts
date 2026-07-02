import { PoolClient } from 'pg';

// Map field_key → entity_type for the knowledge graph
// Loaded from tenant_field_config.graph_entity_type
export interface GraphSignal {
  fieldKey: string;
  entityType: string;
  rawValue: string;
  normalizedValue: string;
  confidence: number;
}

// Normalize a value for canonical graph storage
export function normalizeEntityValue(value: string, entityType: string): string {
  let v = value.trim().toUpperCase();
  // Strip common punctuation for number-type entities
  if (['INVOICE_NUMBER','BL_NUMBER','PO_NUMBER','CONTAINER_NUMBER'].includes(entityType)) {
    v = v.replace(/[\s\-\.\/]/g, '');
  }
  // Normalize supplier/consignee names
  if (['SUPPLIER','CONSIGNEE','NOTIFY_PARTY'].includes(entityType)) {
    v = v.replace(/[,\.]/g, '').replace(/\s+/g, ' ').trim();
  }
  return v;
}

export interface GraphWriteResult {
  documentNodeId: string;
  entityNodeIds: string[];
  edgeIds: string[];
  observationIds: string[];
}

// Write document → entity edges to knowledge graph
// Called after extraction. Returns entity node IDs for resolution engine.
export async function writeDocumentToGraph(
  client: PoolClient,
  tenantId: string,
  documentId: string,
  signals: GraphSignal[],
  eventId: string
): Promise<GraphWriteResult> {
  const entityNodeIds: string[] = [];
  const edgeIds: string[] = [];
  const observationIds: string[] = [];

  // 1. Ensure DOCUMENT node exists
  const { rows: [docNode] } = await client.query<{ id: string }>(
    `INSERT INTO graph_nodes (tenant_id, node_type, document_id)
     VALUES ($1, 'DOCUMENT', $2)
     ON CONFLICT (tenant_id, entity_type, canonical_value)
     DO UPDATE SET updated_at = NOW()
     RETURNING id`,
    [tenantId, documentId]
  ).catch(async () => {
    // If unique constraint fails (entity_type=null doesn't conflict), fetch existing
    const r = await client.query<{ id: string }>(
      `SELECT id FROM graph_nodes WHERE tenant_id=$1 AND document_id=$2 AND node_type='DOCUMENT'`,
      [tenantId, documentId]
    );
    if (r.rows[0]) return r;
    // Create fresh
    return client.query<{ id: string }>(
      `INSERT INTO graph_nodes (tenant_id, node_type, document_id) VALUES ($1, 'DOCUMENT', $2) RETURNING id`,
      [tenantId, documentId]
    );
  });

  const documentNodeId = docNode.id;
  const edgeType = (entityType: string) => `HAS_${entityType}`;

  // 2. For each signal: upsert entity node + create edge + record observation
  for (const signal of signals) {
    if (!signal.rawValue?.trim()) continue;
    const canonical = normalizeEntityValue(signal.rawValue, signal.entityType);
    if (!canonical) continue;

    // Upsert entity node
    const { rows: [entityNode] } = await client.query<{ id: string }>(
      `INSERT INTO graph_nodes
         (tenant_id, node_type, entity_type, canonical_value, display_value, confidence, observation_count)
       VALUES ($1, 'ENTITY', $2, $3, $4, $5, 1)
       ON CONFLICT (tenant_id, entity_type, canonical_value)
       DO UPDATE SET
         observation_count = graph_nodes.observation_count + 1,
         display_value = EXCLUDED.display_value,
         updated_at = NOW()
       RETURNING id`,
      [tenantId, signal.entityType, canonical, signal.rawValue.trim(), signal.confidence]
    );

    entityNodeIds.push(entityNode.id);

    // Create edge: DOCUMENT → ENTITY
    const sp = `sp_edge_${signal.entityType.toLowerCase()}`;
    await client.query(`SAVEPOINT ${sp}`);
    try {
      const { rows: [edge] } = await client.query<{ id: string }>(
        `INSERT INTO graph_edges
           (tenant_id, source_node_id, target_node_id, edge_type,
            confidence, field_key, raw_value, evidence_event_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (source_node_id, target_node_id, edge_type)
         DO UPDATE SET confidence = GREATEST(graph_edges.confidence, EXCLUDED.confidence)
         RETURNING id`,
        [tenantId, documentNodeId, entityNode.id, edgeType(signal.entityType),
         signal.confidence, signal.fieldKey, signal.rawValue, eventId]
      );
      edgeIds.push(edge.id);
      await client.query(`RELEASE SAVEPOINT ${sp}`);
    } catch (e) {
      await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    }

    // Record observation
    const sp2 = `sp_obs_${signal.entityType.toLowerCase()}`;
    await client.query(`SAVEPOINT ${sp2}`);
    try {
      const { rows: [obs] } = await client.query<{ id: string }>(
        `INSERT INTO entity_observations
           (tenant_id, document_id, entity_node_id, field_key, raw_value, normalized_value, confidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (document_id, entity_node_id, field_key) DO UPDATE SET confidence = EXCLUDED.confidence
         RETURNING id`,
        [tenantId, documentId, entityNode.id, signal.fieldKey,
         signal.rawValue, canonical, signal.confidence]
      );
      observationIds.push(obs.id);
      await client.query(`RELEASE SAVEPOINT ${sp2}`);
    } catch (e) {
      await client.query(`ROLLBACK TO SAVEPOINT ${sp2}`);
    }
  }

  return { documentNodeId, entityNodeIds, edgeIds, observationIds };
}

// Get all entity node IDs connected to a document
export async function getDocumentEntityNodes(
  client: PoolClient,
  tenantId: string,
  documentId: string
): Promise<{ nodeId: string; entityType: string; canonicalValue: string; confidence: number }[]> {
  const { rows } = await client.query(
    `SELECT gn.id as node_id, gn.entity_type, gn.canonical_value, ge.confidence
     FROM graph_nodes doc_node
     JOIN graph_edges ge ON ge.source_node_id = doc_node.id
     JOIN graph_nodes gn ON gn.id = ge.target_node_id
     WHERE doc_node.document_id = $1 AND doc_node.tenant_id = $2
       AND doc_node.node_type = 'DOCUMENT' AND gn.node_type = 'ENTITY'`,
    [documentId, tenantId]
  );
  return rows.map(r => ({
    nodeId: r.node_id,
    entityType: r.entity_type,
    canonicalValue: r.canonical_value,
    confidence: parseFloat(r.confidence),
  }));
}

// Find all document IDs sharing at least one entity with given entity nodes
// Used by resolution engine for BFS connected component
export async function findConnectedDocuments(
  client: PoolClient,
  tenantId: string,
  entityNodeIds: string[]
): Promise<string[]> {
  if (entityNodeIds.length === 0) return [];

  const placeholders = entityNodeIds.map((_, i) => `$${i + 2}`).join(',');
  const { rows } = await client.query(
    `SELECT DISTINCT d.id
     FROM graph_nodes doc_node
     JOIN graph_edges ge ON ge.source_node_id = doc_node.id
     JOIN documents d ON d.id = doc_node.document_id
     WHERE doc_node.node_type = 'DOCUMENT'
       AND ge.target_node_id IN (${placeholders})
       AND d.tenant_id = $1
       AND d.status NOT IN ('error', 'archived', 'split')`,
    [tenantId, ...entityNodeIds]
  );
  return rows.map(r => r.id);
}
