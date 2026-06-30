import pg from "pg";
import { classifyConfidence } from "./reconciliation.js";

// CEISA Readiness Score — Rule #5. Computed automatically, never set by
// hand: mandatory field completeness + validation pass rate, exactly as
// specified. This is called after every CTDM field write so the score
// shown in the UI (CheckpointSummary) is always current, not stale.

interface MandatoryFieldConfig {
  bcType: string;
  fieldKeys: string[];
}

// Config-driven (Rule #4) — which fields are mandatory per BC type lives
// here as data, mirroring lib/bcTypes.ts on the frontend. Keeping this
// list in sync with the frontend config is a known seam; a future
// iteration should generate both from one shared source (e.g. a JSON
// file imported by both API and frontend builds) instead of duplicating.
const MANDATORY_FIELDS: MandatoryFieldConfig[] = [
  {
    bcType: "BC_2.3",
    fieldKeys: [
      "shipper_name",
      "consignee_name",
      "hs_code",
      "country_origin",
      "invoice_number",
      "total_value",
      "container_number",
      "gross_weight",
      "net_weight",
    ],
  },
  // Other BC types added here as their workflows are built out.
];

export async function computeCeisaReadinessScore(
  client: pg.PoolClient,
  shipmentId: string,
  bcType: string
): Promise<number> {
  const config = MANDATORY_FIELDS.find((c) => c.bcType === bcType);
  if (!config) return 0;

  const { rows } = await client.query<{ field_key: string; confidence: number }>(
    `SELECT field_key, confidence FROM ctdm_fields WHERE shipment_id = $1`,
    [shipmentId]
  );

  const byKey = new Map(rows.map((r) => [r.field_key, r.confidence]));

  let passCount = 0;
  for (const key of config.fieldKeys) {
    const confidence = byKey.get(key);
    if (confidence === undefined) continue; // missing — counts as fail
    if (classifyConfidence(confidence) !== "REVIEW_REQUIRED") passCount++;
  }

  const score = Math.round((passCount / config.fieldKeys.length) * 100);

  await client.query(
    `UPDATE shipments SET ceisa_readiness_score = $1, updated_at = now() WHERE id = $2`,
    [score, shipmentId]
  );

  return score;
}
