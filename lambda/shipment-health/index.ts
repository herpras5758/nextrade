import { PoolClient } from 'pg';

// Shipment Health Calculator — computes health from projection data.
// HEALTHY | NEEDS_ATTENTION | CRITICAL
// This is a READ operation — no events written.
// Called after each state-affecting event to update shipments.health projection.

export type HealthStatus = 'HEALTHY' | 'NEEDS_ATTENTION' | 'CRITICAL';

interface HealthInput {
  openValidationErrors: number;
  openReasoningResults: number;   // impact analyses pending
  missingCriticalCategories: string[];
  avgConfidence: number;
  hasPendingRevisions: boolean;
}

export function computeHealth(input: HealthInput): { health: HealthStatus; reasons: string[] } {
  const reasons: string[] = [];

  // CRITICAL conditions
  if (input.openValidationErrors > 0) {
    reasons.push(`${input.openValidationErrors} error validasi belum diselesaikan`);
  }
  if (input.openReasoningResults > 0) {
    reasons.push(`${input.openReasoningResults} dampak revisi perlu tindakan`);
  }
  if (input.missingCriticalCategories.length > 0) {
    reasons.push(`Dokumen ${input.missingCriticalCategories.join(', ')} belum ada`);
  }
  if (input.avgConfidence < 0.75 && input.avgConfidence > 0) {
    reasons.push(`Confidence rata-rata rendah: ${Math.round(input.avgConfidence * 100)}%`);
  }

  if (reasons.length >= 2 || input.missingCriticalCategories.length > 0 || input.openReasoningResults > 0) {
    return { health: 'CRITICAL', reasons };
  }

  // NEEDS_ATTENTION conditions
  if (input.hasPendingRevisions) reasons.push('Ada revisi dokumen menunggu review');
  if (input.avgConfidence < 0.90 && input.avgConfidence >= 0.75) {
    reasons.push(`Confidence rata-rata perlu perhatian: ${Math.round(input.avgConfidence * 100)}%`);
  }

  if (reasons.length > 0) {
    return { health: 'NEEDS_ATTENTION', reasons };
  }

  return { health: 'HEALTHY', reasons: [] };
}

// Compute and persist health for a shipment
export async function updateShipmentHealth(
  client: PoolClient,
  shipmentId: string,
  tenantId: string
): Promise<HealthStatus> {
  const [errRes, reasonRes, docRes] = await Promise.all([
    client.query(
      `SELECT COUNT(*) as cnt FROM validation_errors
       WHERE shipment_id = $1 AND resolved = false`,
      [shipmentId]
    ),
    client.query(
      `SELECT COUNT(*) as cnt FROM reasoning_results
       WHERE shipment_id = $1 AND requires_action = true AND action_taken IS NULL`,
      [shipmentId]
    ),
    client.query(
      `SELECT d.category, AVG(cf.confidence) as avg_conf
       FROM documents d
       LEFT JOIN ctdm_fields cf ON cf.document_id = d.id
       WHERE d.shipment_id = $1 AND d.tenant_id = $2
       GROUP BY d.category`,
      [shipmentId, tenantId]
    ),
  ]);

  const existingCategories = new Set(docRes.rows.map((r: any) => r.category).filter(Boolean));
  const requiredCategories = ['COMMERCIAL', 'TRANSPORT'];
  const missing = requiredCategories.filter(c => !existingCategories.has(c));

  const allConf = docRes.rows
    .filter((r: any) => r.avg_conf !== null)
    .map((r: any) => parseFloat(r.avg_conf));
  const avgConf = allConf.length > 0 ? allConf.reduce((a: number, b: number) => a + b, 0) / allConf.length : 0;

  const { health } = computeHealth({
    openValidationErrors: parseInt(errRes.rows[0].cnt),
    openReasoningResults: parseInt(reasonRes.rows[0].cnt),
    missingCriticalCategories: missing,
    avgConfidence: avgConf,
    hasPendingRevisions: false,
  });

  await client.query(
    `UPDATE shipments SET health = $1 WHERE id = $2`,
    [health, shipmentId]
  );

  return health;
}
