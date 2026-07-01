// Confidence Engine — compares incoming signals against a shipment's
// existing identity signals and produces a match score.
// Does NOT know about shipment business logic — only signal math.

import { normalize, fuzzyMatch, rangeOverlap, dateRangeMatch, NormalizerName } from './normalizers.js';

interface SignalConfig {
  weight: number;
  normalizer: NormalizerName;
  match_strategy: 'exact_after_normalize' | 'fuzzy' | 'range_overlap' | 'prefix_match';
  fuzzy_threshold?: number;
  tolerance_pct?: number;
  tolerance_days?: number;
  min_confidence_to_include: number;
}

// Loaded from config/signal-weights.yaml at runtime
// Hardcoded here as fallback — will be overridden by YAML in Lambda env
const DEFAULT_WEIGHTS: Record<string, SignalConfig> = {
  PO_NUMBER:        { weight: 0.35, normalizer: 'strip_prefix',    match_strategy: 'exact_after_normalize', min_confidence_to_include: 0.70 },
  BL_NUMBER:        { weight: 0.30, normalizer: 'strip_whitespace', match_strategy: 'exact_after_normalize', min_confidence_to_include: 0.75 },
  INVOICE_NUMBER:   { weight: 0.20, normalizer: 'strip_prefix',    match_strategy: 'exact_after_normalize', min_confidence_to_include: 0.70 },
  CONTAINER_NUMBER: { weight: 0.25, normalizer: 'iso6346',         match_strategy: 'exact_after_normalize', min_confidence_to_include: 0.80 },
  SUPPLIER_NAME:    { weight: 0.10, normalizer: 'company_name',    match_strategy: 'fuzzy', fuzzy_threshold: 0.85, min_confidence_to_include: 0.60 },
  CONSIGNEE_NAME:   { weight: 0.10, normalizer: 'company_name',    match_strategy: 'fuzzy', fuzzy_threshold: 0.85, min_confidence_to_include: 0.60 },
  VALUE_RANGE:      { weight: 0.15, normalizer: 'currency_convert', match_strategy: 'range_overlap', tolerance_pct: 0.15, min_confidence_to_include: 0.65 },
  HS_CODE:          { weight: 0.10, normalizer: 'strip_dots',      match_strategy: 'prefix_match', min_confidence_to_include: 0.85 },
  ETA:              { weight: 0.05, normalizer: 'date_normalize',  match_strategy: 'range_overlap', tolerance_days: 7, min_confidence_to_include: 0.60 },
};

export interface IncomingSignal {
  signalType: string;
  rawValue: string;
  confidence: number;  // extraction confidence from OCR/AI
}

export interface ExistingSignal {
  signalType: string;
  rawValue: string;
}

export interface SignalMatchResult {
  signalType: string;
  incomingValue: string;
  existingValue: string;
  normalizedIncoming: string;
  normalizedExisting: string;
  rawMatchScore: number;     // 0-1 from comparison
  weightedScore: number;     // rawMatchScore × weight × extractionConfidence
  config: SignalConfig;
}

export interface ConfidenceResult {
  overallScore: number;           // 0-1, normalized by possible weight
  tier: 'AUTO_ATTACH' | 'SUGGEST' | 'MANUAL_REVIEW' | 'NEW_SHIPMENT';
  matchedSignals: SignalMatchResult[];
  unmatchedSignalTypes: string[]; // signals in incoming but not in existing
  reasoning: string;              // human-readable explanation
}

export function computeConfidence(
  incoming: IncomingSignal[],
  existing: ExistingSignal[],
  weights: Record<string, SignalConfig> = DEFAULT_WEIGHTS
): ConfidenceResult {
  const matched: SignalMatchResult[] = [];
  const unmatchedTypes: string[] = [];
  let totalWeightedScore = 0;
  let totalPossibleWeight = 0;

  for (const inc of incoming) {
    const cfg = weights[inc.signalType];
    if (!cfg) continue;
    if (inc.confidence < cfg.min_confidence_to_include) continue;

    const existingMatch = existing.find(e => e.signalType === inc.signalType);
    if (!existingMatch) {
      unmatchedTypes.push(inc.signalType);
      // Still counts toward possible weight — missing signal = 0 score
      totalPossibleWeight += cfg.weight;
      continue;
    }

    const normInc = normalize(inc.rawValue, cfg.normalizer);
    const normExt = normalize(existingMatch.rawValue, cfg.normalizer);

    let rawScore = 0;
    switch (cfg.match_strategy) {
      case 'exact_after_normalize':
        rawScore = normInc === normExt ? 1.0 : 0;
        break;
      case 'fuzzy':
        rawScore = fuzzyMatch(normInc, normExt);
        if (rawScore < (cfg.fuzzy_threshold ?? 0.85)) rawScore = 0;
        break;
      case 'range_overlap':
        rawScore = cfg.tolerance_days
          ? dateRangeMatch(normInc, normExt, cfg.tolerance_days)
          : rangeOverlap(normInc, normExt, cfg.tolerance_pct);
        break;
      case 'prefix_match':
        // HS code: first 6 digits must match
        rawScore = normInc.slice(0, 6) === normExt.slice(0, 6) ? 0.9 : 0;
        break;
    }

    const weightedScore = rawScore * cfg.weight * inc.confidence;
    totalWeightedScore += weightedScore;
    totalPossibleWeight += cfg.weight;

    matched.push({
      signalType: inc.signalType,
      incomingValue: inc.rawValue,
      existingValue: existingMatch.rawValue,
      normalizedIncoming: normInc,
      normalizedExisting: normExt,
      rawMatchScore: rawScore,
      weightedScore,
      config: cfg,
    });
  }

  const overallScore = totalPossibleWeight > 0
    ? totalWeightedScore / totalPossibleWeight
    : 0;

  const tier =
    overallScore >= 0.98 ? 'AUTO_ATTACH' :
    overallScore >= 0.90 ? 'SUGGEST' :
    overallScore >= 0.70 ? 'MANUAL_REVIEW' : 'NEW_SHIPMENT';

  // Build human-readable reasoning
  const strongMatches = matched.filter(m => m.rawMatchScore > 0 && m.config.weight >= 0.20);
  const noMatches = matched.filter(m => m.rawMatchScore === 0);
  const parts: string[] = [];
  if (strongMatches.length > 0)
    parts.push(`${strongMatches.map(m => m.signalType).join(' dan ')} cocok`);
  if (noMatches.length > 0)
    parts.push(`${noMatches.map(m => m.signalType).join(', ')} tidak cocok`);
  if (unmatchedTypes.length > 0)
    parts.push(`${unmatchedTypes.join(', ')} belum ada di shipment existing`);
  const reasoning = parts.join('. ') || 'Tidak ada sinyal yang dapat dibandingkan';

  return { overallScore, tier, matchedSignals: matched, unmatchedSignalTypes: unmatchedTypes, reasoning };
}
