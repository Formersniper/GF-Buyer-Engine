-- GrowthForge Buyer Intelligence Engine
-- Migration: 004_buyer_qualifications.sql
-- Description: Creates the buyer_qualifications table, indexes, constraints, updated_at trigger, and RLS policies for Phase 5C Buyer Qualification

CREATE TABLE IF NOT EXISTS buyer_qualifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    extraction_id UUID NOT NULL REFERENCES conversation_extractions(id) ON DELETE CASCADE,
    qualification_status TEXT NOT NULL,
    reason_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
    blocking_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
    follow_up_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
    dimension_assessments JSONB NOT NULL DEFAULT '{}'::jsonb,
    evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
    qualification_version TEXT NOT NULL DEFAULT '1.0',
    rule_version TEXT NOT NULL DEFAULT '1.0',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_buyer_qualifications_unique UNIQUE (extraction_id, rule_version)
);

-- ==========================================
-- INDEXES
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_buyer_qualifications_lead_id ON buyer_qualifications(lead_id);
CREATE INDEX IF NOT EXISTS idx_buyer_qualifications_extraction_id ON buyer_qualifications(extraction_id);
CREATE INDEX IF NOT EXISTS idx_buyer_qualifications_status ON buyer_qualifications(qualification_status);
CREATE INDEX IF NOT EXISTS idx_buyer_qualifications_created_at ON buyer_qualifications(created_at DESC);

-- ==========================================
-- TRIGGER FOR updated_at
-- ==========================================
DROP TRIGGER IF EXISTS trg_buyer_qualifications_updated_at ON buyer_qualifications;
CREATE TRIGGER trg_buyer_qualifications_updated_at
    BEFORE UPDATE ON buyer_qualifications
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ==========================================
-- ROW-LEVEL SECURITY (RLS) POLICIES
-- ==========================================
ALTER TABLE buyer_qualifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public access on buyer_qualifications" ON buyer_qualifications;
CREATE POLICY "Allow public access on buyer_qualifications" ON buyer_qualifications FOR ALL USING (true);
