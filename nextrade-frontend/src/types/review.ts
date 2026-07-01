import { ReconciliationStatus } from "../lib/reconciliation";

export interface FieldSource {
  documentName: string;
  value: string;
  confidence: number;
  reasoning?: string;
}

export interface CheckpointField {
  id: string;
  label: string;
  value: string | null;
  status: ReconciliationStatus | "MISSING";
  sources: FieldSource[]; // documents this value was derived/confirmed from
}

export interface ShipmentReadiness {
  shipmentNumber: string;
  partyFrom: string;
  partyTo: string;
  bcType: string;
  readinessScore: number; // 0-100
  checkpoints: CheckpointField[];
}
