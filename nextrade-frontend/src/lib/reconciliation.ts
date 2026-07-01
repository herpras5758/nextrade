// Source Resolution / Smart Reconciliation thresholds — Rule E,
// PROJECT_RULES.md. These numbers come directly from the spec (section 10,
// "Smart Reconciliation Engine") and must not be re-derived or "improved"
// elsewhere in the codebase. Any component that needs to classify a
// confidence score imports from here.

export const RECONCILIATION_THRESHOLDS = {
  AUTO_APPROVED: 0.85,
  RECOMMENDED: 0.7,
  // anything below RECOMMENDED is REVIEW_REQUIRED
} as const;

export const ITEM_MATCHING_THRESHOLD = 0.75;

export type ReconciliationStatus = "AUTO_APPROVED" | "RECOMMENDED" | "REVIEW_REQUIRED";

export function classifyConfidence(confidence: number): ReconciliationStatus {
  if (confidence >= RECONCILIATION_THRESHOLDS.AUTO_APPROVED) return "AUTO_APPROVED";
  if (confidence >= RECONCILIATION_THRESHOLDS.RECOMMENDED) return "RECOMMENDED";
  return "REVIEW_REQUIRED";
}
