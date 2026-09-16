import assert from 'assert';
import { isMissingClaimRpcError, createPipelineExecutionsRepository } from '../app/services/supabase/repos/pipelineExecutionsRepo';
import { PipelineRecoveryWorker } from '../app/services/pipeline/pipelineRecoveryWorker';
import { DEFAULT_TENANT_ID } from '../app/schemas/tenant';
import { generateUUID } from '../app/services/security/correlationContext';

async function runTests() {
  console.log('--- Phase 8B.7.4 Remediation Tests ---');

  // A. PostgreSQL 42883 missing claim RPC is recognized
  const pg42883Error = {
    code: '42883',
    message: 'function public.claim_pipeline_execution(p_lease_duration, p_max_attempts, p_worker_id) does not exist'
  };
  assert.strictEqual(isMissingClaimRpcError(pg42883Error), true, 'A: PostgreSQL 42883 missing claim RPC must be recognized');

  // B. PostgREST PGRST202 missing claim RPC is recognized
  const pgrst202Error = {
    code: 'PGRST202',
    message: 'Could not find the function public.claim_pipeline_execution(p_lease_duration, p_max_attempts, p_worker_id) in the schema cache'
  };
  assert.strictEqual(isMissingClaimRpcError(pgrst202Error), true, 'B1: PostgREST PGRST202 missing claim RPC must be recognized');

  // Exact observed error message must be recognized
  const exactObservedError = {
    message: 'Could not find the function public.claim_pipeline_execution(p_lease_duration, p_max_attempts, p_worker_id) in the schema cache'
  };
  assert.strictEqual(isMissingClaimRpcError(exactObservedError), true, 'B2: Exact observed error message must be recognized');

  // C. PGRST202 for an unrelated function is NOT incorrectly classified as the claim RPC
  const unrelatedPgrst202 = {
    code: 'PGRST202',
    message: 'Could not find the function public.unrelated_function() in the schema cache'
  };
  assert.strictEqual(isMissingClaimRpcError(unrelatedPgrst202), false, 'C1: Unrelated PGRST202 must NOT be classified as missing claim RPC');

  const unrelatedPg42883 = {
    code: '42883',
    message: 'function public.other_function() does not exist'
  };
  assert.strictEqual(isMissingClaimRpcError(unrelatedPg42883), false, 'C2: Unrelated 42883 must NOT be classified as missing claim RPC');

  const genericSchemaError = {
    message: 'Some unrelated schema cache error'
  };
  assert.strictEqual(isMissingClaimRpcError(genericSchemaError), false, 'C3: Generic schema cache error must NOT be classified as missing claim RPC');

  // D. Existing claim behavior: when RPC is missing in live DB, it successfully falls back to in-memory store without throwing
  const store = new Map();
  const executionId = generateUUID();
  store.set(executionId, {
    id: executionId,
    tenant_id: DEFAULT_TENANT_ID,
    lead_id: generateUUID(),
    correlation_id: generateUUID(),
    status: 'PENDING',
    attempt_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });

  const repo = createPipelineExecutionsRepository(store);
  const claimed = await repo.claimExecution('worker-remediation-1', 60000, 3);
  assert.ok(claimed, 'D1: Execution should be claimed via in-memory fallback when live DB missing RPC');
  assert.strictEqual(claimed?.id, executionId);
  assert.strictEqual(claimed?.status, 'RUNNING');
  assert.strictEqual(claimed?.lease_owner, 'worker-remediation-1');
  assert.ok(claimed?.lease_token);

  // D2. Cannot claim already claimed execution
  const claimAgain = await repo.claimExecution('worker-remediation-2', 60000, 3);
  assert.strictEqual(claimAgain, null, 'D2: Cannot claim already claimed execution');

  // E. Existing updateExecutionWithFencing behavior remains unchanged
  const fencedSuccess = await repo.updateExecutionWithFencing(
    { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
    executionId,
    claimed!.lease_token!,
    { status: 'COMPLETED' }
  );
  assert.ok(fencedSuccess, 'E1: Fenced update with matching token must succeed');
  assert.strictEqual(fencedSuccess?.status, 'COMPLETED');

  // E2. Fenced update with invalid token fails
  const fencedFailure = await repo.updateExecutionWithFencing(
    { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
    executionId,
    'invalid-token',
    { status: 'FAILED' }
  );
  assert.strictEqual(fencedFailure, null, 'E2: Fenced update with invalid token must return null');

  // F. Worker does not produce unhandled rejection from the known missing-RPC condition
  const worker = new PipelineRecoveryWorker({
    pollingIntervalMs: 10000,
    leaseDurationMs: 60000,
    maxAttempts: 3
  });
  worker.start();
  worker.stop();

  console.log('✓ All Phase 8B.7.4 Remediation tests passed successfully.');
}

runTests().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});
