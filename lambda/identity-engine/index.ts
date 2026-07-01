import { Handler } from 'aws-lambda';
import { getPool } from '../shared/dbPool.js';
import { EvidenceWriter } from '../shared/evidence/index.js';
import { normalize } from '../shared/identity/normalizers.js';

// Identity Engine — answers one question: "are these two signals the same entity?"
// Does NOT know about Shipment, Customs, or any business domain.
// Triggered by: SIGNAL_PRODUCED events via EventBridge

interface IdentityEngineEvent {
  tenantId: string;
  signalId: string;          // newly produced signal to resolve
  action: 'RESOLVE' | 'REBUILD_ALL';
}

export const handler: Handler<IdentityEngineEvent> = async (event) => {
  const pool = await getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const writer = new EvidenceWriter(client);

    if (event.action === 'REBUILD_ALL') {
      await rebuildAllIdentities(client, writer, event.tenantId);
    } else {
      await resolveSignal(client, writer, event.tenantId, event.signalId);
    }

    await client.query('COMMIT');
    return { success: true };
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('[IdentityEngine] failed:', err.message);
    return { success: false, error: err.message };
  } finally {
    client.release();
  }
};

async function resolveSignal(client: any, writer: EvidenceWriter, tenantId: string, signalId: string) {
  // 1. Load the new signal
  const { rows: [signal] } = await client.query(
    `SELECT id, signal_type, raw_value, extraction_confidence
     FROM identity_signals WHERE id = $1 AND tenant_id = $2 AND is_active = true`,
    [signalId, tenantId]
  );
  if (!signal) return;

  // 2. Find existing identities with matching canonical signals
  // The engine clusters by normalized value, not raw value
  const normalizer = getNormalizer(signal.signal_type);
  const normalizedValue = normalize(signal.raw_value, normalizer);

  const { rows: candidates } = await client.query(
    `SELECT i.id, i.identity_type, i.canonical_label, i.strength, i.signal_count
     FROM identities i
     JOIN identity_signal_links isl ON isl.identity_id = i.id
     JOIN identity_signals s ON s.id = isl.signal_id
     WHERE i.tenant_id = $1
       AND s.signal_type = $2
       AND s.is_active = true
       AND isl.normalized_value = $3`,
    [tenantId, signal.signal_type, normalizedValue]
  );

  if (candidates.length === 0) {
    // No existing identity → create new one
    const { rows: [identity] } = await client.query(
      `INSERT INTO identities (tenant_id, identity_type, canonical_label, strength, signal_count, source_count)
       VALUES ($1, 'SHIPMENT', $2, 'WEAK', 1, 1)
       RETURNING id`,
      [tenantId, signal.raw_value]
    );

    // Link signal to identity
    await client.query(
      `INSERT INTO identity_signal_links (identity_id, signal_id, contribution, normalized_value, normalizer_used)
       VALUES ($1, $2, $3, $4, $5)`,
      [identity.id, signalId, getWeight(signal.signal_type), normalizedValue, normalizer]
    );

    const evt = await writer.writeEvent({
      tenantId, eventTime: new Date(), eventType: 'IDENTITY_CREATED',
      producerType: 'IDENTITY_ENGINE', entityType: 'IDENTITY', entityId: identity.id,
      payload: { signal_id: signalId, signal_type: signal.signal_type, canonical_label: signal.raw_value },
    });

    // Update identity with origin event
    await client.query(
      `UPDATE identities SET origin_event_id = $1, last_event_id = $1 WHERE id = $2`,
      [evt.id, identity.id]
    );

  } else {
    // Existing identity found → link this signal to it and recalculate strength
    const identity = candidates[0];

    await client.query(
      `INSERT INTO identity_signal_links (identity_id, signal_id, contribution, normalized_value, normalizer_used)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (identity_id, signal_id) DO NOTHING`,
      [identity.id, signalId, getWeight(signal.signal_type), normalizedValue, normalizer]
    );

    // Recalculate strength
    const { rows: allLinks } = await client.query(
      `SELECT s.signal_type, isl.contribution
       FROM identity_signal_links isl
       JOIN identity_signals s ON s.id = isl.signal_id
       WHERE isl.identity_id = $1 AND s.is_active = true`,
      [identity.id]
    );

    const newStrength = calculateStrength(allLinks);
    const oldStrength = identity.strength;

    const evt = await writer.writeEvent({
      tenantId, eventTime: new Date(),
      eventType: oldStrength !== newStrength ? 'IDENTITY_STRENGTH_CHANGED' : 'IDENTITY_LINKED',
      producerType: 'IDENTITY_ENGINE', entityType: 'IDENTITY', entityId: identity.id,
      payload: {
        signal_id: signalId, old_strength: oldStrength, new_strength: newStrength,
        signal_count: allLinks.length,
      },
    });

    await client.query(
      `UPDATE identities SET strength = $1, signal_count = $2, last_computed_at = NOW(), last_event_id = $3
       WHERE id = $4`,
      [newStrength, allLinks.length, evt.id, identity.id]
    );
  }
}

async function rebuildAllIdentities(client: any, writer: EvidenceWriter, tenantId: string) {
  // Clear all identity projections for this tenant
  await client.query(`DELETE FROM identity_signal_links WHERE identity_id IN (SELECT id FROM identities WHERE tenant_id = $1)`, [tenantId]);
  await client.query(`DELETE FROM identity_links WHERE tenant_id = $1`, [tenantId]);
  await client.query(`DELETE FROM identities WHERE tenant_id = $1`, [tenantId]);

  // Replay all active signals
  const { rows: signals } = await client.query(
    `SELECT id FROM identity_signals WHERE tenant_id = $1 AND is_active = true ORDER BY created_at`,
    [tenantId]
  );

  for (const { id } of signals) {
    await resolveSignal(client, writer, tenantId, id);
  }
}

function getNormalizer(signalType: string): any {
  const map: Record<string, string> = {
    PO_NUMBER: 'strip_prefix', BL_NUMBER: 'strip_whitespace',
    INVOICE_NUMBER: 'strip_prefix', CONTAINER_NUMBER: 'iso6346',
    SUPPLIER_NAME: 'company_name', CONSIGNEE_NAME: 'company_name',
    HS_CODE: 'strip_dots', VALUE_RANGE: 'currency_convert',
    ETA: 'date_normalize',
  };
  return map[signalType] ?? 'none';
}

function getWeight(signalType: string): number {
  const weights: Record<string, number> = {
    PO_NUMBER: 0.35, BL_NUMBER: 0.30, INVOICE_NUMBER: 0.20,
    CONTAINER_NUMBER: 0.25, SUPPLIER_NAME: 0.10, CONSIGNEE_NAME: 0.10,
    VALUE_RANGE: 0.15, HS_CODE: 0.10, ETA: 0.05,
  };
  return weights[signalType] ?? 0.05;
}

const STRONG_SIGNALS = new Set(['PO_NUMBER', 'BL_NUMBER', 'INVOICE_NUMBER', 'CONTAINER_NUMBER']);

function calculateStrength(links: Array<{ signal_type: string; contribution: number }>): string {
  const totalWeight = links.reduce((s, l) => s + l.contribution, 0);
  const strongCount = links.filter(l => STRONG_SIGNALS.has(l.signal_type)).length;

  if (totalWeight >= 0.85 && strongCount >= 3) return 'DEFINITIVE';
  if (totalWeight >= 0.70 && strongCount >= 2) return 'STRONG';
  if (totalWeight >= 0.45 && strongCount >= 1) return 'MODERATE';
  return 'WEAK';
}
