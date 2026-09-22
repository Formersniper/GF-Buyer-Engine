-- Migration: 016_finalize_rls_hardening.sql
-- Description: Finalizes RLS hardening across the 9 core tenant-scoped tables and broker_handoffs.
-- Enforces authenticated-only tenant isolation with app_metadata precedence, top-level fallback,
-- UUID regex guard (preventing invalid UUID syntax errors 22P02), and both USING and WITH CHECK clauses.
-- Ensures webhook_events remains strictly service-role only (default-deny).

DO $$
DECLARE
  target_tables text[] := ARRAY[
    'leads',
    'lead_enrichment',
    'calls',
    'buyer_profiles',
    'buyer_preferences',
    'projects',
    'project_matches',
    'buyer_scores',
    'lead_events',
    'broker_handoffs'
  ];
  t text;
BEGIN
  -- 1. Ensure RLS is enabled on all target tables and drop legacy/existing policies
  FOREACH t IN ARRAY target_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Allow public access on %I" ON %I;', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "Allow tenant-based access on %I" ON %I;', t, t);
    -- Also drop common legacy policy variants if present
    EXECUTE format('DROP POLICY IF EXISTS "Allow public read access on %I" ON %I;', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "Allow public insert access on %I" ON %I;', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "Allow public update access on %I" ON %I;', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "Allow public delete access on %I" ON %I;', t, t);
  END LOOP;

  -- 2. Ensure webhook_events remains strictly service-role only (default-deny)
  ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "Allow public access on webhook_events" ON webhook_events;
  DROP POLICY IF EXISTS "Allow tenant-based access on webhook_events" ON webhook_events;

  -- 3. Apply finalized hardened tenant-based policies with explicit USING and WITH CHECK
  FOREACH t IN ARRAY target_tables LOOP
    EXECUTE format('
      CREATE POLICY "Allow tenant-based access on %I" ON %I
        FOR ALL
        TO authenticated
        USING (
          coalesce(auth.jwt() -> ''app_metadata'' ->> ''tenant_id'', auth.jwt() ->> ''tenant_id'') IS NOT NULL
          AND coalesce(auth.jwt() -> ''app_metadata'' ->> ''tenant_id'', auth.jwt() ->> ''tenant_id'') != ''null''
          AND tenant_id = (
            CASE
              WHEN coalesce(auth.jwt() -> ''app_metadata'' ->> ''tenant_id'', auth.jwt() ->> ''tenant_id'') ~ ''^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$''
              THEN coalesce(auth.jwt() -> ''app_metadata'' ->> ''tenant_id'', auth.jwt() ->> ''tenant_id'')::uuid
              ELSE NULL
            END
          )
        )
        WITH CHECK (
          coalesce(auth.jwt() -> ''app_metadata'' ->> ''tenant_id'', auth.jwt() ->> ''tenant_id'') IS NOT NULL
          AND coalesce(auth.jwt() -> ''app_metadata'' ->> ''tenant_id'', auth.jwt() ->> ''tenant_id'') != ''null''
          AND tenant_id = (
            CASE
              WHEN coalesce(auth.jwt() -> ''app_metadata'' ->> ''tenant_id'', auth.jwt() ->> ''tenant_id'') ~ ''^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$''
              THEN coalesce(auth.jwt() -> ''app_metadata'' ->> ''tenant_id'', auth.jwt() ->> ''tenant_id'')::uuid
              ELSE NULL
            END
          )
        );
    ', t, t);
  END LOOP;
END $$;
