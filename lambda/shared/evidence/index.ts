// Evidence Domain — public API
// Everything outside this domain imports from here only.
// Internal implementation details are not exported.

export { EvidenceWriter } from './writer.js';
export { OcrProducer, UserOverrideProducer } from './producers/OcrProducer.js';
export type {
  EvidenceProducer,
  EvidenceEventInput,
  EvidenceEvent,
  IdentitySignalInput,
  EventType,
  EntityType,
  SignalType,
  ProducerType,
} from './types.js';
