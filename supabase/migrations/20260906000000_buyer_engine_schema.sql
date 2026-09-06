-- GrowthForge Buyer Intelligence Engine - Initial Schema Migration
-- Authoritative PostgreSQL / Supabase Schema for Buyer Engine

-- 1. Leads Table (Core Lead Dossier)
CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id VARCHAR(64) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL DEFAULT '',
    phone VARCHAR(32) NOT NULL DEFAULT '',
    email VARCHAR(255) NOT NULL DEFAULT '',
    location VARCHAR(255) NOT NULL DEFAULT '',
    residence VARCHAR(255) NOT NULL DEFAULT '',
    profession VARCHAR(255) NOT NULL DEFAULT '',
    company VARCHAR(255) NOT NULL DEFAULT '',
    workflow_status VARCHAR(64) NOT NULL DEFAULT 'RAW',
    last_event TEXT NOT NULL DEFAULT 'Lead Created',
    consent_status VARCHAR(64) NOT NULL DEFAULT 'PENDING',
    consent_source VARCHAR(255) NOT NULL DEFAULT 'SYSTEM',
    consent_timestamp TIMESTAMPTZ,
    provenance_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Lead Enrichment (Scout & OSINT enrichment results)
CREATE TABLE IF NOT EXISTS lead_enrichment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id VARCHAR(64) NOT NULL REFERENCES leads(lead_id) ON DELETE CASCADE,
    provider VARCHAR(64) NOT NULL DEFAULT 'scout',
    status VARCHAR(64) NOT NULL DEFAULT 'pending',
    scout_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    enriched_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
    confidence_score NUMERIC(4, 3) NOT NULL DEFAULT 0.0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Calls (Voice Telephony Qualification Sessions)
CREATE TABLE IF NOT EXISTS calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id VARCHAR(64) NOT NULL REFERENCES leads(lead_id) ON DELETE CASCADE,
    call_provider VARCHAR(64) NOT NULL,
    external_call_id VARCHAR(128) NOT NULL,
    status VARCHAR(64) NOT NULL DEFAULT 'initiated',
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    recording_url TEXT,
    transcript_text TEXT,
    transcript_json JSONB,
    initiated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- 4. Buyer Profiles (Structured Buyer Intent Facts)
CREATE TABLE IF NOT EXISTS buyer_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id VARCHAR(64) UNIQUE NOT NULL REFERENCES leads(lead_id) ON DELETE CASCADE,
    interested BOOLEAN NOT NULL DEFAULT true,
    property_type VARCHAR(128) NOT NULL DEFAULT '',
    configuration VARCHAR(128) NOT NULL DEFAULT '',
    purpose VARCHAR(128) NOT NULL DEFAULT 'Self-use',
    budget_min NUMERIC(15, 2),
    budget_max NUMERIC(15, 2),
    currency VARCHAR(16) NOT NULL DEFAULT 'INR',
    timeline VARCHAR(128) NOT NULL DEFAULT '',
    financing VARCHAR(128) NOT NULL DEFAULT '',
    decision_maker BOOLEAN,
    qualification_level VARCHAR(64) NOT NULL DEFAULT 'PENDING',
    intent_score INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Buyer Preferences (Location & Custom requirements)
CREATE TABLE IF NOT EXISTS buyer_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id VARCHAR(64) UNIQUE NOT NULL REFERENCES leads(lead_id) ON DELETE CASCADE,
    preferred_locations TEXT[] NOT NULL DEFAULT '{}',
    requirements TEXT[] NOT NULL DEFAULT '{}',
    preferences TEXT[] NOT NULL DEFAULT '{}',
    preferred_project_id VARCHAR(64),
    preferred_project_basis TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Projects (Controlled Inventory Catalog)
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_code VARCHAR(64) UNIQUE NOT NULL,
    project_name VARCHAR(255) NOT NULL,
    developer_name VARCHAR(255) NOT NULL,
    city VARCHAR(128) NOT NULL,
    locality VARCHAR(128) NOT NULL,
    property_types TEXT[] NOT NULL DEFAULT '{}',
    configurations TEXT[] NOT NULL DEFAULT '{}',
    price_min NUMERIC(15, 2) NOT NULL DEFAULT 0,
    price_max NUMERIC(15, 2) NOT NULL DEFAULT 0,
    possession VARCHAR(128) NOT NULL DEFAULT '',
    features TEXT[] NOT NULL DEFAULT '{}',
    project_url TEXT NOT NULL DEFAULT '',
    status VARCHAR(64) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Project Matches (Algorithmic match scores)
CREATE TABLE IF NOT EXISTS project_matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id VARCHAR(64) NOT NULL REFERENCES leads(lead_id) ON DELETE CASCADE,
    project_id VARCHAR(64) NOT NULL,
    match_score NUMERIC(5, 2) NOT NULL,
    budget_score NUMERIC(5, 2) NOT NULL,
    location_score NUMERIC(5, 2) NOT NULL,
    configuration_score NUMERIC(5, 2) NOT NULL,
    reason_summary TEXT NOT NULL DEFAULT '',
    dimension_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
    buyer_confirmed BOOLEAN NOT NULL DEFAULT false,
    matched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Buyer Scores (Multi-dimensional scoring results)
CREATE TABLE IF NOT EXISTS buyer_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id VARCHAR(64) NOT NULL REFERENCES leads(lead_id) ON DELETE CASCADE,
    intent_score INTEGER NOT NULL,
    confidence NUMERIC(4, 3) NOT NULL,
    score_band VARCHAR(64) NOT NULL,
    dimension_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Lead Events (Immutable Audit Log)
CREATE TABLE IF NOT EXISTS lead_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id VARCHAR(64) NOT NULL REFERENCES leads(lead_id) ON DELETE CASCADE,
    event_name VARCHAR(128) NOT NULL,
    from_status VARCHAR(64),
    to_status VARCHAR(64),
    actor VARCHAR(64) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for high-throughput pipeline queries
CREATE INDEX IF NOT EXISTS idx_leads_workflow_status ON leads(workflow_status);
CREATE INDEX IF NOT EXISTS idx_calls_lead_id ON calls(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_events_lead_id ON lead_events(lead_id);
CREATE INDEX IF NOT EXISTS idx_project_matches_lead_id ON project_matches(lead_id);
