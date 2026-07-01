-- =============================================================================
-- NexTrade Schema v2.0 — Event Sourcing Foundation
-- =============================================================================
-- evidence_events is the SOURCE OF TRUTH. Append-only, never UPDATE, never DELETE.
-- All other tables are PROJECTIONS — read models rebuilt from events.
-- A projection can be dropped and rebuilt at any time by replaying events.
-- =============================================================================

-- Clean slate (prototype reset, agreed on 2026-07-01)
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;

-- =============================================================================
-- CORE: Tenant isolation (not a projection — exists outside event model)
-- =============================================================================
CREATE TABLE tenants (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code             VARCHAR(20) UNIQUE NOT NULL,
  name             VARCHAR(255) NOT NULL,
  group_name       VARCHAR(255),
  default_language VARCHAR(10) DEFAULT 'id',
  settings         JSONB DEFAULT '{}',
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- EVIDENCE DOMAIN — SOURCE OF TRUTH
-- =============================================================================

-- THE EVENT LOG. Immutable. Append-only. Never touched after insert.
-- Every fact in the system starts here.
-- Projections are derived from this table.
-- If projections are lost, replay this to rebuild everything.
CREATE TABLE evidence_events (
  -- Identity
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id),

  -- When the real-world event happened (not when we recorded it)
  -- Critical for timeline accuracy: a BL dated yesterday but uploaded
  -- today should appear on the timeline at yesterday's date.
  event_time       TIMESTAMPTZ NOT NULL,

  -- When we recorded it (always monotonically increasing)
  created_at       TIMESTAMPTZ DEFAULT NOW(),

  -- Deterministic ordering when event_time is identical
  sequence_num     BIGSERIAL NOT NULL,

  -- What happened
  event_type       VARCHAR(60) NOT NULL,
  -- ── Evidence events ──────────────────────────────────────────────
  -- DOCUMENT_RECEIVED        file entered the system
  -- DOCUMENT_CLASSIFIED      document_type determined
  -- DOCUMENT_ENHANCED        image preprocessing applied
  -- FIELD_EXTRACTED          OCR/AI extracted a CTDM field
  -- FIELD_CORRECTED          user corrected an extracted field
  -- ── Signal events ─────────────────────────────────────────────── 
  -- SIGNAL_PRODUCED          identity signal created from any source
  -- SIGNAL_SUPERSEDED        a newer/better signal replaced this one
  -- SIGNAL_CONFIRMED         user confirmed signal is correct
  -- ── Identity events ───────────────────────────────────────────── 
  -- IDENTITY_CREATED         new identity entity resolved
  -- IDENTITY_MERGED          two identities collapsed into one
  -- IDENTITY_LINKED          link created between two identities
  -- IDENTITY_STRENGTH_CHANGED  weak→moderate→strong→definitive
  -- ── Shipment events ───────────────────────────────────────────── 
  -- SHIPMENT_CREATED
  -- SHIPMENT_STATUS_CHANGED  state machine transition
  -- SHIPMENT_HEALTH_CHANGED  healthy→needs_attention→critical
  -- SHIPMENT_MATCHED         document matched to shipment
  -- SHIPMENT_CONFLICT_DETECTED  document conflicts with existing state
  -- SHIPMENT_CONFLICT_RESOLVED
  -- ── Session events ────────────────────────────────────────────── 
  -- UPLOAD_SESSION_CREATED
  -- UPLOAD_SESSION_ANALYZED
  -- UPLOAD_SESSION_COMMITTED
  -- UPLOAD_SESSION_CANCELLED
  -- FILE_STAGED              file landed in S3 staging prefix
  -- ── Reasoning events ──────────────────────────────────────────── 
  -- REASONING_TRIGGERED      something changed that needs analysis
  -- REASONING_COMPLETED      impact level determined
  -- REASONING_ACTION_TAKEN   operator resolved a reasoning result

  -- Who or what produced this event
  producer_type    VARCHAR(30) NOT NULL,
  -- OCR | ERP | CEISA | EMAIL | API | USER | WEBHOOK
  -- MANUAL_ENTRY | SYSTEM | IDENTITY_ENGINE | REASONING_ENGINE
  -- PROJECTION_ENGINE | DRY_RUN_ENGINE

  producer_ref     VARCHAR(255),
  -- Nullable — the specific ID of the producer instance
  -- user_id if USER, document_id if OCR, session_id if DRY_RUN_ENGINE

  -- What entity this event is about
  entity_type      VARCHAR(30),
  -- DOCUMENT | SIGNAL | IDENTITY | SHIPMENT | SESSION | FILE

  entity_id        UUID,
  -- The entity's ID. May be null for system-level events.

  -- Full event context. Schema varies by event_type.
  -- Designed for replay: replaying payload must reproduce the same
  -- projection state as the original write.
  payload          JSONB NOT NULL DEFAULT '{}',

  -- Causality: which earlier event caused this one?
  caused_by        UUID REFERENCES evidence_events(id)
);

