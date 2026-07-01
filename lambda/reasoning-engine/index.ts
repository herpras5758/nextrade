import { Handler } from 'aws-lambda';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { getPool } from '../shared/dbPool.js';
import { EvidenceWriter } from '../shared/evidence/index.js';

const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION });

interface ReasoningTriggerEvent {
  tenantId:         string;
  shipmentId:       string;
  triggerDocumentId: string;
  triggerType:      'NEW_DOC' | 'REVISION' | 'REPLACEMENT' | 'CONFLICT';
  triggerEventId:   string;
}

const IMPACT_FIELDS: Record<string, string[]> = {
  // Fields that affect Customs Declaration
  invoice_value:  ['total_cif', 'bea_masuk', 'ppn'],
  gross_weight:   ['bruto', 'freight_estimate'],
  net_weight:     ['netto'],
  hs_code:        ['tariff_rate', 'bea_masuk', 'lartas_check'],
  country_origin: ['lartas_check', 'preferential_tariff'],
  quantity:       ['netto', 'total_cif'],
  currency:       ['kurs_conversion', 'total_cif'],
};

export const handler: Handler<ReasoningTriggerEvent> = async (event) => {
  const { tenantId, shipmentId, triggerDocumentId, triggerType, triggerEventId } = event;
  const pool = await getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const writer = new EvidenceWriter(client);

    // Load current CTDM state for this shipment
    const { rows: currentFields } = await client.query(
      `SELECT field_key, resolved_value, confidence
       FROM ctdm_fields WHERE shipment_id = $1 AND tenant_id = $2`,
      [shipmentId, tenantId]
    );

    // Load the triggering document's extracted fields
    const { rows: newFields } = await client.query(
      `SELECT cf.field_key, fs.raw_value, fs.confidence
       FROM ctdm_field_sources fs
       JOIN ctdm_fields cf ON cf.id = fs.ctdm_field_id
       WHERE fs.document_id = $1`,
      [triggerDocumentId]
    );

    if (newFields.length === 0) {
      await client.query('COMMIT');
      return { success: true, impact_level: 'NONE', reason: 'No extracted fields to compare' };
    }

    // Compute changed fields
    const currentMap = new Map(currentFields.map((f: any) => [f.field_key, f.resolved_value]));
    const changedFields: Array<{
      field_key: string; from: string | null; to: string;
      delta_pct?: number; affects_declaration: boolean;
    }> = [];

    for (const nf of newFields) {
      const current = currentMap.get(nf.field_key);
      if (current && current !== nf.raw_value) {
        const fromNum = parseFloat(current?.replace(/[^0-9.]/g, '') ?? '0');
        const toNum   = parseFloat(nf.raw_value?.replace(/[^0-9.]/g, '') ?? '0');
        const deltaPct = fromNum > 0 ? Math.abs((toNum - fromNum) / fromNum) * 100 : undefined;

        changedFields.push({
          field_key: nf.field_key,
          from: current,
          to: nf.raw_value,
          delta_pct: deltaPct,
          affects_declaration: (IMPACT_FIELDS[nf.field_key]?.length ?? 0) > 0,
        });
      }
    }

    if (changedFields.length === 0) {
      await client.query('COMMIT');
      return { success: true, impact_level: 'NONE' };
    }

    // Determine impact level
    const declarationChanges = changedFields.filter(f => f.affects_declaration);
    const highValueChange = changedFields.some(f =>
      f.delta_pct !== undefined && f.delta_pct > 5 &&
      ['invoice_value', 'gross_weight', 'hs_code', 'quantity'].includes(f.field_key)
    );
    const hsCodeChanged = changedFields.some(f => f.field_key === 'hs_code');

    let impactLevel: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' = 'NONE';
    if (hsCodeChanged || (declarationChanges.length > 0 && highValueChange)) impactLevel = 'HIGH';
    else if (declarationChanges.length > 0) impactLevel = 'MEDIUM';
    else if (changedFields.length > 0) impactLevel = 'LOW';

    // Build reasoning via Bedrock (concise, actionable)
    const reasoning = await buildReasoning(changedFields, impactLevel, triggerType);

    const affectedDeclarations = [...new Set(
      declarationChanges.flatMap(f => IMPACT_FIELDS[f.field_key] ?? [])
    )];

    const recommendedActions =
      impactLevel === 'HIGH'   ? ['HOLD_SUBMISSION', 'RECALCULATE_DUTIES', 'NOTIFY_DECLARANT'] :
      impactLevel === 'MEDIUM' ? ['REVIEW_CHANGES', 'VERIFY_DECLARATION'] :
      ['ACKNOWLEDGE'];

    // Write REASONING_TRIGGERED event
    const trigEvt = await writer.writeEvent({
      tenantId, eventTime: new Date(), eventType: 'REASONING_TRIGGERED',
      producerType: 'REASONING_ENGINE', producerRef: triggerDocumentId,
      entityType: 'SHIPMENT', entityId: shipmentId,
      payload: { trigger_type: triggerType, changed_field_count: changedFields.length, impact_level: impactLevel },
      causedBy: triggerEventId,
    });

    // Insert reasoning result projection
    const { rows: [result] } = await client.query(
      `INSERT INTO reasoning_results
         (tenant_id, shipment_id, trigger_document_id, trigger_event_id, trigger_type,
          impact_level, changed_fields, affected_declarations, reasoning,
          recommended_actions, requires_action, origin_event_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id`,
      [
        tenantId, shipmentId, triggerDocumentId, triggerEventId, triggerType,
        impactLevel,
        JSON.stringify(changedFields),
        JSON.stringify(affectedDeclarations),
        reasoning,
        JSON.stringify(recommendedActions),
        impactLevel !== 'NONE' && impactLevel !== 'LOW',
        trigEvt.id,
      ]
    );

    // Write REASONING_COMPLETED event
    await writer.writeEvent({
      tenantId, eventTime: new Date(), eventType: 'REASONING_COMPLETED',
      producerType: 'REASONING_ENGINE', producerRef: result.id,
      entityType: 'SHIPMENT', entityId: shipmentId,
      payload: { impact_level: impactLevel, reasoning_result_id: result.id },
      causedBy: trigEvt.id,
    });

    // Update shipment health
    if (impactLevel === 'HIGH') {
      await client.query(
        `UPDATE shipments SET health = 'CRITICAL' WHERE id = $1`,
        [shipmentId]
      );
    } else if (impactLevel === 'MEDIUM') {
      await client.query(
        `UPDATE shipments SET health = 'NEEDS_ATTENTION' WHERE id = $1 AND health = 'HEALTHY'`,
        [shipmentId]
      );
    }

    await client.query('COMMIT');
    return { success: true, impact_level: impactLevel, reasoning_result_id: result.id };
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('[ReasoningEngine]', err.message);
    return { success: false, error: err.message };
  } finally {
    client.release();
  }
};

