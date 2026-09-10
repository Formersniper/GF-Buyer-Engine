-- GrowthForge Buyer Intelligence Engine
-- Migration: 003_conversation_extractions.sql
-- Description: Creates the conversation_extractions table, indexes, constraints, updated_at trigger, and RLS policies for Phase 5B Gemini Structured Extraction

CREATE TABLE IF NOT EXISTS conversation_extractions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    transcript_id UUID NOT NULL REFERENCES call_transcripts(id) ON DELETE CASCADE,
    provider_call_id TEXT,
    interaction_id TEXT,
    model TEXT NOT NULL,
    prompt_version TEXT NOT NULL DEFAULT '1.0',
    schema_version TEXT NOT NULL DEFAULT '1.0',
    extraction_status TEXT NOT NULL DEFAULT 'EXTRACTED',
    extracted_data JSONB,
    raw_gemini_response JSONB,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_conversation_extractions_unique UNIQUE (transcript_id, schema_version, prompt_version)
);

-- ==========================================
-- INDEXES
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_conversation_extractions_lead_id ON conversation_extractions(lead_id);
CREATE INDEX IF NOT EXISTS idx_conversation_extractions_call_id ON conversation_extractions(call_id);
CREATE INDEX IF NOT EXISTS idx_conversation_extractions_transcript_id ON conversation_extractions(transcript_id);
CREATE INDEX IF NOT EXISTS idx_conversation_extractions_status ON conversation_extractions(extraction_status);
CREATE INDEX IF NOT EXISTS idx_conversation_extractions_created_at ON conversation_extractions(created_at DESC);

-- ==========================================
-- TRIGGER FOR updated_at
-- ==========================================
DROP TRIGGER IF EXISTS trg_conversation_extractions_updated_at ON conversation_extractions;
CREATE TRIGGER trg_conversation_extractions_updated_at
    BEFORE UPDATE ON conversation_extractions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ==========================================
-- ROW-LEVEL SECURITY (RLS) POLICIES
-- ==========================================
ALTER TABLE conversation_extractions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public access on conversation_extractions" ON conversation_extractions;
CREATE POLICY "Allow public access on conversation_extractions" ON conversation_extractions FOR ALL USING (true);