-- Queries: "all events for shipment X in order"
CREATE INDEX idx_evt_entity    ON evidence_events(tenant_id, entity_type, entity_id, sequence_num);
-- Queries: "all events after sequence N" (for projection catch-up)
CREATE INDEX idx_evt_sequence  ON evidence_events(sequence_num);
-- Queries: "timeline for tenant between timestamps"
CREATE INDEX idx_evt_timeline  ON evidence_events(tenant_id, event_time, sequence_num);
-- Queries: "all events from producer X" (e.g. all OCR events)
CREATE INDEX idx_evt_producer  ON evidence_events(tenant_id, producer_type, producer_ref);

-- =============================================================================
-- EVIDENCE DOMAIN — PROJECTIONS
-- (Read models. Can be dropped and rebuilt from evidence_events.)
-- =============================================================================

-- Projection: documents
-- Rebuilt from: DOCUMENT_RECEIVED, DOCUMENT_CLASSIFIED, DOCUMENT_ENHANCED
CREATE TABLE documents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id),
  shipment_id         UUID,                         -- set after SHIPMENT_MATCHED

  -- Source file
  file_name           VARCHAR(500) NOT NULL,
  s3_key              VARCHAR(500),
  file_size_bytes     BIGINT,
  mime_type           VARCHAR(100),

  -- Classification output
  document_type       VARCHAR(100),
  category            VARCHAR(30),
  -- COMMERCIAL | TRANSPORT | CUSTOMS | COMPLIANCE | SUPPORTING | INTERNAL

  -- Processing state
  status              VARCHAR(30) DEFAULT 'pending_upload',
  -- pending_upload | uploaded | classifying | classified | extracting
  -- extracted | needs_review | ready | error

  -- Versioning
  version             INT DEFAULT 1,
  supersedes_id       UUID REFERENCES documents(id),

  -- Intake metadata
  intake_source       VARCHAR(30) DEFAULT 'manual_upload',
  intake_session_id   UUID,
  uploaded_by         VARCHAR(255),
  uploaded_at         TIMESTAMPTZ DEFAULT NOW(),

  -- Event sourcing link — which event produced this projection row
  -- Allows us to find the event that created this document
  origin_event_id     UUID REFERENCES evidence_events(id),

  -- Projection tracking — which event last updated this row
  last_event_id       UUID REFERENCES evidence_events(id),
  last_event_seq      BIGINT
);

CREATE INDEX idx_doc_tenant     ON documents(tenant_id, status);
CREATE INDEX idx_doc_shipment   ON documents(shipment_id);
CREATE INDEX idx_doc_session    ON documents(intake_session_id);

-- Projection: ctdm_fields
-- Rebuilt from: FIELD_EXTRACTED, FIELD_CORRECTED
-- Rule #1: canonical trade data model. All downstream logic reads from here.
CREATE TABLE ctdm_fields (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  shipment_id       UUID,
  document_id       UUID REFERENCES documents(id),

  field_key         VARCHAR(100) NOT NULL,
  resolved_value    TEXT,
  confidence        DECIMAL(5,4),
  status            VARCHAR(20) DEFAULT 'pending',
  -- pending | auto_approved | recommended | review_required

  -- Event sourcing links
  origin_event_id   UUID REFERENCES evidence_events(id),
  last_event_id     UUID REFERENCES evidence_events(id),
  last_event_seq    BIGINT
);

