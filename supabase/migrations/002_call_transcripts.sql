-- GrowthForge Buyer Intelligence Engine
-- Migration: 002_call_transcripts.sql
-- Description: Creates the call_transcripts table, indexes, constraints, updated_at trigger, and RLS policies for Phase 5A Transcript Ingestion

CREATE TABLE IF NOT EXISTS call_transcripts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    provider_call_id TEXT,
    interaction_id TEXT,
    transcript_text TEXT NOT NULL,
    transcript_turns JSONB,
    language TEXT DEFAULT 'unknown',
    duration_seconds INTEGER,
    source TEXT NOT NULL DEFAULT 'sarvam',
    source_event_type TEXT,
    ingestion_status TEXT NOT NULL DEFAULT 'INGESTED',
    ingestion_version TEXT NOT NULL DEFAULT 'v1',
    captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_call_transcripts_call_id UNIQUE (call_id)
);

-- ==========================================
-- INDEXES
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_call_transcripts_lead_id ON call_transcripts(lead_id);
CREATE INDEX IF NOT EXISTS idx_call_transcripts_call_id ON call_transcripts(call_id);
CREATE INDEX IF NOT EXISTS idx_call_transcripts_provider_call_id ON call_transcripts(provider_call_id);
CREATE INDEX IF NOT EXISTS idx_call_transcripts_interaction_id ON call_transcripts(interaction_id);
CREATE INDEX IF NOT EXISTS idx_call_transcripts_captured_at ON call_transcripts(captured_at DESC);

-- ==========================================
-- TRIGGER FOR updated_at
-- ==========================================
DROP TRIGGER IF EXISTS trg_call_transcripts_updated_at ON call_transcripts;
CREATE TRIGGER trg_call_transcripts_updated_at
    BEFORE UPDATE ON call_transcripts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ==========================================
-- ROW-LEVEL SECURITY (RLS) POLICIES
-- ==========================================
ALTER TABLE call_transcripts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public access on call_transcripts" ON call_transcripts;
CREATE POLICY "Allow public access on call_transcripts" ON call_transcripts FOR ALL USING (true);
