/**
 * resolution-engine Lambda
 *
 * Triggered by SQS after classify-extract completes.
 * Implements ADR-010: Incremental resolution on connected components only.
 *
 * Algorithm:
 * 1. Load entity nodes for the new document
 * 2. BFS/DFS to find all documents sharing at least one entity
 * 3. Compute component_hash = SHA256(sorted doc IDs)
 * 4. Find existing resolution with this hash OR create new
 * 5. Calculate confidence from shared entities × weights
 * 6. Determine missing doc types
 * 7. Update resolution + emit resolution_event
 * 8. If status=matched and human approved → promote to shipment
 */

import { Handler, SQSEvent } from 'aws-lambda';
import { createHash } from 'crypto';
import { getPool } from '../shared/dbPool.js';
import {
  getDocumentEntityNodes,
  findConnectedDocuments,
} from '../shared/graph/graphWriter.js';

interface ResolutionMessage {
  documentId: string;
  tenantId: string;
  entityNodeIds: string[];
}

export const handler: Handler<SQSEvent> = async (event) => {
  const pool = await getPool();

  for (const record of event.Records) {
    const msg: ResolutionMessage = JSON.parse(record.body);
    const { documentId, tenantId, entityNodeIds } = msg;

    const client = await pool.connect();
    try {
      console.log('[Resolution] START', { documentId, entityNodeIds: entityNodeIds.length });
      const startMs = Date.now();

      // 1. Load matching rules (weights per entity type)
      const { rows: matchingRules } = await client.query(
        `SELECT entity_type, weight, is_required, min_confidence
         FROM tenant_matching_rules WHERE tenant_id=$1 AND is_enabled=true`,
        [tenantId]
      );
      const weightMap: Record<string, { weight: number; isRequired: boolean; minConf: number }> = {};
      for (const rule of matchingRules) {
        weightMap[rule.entity_type] = {
          weight: parseFloat(rule.weight),
          isRequired: rule.is_required,
          minConf: parseFloat(rule.min_confidence),
        };
      }

      // Default weights if not configured
      const defaultWeight = (entityType: string) => {
        const defaults: Record<string, number> = {
          INVOICE_NUMBER: 1.0, BL_NUMBER: 1.0, CONTAINER_NUMBER: 0.95,
          PO_NUMBER: 0.80, HS_CODE: 0.40,
          SUPPLIER: 0.50, CONSIGNEE: 0.50, NOTIFY_PARTY: 0.40,
          VESSEL: 0.30, PORT_LOADING: 0.20, PORT_DISCHARGE: 0.20,
        };
        return defaults[entityType] ?? 0.30;
      };

      // 2. BFS to find connected component
      const visited = new Set<string>([documentId]);
      const queue = entityNodeIds.slice();
      const allEntityNodeIds = new Set<string>(entityNodeIds);

      // Iterative BFS: find all documents sharing these entities
      let frontier = entityNodeIds;
      while (frontier.length > 0) {
        const connectedDocIds = await findConnectedDocuments(client, tenantId, frontier);
        const newDocIds = connectedDocIds.filter(id => !visited.has(id));

        if (newDocIds.length === 0) break;

        // Load entity nodes for new documents
        const newEntityIds: string[] = [];
        for (const docId of newDocIds) {
          visited.add(docId);
          const entities = await getDocumentEntityNodes(client, tenantId, docId);
          for (const e of entities) {
            if (!allEntityNodeIds.has(e.nodeId)) {
              allEntityNodeIds.add(e.nodeId);
              newEntityIds.push(e.nodeId);
            }
          }
        }
        frontier = newEntityIds;
      }

      const componentDocIds = Array.from(visited);
      const componentHash = createHash('sha256')
        .update(componentDocIds.sort().join(','))
        .digest('hex')
        .slice(0, 64);

      console.log('[Resolution] Component:', { docs: componentDocIds.length, hash: componentHash.slice(0, 8) });

      // 3. Calculate confidence
      const confidence = await calculateConfidence(
        client, tenantId, componentDocIds, weightMap, defaultWeight
      );

      // 4. Gather entity values for denormalization
      const entityValues = await gatherEntityValues(client, tenantId, componentDocIds);

      // 5. Check doc type completeness
      const { rows: docTypeRows } = await client.query(
        `SELECT DISTINCT doc_type FROM documents WHERE id=ANY($1::uuid[]) AND doc_type IS NOT NULL`,
        [componentDocIds]
      );
      const foundDocTypes = docTypeRows.map((r: any) => r.doc_type);

      // Expected: Invoice + PL + BL at minimum (configurable)
      const { rows: requiredTypes } = await client.query(
        `SELECT doc_type_code FROM tenant_doc_type_config
         WHERE tenant_id=$1 AND is_enabled=true
         ORDER BY sort_order`,
        [tenantId]
      );
      const expectedDocTypes = requiredTypes.map((r: any) => r.doc_type_code)
        .filter((t: string) => ['COMMERCIAL_INVOICE','PACKING_LIST','BILL_OF_LADING'].includes(t));
      const missingDocTypes = expectedDocTypes.filter((t: string) => !foundDocTypes.includes(t));

      // 6. Determine status
      const status = determineStatus(confidence.score, foundDocTypes, missingDocTypes);

      // 7. Find existing resolution or create new
      await client.query('BEGIN');

      const { rows: [existingRes] } = await client.query(
        `SELECT r.* FROM resolutions r
         JOIN resolution_documents rd ON rd.resolution_id = r.id
         WHERE rd.document_id = ANY($1::uuid[]) AND r.tenant_id = $2
         LIMIT 1`,
        [componentDocIds, tenantId]
      );

      let resolutionId: string;

      if (existingRes) {
        // Update existing resolution
        resolutionId = existingRes.id;

        await client.query(
          `UPDATE resolutions SET
             component_hash=$1, confidence_score=$2, confidence_breakdown=$3,
             status=$4, found_doc_types=$5, missing_doc_types=$6, expected_doc_types=$7,
             invoice_numbers=$8, bl_numbers=$9, po_numbers=$10, vessel_names=$11, container_numbers=$12,
             last_calculated_at=NOW(), trigger_document_id=$13, calculation_ms=$14,
             updated_at=NOW()
           WHERE id=$15`,
          [
            componentHash, confidence.score, JSON.stringify(confidence.breakdown),
            status, foundDocTypes, missingDocTypes, expectedDocTypes,
            entityValues.invoiceNumbers, entityValues.blNumbers, entityValues.poNumbers,
            entityValues.vesselNames, entityValues.containerNumbers,
            documentId, Date.now() - startMs,
            resolutionId,
          ]
        );

        // Sync resolution_documents: remove stale, add new
        await client.query(`DELETE FROM resolution_documents WHERE resolution_id=$1`, [resolutionId]);

      } else {
        // Create new resolution
        const { rows: [newRes] } = await client.query(
          `INSERT INTO resolutions
             (tenant_id, component_hash, status, confidence_score, confidence_breakdown,
              found_doc_types, missing_doc_types, expected_doc_types,
              invoice_numbers, bl_numbers, po_numbers, vessel_names, container_numbers,
              last_calculated_at, trigger_document_id, calculation_ms)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),$14,$15)
           RETURNING id`,
          [
            tenantId, componentHash, status, confidence.score, JSON.stringify(confidence.breakdown),
            foundDocTypes, missingDocTypes, expectedDocTypes,
            entityValues.invoiceNumbers, entityValues.blNumbers, entityValues.poNumbers,
            entityValues.vesselNames, entityValues.containerNumbers,
            documentId, Date.now() - startMs,
          ]
        );
        resolutionId = newRes.id;
      }

      // Re-insert all resolution_documents
      for (const docId of componentDocIds) {
        const { rows: [docInfo] } = await client.query(
          `SELECT doc_type FROM documents WHERE id=$1`, [docId]
        );
        await client.query(
          `INSERT INTO resolution_documents (resolution_id, document_id, tenant_id, doc_role, added_reason)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
          [resolutionId, docId, tenantId, docInfo?.doc_type, `Component of ${componentHash.slice(0,8)}`]
        );
      }

      // Write resolution event
      await client.query(
        `INSERT INTO resolution_events
           (tenant_id, resolution_id, event_type, trigger_document_id,
            confidence_before, confidence_after, documents_after, shared_entities, reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          tenantId, resolutionId,
          existingRes ? 'DOCUMENT_ADDED' : 'RESOLUTION_CREATED',
          documentId,
          existingRes?.confidence_score ?? null, confidence.score,
          JSON.stringify(componentDocIds),
          JSON.stringify(Object.keys(confidence.breakdown)),
          `Document ${documentId} triggered resolution recalculation`,
        ]
      );

      // Update document status
      await client.query(
        `UPDATE documents SET status='linked', linked_at=NOW(), updated_at=NOW() WHERE id=ANY($1::uuid[])`,
        [componentDocIds]
      );

      await client.query('COMMIT');

      // If matched + previously human_approved → auto-promote to shipment
      if (status === 'matched' && existingRes?.human_approved_at) {
        await promoteToShipment(client, resolutionId, tenantId);
      }

      console.log('[Resolution] DONE', {
        resolutionId, componentDocs: componentDocIds.length,
        confidence: confidence.score, status, ms: Date.now() - startMs,
      });

    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[Resolution] ERROR', documentId, err.message);
    } finally {
      client.release();
    }
  }
};

// ── Confidence Calculation ────────────────────────────────────────────────────
async function calculateConfidence(
  client: any,
  tenantId: string,
  docIds: string[],
  weightMap: Record<string, any>,
  defaultWeight: (t: string) => number
): Promise<{ score: number; breakdown: Record<string, number> }> {
  if (docIds.length <= 1) {
    return { score: 0.10, breakdown: {} };
  }

  // Find entities shared by MORE THAN ONE document
  const { rows: sharedEntities } = await client.query(
    `SELECT gn.entity_type, gn.canonical_value, COUNT(DISTINCT d.id) as doc_count,
            AVG(ge.confidence) as avg_confidence
     FROM graph_nodes doc_node
     JOIN documents d ON d.id = doc_node.document_id
     JOIN graph_edges ge ON ge.source_node_id = doc_node.id
     JOIN graph_nodes gn ON gn.id = ge.target_node_id
     WHERE d.id = ANY($1::uuid[])
       AND d.tenant_id = $2
       AND doc_node.node_type = 'DOCUMENT'
       AND gn.node_type = 'ENTITY'
     GROUP BY gn.entity_type, gn.canonical_value
     HAVING COUNT(DISTINCT d.id) > 1`,
    [docIds, tenantId]
  );

  if (sharedEntities.length === 0) {
    return { score: 0.05, breakdown: {} };
  }

  const breakdown: Record<string, number> = {};
  let totalWeight = 0;
  let weightedScore = 0;

  for (const entity of sharedEntities) {
    const rule = weightMap[entity.entity_type];
    const weight = rule?.weight ?? defaultWeight(entity.entity_type);
    const minConf = rule?.minConf ?? 0.70;
    const avgConf = parseFloat(entity.avg_confidence);

    if (avgConf < minConf) continue;

    const entityScore = avgConf * Math.min(1, parseFloat(entity.doc_count) / docIds.length);
    const key = `${entity.entity_type}:${entity.canonical_value.slice(0, 20)}`;
    breakdown[key] = Math.round(entityScore * 100) / 100;

    weightedScore += weight * entityScore;
    totalWeight += weight;
  }

  const score = totalWeight > 0 ? Math.min(1, weightedScore / totalWeight) : 0.05;

  return { score: Math.round(score * 1000) / 1000, breakdown };
}

function determineStatus(
  confidence: number,
  foundDocTypes: string[],
  missingDocTypes: string[]
): string {
  const hasInvoice = foundDocTypes.includes('COMMERCIAL_INVOICE');
  const hasBL = foundDocTypes.includes('BILL_OF_LADING');
  const hasKeyDocs = hasInvoice && hasBL;

  if (confidence >= 0.80 && hasKeyDocs && missingDocTypes.length === 0) return 'matched';
  if (confidence >= 0.60 && (hasInvoice || hasBL)) return 'partial';
  return 'candidate';
}

// ── Gather entity values for denormalization ──────────────────────────────────
async function gatherEntityValues(client: any, tenantId: string, docIds: string[]) {
  const getValues = async (entityType: string) => {
    const { rows } = await client.query(
      `SELECT DISTINCT gn.display_value
       FROM graph_nodes doc_node
       JOIN graph_edges ge ON ge.source_node_id = doc_node.id
       JOIN graph_nodes gn ON gn.id = ge.target_node_id
       WHERE doc_node.document_id = ANY($1::uuid[])
         AND gn.entity_type = $2 AND gn.node_type = 'ENTITY'`,
      [docIds, entityType]
    );
    return rows.map((r: any) => r.display_value).filter(Boolean);
  };

  const [invoiceNumbers, blNumbers, poNumbers, vesselNames, containerNumbers] = await Promise.all([
    getValues('INVOICE_NUMBER'),
    getValues('BL_NUMBER'),
    getValues('PO_NUMBER'),
    getValues('VESSEL'),
    getValues('CONTAINER_NUMBER'),
  ]);

  return { invoiceNumbers, blNumbers, poNumbers, vesselNames, containerNumbers };
}

// ── Promote verified resolution to shipment ───────────────────────────────────
async function promoteToShipment(client: any, resolutionId: string, tenantId: string): Promise<void> {
  // Check if shipment already exists
  const { rows: [existing] } = await client.query(
    `SELECT id FROM shipments WHERE resolution_id=$1`, [resolutionId]
  );
  if (existing) return;

  const { rows: [{ nextval }] } = await client.query(`SELECT nextval('shipment_seq')`);
  const year = new Date().getFullYear();
  const shipmentNumber = `SHP-${year}-${String(nextval).padStart(4, '0')}`;

  await client.query(
    `INSERT INTO shipments (tenant_id, resolution_id, shipment_number, status, health)
     VALUES ($1,$2,$3,'verified','healthy')`,
    [tenantId, resolutionId, shipmentNumber]
  );

  console.log('[Resolution] Promoted to shipment:', shipmentNumber);
}
