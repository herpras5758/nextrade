// Reconcile Fields — Source Resolution Engine (Rule #2) + Smart
// Reconciliation (Rule #3) in their real form: not just "pick the
// highest confidence candidate" but "merge this document's candidates
// with whatever CTDM already has for this shipment, recognizing
// value-equal candidates across different number formats as agreement
// rather than conflict."
//
// This is where the gross_weight case from the sample shipment is
// actually resolved: Invoice says "4,415.30", BL says "4415.3000", BC 2.3
// says "4.415,3000" — numberFormat.ts normalizes all three to the same
// number, so instead of three competing low-confidence candidates we get
// one field with three AGREEING sources and a high combined confidence.

import { withTenant } from "../shared/dbPool.js";
import { numbersMatch } from "../shared/numberFormat.js";
import { classifyConfidence, type ReconciliationStatus } from "../../api/src/lib/reconciliation.js";
import type { ExtractedFieldCandidate } from "../extract-fields/index.js";

interface ReconcileInput {
  tenantId: string;
  shipmentId: string;
  documentId: string;
  documentType: string;
  extractedFields: ExtractedFieldCandidate[];
}

const NUMERIC_FIELDS = new Set(["total_value", "gross_weight", "net_weight", "cbm", "unit_price", "quantity", "guarantee_amount"]);

export async function handler(event: ReconcileInput) {
  const { tenantId, shipmentId, documentId, documentType, extractedFields } = event;

  const reconciledFields = await withTenant(tenantId, async (client) => {
    const results: Array<{ fieldKey: string; resolvedValue: string; confidence: number; status: ReconciliationStatus }> = [];

    for (const candidate of extractedFields) {
      // Pull every prior source already recorded for this field on this
      // shipment — reconciliation is cumulative across documents, not a
      // single-document decision.
      const existing = await client.query<{ id: string; raw_value: string; confidence: number }>(
        `SELECT fs.id, fs.raw_value, fs.confidence
         FROM ctdm_field_sources fs
         JOIN ctdm_fields cf ON cf.id = fs.ctdm_field_id
         WHERE cf.shipment_id = $1 AND cf.field_key = $2`,
        [shipmentId, candidate.fieldKey]
      );

      // Boost confidence when this document's value numerically AGREES
      // with a prior source despite different text formatting — this is
      // the Smart Reconciliation Engine's actual scoring behavior, not
      // just "newest wins" or "highest confidence wins" in isolation.
      let effectiveConfidence = candidate.confidence;
      if (NUMERIC_FIELDS.has(candidate.fieldKey)) {
        const agreesWithPrior = existing.rows.some((row) => numbersMatch(row.raw_value, candidate.rawValue));
        if (agreesWithPrior && existing.rows.length > 0) {
          effectiveConfidence = Math.min(1, effectiveConfidence + 0.1 * existing.rows.length);
        }
      }

      const status = classifyConfidence(effectiveConfidence);

      // Upsert the ctdm_fields row (the resolved value), then append this
      // document's contribution to ctdm_field_sources (the evidence
      // trail the Conflict Resolution Dialog reads).
      const upserted = await client.query<{ id: string }>(
        `INSERT INTO ctdm_fields (tenant_id, shipment_id, field_key, resolved_value, confidence, status)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (shipment_id, field_key) DO UPDATE SET
           resolved_value = CASE WHEN EXCLUDED.confidence >= ctdm_fields.confidence THEN EXCLUDED.resolved_value ELSE ctdm_fields.resolved_value END,
           confidence = GREATEST(ctdm_fields.confidence, EXCLUDED.confidence),
           status = CASE WHEN EXCLUDED.confidence >= ctdm_fields.confidence THEN EXCLUDED.status ELSE ctdm_fields.status END,
           resolved_at = now()
         RETURNING id`,
        [tenantId, shipmentId, candidate.fieldKey, candidate.rawValue, effectiveConfidence, status]
      );

      await client.query(
        `INSERT INTO ctdm_field_sources (ctdm_field_id, document_id, raw_value, confidence, reasoning)
         VALUES ($1, $2, $3, $4, $5)`,
        [upserted.rows[0].id, documentId, candidate.rawValue, candidate.confidence, candidate.reasoning]
      );

      results.push({ fieldKey: candidate.fieldKey, resolvedValue: candidate.rawValue, confidence: effectiveConfidence, status });
    }

    return results;
  });

  return { tenantId, shipmentId, documentId, documentType, reconciledFields };
}