async function buildReasoning(
  changedFields: any[], impactLevel: string, triggerType: string
): Promise<string> {
  // Concise rule-based reasoning — fast, no Bedrock latency for simple cases
  const lines: string[] = [];
  const high = changedFields.filter(f => f.affects_declaration && (f.delta_pct ?? 0) > 5);
  const med  = changedFields.filter(f => f.affects_declaration && (f.delta_pct ?? 0) <= 5);
  const low  = changedFields.filter(f => !f.affects_declaration);

  if (triggerType === 'REVISION') lines.push('Dokumen revisi terdeteksi.');
  else if (triggerType === 'NEW_DOC') lines.push('Dokumen baru terdeteksi setelah shipment siap kirim.');

  if (high.length > 0) {
    lines.push(`Field kritis berubah signifikan: ${high.map(f =>
      `${f.field_key} (${f.from} → ${f.to}${f.delta_pct ? ', Δ' + f.delta_pct.toFixed(1) + '%' : ''})`
    ).join('; ')}.`);
    lines.push('Perubahan ini mempengaruhi perhitungan bea masuk dan nilai pabean.');
  }
  if (med.length > 0) {
    lines.push(`Perubahan field deklarasi minor: ${med.map(f => f.field_key).join(', ')}.`);
  }
  if (low.length > 0) {
    lines.push(`Perubahan non-deklarasi: ${low.map(f => f.field_key).join(', ')}.`);
  }

  lines.push(
    impactLevel === 'HIGH'   ? 'Tindakan diperlukan sebelum submit ke CEISA.' :
    impactLevel === 'MEDIUM' ? 'Verifikasi ulang deklarasi direkomendasikan.' :
    'Tidak ada tindakan wajib.'
  );

  return lines.join(' ');
}
