// Number normalization — the gross weight discrepancy we found across the
// OBOR/Ungaran Sari Garments sample shipment is the canonical case this
// solves: "4,415.30" (Invoice/PL, international format) vs "4415.3000"
// (BL, no separator) vs "4.415,3000" (BC 2.3, Indonesian format — period
// as thousands separator, comma as decimal). Same physical value, three
// textual shapes. This must run BEFORE confidence scoring/reconciliation,
// or the Source Resolution Engine will treat textually-different but
// numerically-identical values as a genuine conflict.

export type NumberFormatHint = "international" | "indonesian" | "plain" | "unknown";

export function detectNumberFormat(raw: string): NumberFormatHint {
  const trimmed = raw.trim();
  const hasComma = trimmed.includes(",");
  const hasPeriod = trimmed.includes(".");

  if (hasComma && hasPeriod) {
    // Whichever separator appears LAST is the decimal separator.
    const lastComma = trimmed.lastIndexOf(",");
    const lastPeriod = trimmed.lastIndexOf(".");
    return lastComma > lastPeriod ? "indonesian" : "international";
  }
  if (hasComma && !hasPeriod) {
    // Ambiguous: "4,415" could be thousands (intl) or decimal (ID with no
    // thousands group). Default to international since that's the more
    // common convention in the trade documents we've seen so far
    // (invoices, BLs use it); BC 2.3 forms are the main Indonesian-format
    // source and those are caught by the dual-separator case above.
    return "international";
  }
  if (hasPeriod && !hasComma) return "plain"; // e.g. "4415.3000" — already decimal
  return "unknown";
}

/**
 * Normalizes any of the formats seen across CTDM source documents into a
 * canonical JS number. Returns null if the string can't be parsed at all
 * (caller should treat that as REVIEW_REQUIRED, never silently default
 * to 0).
 */
export function normalizeNumber(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.,\-]/g, "").trim();
  if (!cleaned) return null;

  const format = detectNumberFormat(cleaned);
  let normalized: string;

  switch (format) {
    case "indonesian":
      // "4.415,3000" -> remove periods (thousands), comma -> decimal point
      normalized = cleaned.replace(/\./g, "").replace(",", ".");
      break;
    case "international":
      // "4,415.30" -> remove commas (thousands)
      normalized = cleaned.replace(/,/g, "");
      break;
    case "plain":
    case "unknown":
    default:
      normalized = cleaned;
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/**
 * Compares two raw numeric strings for value-equality regardless of
 * source formatting — used by the Source Resolution Engine so
 * "4,415.30" and "4.415,3000" are recognized as the SAME value (high
 * confidence agreement), not a conflict requiring manual review.
 */
export function numbersMatch(rawA: string, rawB: string, tolerance = 0.01): boolean {
  const a = normalizeNumber(rawA);
  const b = normalizeNumber(rawB);
  if (a === null || b === null) return false;
  return Math.abs(a - b) <= tolerance;
}
