// Document Linking Engine — sits between Extract and Reconcile. Real
// intake never arrives with a shipment pre-assigned: a PO lands today,
// the matching Invoice/Packing List three weeks later, the BL/Letter of
// Guarantee/Manifest after that, and the PIB last of all once everything
// upstream exists. This stage is what groups them into one shipment
// automatically, based on the exact cross-reference pattern found in the
// OBOR/Ungaran Sari Garments sample:
//
//   PO 1409443
//     -> Invoice/Packing List share invoice number 0126051
//          -> BL/Letter of Guarantee/Inward Manifest share B/L number
//             DFS717006813
//               -> PIB (BC 2.3) cross-references ALL THREE:
//                  PO 1409443 + Invoice 0126051 + BL DFS717006813
//
// Each document type contributes a different reference_type. Linking
// logic: look up whether ANY of this document's extracted reference
// numbers already exists in document_references for this tenant. If
// yes, join that shipment. If no match on any reference, this document
// starts a new shipment.

import { withTenant } from "../shared/dbPool.js";
import type { ExtractedFieldCandidate } from "../extract-fields/index.js";

interface LinkShipmentInput {
  tenantId: string;
  documentId: string;
  documentType: string;
  shipmentId: string | null;
  extractedFields: ExtractedFieldCandidate[];
}

// Which extracted field on each document type IS a cross-document
// reference number — config-driven (Rule #4), not hardcoded per
// document type in branching logic.
const REFERENCE_FIELDS_BY_DOCUMENT_TYPE: Record<string, string[]> = {
  "Purchase Order": ["po_number"],
  "Commercial Invoice": ["invoice_number"],
  "Packing List": ["invoice_number"], // packing list in this sample cites the invoice number, not its own
  "Bill of Lading / AWB": ["bl_number"],
  "Letter of Guarantee": ["bl_number"], // LOG references the B/L it guarantees release of
  "Inward Manifest BC 1.1": ["bl_number", "manifest_number"],
  "BC 2.3 Declaration": ["po_number", "invoice_number", "bl_number"], // cross-checks all three at once
};

export async function handler(event: LinkShipmentInput) {
  const { tenantId, documentId, documentType, extractedFields } = event;

  const referenceFieldKeys = REFERENCE_FIELDS_BY_DOCUMENT_TYPE[documentType] ?? [];
  const referencesFound = extractedFields.filter((f) => referenceFieldKeys.includes(f.fieldKey));

  const result = await withTenant(tenantId, async (client) => {
    let shipmentId = event.shipmentId;
    const matchedReferenceTypes: string[] = [];

    for (const ref of referencesFound) {
      const { rows } = await client.query<{ document_id: string; shipment_id: string | null }>(
        `SELECT dr.document_id, d.shipment_id
         FROM document_references dr
         JOIN documents d ON d.id = dr.document_id
         WHERE dr.tenant_id = $1 AND dr.reference_type = $2 AND dr.reference_value = $3
         LIMIT 1`,
        [tenantId, ref.fieldKey, ref.rawValue.trim()]
      );
      if (rows.length > 0 && rows[0].shipment_id) {
        if (!shipmentId) shipmentId = rows[0].shipment_id;
        matchedReferenceTypes.push(ref.fieldKey);
      }
    }

    if (!shipmentId) {
      const poRef = referencesFound.find((r) => r.fieldKey === "po_number");
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO shipments (tenant_id, shipment_number, bc_type, status)
         VALUES ($1, $2, 'BC_2.3', 'draft')
         RETURNING id`,
        [tenantId, poRef?.rawValue.trim() ?? `AUTO-${documentId.slice(0, 8)}`]
      );
      shipmentId = rows[0].id;
    } else {
      await client.query(`UPDATE documents SET shipment_id = $1 WHERE id = $2 AND tenant_id = $3`, [
        shipmentId,
        documentId,
        tenantId,
      ]);
    }

    // --- Validation Engine ---
    // Distinct from the matching loop above. That loop asks "does this
    // reference value match an EXISTING document somewhere?" — useful for
    // grouping, but it silently passes if there's simply no match yet
    // (could just mean this is the first document of a new shipment).
    //
    // This block asks a different, stricter question: "for THIS
    // shipment (now that we know which one it is), has a DIFFERENT value
    // already been recorded for this exact reference_type?" That's the
    // real mismatch case — e.g. Invoice and Packing List both establish
    // invoice_number = 0126051 for this shipment, then a later document
    // carries invoice_number = 0126057. Same reference_type, same
    // shipment, contradicting value. Most OCR products stop at "I
    // extracted 0126057 with 95% confidence" and never ask whether that
    // contradicts a sibling document — this is the check that catches it.
    const validationErrors: Array<{ referenceType: string; expectedValue: string; actualValue: string }> = [];

    for (const ref of referencesFound) {
      const { rows: priorRefs } = await client.query<{ reference_value: string; document_id: string }>(
        `SELECT DISTINCT reference_value, document_id
         FROM document_references dr
         JOIN documents d ON d.id = dr.document_id
         WHERE d.shipment_id = $1 AND dr.reference_type = $2 AND dr.tenant_id = $3`,
        [shipmentId, ref.fieldKey, tenantId]
      );

      const conflicting = priorRefs.find((p) => p.reference_value !== ref.rawValue.trim());
      if (conflicting) {
        validationErrors.push({
          referenceType: ref.fieldKey,
          expectedValue: conflicting.reference_value,
          actualValue: ref.rawValue.trim(),
        });
        await client.query(
          `INSERT INTO validation_errors
             (tenant_id, shipment_id, document_id, error_type, reference_type, expected_value, actual_value, conflicting_document_id)
           VALUES ($1, $2, $3, 'REFERENCE_MISMATCH', $4, $5, $6, $7)`,
          [tenantId, shipmentId, documentId, ref.fieldKey, conflicting.reference_value, ref.rawValue.trim(), conflicting.document_id]
        );
      }
    }

    for (const ref of referencesFound) {
      await client.query(
        `INSERT INTO document_references (tenant_id, document_id, reference_type, reference_value)
         VALUES ($1, $2, $3, $4)`,
        [tenantId, documentId, ref.fieldKey, ref.rawValue.trim()]
      );
    }

    // Cross-check for PIB/BC 2.3: it claims 3 reference numbers at once
    // (PO + Invoice + BL) — if any of those three weren't found among
    // OTHER documents' references, that's a genuine red flag (PIB
    // pointing at a PO/Invoice/BL that doesn't exist in the system yet),
    // surfaced as a structured result rather than silently ignored.
    const crossCheckIssues =
      documentType === "BC 2.3 Declaration"
        ? referenceFieldKeys.filter((key) => !matchedReferenceTypes.includes(key))
        : [];

    return { shipmentId, matchedReferenceTypes, crossCheckIssues, validationErrors };
  });

  return { ...event, shipmentId: result.shipmentId, linkingResult: result };
}
