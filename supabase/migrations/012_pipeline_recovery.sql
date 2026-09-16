-- Migration 012: Pipeline Recovery Worker and Lease Fencing

ALTER TABLE pipeline_executions 
ADD COLUMN IF NOT EXISTS lease_owner TEXT,
ADD COLUMN IF NOT EXISTS lease_token UUID,
ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;

-- Drop old worker polling index and replace with one that includes lease expiration
DROP INDEX IF EXISTS idx_pipeline_executions_status_next_attempt;
CREATE INDEX IF NOT EXISTS idx_pipeline_executions_worker_polling 
ON pipeline_executions (status, next_attempt_at, lease_expires_at);

-- Atomic claim function
CREATE OR REPLACE FUNCTION claim_pipeline_execution(
  p_worker_id text,
  p_lease_duration interval,
  p_max_attempts integer
)
RETURNS SETOF pipeline_executions
LANGUAGE plpgsql
AS $$
DECLARE
  v_execution pipeline_executions;
BEGIN
  UPDATE pipeline_executions
  SET 
    status = 'RUNNING',
    lease_owner = p_worker_id,
    lease_token = gen_random_uuid(),
    lease_expires_at = NOW() + p_lease_duration,
    attempt_count = attempt_count + 1,
    started_at = COALESCE(started_at, NOW()),
    updated_at = NOW()
  WHERE id = (
    SELECT id
    FROM pipeline_executions
    WHERE 
      ((status = 'PENDING' AND (next_attempt_at IS NULL OR next_attempt_at <= NOW()))
      OR 
      (status = 'RUNNING' AND lease_expires_at < NOW()))
      AND attempt_count < p_max_attempts
    ORDER BY created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING * INTO v_execution;

  IF FOUND THEN
    RETURN NEXT v_execution;
  END IF;
END;
$$;

-- Grant execute to authenticated users (so the worker can run it if authenticated as service role or platform admin)
GRANT EXECUTE ON FUNCTION claim_pipeline_execution TO authenticated;
GRANT EXECUTE ON FUNCTION claim_pipeline_execution TO service_role;
