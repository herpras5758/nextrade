// Shipment Matcher — uses Identity Graph to find best shipment match.
// Consumes Identity Engine output. Never calls Identity Engine directly.
// Knows about Shipment domain — this is the bridge.

import { computeConfidence, IncomingSignal } from './confidenceEngine.js';
import { PoolClient } from 'pg';

// Re-export so consumers (dry-run-analyze) can import from one place
export type { IncomingSignal } from './confidenceEngine.js';

export type MatchTier = 'AUTO_ATTACH' | 'SUGGEST' | 'MANUAL_REVIEW' | 'NEW_SHIPMENT' | 'CONFLICT';

export interface MatchResult {
  tier: MatchTier;
  shipmentId?: string;
  shipmentNumber?: string;
  shipmentStatus?: string;
  confidence: number;
  reasoning: string;
  isConflict: boolean;        // true if best match is READY_FOR_CEISA or later
  conflictCategory?: string;  // which category of doc is conflicting
}

// State machine: which states block auto-attachment
const LOCKED_STATES = new Set(['READY_FOR_CEISA', 'SUBMITTED', 'SPPB', 'CLOSED']);
const PROTECTED_STATES = new Set(['READY_FOR_CEISA']);  // need conflict dialog

export async function findBestShipmentMatch(
  client: PoolClient,
  tenantId: string,
  incomingSignals: IncomingSignal[],
  documentCategory: string
): Promise<MatchResult> {

  // 1. Load all active shipments for this tenant with their identity signals
  const { rows: shipments } = await client.query(
    `SELECT s.id, s.shipment_number, s.status, s.identity_id,
            COALESCE(
              json_agg(
                json_build_object(
                  'signalType', sig.signal_type,
                  'rawValue',   sig.raw_value
                )
              ) FILTER (WHERE sig.id IS NOT NULL),
              '[]'
            ) AS existing_signals
     FROM shipments s
     LEFT JOIN identities i ON i.id = s.identity_id
     LEFT JOIN identity_signal_links isl ON isl.identity_id = i.id
     LEFT JOIN identity_signals sig ON sig.id = isl.signal_id AND sig.is_active = true
     WHERE s.tenant_id = $1 AND s.status NOT IN ('CLOSED')
     GROUP BY s.id, s.shipment_number, s.status, s.identity_id`,
    [tenantId]
  );

  if (shipments.length === 0) {
    return { tier: 'NEW_SHIPMENT', confidence: 0, reasoning: 'Belum ada shipment yang tersedia.', isConflict: false };
  }

  // 2. Score each shipment
  const scored = shipments.map(s => {
    const result = computeConfidence(incomingSignals, s.existing_signals);
    return { ...s, matchResult: result };
  });

  // 3. Find best match
  scored.sort((a, b) => b.matchResult.overallScore - a.matchResult.overallScore);
  const best = scored[0];

  if (best.matchResult.tier === 'NEW_SHIPMENT') {
    return {
      tier: 'NEW_SHIPMENT', confidence: best.matchResult.overallScore,
      reasoning: best.matchResult.reasoning, isConflict: false,
    };
  }

  // 4. Check if best match is in a protected/locked state
  const isProtected = PROTECTED_STATES.has(best.status);
  const isLocked = LOCKED_STATES.has(best.status) && !isProtected;

  if (isLocked) {
    return {
      tier: 'CONFLICT', shipmentId: best.id, shipmentNumber: best.shipment_number,
      shipmentStatus: best.status, confidence: best.matchResult.overallScore,
      reasoning: `Shipment ${best.shipment_number} sudah dalam status ${best.status} dan tidak dapat diubah.`,
      isConflict: true, conflictCategory: documentCategory,
    };
  }

  if (isProtected) {
    // READY_FOR_CEISA — high confidence match exists but needs human decision
    return {
      tier: 'CONFLICT', shipmentId: best.id, shipmentNumber: best.shipment_number,
      shipmentStatus: best.status, confidence: best.matchResult.overallScore,
      reasoning: `Shipment ${best.shipment_number} sudah READY_FOR_CEISA. ${best.matchResult.reasoning}`,
      isConflict: true, conflictCategory: documentCategory,
    };
  }

  return {
    tier: best.matchResult.tier,
    shipmentId: best.id,
    shipmentNumber: best.shipment_number,
    shipmentStatus: best.status,
    confidence: best.matchResult.overallScore,
    reasoning: best.matchResult.reasoning,
    isConflict: false,
  };
}
