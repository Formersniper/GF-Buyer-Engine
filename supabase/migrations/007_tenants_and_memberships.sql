-- GrowthForge Buyer Intelligence Engine
-- Migration: 007_tenants_and_memberships.sql
-- Description: Creates tenants, tenant_memberships, tenant_api_keys, webhook_events, broker_handoffs tables,
--              seeds deterministic default tenant, backfills and propagates tenant_id across all application tables.

-- ==========================================
-- 1. CORE TENANT & MEMBERSHIP TABLES
-- ==========================================

-- Table 1: tenants
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_tenants_updated_at ON tenants;
CREATE TRIGGER trg_tenants_updated_at
    BEFORE UPDATE ON tenants
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Table 2: tenant_memberships
CREATE TABLE IF NOT EXISTS tenant_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (
        role IN ('OWNER','ADMIN','SALES','VIEWER','PLATFORM_ADMIN')
    ),
    is_platform_admin BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_tenant_memberships_tenant_user UNIQUE (tenant_id, user_id)
);

DROP TRIGGER IF EXISTS trg_tenant_memberships_updated_at ON tenant_memberships;
CREATE TRIGGER trg_tenant_memberships_updated_at
    BEFORE UPDATE ON tenant_memberships
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Table 3: tenant_api_keys (Stores hashed API keys only, never plaintext)
CREATE TABLE IF NOT EXISTS tenant_api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    key_hash TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'ADMIN',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ NULL
);

-- Table 4: webhook_events (Tracks received webhooks for idempotency and audit)
CREATE TABLE IF NOT EXISTS webhook_events (
    event_id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL,
    payload_hash TEXT NULL,
    processed_at TIMESTAMPTZ NULL
);

-- Table 5: broker_handoffs (Phase 5F Broker Handoff & CRM Routing)
CREATE TABLE IF NOT EXISTS broker_handoffs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    qualification_id UUID REFERENCES buyer_qualifications(id) ON DELETE CASCADE,
    score_id UUID REFERENCES buyer_scores(id) ON DELETE CASCADE,
    extraction_id UUID REFERENCES conversation_extractions(id) ON DELETE CASCADE,
    transcript_id UUID REFERENCES call_transcripts(id) ON DELETE CASCADE,
    call_id UUID REFERENCES calls(id) ON DELETE CASCADE,
    handoff_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    handoff_status TEXT NOT NULL,
    routing_status TEXT NOT NULL,
    assigned_role TEXT,
    assigned_team TEXT,
    priority_tier TEXT NOT NULL,
    sla_minutes INTEGER NOT NULL,
    sla_deadline TIMESTAMPTZ NOT NULL,
    dispatch_channel TEXT,
    dispatch_status TEXT NOT NULL DEFAULT 'PENDING',
    dispatch_id TEXT,
    handoff_version TEXT NOT NULL DEFAULT '1.0',
    rule_version TEXT NOT NULL DEFAULT '1.0',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_broker_handoffs_updated_at ON broker_handoffs;
CREATE TRIGGER trg_broker_handoffs_updated_at
    BEFORE UPDATE ON broker_handoffs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ==========================================
-- 2. DETERMINISTIC DEFAULT TENANT SEED
-- ==========================================
INSERT INTO tenants (id, name, slug, status)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default GrowthForge Tenant', 'default-growthforge', 'ACTIVE')
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    slug = EXCLUDED.slug,
    status = EXCLUDED.status;

-- ==========================================
-- 3. SAFE TENANT_ID PROPAGATION & BACKFILL
-- ==========================================

-- Step 3.1: Add tenant_id column (with foreign key to tenants table)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE lead_enrichment ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE buyer_profiles ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE buyer_preferences ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE project_matches ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE buyer_scores ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE lead_events ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE call_transcripts ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE conversation_extractions ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE buyer_qualifications ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE broker_handoffs ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

