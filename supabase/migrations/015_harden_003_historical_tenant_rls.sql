-- Migration: 015_harden_003_historical_tenant_rls.sql
-- Description: Hardens Row Level Security (RLS) across the 3 historical tenant-scoped tables from migrations 002, 003, and 004.
-- Tables targeted: call_transcripts (7,714 rows), conversation_extractions (5,807 rows), buyer_qualifications (5,029 rows).
-- Enforces authenticated-only tenant isolation with app_metadata precedence, top-level fallback, and UUID regex guard.
-- Closes the remaining anonymous access vector on historical tables.

DO $$
DECLARE
  tenant_tables text[] := ARRAY[
    'call_transcripts',
    'conversation_extractions',
    'buyer_qualifications'
  ];
  t text;
BEGIN
  -- 1. Explicitly drop all legacy permissive policies from migrations 002, 003, and 004
  DROP POLICY IF EXISTS "Allow public access on call_transcripts" ON call_transcripts;
  DROP POLICY IF EXISTS "Allow public access on conversation_extractions" ON conversation_extractions;
  DROP POLICY IF EXISTS "Allow public access on buyer_qualifications" ON buyer_qualifications;

  -- 2. Ensure RLS is enabled and drop any existing tenant policies on the 3 tables
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Allow tenant-based access on %I" ON %I;', t, t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
  END LOOP;

  -- 3. Apply hardened tenant-based access control policies on the 3 historical tenant-scoped tables
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
