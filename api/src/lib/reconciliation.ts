// Mirrors frontend src/lib/reconciliation.ts — same thresholds, same
// source of truth (PROJECT_RULES.md Addendum E). Duplicated rather than
// shared via a package because frontend/backend build pipelines aren't
// wired into a monorepo tool yet; flagged here as a seam to fix when
// that's set up, same as the BC mandatory-fields list.

export const RECONCILIATION_THRESHOLDS = {
  AUTO_APPROVED: 0.85,
  RECOMMENDED: 0.7,
} as const;

export const ITEM_MATCHING_THRESHOLD = 0.75;

export type ReconciliationStatus = "AUTO_APPROVED" | "RECOMMENDED" | "REVIEW_REQUIRED";

export function classifyConfidence(confidence: number): ReconciliationStatus {
  if (confidence >= RECONCILIATION_THRESHOLDS.AUTO_APPROVED) return "AUTO_APPROVED";
  if (confidence >= RECONCILIATION_THRESHOLDS.RECOMMENDED) return "RECOMMENDED";
  return "REVIEW_REQUIRED";
}

/**
 * Source Resolution Engine (Rule #2) — given multiple candidate values
 * for one CTDM field from different documents, picks the resolved value
 * (highest confidence wins) and returns it alongside its classification.
 * This is intentionally simple (max-confidence) as the first working
 * version; the Learning Engine (Rule #9) is meant to refine this over
 * time using learning_corrections data, not replace the entry point.
 */
export interface FieldCandidate {
  documentId: string;
  value: string;
  confidence: number;
  reasoning?: string;
}

export function resolveField(candidates: FieldCandidate[]): {
  resolvedValue: string;
  confidence: number;
  status: ReconciliationStatus;
  winningCandidate: FieldCandidate;
} {
  if (candidates.length === 0) {
    throw new Error("resolveField requires at least one candidate");
  }
  const winner = [...candidates].sort((a, b) => b.confidence - a.confidence)[0];
  return {
    resolvedValue: winner.value,
    confidence: winner.confidence,
    status: classifyConfidence(winner.confidence),
    winningCandidate: winner,
  };
}
