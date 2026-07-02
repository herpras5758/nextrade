-- ============================================================
-- Ship-X v2 Schema
-- ADR-009: Graph owned by Resolution Engine
-- ADR-010: Incremental resolution on connected components only
-- ADR-011: Document relationships through entities, not direct edges
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ── Tenants ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          VARCHAR(20) UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  config        JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Evidence Events (Immutable Audit Log) ────────────────────
CREATE TABLE IF NOT EXISTS evidence_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  event_type    VARCHAR(60) NOT NULL,
  actor_type    VARCHAR(20) NOT NULL DEFAULT 'system',
  actor_id      VARCHAR(255),
  entity_type   VARCHAR(30),
  entity_id     UUID,
  payload       JSONB,
  sequence_num  BIGSERIAL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_events_tenant ON evidence_events(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_entity ON evidence_events(entity_type, entity_id);

-- ════════════════════════════════════════════════════════════
-- LAYER 1: DOCUMENT REGISTRY
-- Single source of truth. Documents never duplicated.
-- Handles: single doc, multi-doc PDF (split children), mass upload
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS documents (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id),

  -- File identity
  file_name             VARCHAR(500) NOT NULL,
  s3_key                VARCHAR(500) NOT NULL,
  file_hash             VARCHAR(64),      -- SHA256 hex, dedup guard
  file_size_bytes       BIGINT,
  mime_type             VARCHAR(50),

  -- Multi-doc split support (Scenario B: 1 PDF = multiple doc types)
  parent_document_id    UUID REFERENCES documents(id),
  page_range_start      INT,    -- which pages this segment covers
  page_range_end        INT,
  is_split_child        BOOLEAN DEFAULT false,

  -- Lifecycle:
  -- uploaded → classifying → classified → extracting → extracted
  -- → normalizing → normalized → linked → archived
  -- Special: split (parent PDF that was split into children)
  --          error (processing failed)
  status                VARCHAR(30) NOT NULL DEFAULT 'uploaded',
  error_message         TEXT,

  -- Classification output
  doc_type              VARCHAR(50),
  doc_type_confidence   DECIMAL(5,4),
  language              VARCHAR(10),

  -- Intake
  intake_source         VARCHAR(30) DEFAULT 'upload',
  uploaded_by           VARCHAR(255),

  -- Processing timestamps
  uploaded_at           TIMESTAMPTZ DEFAULT NOW(),
  classified_at         TIMESTAMPTZ,
  extracted_at          TIMESTAMPTZ,
  normalized_at         TIMESTAMPTZ,
  linked_at             TIMESTAMPTZ,

  last_event_id         UUID REFERENCES evidence_events(id),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_docs_tenant_status ON documents(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_docs_hash ON documents(tenant_id, file_hash) WHERE file_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_docs_type ON documents(tenant_id, doc_type);
CREATE INDEX IF NOT EXISTS idx_docs_parent ON documents(parent_document_id) WHERE parent_document_id IS NOT NULL;

-- ════════════════════════════════════════════════════════════
-- LAYER 2: FIELD EXTRACTIONS
-- All AI-extracted fields per document. Correctable by users.
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS field_extractions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  document_id       UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,

  field_key         VARCHAR(100) NOT NULL,
  raw_value         TEXT,             -- exactly as AI read it
  normalized_value  TEXT,             -- cleaned: UPPER, strip punctuation
  display_value     TEXT,             -- human-friendly format
  confidence        DECIMAL(5,4),
  extraction_model  VARCHAR(100),

  status            VARCHAR(20) DEFAULT 'auto_approved',
  -- auto_approved | review_required | user_verified | user_rejected

  -- User corrections (evidence-based, not graph edits)
  corrected_value   TEXT,
  corrected_by      VARCHAR(255),
  corrected_at      TIMESTAMPTZ,
  correction_reason TEXT,

  last_event_id     UUID REFERENCES evidence_events(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (document_id, field_key)
);
CREATE INDEX IF NOT EXISTS idx_fields_doc ON field_extractions(document_id);
CREATE INDEX IF NOT EXISTS idx_fields_key_val ON field_extractions(tenant_id, field_key, normalized_value);

-- ════════════════════════════════════════════════════════════
-- LAYER 3: KNOWLEDGE GRAPH
-- Multi-layer: Document Layer + Entity Layer + Semantic Relations
-- ADR-011: No direct doc-to-doc edges. Relationships via shared entities.
-- ════════════════════════════════════════════════════════════

-- Graph Nodes: both DOCUMENT nodes and ENTITY nodes
CREATE TABLE IF NOT EXISTS graph_nodes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),

  node_type         VARCHAR(20) NOT NULL,   -- DOCUMENT | ENTITY

  -- For ENTITY nodes:
  entity_type       VARCHAR(40),
  -- INVOICE_NUMBER | BL_NUMBER | PO_NUMBER | CONTAINER_NUMBER
  -- SUPPLIER | CONSIGNEE | NOTIFY_PARTY | VESSEL
  -- HS_CODE | PORT_LOADING | PORT_DISCHARGE

  canonical_value   TEXT,    -- normalized: UPPER, stripped
  display_value     TEXT,    -- human-friendly, most common form

  -- For DOCUMENT nodes:
  document_id       UUID REFERENCES documents(id) ON DELETE CASCADE,

  observation_count INT DEFAULT 1,    -- how many docs have seen this entity
  confidence        DECIMAL(5,4) DEFAULT 1.0,

  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE NULLS NOT DISTINCT (tenant_id, entity_type, canonical_value)
);
CREATE INDEX IF NOT EXISTS idx_gnodes_tenant ON graph_nodes(tenant_id, node_type);
CREATE INDEX IF NOT EXISTS idx_gnodes_entity ON graph_nodes(tenant_id, entity_type, canonical_value);
CREATE INDEX IF NOT EXISTS idx_gnodes_doc ON graph_nodes(document_id) WHERE document_id IS NOT NULL;

