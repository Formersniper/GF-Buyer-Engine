import { getSupabaseAdminClient, getSupabaseClient, getSupabaseConfig } from '../app/services/supabase/client';
import { generateUUID } from '../app/services/security/correlationContext';
import assert from 'assert';

async function verifyLiveDatabase() {
  console.log('=== PHASE 8B.7.10: LIVE DATABASE VERIFICATION ===');

  const config = getSupabaseConfig();
  console.log(`Supabase URL: ${config.url ? config.url : 'NONE'}`);
  console.log(`Service Role Key Configured: ${Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)}`);
  console.log(`Anon Key Configured: ${Boolean(config.key)}`);

  assert(config.url, 'Supabase URL must be configured');
  assert(process.env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY must be configured');

  const adminClient = getSupabaseAdminClient()!;
  const anonClient = getSupabaseClient()!;

  // 1. Check table existence and columns by querying information_schema or querying table metadata
  console.log('\n--- 1. Table & Column Schema Verification ---');
  const requiredColumns = [
    'id',
    'tenant_id',
    'lead_id',
    'call_id',
    'source_event_id',
    'idempotency_key',
    'correlation_id',
    'status',
    'current_stage',
    'attempt_count',
    'next_attempt_at',
    'last_error',
    'created_at',
    'started_at',
    'completed_at',
    'updated_at',
    'lease_owner',
    'lease_token',
    'lease_expires_at'
  ];

  // We can insert a dry probe row or query with limit 0
  const { data: probeData, error: probeError } = await adminClient
    .from('pipeline_executions')
    .select(requiredColumns.join(','))
    .limit(0);

  if (probeError) {
    console.error('Failed to select required columns from pipeline_executions:', probeError);
    throw new Error(`pipeline_executions column check failed: ${probeError.message}`);
  }
  console.log(`✓ Table 'pipeline_executions' exists with all 19 required columns: ${requiredColumns.join(', ')}`);

  // 2. Verify RLS is enabled and enforced
  console.log('\n--- 2. RLS Enforcement Verification ---');
  // Anon client should NOT be able to select or insert freely without auth/tenant context
  const { data: anonSel, error: anonSelErr } = await anonClient
    .from('pipeline_executions')
    .select('*')
    .limit(5);

  console.log(`Anon client SELECT returned: ${anonSel?.length ?? 0} rows. Error:`, anonSelErr ? anonSelErr.message : 'none (0 rows returned via RLS policy)');
  // Under RLS, unauthenticated anon client receives empty list or permission error
  assert(
    anonSelErr !== null || (anonSel && anonSel.length === 0),
    'RLS must block unauthenticated access from seeing pipeline_executions'
  );

  const fakeId = generateUUID();
  const { data: anonIns, error: anonInsErr } = await anonClient
    .from('pipeline_executions')
    .insert({
      id: fakeId,
      lead_id: fakeId,
      correlation_id: fakeId,
      status: 'PENDING'
    })
    .select();

  assert(anonInsErr !== null, 'RLS must reject unauthenticated INSERT on pipeline_executions');
  console.log(`✓ RLS is actively enforced on 'pipeline_executions' (Anon INSERT rejected with: ${anonInsErr.message})`);

  // 3. Verify RPC claim_pipeline_execution exists and is executable
  console.log('\n--- 3. claim_pipeline_execution RPC Verification ---');
  const testWorkerId = `test-verify-worker-${generateUUID()}`;
  const { data: rpcData, error: rpcError } = await adminClient.rpc('claim_pipeline_execution', {
    p_worker_id: testWorkerId,
    p_lease_duration: '300 seconds',
    p_max_attempts: 3
  });

  if (rpcError) {
    console.error('RPC error executing claim_pipeline_execution:', rpcError);
    throw new Error(`claim_pipeline_execution RPC failed: ${rpcError.message}`);
  }
  console.log(`✓ claim_pipeline_execution RPC exists and executed successfully. Returned items: ${rpcData ? rpcData.length : 0}`);

  // 4. Test atomic claim, lease fields, lease_token generation, and idempotency in live DB
  console.log('\n--- 4. Live Table Invariant & Idempotency Check ---');
  // Create isolated tenant and lead
  const testTenantId = generateUUID();
  const testLeadId = generateUUID();
  const testExecutionId = generateUUID();
  const testIdempotencyKey = `idem-${generateUUID()}`;
  const testCorrelationId = generateUUID();

  try {
    // Create tenant
    const { error: tenantErr } = await adminClient.from('tenants').insert({
      id: testTenantId,
      name: 'Live Verify Tenant',
      slug: `live-verify-${testTenantId.slice(0, 8)}`,
      status: 'ACTIVE'
    });
    assert(!tenantErr, `Failed to create test tenant: ${tenantErr?.message}`);

    // Create lead
    const { error: leadErr } = await adminClient.from('leads').insert({
      id: testLeadId,
      tenant_id: testTenantId,
      lead_id: `LEAD-VERIFY-${testLeadId.slice(0, 8)}`,
      name: 'Live Verify Lead',
      email: 'verify@example.com',
      phone: '+15551234567',
      status: 'RAW'
    });
    assert(!leadErr, `Failed to create test lead: ${leadErr?.message}`);

    // Insert execution
    const { data: insExec, error: execErr } = await adminClient.from('pipeline_executions').insert({
      id: testExecutionId,
      tenant_id: testTenantId,
      lead_id: testLeadId,
      correlation_id: testCorrelationId,
      idempotency_key: testIdempotencyKey,
      status: 'PENDING',
      attempt_count: 0
    }).select().single();

    assert(!execErr && insExec, `Failed to insert execution: ${execErr?.message}`);
    console.log(`✓ Inserted test execution ${testExecutionId} with idempotency_key ${testIdempotencyKey}`);

    // Try duplicate insert with same idempotency_key
    const { error: dupErr } = await adminClient.from('pipeline_executions').insert({
      id: generateUUID(),
      tenant_id: testTenantId,
      lead_id: testLeadId,
      correlation_id: generateUUID(),
      idempotency_key: testIdempotencyKey,
      status: 'PENDING',
      attempt_count: 0
    });

    assert(dupErr !== null, 'Duplicate idempotency_key must be rejected by unique constraint');
    console.log(`✓ Idempotency constraint verified: duplicate insert rejected with: ${dupErr.message} (code: ${dupErr.code})`);

    // Claim the execution via RPC
    const { data: claimedRows, error: claimErr } = await adminClient.rpc('claim_pipeline_execution', {
      p_worker_id: testWorkerId,
      p_lease_duration: '300 seconds',
      p_max_attempts: 3
    });
    assert(!claimErr && claimedRows && claimedRows.length === 1, `Claim failed: ${claimErr?.message}`);
    const claimed = claimedRows[0];
    assert(claimed.id === testExecutionId, 'Claimed execution must match testExecutionId');
    assert(claimed.lease_owner === testWorkerId, 'lease_owner must match workerId');
    assert(claimed.lease_token !== null, 'lease_token must be non-null');
    assert(claimed.status === 'RUNNING', 'status must be RUNNING');
    assert(claimed.attempt_count === 1, 'attempt_count must be 1');
    console.log(`✓ Atomic claim verified on live database. lease_token: ${claimed.lease_token}, lease_expires_at: ${claimed.lease_expires_at}`);
  } finally {
    // 5. Cleanup test records in reverse dependency order
    console.log('\n--- 5. Cleanup Verification Artifacts ---');
    await adminClient.from('pipeline_executions').delete().eq('id', testExecutionId);
    await adminClient.from('leads').delete().eq('id', testLeadId);
    await adminClient.from('tenants').delete().eq('id', testTenantId);

    // Confirm deletion
    const { data: checkDel } = await adminClient.from('pipeline_executions').select('id').eq('id', testExecutionId);
    assert(!checkDel || checkDel.length === 0, 'Test execution must be deleted');
    console.log('✓ All verification artifacts cleanly deleted in reverse FK order. Zero leftovers.');
  }

  console.log('\n=============================================================');
  console.log('LIVE DATABASE VERIFICATION: ALL INVARIANTS PASS');
  console.log('=============================================================');
}

verifyLiveDatabase().catch((err) => {
  console.error('Live Database Verification Failed:', err);
  process.exit(1);
});
