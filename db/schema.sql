-- ============================================================================
-- NexTrade Canonical Trade Data Model (CTDM) — core schema
-- ============================================================================
-- Rule #1 (PROJECT_RULES.md): every source (document, ERP, logistics,
-- customs) is transformed INTO this shape before any business logic touches
-- it. No module reads raw document-specific formats directly.
--
-- This is intentionally normalized around the entities named in the spec:
-- Shipment, Parties, Goods, Commercial, Transport, Customs — plus the
-- supporting tables Source Resolution / Reconciliation / Item Matching /
-- Learning Engine need to do their job (Rules #2, #3, #6, #9).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Multi-tenancy (Rule #7) — every table below carries tenant_id and every
-- query in the application MUST filter by it. Row Level Security is enabled
-- as a second line of defense, not the only one.
-- ---------------------------------------------------------------------------
CREATE TABLE tenants (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code            VARCHAR(20) UNIQUE NOT NULL,
    name            VARCHAR(255) NOT NULL,
    group_name      VARCHAR(255),
    default_language VARCHAR(5) NOT NULL DEFAULT 'id', -- Rule i18n decision
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Parties — suppliers, consignees, subcontractors (BC 2.6.1/2.6.2), etc.
-- ---------------------------------------------------------------------------
CREATE TABLE parties (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    party_type      VARCHAR(30) NOT NULL, -- supplier | consignee | subcontractor | forwarder
    name            VARCHAR(255) NOT NULL,
    npwp            VARCHAR(30),
    address         TEXT,
    country_code    VARCHAR(2),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_parties_tenant ON parties(tenant_id);

-- ---------------------------------------------------------------------------
-- Shipment — the central CTDM aggregate root. Everything else (goods,
-- commercial terms, transport, customs declaration) hangs off a shipment.
-- ---------------------------------------------------------------------------
CREATE TABLE shipments (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id),
    shipment_number     VARCHAR(50) NOT NULL,
    bc_type             VARCHAR(10) NOT NULL, -- BC_2.0, BC_2.3, BC_2.6.1, etc — see bcTypes.ts
    party_from_id       UUID REFERENCES parties(id),
    party_to_id         UUID REFERENCES parties(id),
    status              VARCHAR(30) NOT NULL DEFAULT 'draft', -- draft|pending_review|ready|submitted|cleared
    ceisa_readiness_score INT NOT NULL DEFAULT 0, -- Rule #5, recomputed on every field change
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, shipment_number)
);
CREATE INDEX idx_shipments_tenant_status ON shipments(tenant_id, status);

-- ---------------------------------------------------------------------------
-- Documents — the source artifacts (Invoice, Packing List, BL, etc).
-- This is the entry point of the pipeline; everything downstream is
-- DERIVED from these via the Source Resolution Engine.
-- ---------------------------------------------------------------------------
CREATE TABLE documents (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    shipment_id     UUID REFERENCES shipments(id),
    file_name       VARCHAR(500) NOT NULL,
    s3_key          VARCHAR(1000) NOT NULL,
    document_type   VARCHAR(50) NOT NULL DEFAULT 'UNCLASSIFIED', -- resolved by classifier, never the upload filename
    status          VARCHAR(30) NOT NULL DEFAULT 'pending_upload', -- pending_upload|uploaded|extracting|extracted|needs_review
    -- Source identity (Rule #10 Adapter Pattern, admin-configurable per
    -- Addendum F) — every document MUST declare which intake channel it
    -- came from. Adding a new channel (API, FTP, EDI per the vision
    -- doc's "Supported integration" list) means adding a config entry
    -- in lib/intakeSources.ts, not a new column or new branching logic.
    intake_source   VARCHAR(30) NOT NULL DEFAULT 'manual_upload', -- manual_upload | bulk_upload | email_intake | api | ftp | edi
    intake_metadata JSONB, -- source-specific detail: email -> {senderAddress, subject, messageId}; api -> {apiKeyId}; etc
    -- Client-side grouping hint for bulk/batch uploads where the user
    -- explicitly selected multiple files as "this is one shipment" —
    -- UI-only signal for instant grouping feedback. The Document Linking
    -- Engine's reference-number matching remains the actual source of
    -- truth for which shipment a document belongs to; this column never
    -- overrides that.
    intake_session_id VARCHAR(100),
    uploaded_by     UUID,
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_documents_tenant_shipment ON documents(tenant_id, shipment_id);
CREATE INDEX idx_documents_intake_session ON documents(tenant_id, intake_session_id);
CREATE INDEX idx_documents_intake_source ON documents(tenant_id, intake_source);

-- ---------------------------------------------------------------------------
-- CTDM fields — the canonical, resolved field values for a shipment.
-- Rule #1: business logic reads ONLY from this table, never from
-- per-document extraction directly.
-- ---------------------------------------------------------------------------
CREATE TABLE ctdm_fields (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    shipment_id     UUID NOT NULL REFERENCES shipments(id),
    field_key       VARCHAR(100) NOT NULL, -- e.g. "gross_weight", "invoice_number"
    resolved_value  TEXT,
    confidence      NUMERIC(4,3) NOT NULL, -- 0.000 - 1.000
    status          VARCHAR(20) NOT NULL, -- AUTO_APPROVED | RECOMMENDED | REVIEW_REQUIRED | MANUALLY_RESOLVED
    resolved_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(shipment_id, field_key)
);
CREATE INDEX idx_ctdm_fields_shipment ON ctdm_fields(shipment_id);

-- ---------------------------------------------------------------------------
-- Field sources — every candidate value seen for a CTDM field, from every
-- document, with its own confidence. This IS the Source Resolution Engine's
-- working data (Rule #2) and what powers the Conflict Resolution Dialog.
-- ---------------------------------------------------------------------------
CREATE TABLE ctdm_field_sources (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ctdm_field_id   UUID NOT NULL REFERENCES ctdm_fields(id) ON DELETE CASCADE,
    document_id     UUID NOT NULL REFERENCES documents(id),
    raw_value       TEXT NOT NULL,
    confidence      NUMERIC(4,3) NOT NULL,
    reasoning       TEXT, -- short human-readable explanation from the AI engine
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_field_sources_field ON ctdm_field_sources(ctdm_field_id);

-- ---------------------------------------------------------------------------
-- Items / Goods + Item Matching Engine (Rule #6)
-- ---------------------------------------------------------------------------
CREATE TABLE goods_items (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    shipment_id     UUID NOT NULL REFERENCES shipments(id),
    document_id     UUID REFERENCES documents(id),
    product_code    VARCHAR(100),
    description     TEXT,
    hs_code         VARCHAR(20),
    quantity        NUMERIC(14,3),
    unit            VARCHAR(20),
    unit_value      NUMERIC(16,2),
    currency        VARCHAR(3),
    matched_group_id UUID -- items across documents that the Item Matching
                           -- Engine considers "the same line item" share this
);
CREATE INDEX idx_goods_items_shipment ON goods_items(shipment_id);
CREATE INDEX idx_goods_items_matched_group ON goods_items(matched_group_id);

-- ---------------------------------------------------------------------------
-- BC 2.6.1 / 2.6.2 Subcontracting Reconciliation (PROJECT_RULES.md Addendum B)
-- — separate table because this is a distinct two-party flow, not a CTDM
-- field variation.
-- ---------------------------------------------------------------------------
CREATE TABLE subcontract_reconciliations (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id),
    main_shipment_id    UUID NOT NULL REFERENCES shipments(id),  -- BC 2.6.1 (OUT)
    return_shipment_id  UUID REFERENCES shipments(id),           -- BC 2.6.2 (IN), filled once returned
    main_tpb_party_id   UUID NOT NULL REFERENCES parties(id),
    sub_tpb_party_id    UUID NOT NULL REFERENCES parties(id),
    guarantee_reference VARCHAR(100),
    guarantee_status    VARCHAR(20) NOT NULL DEFAULT 'active', -- active|released
    initial_stock_qty   NUMERIC(14,3),
    output_stock_qty    NUMERIC(14,3),
    waste_qty           NUMERIC(14,3),
    waste_percentage    NUMERIC(5,2),
    status              VARCHAR(30) NOT NULL DEFAULT 'sent', -- sent|in_process|returned|reconciled
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Learning Engine (Rule #9) — every manual correction a user makes is
-- captured here. This table is the training signal for improving future
-- confidence/accuracy; it is never discarded after a single use.
-- ---------------------------------------------------------------------------
CREATE TABLE learning_corrections (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id),
    ctdm_field_id       UUID NOT NULL REFERENCES ctdm_fields(id),
    original_value      TEXT,
    corrected_value     TEXT NOT NULL,
    corrected_by        UUID NOT NULL,
    document_type       VARCHAR(50),
    field_key           VARCHAR(100) NOT NULL,
    corrected_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_learning_field_key ON learning_corrections(field_key, document_type);

-- ---------------------------------------------------------------------------
-- Audit trail — Rule "Audit First" (Enterprise Quality Standards, no
-- exceptions). One append-only table for every mutating action in the
-- system, regardless of module.
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    actor_id        UUID,
    action          VARCHAR(100) NOT NULL,
    entity_type     VARCHAR(50) NOT NULL,
    entity_id       UUID NOT NULL,
    changes         JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_tenant_entity ON audit_log(tenant_id, entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- Document References — Document Linking Engine. Captures the reference
-- numbers that tie separate documents to the same shipment (PO number,
-- Invoice number, BL number, etc), discovered from a real sample
-- shipment: PO 1409443 -> Invoice/PackingList 0126051 -> BL/LOG/Manifest
-- DFS717006813 -> PIB cross-references ALL THREE. Documents arrive
-- separately and must be auto-grouped by these shared numbers, not by a
-- shipment_id assigned manually at upload time.
-- ---------------------------------------------------------------------------
CREATE TABLE document_references (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    document_id     UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    reference_type  VARCHAR(30) NOT NULL, -- po_number | invoice_number | bl_number | manifest_number | guarantee_reference
    reference_value VARCHAR(100) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- The lookup index a new document's linking pass runs against: "has any
-- other document already cited this exact reference number?"
CREATE INDEX idx_document_references_lookup ON document_references(tenant_id, reference_type, reference_value);

-- ---------------------------------------------------------------------------
-- Validation Errors — the Validation Engine. Distinct from the Document
-- Linking Engine above: linking GROUPS documents by matching references;
-- this table records when a document's reference number CONTRADICTS what
-- another document in the same shipment already established. Example
-- from the real intake pattern: Invoice and Packing List both cite
-- 0126051; if a Bill of Lading (or any other document in the same
-- shipment, linked via a different reference like bl_number) carried
-- "0126057" for the same reference_type, that is a mismatch — most OCR
-- products extract the field correctly and stop there; they do not
-- cross-check it against sibling documents the way this table is for.
-- ---------------------------------------------------------------------------
CREATE TABLE validation_errors (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    shipment_id     UUID NOT NULL REFERENCES shipments(id),
    document_id     UUID NOT NULL REFERENCES documents(id),
    error_type      VARCHAR(30) NOT NULL DEFAULT 'REFERENCE_MISMATCH',
    reference_type  VARCHAR(30) NOT NULL, -- po_number | invoice_number | bl_number | manifest_number
    expected_value  VARCHAR(100) NOT NULL, -- value already established for this shipment
    actual_value    VARCHAR(100) NOT NULL, -- conflicting value this document carries
    conflicting_document_id UUID REFERENCES documents(id), -- the earlier document that set expected_value
    status          VARCHAR(20) NOT NULL DEFAULT 'OPEN', -- OPEN | ACKNOWLEDGED | RESOLVED
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_validation_errors_shipment ON validation_errors(shipment_id, status);

-- ---------------------------------------------------------------------------
-- Business Validation Results — IDP Engine module #6 (AI Validation),
-- distinct from ctdm_fields.confidence. A field can be extracted with
-- high confidence and still fail a business rule (e.g. malformed HS
-- code, negative weight, future-dated invoice).
-- ---------------------------------------------------------------------------
CREATE TABLE business_validation_results (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    shipment_id     UUID NOT NULL REFERENCES shipments(id),
    ctdm_field_id   UUID NOT NULL REFERENCES ctdm_fields(id) ON DELETE CASCADE,
    field_key       VARCHAR(100) NOT NULL,
    rule_type       VARCHAR(30) NOT NULL,
    passed          BOOLEAN NOT NULL,
    message         TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_business_validation_shipment ON business_validation_results(shipment_id, passed);

-- ---------------------------------------------------------------------------
-- Tenant AI/Tools Configuration — PROJECT_RULES.md Addendum F. Single
-- source of truth for every "brain" component (AI provider/model, OCR
-- engine, ERP adapter, CEISA endpoint, reconciliation thresholds). Read
-- by the AI Engine Adapter and other config-driven modules at request
-- time — NOT hardcoded in Lambda/ECS environment variables. Editable via
-- a future "AI & Integration Settings" UI page, not redeploy.
--
-- NOTE: wiring this in (replacing DEFAULT_AI_ENGINE_CONFIG and friends
-- with reads from this table) is tracked as open backlog — this table
-- exists now so the schema migration doesn't have to happen later.
-- ---------------------------------------------------------------------------
CREATE TABLE tenant_ai_config (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id),
    config_key          VARCHAR(100) NOT NULL, -- e.g. "ai_engine", "reconciliation_thresholds", "erp_adapter", "ceisa_endpoint"
    config_value        JSONB NOT NULL, -- shape depends on config_key, validated at the API layer before write
    updated_by          UUID,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, config_key)
);

-- ---------------------------------------------------------------------------
-- Email Intake — "no human touch" document intake via registered email
-- address. Security-critical: every inbound email is checked against
-- allowed_senders BEFORE any attachment is trusted into the pipeline —
-- this is the one intake path that bypasses normal authenticated upload,
-- so the allowlist is the entire security boundary protecting it.
-- ---------------------------------------------------------------------------
CREATE TABLE email_intake_config (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) UNIQUE, -- one intake config per tenant
    intake_address  VARCHAR(255) NOT NULL UNIQUE, -- e.g. "intake-pt-ungaran@mail.nextrade.io"
    allowed_senders TEXT[] NOT NULL DEFAULT '{}', -- exact addresses or "@domain.com" wildcard entries
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE email_intake_log (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id),
    sender_address      VARCHAR(255) NOT NULL,
    subject             TEXT,
    received_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    status              VARCHAR(30) NOT NULL, -- ACCEPTED | REJECTED_UNAUTHORIZED_SENDER | REJECTED_NO_ATTACHMENTS | REJECTED_INACTIVE_INTAKE
    attachment_count    INT NOT NULL DEFAULT 0,
    document_ids        UUID[] DEFAULT '{}' -- documents rows created from this email's attachments
);
CREATE INDEX idx_email_intake_log_tenant ON email_intake_log(tenant_id, received_at DESC);

-- ---------------------------------------------------------------------------
-- Row Level Security — second line of defense for Rule #7 multi-tenancy.
-- Application connects with a role that sets app.current_tenant_id per
-- session/request; Postgres enforces isolation even if a query forgets
-- the WHERE tenant_id = ... clause.
-- ---------------------------------------------------------------------------
ALTER TABLE shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE ctdm_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE validation_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_validation_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_ai_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_intake_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_intake_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_shipments ON shipments
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_documents ON documents
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_ctdm_fields ON ctdm_fields
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_goods_items ON goods_items
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_document_references ON document_references
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_validation_errors ON validation_errors
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_business_validation_results ON business_validation_results
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_tenant_ai_config ON tenant_ai_config
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_email_intake_config ON email_intake_config
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_email_intake_log ON email_intake_log
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