-- Graph Edges (multi-layer)
-- Layer A: DOCUMENT_NODE --[HAS_*]--> ENTITY_NODE  (from AI extraction)
-- Layer B: ENTITY_NODE --[RELATED_TO]--> ENTITY_NODE  (semantic, e.g. BL refs Invoice)
CREATE TABLE IF NOT EXISTS graph_edges (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),

  source_node_id    UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  target_node_id    UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,

  edge_type         VARCHAR(50) NOT NULL,
  -- Layer A (Document → Entity):
  --   HAS_INVOICE_NUMBER | HAS_BL_NUMBER | HAS_PO_NUMBER | HAS_CONTAINER
  --   HAS_SUPPLIER | HAS_CONSIGNEE | HAS_NOTIFY_PARTY | HAS_VESSEL
  --   HAS_HS_CODE | HAS_PORT_LOADING | HAS_PORT_DISCHARGE
  -- Layer B (Entity → Entity):
  --   REFERENCES_PO | LOADED_ON | SHIPPED_BY | CONSIGNED_TO

  confidence        DECIMAL(5,4) NOT NULL DEFAULT 1.0,
  weight            DECIMAL(5,4) DEFAULT 1.0,  -- from tenant_matching_rules
  field_key         VARCHAR(100),
  raw_value         TEXT,

  created_by        VARCHAR(20) DEFAULT 'ai',  -- ai | system | human_evidence
  evidence_event_id UUID REFERENCES evidence_events(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (source_node_id, target_node_id, edge_type)
);
CREATE INDEX IF NOT EXISTS idx_gedges_source ON graph_edges(source_node_id);
CREATE INDEX IF NOT EXISTS idx_gedges_target ON graph_edges(target_node_id);
CREATE INDEX IF NOT EXISTS idx_gedges_tenant ON graph_edges(tenant_id, edge_type);

-- Entity Observations: which document saw which entity (full audit trail)
CREATE TABLE IF NOT EXISTS entity_observations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  document_id       UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  entity_node_id    UUID NOT NULL REFERENCES graph_nodes(id),
  field_key         VARCHAR(100),
  raw_value         TEXT,
  normalized_value  TEXT,
  confidence        DECIMAL(5,4),
  observed_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (document_id, entity_node_id, field_key)
);
CREATE INDEX IF NOT EXISTS idx_obs_doc ON entity_observations(document_id);
CREATE INDEX IF NOT EXISTS idx_obs_entity ON entity_observations(entity_node_id);

-- ════════════════════════════════════════════════════════════
-- LAYER 4: SHIPMENT RESOLUTION ENGINE
-- ADR-009: Graph owned by Resolution Engine
-- ADR-010: Incremental resolution on connected components
-- ════════════════════════════════════════════════════════════

