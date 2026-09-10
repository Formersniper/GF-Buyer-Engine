-- GrowthForge Buyer Intelligence Engine
-- Migration: 006_schema_compatibility.sql
-- Purpose: Repair migration compatibility for buyer_scores.qualification_id.
-- This migration is intentionally additive and safe to run after the existing
-- buyer_qualifications and buyer_scores migrations.

ALTER TABLE buyer_scores
    ADD COLUMN IF NOT EXISTS qualification_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'buyer_scores_qualification_id_fkey'
          AND conrelid = 'buyer_scores'::regclass
    ) THEN
        ALTER TABLE buyer_scores
            ADD CONSTRAINT buyer_scores_qualification_id_fkey
            FOREIGN KEY (qualification_id)
            REFERENCES buyer_qualifications(id)
            ON DELETE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_buyer_scores_qualification_id
    ON buyer_scores(qualification_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'uq_buyer_scores_unique'
          AND conrelid = 'buyer_scores'::regclass
    ) THEN
        ALTER TABLE buyer_scores
            ADD CONSTRAINT uq_buyer_scores_unique
            UNIQUE (qualification_id, rule_version);
    END IF;
END $$;
