-- Phase 8A.8: Rate Limiting, Concurrency, & Idempotency

CREATE TABLE IF NOT EXISTS public.idempotency_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL,
    operation TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED')),
    response_code INTEGER,
    response_body JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_idempotency_key UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON public.idempotency_records(expires_at);

CREATE TABLE IF NOT EXISTS public.resource_locks (
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    locked_by TEXT NOT NULL, -- e.g., task or instance id
    locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (resource_type, resource_id)
);

CREATE TABLE IF NOT EXISTS public.rate_limits (
    target_id TEXT NOT NULL, -- tenant_id, ip_address, 'global'
    operation TEXT NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (target_id, operation, window_start)
);

-- RLS Policies
ALTER TABLE public.idempotency_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resource_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- Allow system/service role to bypass RLS (Supabase does this automatically for service_role)
-- No public access policies needed since this is purely server-side control

-- RPC for atomic rate limit increment
CREATE OR REPLACE FUNCTION public.increment_rate_limit(
    p_target_id TEXT,
    p_operation TEXT,
    p_window_start TIMESTAMPTZ
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    INSERT INTO public.rate_limits (target_id, operation, window_start, request_count)
    VALUES (p_target_id, p_operation, p_window_start, 1)
    ON CONFLICT (target_id, operation, window_start)
    DO UPDATE SET request_count = public.rate_limits.request_count + 1
    RETURNING request_count INTO v_count;
    
    RETURN v_count;
END;
$$;
