// Evidence Domain — Core Types
// Every write in the system starts with an EvidenceEvent.

export type ProducerType =
  | 'OCR' | 'ERP' | 'CEISA' | 'EMAIL' | 'API'
  | 'USER' | 'WEBHOOK' | 'MANUAL_ENTRY'
  | 'SYSTEM' | 'IDENTITY_ENGINE' | 'REASONING_ENGINE'
  | 'PROJECTION_ENGINE' | 'DRY_RUN_ENGINE';

export type EventType =
  // Evidence
  | 'DOCUMENT_RECEIVED' | 'DOCUMENT_CLASSIFIED' | 'DOCUMENT_ENHANCED'
  | 'FIELD_EXTRACTED'   | 'FIELD_CORRECTED'
  // Signal
  | 'SIGNAL_PRODUCED'   | 'SIGNAL_SUPERSEDED'   | 'SIGNAL_CONFIRMED'
  // Identity
  | 'IDENTITY_CREATED'  | 'IDENTITY_MERGED'     | 'IDENTITY_LINKED'
  | 'IDENTITY_STRENGTH_CHANGED'
  // Shipment
  | 'SHIPMENT_CREATED'        | 'SHIPMENT_STATUS_CHANGED'
  | 'SHIPMENT_HEALTH_CHANGED' | 'SHIPMENT_MATCHED'
  | 'SHIPMENT_CONFLICT_DETECTED' | 'SHIPMENT_CONFLICT_RESOLVED'
  // Upload
  | 'UPLOAD_SESSION_CREATED'  | 'UPLOAD_SESSION_ANALYZED'
  | 'UPLOAD_SESSION_COMMITTED'| 'UPLOAD_SESSION_CANCELLED'
  | 'FILE_STAGED'
  // Reasoning
  | 'REASONING_TRIGGERED' | 'REASONING_COMPLETED' | 'REASONING_ACTION_TAKEN'
  // Admin / Config
  | 'CONFIG_CHANGED';

export type EntityType =
  | 'DOCUMENT' | 'SIGNAL' | 'IDENTITY' | 'SHIPMENT' | 'SESSION' | 'FILE' | 'CONFIG';

export type SignalType =
  | 'PO_NUMBER' | 'BL_NUMBER'     | 'INVOICE_NUMBER' | 'CONTAINER_NUMBER'
  | 'HAWB'      | 'LC_NUMBER'     | 'VESSEL_NAME'    | 'PRODUCT_CODE'
  | 'SUPPLIER_NAME' | 'CONSIGNEE_NAME' | 'ETA'        | 'VALUE_RANGE'
  | 'HS_CODE';

// ─── Input type for writing a new event ──────────────────────────────────────
export interface EvidenceEventInput {
  tenantId:       string;
  eventTime:      Date;        // when did it happen in the real world
  eventType:      EventType;
  producerType:   ProducerType;
  producerRef?:   string;
  entityType?:    EntityType;
  entityId?:      string;
  payload:        Record<string, unknown>;
  causedBy?:      string;      // parent event ID
}

// ─── What comes back from the DB after insert ─────────────────────────────── 
export interface EvidenceEvent extends EvidenceEventInput {
  id:          string;
  createdAt:   Date;
  sequenceNum: bigint;
}

// ─── Identity Signal input (before insert) ───────────────────────────────────
export interface IdentitySignalInput {
  tenantId:             string;
  signalType:           SignalType;
  rawValue:             string;
  producerType:         ProducerType;
  producerRef?:         string;
  extractionConfidence: number;
  originEventId:        string;
}

// ─── Every data source implements this interface ──────────────────────────────
// Rule #10: all external sources accessed through adapters with standard interface.
// This is the evidence-layer equivalent.
export interface EvidenceProducer {
  readonly producerType: ProducerType;

  // Produce events and signals — the producer does NOT write to DB directly.
  // It returns structured input, the EvidenceWriter handles the actual write.
  // This separation allows testing producers without DB, and allows
  // the write path to enforce ordering (event first, projection second).
  produceEvents(context: unknown): Promise<{
    events:  EvidenceEventInput[];
    signals: IdentitySignalInput[];
  }>;
}
