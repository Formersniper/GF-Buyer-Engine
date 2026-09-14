-- Re-remedy RLS on broker_handoffs to safely handle malformed/invalid UUID values in JWT context
-- This ensures index-friendly tenant_id search without PostgreSQL casting exceptions.

DROP POLICY IF EXISTS "Allow tenant-based access on broker_handoffs" ON broker_handoffs;

CREATE POLICY "Allow tenant-based access on broker_handoffs" ON broker_handoffs
FOR ALL
USING (
    (auth.jwt() ->> 'tenant_id') IS NOT NULL
    AND (auth.jwt() ->> 'tenant_id') != 'null'
    AND tenant_id = (
        CASE
            WHEN (auth.jwt() ->> 'tenant_id')
                 ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
            THEN (auth.jwt() ->> 'tenant_id')::uuid
            ELSE NULL
        END
    )
);