CREATE TABLE ctdm_field_sources (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ctdm_field_id   UUID REFERENCES ctdm_fields(id) ON DELETE CASCADE,
  document_id     UUID REFERENCES documents(id),
  raw_value       TEXT,
  confidence      DECIMAL(5,4),
  reasoning       TEXT,
  origin_event_id UUID REFERENCES evidence_events(id)
);

-- Projection: identity_signals
-- Rebuilt from: SIGNAL_PRODUCED, SIGNAL_SUPERSEDED
CREATE TABLE identity_signals (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL,

  signal_type           VARCHAR(30) NOT NULL,
  -- PO_NUMBER | BL_NUMBER | INVOICE_NUMBER | CONTAINER_NUMBER |
  -- SUPPLIER_NAME | CONSIGNEE_NAME | ETA | VALUE_RANGE |
  -- HS_CODE | HAWB | LC_NUMBER | VESSEL_NAME | PRODUCT_CODE

  raw_value             TEXT NOT NULL,
  producer_type         VARCHAR(30) NOT NULL,
  producer_ref          VARCHAR(255),
  extraction_confidence DECIMAL(5,4),

  is_active             BOOLEAN DEFAULT true,
  -- false when SIGNAL_SUPERSEDED event is replayed

  -- Event sourcing links
  origin_event_id       UUID REFERENCES evidence_events(id),
  last_event_id         UUID REFERENCES evidence_events(id),
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_signals_tenant_type ON identity_signals(tenant_id, signal_type, is_active);

-- =============================================================================
-- IDENTITY DOMAIN — PROJECTIONS
-- (Rebuilt from: IDENTITY_CREATED, IDENTITY_MERGED, IDENTITY_LINKED,
--  IDENTITY_STRENGTH_CHANGED)
-- =============================================================================

CREATE TABLE identities (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,

  identity_type    VARCHAR(30) NOT NULL,
  -- SHIPMENT | SUPPLIER | BUYER | CONTAINER | PRODUCT
  -- | DOCUMENT | MATERIAL | FACTORY | VESSEL

  canonical_label  TEXT NOT NULL,
  strength         VARCHAR(15) NOT NULL DEFAULT 'WEAK',
  -- WEAK | MODERATE | STRONG | DEFINITIVE

  signal_count     INT DEFAULT 0,
  source_count     INT DEFAULT 0,

  last_computed_at TIMESTAMPTZ DEFAULT NOW(),
  origin_event_id  UUID REFERENCES evidence_events(id),
  last_event_id    UUID REFERENCES evidence_events(id),
  last_event_seq   BIGINT
);

CREATE TABLE identity_links (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  from_id       UUID NOT NULL REFERENCES identities(id),
  to_id         UUID NOT NULL REFERENCES identities(id),
  link_type     VARCHAR(20) NOT NULL,
  -- SAME_AS | PART_OF | RELATED_TO | DERIVED_FROM | SUPERSEDES
  confidence    DECIMAL(5,4) NOT NULL,
  resolved_by   VARCHAR(30) NOT NULL,
  origin_event_id UUID REFERENCES evidence_events(id)
);

CREATE TABLE identity_signal_links (
  identity_id      UUID NOT NULL REFERENCES identities(id),
  signal_id        UUID NOT NULL REFERENCES identity_signals(id),
  contribution     DECIMAL(5,4) NOT NULL,
  normalized_value TEXT,
  normalizer_used  VARCHAR(50),
  PRIMARY KEY (identity_id, signal_id)
);

-- =============================================================================
-- SHIPMENT DOMAIN — PROJECTIONS
-- =============================================================================

CREATE TABLE parties (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL,
  party_type VARCHAR(30),
  name       VARCHAR(500),
  identity_id UUID REFERENCES identities(id),
  address    TEXT,
  country    VARCHAR(100),
  tax_id     VARCHAR(100)
);

CREATE TABLE shipments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL,
  shipment_number       VARCHAR(100),
  bc_type               VARCHAR(20),

  -- Full state machine (v2.0 — replaces old 4-state enum)
  status                VARCHAR(30) DEFAULT 'DRAFT',
  -- DRAFT | UNDER_REVIEW | READY_FOR_CEISA | SUBMITTED | SPPB | CLOSED

  health                VARCHAR(20) DEFAULT 'HEALTHY',
  -- HEALTHY | NEEDS_ATTENTION | CRITICAL

  -- Scoring
  ceisa_readiness_score INT DEFAULT 0,
  identity_id           UUID REFERENCES identities(id),

  -- Parties
  party_from_id         UUID REFERENCES parties(id),
  party_to_id           UUID REFERENCES parties(id),

  -- Event sourcing links
  origin_event_id       UUID REFERENCES evidence_events(id),
  last_event_id         UUID REFERENCES evidence_events(id),
  last_event_seq        BIGINT,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- UPLOAD DOMAIN — PROJECTIONS
-- =============================================================================

CREATE TABLE upload_sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  created_by         VARCHAR(255),
  status             VARCHAR(20) DEFAULT 'STAGING',
  -- STAGING | ANALYZING | PREVIEWED | COMMITTED | CANCELLED
  s3_staging_prefix  VARCHAR(500),
  expires_at         TIMESTAMPTZ,
  summary            JSONB,
  committed_at       TIMESTAMPTZ,
  origin_event_id    UUID REFERENCES evidence_events(id),
  last_event_id      UUID REFERENCES evidence_events(id),
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE upload_session_files (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id           UUID REFERENCES upload_sessions(id),
  original_filename    VARCHAR(500),
  s3_staging_key       VARCHAR(500),
  file_size_bytes      BIGINT,
  detected_type        VARCHAR(100),
  detected_category    VARCHAR(30),
  matched_shipment_id  UUID REFERENCES shipments(id),
  match_confidence     DECIMAL(5,4),
  confidence_tier      VARCHAR(20),
  -- AUTO_ATTACH | SUGGEST | MANUAL_REVIEW | NEW_SHIPMENT | DUPLICATE
  action               VARCHAR(30),
  is_duplicate_of      UUID,
  user_override        BOOLEAN DEFAULT false,
  committed_document_id UUID REFERENCES documents(id),
  analysis_detail      JSONB,
  origin_event_id      UUID REFERENCES evidence_events(id)
);

-- =============================================================================
-- REASONING ENGINE — PROJECTIONS
-- =============================================================================

CREATE TABLE reasoning_results (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL,
  shipment_id           UUID REFERENCES shipments(id),
  trigger_document_id   UUID REFERENCES documents(id),
  trigger_event_id      UUID REFERENCES evidence_events(id),
  trigger_type          VARCHAR(30),
  -- NEW_DOC | REVISION | REPLACEMENT | CONFLICT
  impact_level          VARCHAR(10) NOT NULL,
  -- NONE | LOW | MEDIUM | HIGH
  changed_fields        JSONB,
  affected_declarations JSONB,
  reasoning             TEXT,
  recommended_actions   JSONB,
  requires_action       BOOLEAN DEFAULT false,
  action_taken          VARCHAR(50),
  resolved_by           VARCHAR(255),
  resolved_at           TIMESTAMPTZ,
  origin_event_id       UUID REFERENCES evidence_events(id),
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- PROJECTION TRACKING
-- Tracks which sequence_num each projector has consumed.
-- On restart: read last_processed_seq, replay from there.
-- On full rebuild: reset to 0, replay all events.
-- =============================================================================

CREATE TABLE projection_checkpoints (
  projection_name         VARCHAR(100) PRIMARY KEY,
  last_processed_seq      BIGINT NOT NULL DEFAULT 0,
  last_processed_event_id UUID REFERENCES evidence_events(id),
  last_processed_at       TIMESTAMPTZ,
  status                  VARCHAR(20) DEFAULT 'ACTIVE'
  -- ACTIVE | REBUILDING | FAILED
);

INSERT INTO projection_checkpoints (projection_name) VALUES
  ('documents'),
  ('ctdm_fields'),
  ('identity_signals'),
  ('identities'),
  ('identity_links'),
  ('shipments'),
  ('upload_sessions'),
  ('reasoning_results');

-- =============================================================================
-- SUPPORTING TABLES (not projections — own lifecycle)
-- =============================================================================

CREATE TABLE validation_errors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  shipment_id     UUID REFERENCES shipments(id),
  document_id_a   UUID REFERENCES documents(id),
  document_id_b   UUID REFERENCES documents(id),
  field_key       VARCHAR(100),
  expected_value  TEXT,
  actual_value    TEXT,
  reference_type  VARCHAR(100),
  resolved        BOOLEAN DEFAULT false,
  resolved_by     VARCHAR(255),
  resolved_at     TIMESTAMPTZ,
  origin_event_id UUID REFERENCES evidence_events(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE business_validation_results (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  shipment_id     UUID REFERENCES shipments(id),
  document_id     UUID REFERENCES documents(id),
  rule_type       VARCHAR(100),
  field_key       VARCHAR(100),
  message         TEXT,
  passed          BOOLEAN DEFAULT false,
  origin_event_id UUID REFERENCES evidence_events(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE learning_corrections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  document_type   VARCHAR(100),
  field_key       VARCHAR(100),
  wrong_value     TEXT,
  correct_value   TEXT,
  correction_source VARCHAR(30),
  origin_event_id UUID REFERENCES evidence_events(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- Document category metadata (config-driven, seeded from YAML)
-- =============================================================================

CREATE TABLE document_categories (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 VARCHAR(30) UNIQUE NOT NULL,
  label                VARCHAR(100) NOT NULL,
  affects_customs      BOOLEAN DEFAULT false,
  affects_inventory    BOOLEAN DEFAULT false,
  affects_declaration  BOOLEAN DEFAULT false,
  lock_policy          VARCHAR(30) NOT NULL,
  -- LOCK_ON_SUBMITTED | LOCK_ON_READY | ALWAYS_OPEN
  document_types       TEXT[],
  sort_order           INT
);

INSERT INTO document_categories (code, label, affects_customs, affects_inventory, affects_declaration, lock_policy, document_types, sort_order) VALUES
('COMMERCIAL', 'Commercial Documents',   true,  true,  true,  'LOCK_ON_SUBMITTED', ARRAY['Invoice','Packing List','Purchase Order','Proforma Invoice'], 1),
('TRANSPORT',  'Transport Documents',    true,  false, true,  'LOCK_ON_SUBMITTED', ARRAY['Bill of Lading','Airway Bill','Manifest','Sea Waybill'], 2),
('CUSTOMS',    'Customs Documents',      true,  false, true,  'LOCK_ON_SUBMITTED', ARRAY['PIB','BC 2.3','BC 2.0','Letter of Guarantee','SPPB'], 3),
('COMPLIANCE', 'Compliance Documents',   false, false, false, 'LOCK_ON_READY',     ARRAY['Certificate of Origin','Health Certificate','Phytosanitary','MSDS'], 4),
('SUPPORTING', 'Supporting Documents',   false, false, false, 'ALWAYS_OPEN',       ARRAY['Insurance','Test Report','Photo','Weight Certificate'], 5),
('INTERNAL',   'Internal Documents',     false, false, false, 'ALWAYS_OPEN',       ARRAY['Email','Memo','Internal Note','Meeting Minutes'], 6);


-- =============================================================================
-- ADMIN / CONFIGURATION DOMAIN
-- Rule #4: semua business rule di config, bukan hardcode.
-- Setiap perubahan config → evidence_events (CONFIG_CHANGED).
-- YAML files = system default. Tabel ini = per-tenant override.
-- =============================================================================

-- AI Engine config per tenant (Addendum F — Technical Debt resolved)
CREATE TABLE tenant_ai_config (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID REFERENCES tenants(id) UNIQUE,
  bedrock_model_id VARCHAR(100) DEFAULT 'apac.anthropic.claude-sonnet-4-20250514-v1:0',
  max_tokens       INT DEFAULT 4096,
  temperature      DECIMAL(3,2) DEFAULT 0.1,
  -- Confidence thresholds (Addendum E)
  threshold_auto_approved DECIMAL(4,3) DEFAULT 0.850,
  threshold_recommended   DECIMAL(4,3) DEFAULT 0.700,
  -- below threshold_recommended = REVIEW_REQUIRED
  ceisa_mode       VARCHAR(10) DEFAULT 'mock',   -- mock | live
  ceisa_endpoint   TEXT,
  ceisa_api_key    TEXT,                          -- encrypted at rest
  -- Sprint 4: Extraction Engine config (Rule #4 — config-driven)
  extraction_approach    VARCHAR(30) DEFAULT 'bedrock_vision',  -- bedrock_vision | hybrid_textract | textract_only
  extraction_model_id    VARCHAR(100) DEFAULT 'apac.anthropic.claude-sonnet-4-20250514-v1:0',
  extraction_max_tokens  INT DEFAULT 4096,
  extraction_max_pages   INT DEFAULT 20,
  source_resolution_mode VARCHAR(30) DEFAULT 'confidence_weighted',
  conflict_auto_resolve_threshold DECIMAL(4,3) DEFAULT 0.900,
  identity_signals_active JSONB DEFAULT '["INVOICE_NUMBER","BL_NUMBER","PO_NUMBER","CONTAINER_NUMBER"]',
  pipeline_timeout_seconds INT DEFAULT 120,
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  last_event_id    UUID REFERENCES evidence_events(id)
);

-- Signal weights per tenant (override dari signal-weights.yaml)
-- Doc type configuration per tenant (Rule #4 — config-driven, Sprint 4)
CREATE TABLE tenant_doc_type_config (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID REFERENCES tenants(id),
  doc_type_code            VARCHAR(30) NOT NULL,   -- COMMERCIAL_INVOICE, BC_2_3, dll
  display_name             VARCHAR(100),
  is_enabled               BOOLEAN DEFAULT true,
  category                 VARCHAR(20),             -- COMMERCIAL/TRANSPORT/CUSTOMS/SUPPORTING
  classification_hints     TEXT[],                  -- keyword AI pakai untuk detect tipe
  extraction_prompt_override TEXT,                  -- NULL = auto-generate dari field list
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, doc_type_code)
);

-- Field configuration per doc type per tenant (Sprint 4)
CREATE TABLE tenant_doc_field_config (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID REFERENCES tenants(id),
  doc_type_code         VARCHAR(30) NOT NULL,
  field_key             VARCHAR(60) NOT NULL,
  display_name          VARCHAR(100),               -- label UI Bahasa Indonesia
  is_enabled            BOOLEAN DEFAULT true,
  is_mandatory          BOOLEAN DEFAULT false,       -- mandatory untuk ekstraksi
  is_mandatory_ceisa    BOOLEAN DEFAULT false,       -- mandatory untuk submit CEISA
  ceisa_field_ref       VARCHAR(20),                -- e.g. "field_16", "field_20"
  confidence_threshold  DECIMAL(4,3),               -- NULL = pakai tenant default
  validation_regex      TEXT,                        -- optional format validation
  sort_order            INT DEFAULT 0,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, doc_type_code, field_key)
);

CREATE TABLE tenant_signal_weights (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID REFERENCES tenants(id),
  signal_type VARCHAR(30) NOT NULL,
  weight      DECIMAL(5,4) NOT NULL,
  normalizer  VARCHAR(30) NOT NULL,
  match_strategy VARCHAR(30) NOT NULL,
  fuzzy_threshold DECIMAL(4,3),
  tolerance_pct   DECIMAL(4,3),
  tolerance_days  INT,
  min_confidence_to_include DECIMAL(4,3) NOT NULL,
  is_active   BOOLEAN DEFAULT true,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  last_event_id UUID REFERENCES evidence_events(id),
  UNIQUE(tenant_id, signal_type)
);

-- Confidence tiers per tenant
CREATE TABLE tenant_confidence_tiers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID REFERENCES tenants(id),
  tier_name      VARCHAR(30) NOT NULL,  -- AUTO_ATTACH | SUGGEST | MANUAL_REVIEW | NEW_SHIPMENT
  min_score      DECIMAL(5,4),
  max_score      DECIMAL(5,4),
  requires_user_action BOOLEAN DEFAULT false,
  is_active      BOOLEAN DEFAULT true,
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, tier_name)
);

-- Validation rules per tenant (Rule #4 — config-driven)
CREATE TABLE tenant_validation_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID REFERENCES tenants(id),
  rule_code       VARCHAR(50) NOT NULL,
  rule_type       VARCHAR(30) NOT NULL,  -- FORMAT | RANGE | REQUIRED | CROSS_DOC | CUSTOM
  field_key       VARCHAR(100),
  description     TEXT,
  config          JSONB NOT NULL DEFAULT '{}',
  -- FORMAT: { "pattern": "\\d{8}", "message": "HS Code harus 8 digit" }
  -- RANGE:  { "min": 0, "max": 999999999, "message": "Nilai tidak valid" }
  -- REQUIRED: { "bc_types": ["BC_2_3"], "message": "Field wajib untuk BC 2.3" }
  is_active       BOOLEAN DEFAULT true,
  severity        VARCHAR(10) DEFAULT 'ERROR', -- ERROR | WARNING
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  last_event_id   UUID REFERENCES evidence_events(id),
  UNIQUE(tenant_id, rule_code)
);

-- ERP integration config per tenant (Rule #10)
CREATE TABLE tenant_erp_config (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID REFERENCES tenants(id) UNIQUE,
  erp_type       VARCHAR(30),  -- SAP | ORACLE | DYNAMICS | CUSTOM
  endpoint_url   TEXT,
  auth_type      VARCHAR(20),  -- basic | oauth2 | api_key
  credentials    JSONB,        -- encrypted
  field_mappings JSONB DEFAULT '{}',
  is_active      BOOLEAN DEFAULT false,
  last_sync_at   TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  last_event_id  UUID REFERENCES evidence_events(id)
);

-- BC Type access control per tenant (Addendum B)
CREATE TABLE tenant_bc_access (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  bc_type   VARCHAR(20) NOT NULL,
  -- BC_2_0 | BC_2_3 | BC_2_5 | BC_2_6_1 | BC_2_6_2 | BC_3_0 | BC_4_0 | BC_4_1
  is_enabled BOOLEAN DEFAULT false,
  config     JSONB DEFAULT '{}',  -- BC-specific overrides
  UNIQUE(tenant_id, bc_type)
);

-- Learning corrections log (Rule #9)
-- Already have learning_corrections table — this extends it with approval flow
CREATE TABLE learning_correction_reviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  correction_id   UUID REFERENCES learning_corrections(id) UNIQUE,
  status          VARCHAR(20) DEFAULT 'PENDING', -- PENDING | APPROVED | REJECTED
  reviewed_by     VARCHAR(255),
  reviewed_at     TIMESTAMPTZ,
  notes           TEXT,
  origin_event_id UUID REFERENCES evidence_events(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default AI config for USG tenant (will be set after seeding)
-- Inserted in seed-data-v2, not here.

-- Update projection_checkpoints for new tables
INSERT INTO projection_checkpoints (projection_name) VALUES
  ('tenant_ai_config'),
  ('tenant_doc_type_config'),
  ('tenant_doc_field_config'),
  ('tenant_signal_weights'),
  ('tenant_validation_rules')
ON CONFLICT (projection_name) DO NOTHING;

