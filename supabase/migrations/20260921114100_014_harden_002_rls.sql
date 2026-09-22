-- Migration: 014_harden_002_rls.sql
-- Description: Hardens Row Level Security (RLS) across the 9 tenant-scoped tables from migration 001.
-- Corrects the failed migration 013 by excluding webhook_events from tenant_id policy creation.
-- webhook_events is an internal deduplication ledger and is isolated with default-deny (service_role only).

DO $$
DECLARE
  tenant_tables text[] := ARRAY[
    'leads',
    'lead_enrichment',
    'calls',
    'buyer_profiles',
    'buyer_preferences',
    'projects',
    'project_matches',
    'buyer_scores',
    'lead_events'
  ];
  t text;
BEGIN
  -- 1. Explicitly drop all legacy permissive policies from migration 001
  DROP POLICY IF EXISTS "Allow public read access on leads" ON leads;
  DROP POLICY IF EXISTS "Allow public insert access on leads" ON leads;
  DROP POLICY IF EXISTS "Allow public update access on leads" ON leads;
  DROP POLICY IF EXISTS "Allow public delete access on leads" ON leads;
  DROP POLICY IF EXISTS "Allow public access on webhook_events" ON webhook_events;
  DROP POLICY IF EXISTS "Allow tenant-based access on webhook_events" ON webhook_events;

  -- 2. Drop legacy and existing tenant policies on all tenant tables
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Allow public access on %I" ON %I;', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "Allow tenant-based access on %I" ON %I;', t, t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
  END LOOP;

  -- 3. Ensure RLS is enabled on webhook_events without granting any client access (service_role only default-deny)
  ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

  -- 4. Apply hardened tenant-based access control policies on the 9 tenant-scoped tables
  FOREACH t IN ARRAY tenant_tables LOOP
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
