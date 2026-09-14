-- Migration 011: Correct Broker Handoffs RLS Policy
-- Replaces the buggy coalesce(..., 'null')::uuid policy with a safe tenant check that avoids UUID casting errors for unauthenticated/missing JWT claims.

DROP POLICY IF EXISTS "tenant_isolation_policy" ON broker_handoffs;
DROP POLICY IF EXISTS "Allow tenant-based access on broker_handoffs" ON broker_handoffs;

CREATE POLICY "Allow tenant-based access on broker_handoffs" ON broker_handoffs
    FOR ALL
    USING (
        (auth.jwt() ->> 'tenant_id') IS NOT NULL 
        AND (auth.jwt() ->> 'tenant_id') != 'null' 
        AND tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
    );
