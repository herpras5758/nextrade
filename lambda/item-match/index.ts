// Item Match — Rule #6. Matches goods_items rows across documents for
// the same shipment (e.g. PO line "MH380FU/YHH-SV81RK-650DDMH38 COMPLETE
// SET" should match the same line on the Invoice and Packing List) using
// fuzzy description + product code similarity, never manual linking.
//
// The sample shipment's BC 2.3 split is the real case this has to
// handle: one PO line (qty 26, MH380FU...) maps to one BC 2.3 declaration
// line, but the CIF value on the BC 2.3 (98,280) differs from the simple
// unit_price * qty on the PO (68,900) because BC 2.3 CIF includes
// freight/insurance apportionment. Item matching links the records;
// reconciling WHY their values differ is a downstream concern (flagged
// for review, not silently treated as a match failure).

import { withTenant } from "../shared/dbPool.js";
import { ITEM_MATCHING_THRESHOLD } from "../../api/src/lib/reconciliation.js";

interface ItemMatchInput {
  tenantId: string;
  shipmentId: string;
}

/** Levenshtein-based similarity, normalized to 0-1 (1 = identical). */
function similarity(a: string, b: string): number {
  const s1 = a.toLowerCase().trim();
  const s2 = b.toLowerCase().trim();
  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  const matrix: number[][] = Array.from({ length: s1.length + 1 }, () => new Array(s2.length + 1).fill(0));
  for (let i = 0; i <= s1.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= s2.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }
  const distance = matrix[s1.length][s2.length];
  return 1 - distance / Math.max(s1.length, s2.length);
}

export async function handler(event: ItemMatchInput) {
  const { tenantId, shipmentId } = event;

  const matchedGroups = await withTenant(tenantId, async (client) => {
    const { rows: items } = await client.query<{ id: string; product_code: string | null; description: string | null; hs_code: string | null }>(
      `SELECT id, product_code, description, hs_code FROM goods_items WHERE shipment_id = $1 AND matched_group_id IS NULL`,
      [shipmentId]
    );

    const groups: string[][] = [];
    const assigned = new Set<string>();

    for (const item of items) {
      if (assigned.has(item.id)) continue;
      const group = [item.id];
      assigned.add(item.id);

      for (const candidate of items) {
        if (assigned.has(candidate.id)) continue;
        const codeMatch =
          item.product_code && candidate.product_code && item.product_code === candidate.product_code;
        const descSimilarity =
          item.description && candidate.description ? similarity(item.description, candidate.description) : 0;

        if (codeMatch || descSimilarity >= ITEM_MATCHING_THRESHOLD) {
          group.push(candidate.id);
          assigned.add(candidate.id);
        }
      }
      groups.push(group);
    }

    for (const group of groups) {
      if (group.length < 2) continue; // a "group" of one isn't a match, leave ungrouped for manual review
      const groupId = group[0];
      await client.query(`UPDATE goods_items SET matched_group_id = $1 WHERE id = ANY($2)`, [groupId, group]);
    }

    return groups.filter((g) => g.length >= 2);
  });

  return { tenantId, shipmentId, matchedGroups };
}
