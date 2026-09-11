-- GrowthForge Buyer Intelligence Engine
-- Migration: 005_buyer_scoring.sql
-- Description: Creates / enhances the buyer_scores table, indexes, constraints, updated_at trigger, and RLS policies for Phase 5D Buyer Scoring & Prioritization

-- 1. Create table if not exists (in case it wasn't created in 001)
CREATE TABLE IF NOT EXISTS buyer_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    qualification_id UUID REFERENCES buyer_qualifications(id) ON DELETE CASCADE,
    extraction_id UUID REFERENCES conversation_extractions(id) ON DELETE CASCADE,
    composite_score NUMERIC(5, 2),
    scoring_confidence NUMERIC(4, 3) NOT NULL DEFAULT 0.850,
    tier TEXT,
    dimension_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
    breakdown JSONB NOT NULL DEFAULT '[]'::jsonb,
    key_drivers JSONB NOT NULL DEFAULT '[]'::jsonb,
    risk_factors JSONB NOT NULL DEFAULT '[]'::jsonb,
    sla_dispatch JSONB NOT NULL DEFAULT '{}'::jsonb,
    scoring_version TEXT NOT NULL DEFAULT '1.0',
    rule_version TEXT NOT NULL DEFAULT '1.0',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Ensure all Phase 5D columns exist (for existing buyer_scores table created in 001)
ALTER TABLE buyer_scores
    ADD COLUMN IF NOT EXISTS qualification_id UUID REFERENCES buyer_qualifications(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS extraction_id UUID REFERENCES conversation_extractions(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS composite_score NUMERIC(5, 2),
    ADD COLUMN IF NOT EXISTS scoring_confidence NUMERIC(4, 3) DEFAULT 0.850,
    ADD COLUMN IF NOT EXISTS tier TEXT,
    ADD COLUMN IF NOT EXISTS dimension_scores JSONB DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS breakdown JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS key_drivers JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS risk_factors JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS sla_dispatch JSONB DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS scoring_version TEXT DEFAULT '1.0',
    ADD COLUMN IF NOT EXISTS rule_version TEXT DEFAULT '1.0',
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 3. Ensure unique constraint exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_buyer_scores_unique'
    ) THEN
        ALTER TABLE buyer_scores
            ADD CONSTRAINT uq_buyer_scores_unique UNIQUE (qualification_id, rule_version);
    END IF;
END $$;

-- ==========================================
-- INDEXES
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_buyer_scores_lead_id ON buyer_scores(lead_id);
CREATE INDEX IF NOT EXISTS idx_buyer_scores_qualification_id ON buyer_scores(qualification_id);
CREATE INDEX IF NOT EXISTS idx_buyer_scores_tier ON buyer_scores(tier);
CREATE INDEX IF NOT EXISTS idx_buyer_scores_composite_score ON buyer_scores(composite_score DESC);
CREATE INDEX IF NOT EXISTS idx_buyer_scores_created_at ON buyer_scores(created_at DESC);

-- ==========================================
-- TRIGGER FOR updated_at
-- ==========================================
DROP TRIGGER IF EXISTS trg_buyer_scores_updated_at ON buyer_scores;
CREATE TRIGGER trg_buyer_scores_updated_at
    BEFORE UPDATE ON buyer_scores
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ==========================================
-- ROW-LEVEL SECURITY (RLS) POLICIES
-- ==========================================
ALTER TABLE buyer_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public access on buyer_scores" ON buyer_scores;
CREATE POLICY "Allow public access on buyer_scores" ON buyer_scores FOR ALL USING (true);
