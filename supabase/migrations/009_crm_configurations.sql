-- GrowthForge Buyer Intelligence Engine
-- Migration: 009_crm_configurations.sql
-- Description: Creates the crm_configurations table for Phase 8B.3 Dispatch Engine.

CREATE TABLE IF NOT EXISTS crm_configurations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    provider_name TEXT NOT NULL,
    destination_type TEXT NOT NULL,
    endpoint_url TEXT,
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    dry_run_mode BOOLEAN NOT NULL DEFAULT true,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensure updated_at stays up to date
DROP TRIGGER IF EXISTS trg_crm_configurations_updated_at ON crm_configurations;
CREATE TRIGGER trg_crm_configurations_updated_at
    BEFORE UPDATE ON crm_configurations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Indexes for lookup
CREATE INDEX IF NOT EXISTS idx_crm_configurations_tenant_id ON crm_configurations(tenant_id);

-- Enable RLS
ALTER TABLE crm_configurations ENABLE ROW LEVEL SECURITY;

-- Note: We intentionally do NOT create a permissive public policy for this table.
-- It must remain secure and is accessed exclusively via the service_role key 
-- (getSupabaseAdminClient) from the server-side to prevent unauthorized reads 
-- of CRM destinations and metadata which may contain integration secrets.

