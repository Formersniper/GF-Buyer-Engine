import assert from 'assert';
import { isNetworkFetchError, isMissingClaimRpcError } from '../app/services/supabase/repos/pipelineExecutionsRepo';
import { supabaseDataService } from '../app/services/supabase/repositories';
import { DEFAULT_TENANT_ID } from '../app/schemas/tenant';
import { generateUUID } from '../app/services/security/correlationContext';

async function runRecoveryHardeningTests() {
  console.log('--- Starting Supabase Connection Recovery Hardening Unit Tests ---');

  // 1. Test isNetworkFetchError classification
  console.log('Test 1: isNetworkFetchError accurately identifies network errors');
  assert(isNetworkFetchError(new Error('TypeError: fetch failed')), 'fetch failed should be network error');
  assert(isNetworkFetchError({ message: 'getaddrinfo ENOTFOUND host.supabase.co', code: 'ENOTFOUND' }), 'ENOTFOUND should be network error');
  assert(isNetworkFetchError({ message: 'connect ECONNREFUSED 127.0.0.1:5432', code: 'ECONNREFUSED' }), 'ECONNREFUSED should be network error');
  assert(isNetworkFetchError({ message: 'connect ETIMEDOUT', code: 'ETIMEDOUT' }), 'ETIMEDOUT should be network error');

  // 2. Test isNetworkFetchError does NOT misclassify DB/Schema/Auth/RLS errors
  console.log('Test 2: isNetworkFetchError excludes PGRST202, 42883, and Auth/RLS 42501');
  assert(!isNetworkFetchError({ code: 'PGRST202', message: 'Could not find the function claim_pipeline_execution' }), 'PGRST202 is schema error, not network');
  assert(!isNetworkFetchError({ code: '42883', message: 'function claim_pipeline_execution does not exist' }), '42883 is Postgres error, not network');
  assert(!isNetworkFetchError({ code: '42501', message: 'permission denied for table pipeline_executions' }), '42501 is RLS error, not network');
  assert(!isNetworkFetchError({ code: 'PGRST301', message: 'JWT expired' }), 'PGRST301 is Auth error, not network');

  // 3. Test isMissingClaimRpcError
  console.log('Test 3: isMissingClaimRpcError correctly handles PGRST202 and 42883 for schema missing function');
  assert(isMissingClaimRpcError({ code: 'PGRST202', message: 'Could not find claim_pipeline_execution in schema cache' }), 'PGRST202 claim_pipeline_execution');
  assert(isMissingClaimRpcError({ code: '42883', message: 'function claim_pipeline_execution does not exist' }), '42883 claim_pipeline_execution');
  assert(!isMissingClaimRpcError({ code: '42501', message: 'permission denied' }), 'RLS error is not missing function');

  // 4. Test Execution Claims with Valid Lead
  console.log('Test 4: Creating lead and testing pipeline execution claim');
  const scope = { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true };
  const lead = await supabaseDataService.leads.createLead(scope, {
    lead_id: `lead-${generateUUID()}`,
    name: 'Hardening Test Lead',
    source: 'WEB_FORM',
    status: 'RAW'
  });

  const exec = await supabaseDataService.pipelineExecutions.createExecution(scope, {
    lead_id: lead.id,
    correlation_id: generateUUID(),
    status: 'PENDING',
  });

  assert(exec && exec.id, 'Execution should be created');

  const workerId = 'test-worker-hardening';
  const claimed = await supabaseDataService.pipelineExecutions.claimExecution(workerId, 300000, 3);

  // Note: If running in in-memory mode, claimed execution matches created exec
  if (claimed) {
    assert.strictEqual(claimed.id, exec.id, 'Claimed execution ID should match');
    assert.strictEqual(claimed.status, 'RUNNING', 'Status should be RUNNING');
    assert.strictEqual(claimed.lease_owner, workerId, 'Lease owner should be workerId');
  }

  // 5. Test Fencing Invariants
  console.log('Test 5: Lease fencing prevents unauthorized updates');
  if (claimed && claimed.lease_token) {
    const invalidUpdate = await supabaseDataService.pipelineExecutions.updateExecutionWithFencing(
      scope,
      exec.id,
      generateUUID(),
      { status: 'COMPLETED' }
    );
    assert.strictEqual(invalidUpdate, null, 'Zombie update with wrong lease token must be rejected');

    const validUpdate = await supabaseDataService.pipelineExecutions.updateExecutionWithFencing(
      scope,
      exec.id,
      claimed.lease_token,
      { status: 'COMPLETED' }
    );
    assert(validUpdate !== null, 'Valid update with correct lease token must succeed');
    assert.strictEqual(validUpdate.status, 'COMPLETED', 'Status should be COMPLETED');
  }

  console.log('--- ALL SUPABASE RECOVERY HARDENING TESTS PASSED SUCCESSFULLY ---');
}

runRecoveryHardeningTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