-- A resolution = one connected component in the knowledge graph
CREATE TABLE IF NOT EXISTS resolutions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id),

  -- Component fingerprint: SHA256 of sorted document IDs
  -- Changes whenever documents are added or removed
  component_hash        VARCHAR(64),

  -- Status
  status                VARCHAR(30) DEFAULT 'candidate',
  -- candidate  → just created, low confidence
  -- partial    → some expected docs present
  -- matched    → all key docs present, confidence high
  -- verified   → human approved → promotes to shipment

  -- Confidence
  confidence_score      DECIMAL(5,4) DEFAULT 0,
  confidence_breakdown  JSONB DEFAULT '{}',
  -- { "INVOICE_NUMBER": 0.97, "BL_NUMBER": 0.99, "SUPPLIER": 0.85 }

  -- Document completeness analysis
  expected_doc_types    TEXT[] DEFAULT '{}',
  found_doc_types       TEXT[] DEFAULT '{}',
  missing_doc_types     TEXT[] DEFAULT '{}',

  -- Key identifiers (denormalized for fast dashboard queries)
  invoice_numbers       TEXT[] DEFAULT '{}',
  bl_numbers            TEXT[] DEFAULT '{}',
  po_numbers            TEXT[] DEFAULT '{}',
  vessel_names          TEXT[] DEFAULT '{}',
  container_numbers     TEXT[] DEFAULT '{}',

  -- Human approval
  human_approved_by     VARCHAR(255),
  human_approved_at     TIMESTAMPTZ,

  -- Engine metadata
  last_calculated_at    TIMESTAMPTZ,
  trigger_document_id   UUID REFERENCES documents(id),
  calculation_ms        INT,

  last_event_id         UUID REFERENCES evidence_events(id),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_res_tenant ON resolutions(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_res_hash ON resolutions(tenant_id, component_hash);
CREATE INDEX IF NOT EXISTS idx_res_invoice ON resolutions USING GIN(invoice_numbers);
CREATE INDEX IF NOT EXISTS idx_res_bl ON resolutions USING GIN(bl_numbers);

-- Documents in a resolution (computed by engine, NEVER asserted by user)
CREATE TABLE IF NOT EXISTS resolution_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resolution_id   UUID NOT NULL REFERENCES resolutions(id) ON DELETE CASCADE,
  document_id     UUID NOT NULL REFERENCES documents(id),
  tenant_id       UUID NOT NULL,
  doc_role        VARCHAR(50),   -- PRIMARY_INVOICE | PACKING_LIST | BILL_OF_LADING | etc
  added_reason    TEXT,          -- which shared entity caused this grouping
  confidence      DECIMAL(5,4),
  added_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (resolution_id, document_id)
);
CREATE INDEX IF NOT EXISTS idx_resdoc_res ON resolution_documents(resolution_id);
CREATE INDEX IF NOT EXISTS idx_resdoc_doc ON resolution_documents(document_id);

-- Immutable resolution decision log
CREATE TABLE IF NOT EXISTS resolution_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id),
  resolution_id         UUID NOT NULL REFERENCES resolutions(id),
  event_type            VARCHAR(50) NOT NULL,
  -- RESOLUTION_CREATED | DOCUMENT_ADDED | DOCUMENT_REMOVED
  -- CONFIDENCE_UPDATED | STATUS_CHANGED
  -- HUMAN_EVIDENCE_APPLIED | FORCE_RECALCULATED
  -- COMPONENT_MERGED | COMPONENT_SPLIT
  trigger_document_id   UUID REFERENCES documents(id),
  confidence_before     DECIMAL(5,4),
  confidence_after      DECIMAL(5,4),
  documents_before      TEXT,   -- JSON array
  documents_after       TEXT,   -- JSON array
  shared_entities       TEXT,   -- which entities caused the grouping
  reason                TEXT,
  payload               JSONB,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_resev_res ON resolution_events(resolution_id);

-- Human Evidence (ADR-009: users provide facts, not graph edits)
CREATE TABLE IF NOT EXISTS human_evidence (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id),
  resolution_id         UUID REFERENCES resolutions(id),
  document_id           UUID REFERENCES documents(id),

  evidence_type         VARCHAR(50) NOT NULL,
  -- DOCUMENT_BELONGS_HERE          → doc should be in this resolution
  -- DOCUMENT_DOES_NOT_BELONG       → doc should NOT be here
  -- FIELD_VALUE_INCORRECT          → AI extracted wrong value
  -- DOCUMENTS_ARE_RELATED          → these docs are for same shipment
  -- DOCUMENTS_ARE_NOT_RELATED      → these docs are NOT for same shipment

  payload               JSONB NOT NULL DEFAULT '{}',

  submitted_by          VARCHAR(255) NOT NULL,
  submitted_at          TIMESTAMPTZ DEFAULT NOW(),
  processed_at          TIMESTAMPTZ,       -- when engine applied this
  resolution_event_id   UUID REFERENCES resolution_events(id)
);
CREATE INDEX IF NOT EXISTS idx_hev_res ON human_evidence(resolution_id);
CREATE INDEX IF NOT EXISTS idx_hev_pending ON human_evidence(tenant_id) WHERE processed_at IS NULL;

