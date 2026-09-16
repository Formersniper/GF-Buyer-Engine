CREATE TABLE IF NOT EXISTS pipeline_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    call_id UUID REFERENCES calls(id) ON DELETE CASCADE,
    source_event_id TEXT,
    idempotency_key TEXT,
    correlation_id UUID NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    current_stage TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for worker polling
CREATE INDEX IF NOT EXISTS idx_pipeline_executions_status_next_attempt ON pipeline_executions (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_pipeline_executions_lead_id ON pipeline_executions (lead_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_executions_tenant_id ON pipeline_executions (tenant_id);

-- Uniqueness constraint to prevent duplicate automatic runs from the same webhook,
-- while allowing manual force reruns (which might not have a source_event_id, or use a distinct idempotency_key).
CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_executions_idempotency ON pipeline_executions (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- RLS
ALTER TABLE pipeline_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins can access all pipeline_executions"
  ON pipeline_executions
  FOR ALL
  TO authenticated
  USING (
    ((auth.jwt() -> 'app_metadata') ->> 'role') = 'platform_admin'
  );

CREATE POLICY "Users can access their tenant's pipeline_executions"
  ON pipeline_executions
  FOR ALL
  TO authenticated
  USING (
    tenant_id = (((auth.jwt() -> 'app_metadata') ->> 'tenant_id')::uuid)
  );

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_pipeline_executions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_pipeline_executions_updated_at
BEFORE UPDATE ON pipeline_executions
FOR EACH ROW
EXECUTE FUNCTION update_pipeline_executions_updated_at();
