import pg from "pg";

// Unified Shipment Status — the single computed status the spec's IDP
// Engine calls out explicitly: "Ready for CEISA", "Need Review",
// "Document Mismatch". Before this, status was scattered across
// shipments.status (workflow stage), ctdm_fields.status (per-field),
// and validation_errors (cross-document). This function is the one
// place that combines all three into the status an operator actually
// needs to see at a glance.

export type UnifiedShipmentStatus =
  | "DOCUMENT_MISMATCH" // highest priority — a hard cross-reference contradiction exists
  | "NEEDS_REVIEW" // any CTDM field is REVIEW_REQUIRED, or document(s) still extracting
  | "READY_FOR_CEISA" // 100% readiness score, zero open validation errors, zero fields needing review
  | "DRAFT"; // not yet enough data to evaluate (no documents processed yet)

export interface ShipmentStatusResult {
  status: UnifiedShipmentStatus;
  readinessScore: number;
  openValidationErrorCount: number;
  fieldsNeedingReviewCount: number;
  documentsStillProcessingCount: number;
}

export async function computeUnifiedShipmentStatus(
  client: pg.PoolClient,
  shipmentId: string,
  tenantId: string
): Promise<ShipmentStatusResult> {
  const [shipmentResult, validationErrorsResult, fieldsResult, documentsResult] = await Promise.all([
    client.query<{ ceisa_readiness_score: number }>(
      `SELECT ceisa_readiness_score FROM shipments WHERE id = $1 AND tenant_id = $2`,
      [shipmentId, tenantId]
    ),
    client.query<{ count: string }>(
      `SELECT COUNT(*) FROM validation_errors WHERE shipment_id = $1 AND tenant_id = $2 AND status = 'OPEN'`,
      [shipmentId, tenantId]
    ),
    client.query<{ count: string }>(
      `SELECT COUNT(*) FROM ctdm_fields WHERE shipment_id = $1 AND tenant_id = $2 AND status = 'REVIEW_REQUIRED'`,
      [shipmentId, tenantId]
    ),
    client.query<{ count: string }>(
      `SELECT COUNT(*) FROM documents WHERE shipment_id = $1 AND tenant_id = $2 AND status IN ('uploaded', 'extracting')`,
      [shipmentId, tenantId]
    ),
  ]);

  const readinessScore = shipmentResult.rows[0]?.ceisa_readiness_score ?? 0;
  const openValidationErrorCount = Number(validationErrorsResult.rows[0]?.count ?? 0);
  const fieldsNeedingReviewCount = Number(fieldsResult.rows[0]?.count ?? 0);
  const documentsStillProcessingCount = Number(documentsResult.rows[0]?.count ?? 0);

  // Priority order matters: a hard mismatch always outranks a soft
  // "needs review" — an operator should never see "Ready for CEISA"
  // while a contradicting invoice number sits unresolved.
  let status: UnifiedShipmentStatus;
  if (openValidationErrorCount > 0) {
    status = "DOCUMENT_MISMATCH";
  } else if (fieldsNeedingReviewCount > 0 || documentsStillProcessingCount > 0) {
    status = "NEEDS_REVIEW";
  } else if (readinessScore >= 100) {
    status = "READY_FOR_CEISA";
  } else {
    status = "DRAFT";
  }

  return { status, readinessScore, openValidationErrorCount, fieldsNeedingReviewCount, documentsStillProcessingCount };
}