-- ════════════════════════════════════════════════════════════
-- LAYER 5: SHIPMENT (Business Object)
-- Only created when resolution is verified by human.
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS shipments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id),
  resolution_id         UUID NOT NULL REFERENCES resolutions(id),
  shipment_number       VARCHAR(50) UNIQUE,  -- SHP-2026-0001

  status                VARCHAR(30) DEFAULT 'verified',
  -- verified → ready_ceisa → submitted → sppb → closed

  health                VARCHAR(20) DEFAULT 'healthy',
  ceisa_readiness_score INT DEFAULT 0,

  nomor_bc              TEXT,
  nomor_sppb            TEXT,
  submitted_at          TIMESTAMPTZ,
  sppb_received_at      TIMESTAMPTZ,

  last_event_id         UUID REFERENCES evidence_events(id),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ship_tenant ON shipments(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_ship_res ON shipments(resolution_id);

-- Immutable snapshots for auditability
CREATE TABLE IF NOT EXISTS shipment_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id     UUID NOT NULL REFERENCES shipments(id),
  tenant_id       UUID NOT NULL,
  trigger_event   VARCHAR(50),
  snapshot        JSONB NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- CEISA declarations
CREATE TABLE IF NOT EXISTS customs_declarations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  shipment_id     UUID NOT NULL REFERENCES shipments(id),
  bc_type         VARCHAR(20) DEFAULT 'BC_2_3',
  payload         JSONB,
  status          VARCHAR(30) DEFAULT 'draft',
  ceisa_mode      VARCHAR(10) DEFAULT 'mock',
  nomor_aju       TEXT,
  nomor_bc        TEXT,
  tanggal_bc      DATE,
  submitted_at    TIMESTAMPTZ,
  response_raw    JSONB,
  last_event_id   UUID REFERENCES evidence_events(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════
-- CONFIGURATION (everything configurable, no hardcode)
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS tenant_ai_config (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID UNIQUE NOT NULL REFERENCES tenants(id),
  ai_provider               VARCHAR(20) DEFAULT 'anthropic',
  anthropic_api_key         TEXT,
  openai_api_key            TEXT,
  extraction_model_id       VARCHAR(100) DEFAULT 'claude-sonnet-4-6',
  extraction_max_tokens     INT DEFAULT 4096,
  classification_model_id   VARCHAR(100) DEFAULT 'claude-sonnet-4-6',
  threshold_auto_approved   DECIMAL(5,4) DEFAULT 0.85,
  threshold_review_required DECIMAL(5,4) DEFAULT 0.70,
  ceisa_mode                VARCHAR(10) DEFAULT 'mock',
  ceisa_endpoint            TEXT,
  ceisa_api_key             TEXT,
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_doc_type_config (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id),
  doc_type_code         VARCHAR(50) NOT NULL,
  display_name          TEXT NOT NULL,
  category              VARCHAR(30),
  classification_hints  TEXT[],
  extraction_prompt     TEXT,
  is_enabled            BOOLEAN DEFAULT true,
  sort_order            INT DEFAULT 0,
  UNIQUE (tenant_id, doc_type_code)
);

CREATE TABLE IF NOT EXISTS tenant_field_config (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id),
  doc_type_code         VARCHAR(50) NOT NULL,
  field_key             VARCHAR(100) NOT NULL,
  display_name          TEXT NOT NULL,
  is_mandatory          BOOLEAN DEFAULT false,
  is_mandatory_ceisa    BOOLEAN DEFAULT false,
  ceisa_field_ref       VARCHAR(50),
  confidence_threshold  DECIMAL(5,4) DEFAULT 0.70,
  -- Graph config: does this field feed the knowledge graph?
  is_graph_signal       BOOLEAN DEFAULT false,
  graph_entity_type     VARCHAR(40),
  -- INVOICE_NUMBER | BL_NUMBER | PO_NUMBER | SUPPLIER | CONSIGNEE
  -- VESSEL | CONTAINER | HS_CODE | PORT_LOADING | PORT_DISCHARGE
  sort_order            INT DEFAULT 0,
  is_enabled            BOOLEAN DEFAULT true,
  UNIQUE (tenant_id, doc_type_code, field_key)
);

-- Entity matching weights (ADR-010: configurable, not hardcoded)
CREATE TABLE IF NOT EXISTS tenant_matching_rules (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  entity_type       VARCHAR(40) NOT NULL,
  weight            DECIMAL(5,4) DEFAULT 0.5,
  is_required       BOOLEAN DEFAULT false,
  min_confidence    DECIMAL(5,4) DEFAULT 0.70,
  description       TEXT,
  is_enabled        BOOLEAN DEFAULT true,
  UNIQUE (tenant_id, entity_type)
);

-- Sequence for shipment numbers
CREATE SEQUENCE IF NOT EXISTS shipment_seq START 1;
