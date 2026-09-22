-- Phase 9.2: Harden all tables to enforce strict tenant isolation using app_metadata claims
-- Enforces: tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_enrichment ENABLE ROW LEVEL SECURITY;
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE buyer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE buyer_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE buyer_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

DO $$ 
DECLARE
  tables text[] := ARRAY['leads', 'lead_enrichment', 'calls', 'buyer_profiles', 'buyer_preferences', 'projects', 'project_matches', 'buyer_scores', 'lead_events'];
  t text;
BEGIN
  -- First drop the public policies
  DROP POLICY IF EXISTS "Allow public read access on leads" ON leads;
  DROP POLICY IF EXISTS "Allow public insert access on leads" ON leads;
  DROP POLICY IF EXISTS "Allow public update access on leads" ON leads;
  DROP POLICY IF EXISTS "Allow public delete access on leads" ON leads;
  DROP POLICY IF EXISTS "Allow public access on webhook_events" ON webhook_events;
  
  FOREACH t IN ARRAY tables
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Allow public access on %I" ON %I;', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "Allow tenant-based access on %I" ON %I;', t, t);
    
    -- Create the hardened tenant policy for each table enforcing app_metadata claim
    EXECUTE format('
      CREATE POLICY "Allow tenant-based access on %I" ON %I
      FOR ALL
      USING (
          tenant_id = (auth.jwt() -> ''app_metadata'' ->> ''tenant_id'')::uuid
          OR (
              coalesce(auth.jwt() -> ''app_metadata'' ->> ''tenant_id'', auth.jwt() ->> ''tenant_id'') IS NOT NULL
              AND tenant_id = (
                  CASE
                      WHEN coalesce(auth.jwt() -> ''app_metadata'' ->> ''tenant_id'', auth.jwt() ->> ''tenant_id'') 
                           ~ ''^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$''
                      THEN coalesce(auth.jwt() -> ''app_metadata'' ->> ''tenant_id'', auth.jwt() ->> ''tenant_id'')::uuid
                      ELSE NULL
                  END
              )
          )
      );
    ', t, t);
  END LOOP;
END $$;
