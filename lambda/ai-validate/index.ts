// AI Validation — IDP Engine module #6. Runs business rules
// (businessValidation.ts) against every CTDM field this document just
// contributed to, AFTER Reconcile (rules check the RESOLVED value, not
// a raw per-document candidate — validating a losing candidate that got
// overruled would be noise).

import { withTenant } from "../shared/dbPool.js";
import { runBusinessValidation } from "../shared/businessValidation.js";

interface AiValidateInput {
  tenantId: string;
  shipmentId: string;
  documentId: string;
  documentType: string;
  reconciledFields: Array<{ fieldKey: string; resolvedValue: string; confidence: number; status: string }>;
}

export async function handler(event: AiValidateInput) {
  const { tenantId, shipmentId, reconciledFields } = event;

  const validationSummary = await withTenant(tenantId, async (client) => {
    const failures: Array<{ fieldKey: string; message: string }> = [];

    for (const field of reconciledFields) {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM ctdm_fields WHERE shipment_id = $1 AND field_key = $2 AND tenant_id = $3`,
        [shipmentId, field.fieldKey, tenantId]
      );
      if (rows.length === 0) continue;
      const ctdmFieldId = rows[0].id;

      const results = runBusinessValidation(field.fieldKey, field.resolvedValue ?? "");
      for (const result of results) {
        await client.query(
          `INSERT INTO business_validation_results
             (tenant_id, shipment_id, ctdm_field_id, field_key, rule_type, passed, message)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [tenantId, shipmentId, ctdmFieldId, field.fieldKey, result.ruleType, result.passed, result.message]
        );
        if (!result.passed) failures.push({ fieldKey: field.fieldKey, message: result.message });
      }
    }

    return { totalChecked: reconciledFields.length, failureCount: failures.length, failures };
  });

  return { ...event, validationSummary };
}
