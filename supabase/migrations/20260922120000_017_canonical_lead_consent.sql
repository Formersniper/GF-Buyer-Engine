-- Migration: 017_canonical_lead_consent.sql
-- Description: Adds canonical consent tracking columns to public.leads table.
-- Confined strictly to public.leads and index idx_leads_tenant_consent.

ALTER TABLE public.leads
ADD COLUMN IF NOT EXISTS consent_status VARCHAR NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN IF NOT EXISTS consent_source VARCHAR NULL,
ADD COLUMN IF NOT EXISTS consent_timestamp TIMESTAMPTZ NULL;

-- Backfill any existing rows where consent_status is NULL to UNKNOWN
UPDATE leads
SET consent_status = 'UNKNOWN'
WHERE consent_status IS NULL;

-- Tenant-scoped index for fast consent filtering and compliance audits
CREATE INDEX IF NOT EXISTS idx_leads_tenant_consent
ON leads(tenant_id, consent_status);