-- Step 3.2: Backfill all existing rows to the default tenant
UPDATE leads SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE lead_enrichment SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE calls SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE buyer_profiles SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE buyer_preferences SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE projects SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE project_matches SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE buyer_scores SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE lead_events SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE call_transcripts SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE conversation_extractions SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE buyer_qualifications SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE broker_handoffs SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;

-- Step 3.3: Strict validation - fail migration if any NULL tenant_id exists
DO $$
DECLARE
    null_count integer;
    tbl text;
    tables text[] := ARRAY[
        'leads', 'lead_enrichment', 'calls', 'buyer_profiles', 'buyer_preferences',
        'projects', 'project_matches', 'buyer_scores', 'lead_events',
        'call_transcripts', 'conversation_extractions', 'buyer_qualifications', 'broker_handoffs'
    ];
BEGIN
    FOREACH tbl IN ARRAY tables LOOP
        EXECUTE format('SELECT count(*) FROM %I WHERE tenant_id IS NULL', tbl) INTO null_count;
        IF null_count > 0 THEN
            RAISE EXCEPTION 'Migration 007 Error: Table % has % NULL tenant_id rows after backfill!', tbl, null_count;
        END IF;
    END LOOP;
END $$;

-- Step 3.4: Enforce NOT NULL constraints
ALTER TABLE leads ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE lead_enrichment ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE calls ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE buyer_profiles ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE buyer_preferences ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE projects ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE project_matches ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE buyer_scores ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE lead_events ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE call_transcripts ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE conversation_extractions ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE buyer_qualifications ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE broker_handoffs ALTER COLUMN tenant_id SET NOT NULL;

-- ==========================================
-- 4. INDEXES
-- ==========================================

-- Core Tenant Model Indexes
CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_tenant_id ON tenant_memberships(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_user_id ON tenant_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_tenant_api_keys_tenant_id ON tenant_api_keys(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_api_keys_key_hash ON tenant_api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_webhook_events_provider ON webhook_events(provider);
CREATE INDEX IF NOT EXISTS idx_webhook_events_status ON webhook_events(status);
CREATE INDEX IF NOT EXISTS idx_webhook_events_received_at ON webhook_events(received_at DESC);

-- Application Table tenant_id Indexes
CREATE INDEX IF NOT EXISTS idx_leads_tenant_id ON leads(tenant_id);
CREATE INDEX IF NOT EXISTS idx_lead_enrichment_tenant_id ON lead_enrichment(tenant_id);
CREATE INDEX IF NOT EXISTS idx_calls_tenant_id ON calls(tenant_id);
CREATE INDEX IF NOT EXISTS idx_buyer_profiles_tenant_id ON buyer_profiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_buyer_preferences_tenant_id ON buyer_preferences(tenant_id);
CREATE INDEX IF NOT EXISTS idx_projects_tenant_id ON projects(tenant_id);
CREATE INDEX IF NOT EXISTS idx_project_matches_tenant_id ON project_matches(tenant_id);
CREATE INDEX IF NOT EXISTS idx_buyer_scores_tenant_id ON buyer_scores(tenant_id);
CREATE INDEX IF NOT EXISTS idx_lead_events_tenant_id ON lead_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_call_transcripts_tenant_id ON call_transcripts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_conversation_extractions_tenant_id ON conversation_extractions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_buyer_qualifications_tenant_id ON buyer_qualifications(tenant_id);
CREATE INDEX IF NOT EXISTS idx_broker_handoffs_tenant_id ON broker_handoffs(tenant_id);

-- Composite query optimization indexes
CREATE INDEX IF NOT EXISTS idx_leads_tenant_status ON leads(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_calls_tenant_lead ON calls(tenant_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_buyer_profiles_tenant_lead ON buyer_profiles(tenant_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_buyer_scores_tenant_lead ON buyer_scores(tenant_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_project_matches_tenant_lead ON project_matches(tenant_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_broker_handoffs_tenant_lead ON broker_handoffs(tenant_id, lead_id);

-- ==========================================
-- 5. ROW-LEVEL SECURITY (RLS)
-- ==========================================
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE broker_handoffs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public access on webhook_events" ON webhook_events FOR ALL USING (true);
