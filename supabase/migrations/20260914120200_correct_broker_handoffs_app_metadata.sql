-- Drop the old policy and replace it with a robust, CASE-guarded UUID policy supporting nested app_metadata tenant_id claims
DROP POLICY IF EXISTS "Allow tenant-based access on broker_handoffs" ON broker_handoffs;

CREATE POLICY "Allow tenant-based access on broker_handoffs" ON broker_handoffs
FOR ALL
USING (
    coalesce(auth.jwt() -> 'app_metadata' ->> 'tenant_id', auth.jwt() ->> 'tenant_id') IS NOT NULL
    AND coalesce(auth.jwt() -> 'app_metadata' ->> 'tenant_id', auth.jwt() ->> 'tenant_id') != 'null'
    AND tenant_id = (
        CASE
            WHEN coalesce(auth.jwt() -> 'app_metadata' ->> 'tenant_id', auth.jwt() ->> 'tenant_id')
                 ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
            THEN coalesce(auth.jwt() -> 'app_metadata' ->> 'tenant_id', auth.jwt() ->> 'tenant_id')::uuid
            ELSE NULL
        END
    )
);
