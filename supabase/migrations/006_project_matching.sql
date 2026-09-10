-- GrowthForge Buyer Intelligence Engine
-- Migration: 006_project_matching.sql
-- Description: Creates / enhances the project_matches table, indexes, constraints, updated_at trigger, and RLS policies for Phase 5E Project Mapping & Recommendations

-- Ensure projects table exists and has all required attributes
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

-- Enhance / Create project_matches table
CREATE TABLE IF NOT EXISTS project_matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    match_score NUMERIC NOT NULL,
    budget_score NUMERIC DEFAULT 0,
    location_score NUMERIC DEFAULT 0,
    configuration_score NUMERIC DEFAULT 0,
    purpose_score NUMERIC DEFAULT 0,
    preference_score NUMERIC DEFAULT 0,
    timeline_score NUMERIC DEFAULT 0,
    buyer_confirmed BOOLEAN DEFAULT false,
    reason JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_project_matches_lead_project UNIQUE (lead_id, project_id)
);

-- ==========================================
-- INDEXES
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_projects_code ON projects(project_code);
CREATE INDEX IF NOT EXISTS idx_projects_city ON projects(city);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_property_type ON projects(property_type);

CREATE INDEX IF NOT EXISTS idx_project_matches_lead_id ON project_matches(lead_id);
CREATE INDEX IF NOT EXISTS idx_project_matches_project_id ON project_matches(project_id);
CREATE INDEX IF NOT EXISTS idx_project_matches_match_score ON project_matches(match_score DESC);
CREATE INDEX IF NOT EXISTS idx_project_matches_created_at ON project_matches(created_at DESC);

-- ==========================================
-- ROW-LEVEL SECURITY (RLS) POLICIES
-- ==========================================
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public access on projects" ON projects;
CREATE POLICY "Allow public access on projects" ON projects FOR ALL USING (true);

DROP POLICY IF EXISTS "Allow public access on project_matches" ON project_matches;
CREATE POLICY "Allow public access on project_matches" ON project_matches FOR ALL USING (true);
