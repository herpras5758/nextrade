import { EvidenceProducer, EvidenceEventInput, IdentitySignalInput, SignalType } from '../types.js';

const FIELD_TO_SIGNAL: Partial<Record<string, SignalType>> = {
  po_number: 'PO_NUMBER', bl_number: 'BL_NUMBER',
  invoice_number: 'INVOICE_NUMBER', container_number: 'CONTAINER_NUMBER',
  hawb: 'HAWB', lc_number: 'LC_NUMBER', vessel_name: 'VESSEL_NAME',
  shipper_name: 'SUPPLIER_NAME', exporter_name: 'SUPPLIER_NAME',
  supplier_name: 'SUPPLIER_NAME', consignee_name: 'CONSIGNEE_NAME',
  importer_name: 'CONSIGNEE_NAME', eta: 'ETA',
  total_value: 'VALUE_RANGE', hs_code: 'HS_CODE',
};

interface OcrContext {
  tenantId: string; documentId: string; extractedAt: Date;
  fields: Array<{ fieldKey: string; rawValue: string; confidence: number }>;
}

export class OcrProducer implements EvidenceProducer {
  readonly producerType = 'OCR' as const;

  async produceEvents(ctx: OcrContext): Promise<{ events: EvidenceEventInput[]; signals: IdentitySignalInput[] }> {
    const events: EvidenceEventInput[] = [];
    const signals: IdentitySignalInput[] = [];
    for (const f of ctx.fields) {
      events.push({ tenantId: ctx.tenantId, eventTime: ctx.extractedAt, eventType: 'FIELD_EXTRACTED',
        producerType: this.producerType, producerRef: ctx.documentId,
        entityType: 'DOCUMENT', entityId: ctx.documentId,
        payload: { field_key: f.fieldKey, raw_value: f.rawValue, confidence: f.confidence } });
      const st = FIELD_TO_SIGNAL[f.fieldKey];
      if (st && f.rawValue && f.confidence > 0.5) {
        events.push({ tenantId: ctx.tenantId, eventTime: ctx.extractedAt, eventType: 'SIGNAL_PRODUCED',
          producerType: this.producerType, producerRef: ctx.documentId, entityType: 'SIGNAL',
          payload: { signal_type: st, raw_value: f.rawValue, confidence: f.confidence, source_field: f.fieldKey } });
        signals.push({ tenantId: ctx.tenantId, signalType: st, rawValue: f.rawValue,
          producerType: this.producerType, producerRef: ctx.documentId,
          extractionConfidence: f.confidence, originEventId: '' });
      }
    }
    return { events, signals };
  }
}

interface UserCorrectionContext {
  tenantId: string; documentId: string; userId: string;
  fieldKey: string; oldValue: string; newValue: string;
  correctedAt: Date; previousSignalId?: string;
}

export class UserOverrideProducer implements EvidenceProducer {
  readonly producerType = 'USER' as const;
  async produceEvents(ctx: UserCorrectionContext): Promise<{ events: EvidenceEventInput[]; signals: IdentitySignalInput[] }> {
    const st = FIELD_TO_SIGNAL[ctx.fieldKey];
    const events: EvidenceEventInput[] = [
      { tenantId: ctx.tenantId, eventTime: ctx.correctedAt, eventType: 'FIELD_CORRECTED',
        producerType: this.producerType, producerRef: ctx.userId,
        entityType: 'DOCUMENT', entityId: ctx.documentId,
        payload: { field_key: ctx.fieldKey, old_value: ctx.oldValue, new_value: ctx.newValue } },
      ...(st ? [{ tenantId: ctx.tenantId, eventTime: ctx.correctedAt, eventType: 'SIGNAL_SUPERSEDED' as const,
        producerType: this.producerType, producerRef: ctx.userId, entityType: 'SIGNAL' as const,
        payload: { signal_type: st, raw_value: ctx.newValue, previous_signal_id: ctx.previousSignalId } }] : []),
    ];
    const signals: IdentitySignalInput[] = st ? [{ tenantId: ctx.tenantId, signalType: st,
      rawValue: ctx.newValue, producerType: this.producerType, producerRef: ctx.userId,
      extractionConfidence: 1.0, originEventId: '' }] : [];
    return { events, signals };
  }
}
