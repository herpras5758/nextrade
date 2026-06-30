// CTDM Write — final pipeline stage. By this point reconcile-fields has
// already written the authoritative ctdm_fields/ctdm_field_sources rows;
// this stage's job is to (1) flip the document's status from
// "extracting" to "extracted" or "needs_review" honestly based on
// whether any field landed in REVIEW_REQUIRED, and (2) recompute the
// CEISA Readiness Score (Rule #5) now that this document's contribution
// is in, so the Dashboard/CheckpointSummary reflect current state
// without a separate manual trigger.

import { withTenant } from "../shared/dbPool.js";
import { computeCeisaReadinessScore } from "../../api/src/lib/ceisaReadiness.js";
import { computeUnifiedShipmentStatus } from "../../api/src/lib/shipmentStatus.js";

interface CtdmWriteInput {
  tenantId: string;
  shipmentId: string;
  documentId: string;
  reconciledFields: Array<{ fieldKey: string; status: string }>;
}

export async function handler(event: CtdmWriteInput) {
  const { tenantId, shipmentId, documentId, reconciledFields } = event;

  const result = await withTenant(tenantId, async (client) => {
    const hasReviewRequired = reconciledFields.some((f) => f.status === "REVIEW_REQUIRED");
    const documentStatus = hasReviewRequired ? "needs_review" : "extracted";

    await client.query(`UPDATE documents SET status = $1 WHERE id = $2 AND tenant_id = $3`, [
      documentStatus,
      documentId,
      tenantId,
    ]);

    const { rows: shipmentRows } = await client.query<{ bc_type: string }>(
      `SELECT bc_type FROM shipments WHERE id = $1 AND tenant_id = $2`,
      [shipmentId, tenantId]
    );

    let readinessScore = 0;
    if (shipmentRows.length > 0) {
      readinessScore = await computeCeisaReadinessScore(client, shipmentId, shipmentRows[0].bc_type);
    }

    // Recompute the unified status (Ready for CEISA / Needs Review /
    // Document Mismatch / Draft) and persist it onto shipments.status so
    // every consumer (Dashboard, list views, CheckpointSummary) reads
    // the same value instead of re-deriving it independently.
    const unified = await computeUnifiedShipmentStatus(client, shipmentId, tenantId);
    const statusMap: Record<string, string> = {
      DOCUMENT_MISMATCH: "pending_review",
      NEEDS_REVIEW: "pending_review",
      READY_FOR_CEISA: "ready",
      DRAFT: "draft",
    };
    await client.query(`UPDATE shipments SET status = $1 WHERE id = $2 AND tenant_id = $3`, [
      statusMap[unified.status],
      shipmentId,
      tenantId,
    ]);

    return { documentStatus, readinessScore, unifiedStatus: unified.status };
  });

  return {
    tenantId,
    shipmentId,
    documentId,
    status: result.documentStatus,
    readinessScore: result.readinessScore,
    unifiedStatus: result.unifiedStatus,
  };
}
