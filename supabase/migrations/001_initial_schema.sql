-- GrowthForge Buyer Intelligence Engine
-- Migration: 001_initial_schema.sql
-- Description: Creates the 9 core tables, constraints, updated_at trigger, indexes, and RLS policies

-- Ensure UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==========================================
-- 1. REUSABLE UPDATED_AT TRIGGER FUNCTION
-- ==========================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ==========================================
-- 2. TABLE DEFINITIONS
-- ==========================================

-- Table 1: leads
CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id TEXT UNIQUE NOT NULL,
    name TEXT,
    phone TEXT,
    email TEXT,
    source TEXT,
    source_reference TEXT,
    status TEXT NOT NULL DEFAULT 'RAW',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table 2: lead_enrichment
CREATE TABLE IF NOT EXISTS lead_enrichment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    platform TEXT,
    username TEXT,
    profile_url TEXT,
    full_name TEXT,
    bio TEXT,
    website TEXT,
    company TEXT,
    location TEXT,
    raw_data JSONB,
    enriched_data JSONB,
    source_confidence NUMERIC,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table 3: calls
CREATE TABLE IF NOT EXISTS calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    provider TEXT,
    provider_call_id TEXT,
    status TEXT,
    attempt_number INTEGER DEFAULT 1,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    duration_seconds INTEGER,
    transcript TEXT,
    recording_url TEXT,
    call_outcome TEXT,
    call_metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table 4: buyer_profiles
CREATE TABLE IF NOT EXISTS buyer_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID UNIQUE NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    property_interest BOOLEAN,
    property_type TEXT,
    configuration TEXT,
    purpose TEXT,
    budget_min NUMERIC,
    budget_max NUMERIC,
    currency TEXT DEFAULT 'INR',
    preferred_locations JSONB,
    timeline TEXT,
    financing TEXT,
    decision_maker BOOLEAN,
    requirements JSONB,
    preferences JSONB,
    qualification_status TEXT,
    intent_score NUMERIC,
    confidence_score NUMERIC,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table 5: buyer_preferences
CREATE TABLE IF NOT EXISTS buyer_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    attribute TEXT NOT NULL,
    value JSONB,
    source TEXT,
    confidence NUMERIC,
    is_explicit BOOLEAN DEFAULT false,
    is_verified BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table 6: projects
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_code TEXT UNIQUE NOT NULL,
    project_name TEXT NOT NULL,
    developer_name TEXT,
    city TEXT,
    locality TEXT,
    micro_market TEXT,
    property_type TEXT,
    configurations JSONB,
    price_min NUMERIC,
    price_max NUMERIC,
    possession TEXT,
    project_description TEXT,
    features JSONB,
    amenities JSONB,
    project_url TEXT,
    status TEXT DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table 7: project_matches
CREATE TABLE IF NOT EXISTS project_matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    match_score NUMERIC,
    budget_score NUMERIC,
    location_score NUMERIC,
    configuration_score NUMERIC,
    purpose_score NUMERIC,
    preference_score NUMERIC,
    timeline_score NUMERIC,
    buyer_confirmed BOOLEAN DEFAULT false,
    reason JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_project_matches_lead_project UNIQUE (lead_id, project_id)
);

-- Table 8: buyer_scores
CREATE TABLE IF NOT EXISTS buyer_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    intent_score NUMERIC,
    budget_score NUMERIC,
    location_score NUMERIC,
    timeline_score NUMERIC,
    decision_score NUMERIC,
    project_fit_score NUMERIC,
    overall_score NUMERIC,
    qualification TEXT,
    reason JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table 9: lead_events
CREATE TABLE IF NOT EXISTS lead_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    event_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ==========================================
-- 3. TRIGGERS FOR UPDATED_AT
-- ==========================================

