import { PoolClient } from 'pg';
import { EvidenceEventInput, EvidenceEvent, IdentitySignalInput } from './types.js';

// EvidenceWriter — the ONLY path for writing to evidence_events.
// Enforces the rule: event first, projection second.
// Projection tables are never written to directly from outside this module
// without first writing an event.

export class EvidenceWriter {
  constructor(private readonly client: PoolClient) {}

  // Write ONE event and return it with its assigned sequence number.
  // This is the atomic primitive. Everything else builds on this.
  async writeEvent(input: EvidenceEventInput): Promise<EvidenceEvent> {
    const { rows } = await this.client.query<{
      id: string; created_at: Date; sequence_num: bigint;
    }>(
      `INSERT INTO evidence_events
         (tenant_id, event_time, event_type, producer_type, producer_ref,
          entity_type, entity_id, payload, caused_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, created_at, sequence_num`,
      [
        input.tenantId,
        input.eventTime,
        input.eventType,
        input.producerType,
        input.producerRef ?? null,
        input.entityType  ?? null,
        input.entityId    ?? null,
        JSON.stringify(input.payload),
        input.causedBy    ?? null,
      ]
    );

    return {
      ...input,
      id:          rows[0].id,
      createdAt:   rows[0].created_at,
      sequenceNum: rows[0].sequence_num,
    };
  }

  // Write a batch of events in a single round-trip.
  // Events are inserted in array order — sequence_num reflects this.
  async writeBatch(inputs: EvidenceEventInput[]): Promise<EvidenceEvent[]> {
    if (inputs.length === 0) return [];
    const results: EvidenceEvent[] = [];
    for (const input of inputs) {
      results.push(await this.writeEvent(input));
    }
    return results;
  }

  // Write a SIGNAL_PRODUCED event and insert the identity_signal projection.
  // This is the most common signal write path.
  async writeSignal(
    eventInput: EvidenceEventInput,
    signal: Omit<IdentitySignalInput, 'originEventId'>
  ): Promise<{ event: EvidenceEvent; signalId: string }> {
    // 1. Event first — always
    const event = await this.writeEvent(eventInput);

    // 2. Projection second
    const { rows } = await this.client.query<{ id: string }>(
      `INSERT INTO identity_signals
         (tenant_id, signal_type, raw_value, producer_type, producer_ref,
          extraction_confidence, origin_event_id, last_event_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
       RETURNING id`,
      [
        signal.tenantId,
        signal.signalType,
        signal.rawValue,
        signal.producerType,
        signal.producerRef ?? null,
        signal.extractionConfidence,
        event.id,
      ]
    );

    return { event, signalId: rows[0].id };
  }

  // Supersede a signal: deactivate old, create new.
  // Writes SIGNAL_SUPERSEDED event, updates projection.
  async supersede(
    tenantId: string,
    oldSignalId: string,
    newSignalInput: EvidenceEventInput,
    newSignal: Omit<IdentitySignalInput, 'originEventId'>
  ): Promise<{ event: EvidenceEvent; signalId: string }> {
    // 1. Event first
    const event = await this.writeEvent({
      ...newSignalInput,
      payload: {
        ...newSignalInput.payload,
        superseded_signal_id: oldSignalId,
      },
    });

    // 2. Mark old signal inactive
    await this.client.query(
      `UPDATE identity_signals
       SET is_active = false, last_event_id = $1
       WHERE id = $2`,
      [event.id, oldSignalId]
    );

    // 3. Insert new signal projection
    const { rows } = await this.client.query<{ id: string }>(
      `INSERT INTO identity_signals
         (tenant_id, signal_type, raw_value, producer_type, producer_ref,
          extraction_confidence, is_active, origin_event_id, last_event_id)
       VALUES ($1,$2,$3,$4,$5,$6,true,$7,$7)
       RETURNING id`,
      [
        newSignal.tenantId,
        newSignal.signalType,
        newSignal.rawValue,
        newSignal.producerType,
        newSignal.producerRef ?? null,
        newSignal.extractionConfidence,
        event.id,
      ]
    );

    return { event, signalId: rows[0].id };
  }

  // Update the projection checkpoint for a named projector.
  // Called after a projector finishes processing a batch of events.
  async advanceCheckpoint(
    projectionName: string,
    lastSeq: bigint,
    lastEventId: string
  ): Promise<void> {
    await this.client.query(
      `INSERT INTO projection_checkpoints
         (projection_name, last_processed_seq, last_processed_event_id, last_processed_at)
       VALUES ($1,$2,$3,NOW())
       ON CONFLICT (projection_name) DO UPDATE SET
         last_processed_seq = EXCLUDED.last_processed_seq,
         last_processed_event_id = EXCLUDED.last_processed_event_id,
         last_processed_at = NOW()`,
      [projectionName, lastSeq, lastEventId]
    );
  }
}