DROP TRIGGER IF EXISTS trigger_leads_updated_at ON leads;
CREATE TRIGGER trigger_leads_updated_at
BEFORE UPDATE ON leads
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_buyer_profiles_updated_at ON buyer_profiles;
CREATE TRIGGER trigger_buyer_profiles_updated_at
BEFORE UPDATE ON buyer_profiles
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_projects_updated_at ON projects;
CREATE TRIGGER trigger_projects_updated_at
BEFORE UPDATE ON projects
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ==========================================
-- 4. PERFORMANCE & LOOKUP INDEXES
-- ==========================================

-- leads indexes
CREATE INDEX IF NOT EXISTS idx_leads_lead_id ON leads(lead_id);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC);

-- lead_enrichment indexes
CREATE INDEX IF NOT EXISTS idx_lead_enrichment_lead_id ON lead_enrichment(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_enrichment_platform ON lead_enrichment(platform);

-- calls indexes
CREATE INDEX IF NOT EXISTS idx_calls_lead_id ON calls(lead_id);
CREATE INDEX IF NOT EXISTS idx_calls_provider_call_id ON calls(provider_call_id);
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);

-- buyer_profiles indexes
CREATE INDEX IF NOT EXISTS idx_buyer_profiles_lead_id ON buyer_profiles(lead_id);
CREATE INDEX IF NOT EXISTS idx_buyer_profiles_qualification_status ON buyer_profiles(qualification_status);

-- buyer_preferences indexes
CREATE INDEX IF NOT EXISTS idx_buyer_preferences_lead_id ON buyer_preferences(lead_id);

-- projects indexes
CREATE INDEX IF NOT EXISTS idx_projects_project_code ON projects(project_code);
CREATE INDEX IF NOT EXISTS idx_projects_city ON projects(city);
CREATE INDEX IF NOT EXISTS idx_projects_locality ON projects(locality);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

-- project_matches indexes
CREATE INDEX IF NOT EXISTS idx_project_matches_lead_id ON project_matches(lead_id);
CREATE INDEX IF NOT EXISTS idx_project_matches_project_id ON project_matches(project_id);
CREATE INDEX IF NOT EXISTS idx_project_matches_match_score ON project_matches(match_score DESC);

-- buyer_scores indexes
CREATE INDEX IF NOT EXISTS idx_buyer_scores_lead_id ON buyer_scores(lead_id);
CREATE INDEX IF NOT EXISTS idx_buyer_scores_overall_score ON buyer_scores(overall_score DESC);

-- lead_events indexes
CREATE INDEX IF NOT EXISTS idx_lead_events_lead_id ON lead_events(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_events_event_type ON lead_events(event_type);
CREATE INDEX IF NOT EXISTS idx_lead_events_created_at ON lead_events(created_at DESC);

-- ==========================================
-- 5. ROW-LEVEL SECURITY (RLS) POLICIES
-- ==========================================

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_enrichment ENABLE ROW LEVEL SECURITY;
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE buyer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE buyer_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE buyer_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_events ENABLE ROW LEVEL SECURITY;

-- Development MVP Policies: Allow full CRUD for anon and authenticated clients
-- In production, these policies will restrict mutations by verified role/tenant ID.
CREATE POLICY "Allow public read access on leads" ON leads FOR SELECT USING (true);
CREATE POLICY "Allow public insert access on leads" ON leads FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update access on leads" ON leads FOR UPDATE USING (true);
CREATE POLICY "Allow public delete access on leads" ON leads FOR DELETE USING (true);

CREATE POLICY "Allow public access on lead_enrichment" ON lead_enrichment FOR ALL USING (true);
CREATE POLICY "Allow public access on calls" ON calls FOR ALL USING (true);
CREATE POLICY "Allow public access on buyer_profiles" ON buyer_profiles FOR ALL USING (true);
CREATE POLICY "Allow public access on buyer_preferences" ON buyer_preferences FOR ALL USING (true);
CREATE POLICY "Allow public access on projects" ON projects FOR ALL USING (true);
CREATE POLICY "Allow public access on project_matches" ON project_matches FOR ALL USING (true);
CREATE POLICY "Allow public access on buyer_scores" ON buyer_scores FOR ALL USING (true);
CREATE POLICY "Allow public access on lead_events" ON lead_events FOR ALL USING (true);
