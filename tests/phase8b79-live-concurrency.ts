/**
 * GrowthForge Phase 8B.7.9: Live Multi-Worker Claim / Lease / Fencing Concurrency Verification
 *
 * Proves against the LIVE Supabase/PostgreSQL database that:
 * 1. Concurrent claims are serialized via row locking (FOR UPDATE SKIP LOCKED).
 * 2. Exactly one worker wins; the loser receives zero claims.
 * 3. Expired leases permit safe reclaim by another worker.
 * 4. Fenced mutations with stale lease tokens are strictly rejected.
 * 5. Completed executions are protected against stale zombie mutations.
 * 6. Tenant isolation is enforced across normal tenant scopes.
 * 7. Attempt counts increment with absolute integrity (no double/lost increments).
 * 8. Competing reclaimers are serialized safely (reclaim itself is concurrency-safe).
 */

import assert from 'assert';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseConfig, getSupabaseAdminClient } from '../app/services/supabase/client';
import { supabaseDataService } from '../app/services/supabase/repositories';
import { buyerPipelineCoordinator } from '../app/services/pipeline/buyerPipelineCoordinator';
import { generateUUID } from '../app/services/security/correlationContext';
import { PipelineExecution } from '../app/schemas/database';

async function runLiveConcurrencySuite() {
  console.log('===============================================================');
  console.log('PHASE 8B.7.9: LIVE MULTI-WORKER CONCURRENCY VERIFICATION SUITE');
  console.log('TARGET: LIVE SUPABASE / POSTGRESQL');
  console.log('===============================================================');

  const config = getSupabaseConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!config.url || !serviceRoleKey) {
    console.error('CRITICAL: Live Supabase credentials missing (SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY).');
    process.exit(1);
  }

  const adminClient = getSupabaseAdminClient();
  if (!adminClient) {
    console.error('CRITICAL: Failed to obtain Supabase admin client.');
    process.exit(1);
  }

  // Create genuinely independent clients simulating separate worker processes / database connections
  const workerAClient: SupabaseClient = createClient(config.url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const workerBClient: SupabaseClient = createClient(config.url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const workerCClient: SupabaseClient = createClient(config.url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const repo = supabaseDataService.pipelineExecutions;

  // Track created test artifacts for safe cleanup in reverse dependency order
  const createdExecutionIds: string[] = [];
  const createdLeadIds: string[] = [];
  const createdTenantIds: string[] = [];

  const results = {
    testA: false,
    testB: false,
    testC: false,
    testD: false,
    testE: false,
    testF: false,
    testG: false
  };

  try {
    // -------------------------------------------------------------
    // SETUP: Create isolated test tenants and leads
    // -------------------------------------------------------------
    console.log('\n[SETUP] Creating isolated test tenants and leads in live database...');

    const tenantAId = generateUUID();
    const tenantBId = generateUUID();

    const { error: tErrA } = await adminClient.from('tenants').insert({
      id: tenantAId,
      name: 'Phase 8B.7.9 Concurrency Tenant A',
      slug: `concur-a-${tenantAId.slice(0, 8)}`
    });
    assert(!tErrA, `Failed to create test Tenant A: ${tErrA?.message}`);
    createdTenantIds.push(tenantAId);

    const { error: tErrB } = await adminClient.from('tenants').insert({
      id: tenantBId,
      name: 'Phase 8B.7.9 Concurrency Tenant B',
      slug: `concur-b-${tenantBId.slice(0, 8)}`
    });
    assert(!tErrB, `Failed to create test Tenant B: ${tErrB?.message}`);
    createdTenantIds.push(tenantBId);

    const leadAId = generateUUID();
    const { error: lErrA } = await adminClient.from('leads').insert({
      id: leadAId,
      tenant_id: tenantAId,
      lead_id: `LEAD-A-${leadAId.slice(0, 8)}`,
      name: 'Concurrency Lead A',
      phone: '+15555550101',
      status: 'RAW'
    });
    assert(!lErrA, `Failed to create test Lead A: ${lErrA?.message}`);
    createdLeadIds.push(leadAId);

    const leadBId = generateUUID();
    const { error: lErrB } = await adminClient.from('leads').insert({
      id: leadBId,
      tenant_id: tenantBId,
      lead_id: `LEAD-B-${leadBId.slice(0, 8)}`,
      name: 'Concurrency Lead B',
      phone: '+15555550102',
      status: 'RAW'
    });
    assert(!lErrB, `Failed to create test Lead B: ${lErrB?.message}`);
    createdLeadIds.push(leadBId);

    console.log('✓ Isolated test fixtures created successfully.');

    // -------------------------------------------------------------
    // TEST A — CONCURRENT CLAIM
    // -------------------------------------------------------------
    console.log('\n--- TEST A: CONCURRENT CLAIM (2 independent workers competing for 1 PENDING execution) ---');
    const execAId = generateUUID();
    const { error: eErrA } = await adminClient.from('pipeline_executions').insert({
      id: execAId,
      tenant_id: tenantAId,
      lead_id: leadAId,
      correlation_id: generateUUID(),
      status: 'PENDING',
      attempt_count: 0
    });
    assert(!eErrA, `Failed to insert pending execution: ${eErrA?.message}`);
    createdExecutionIds.push(execAId);

    const workerAId = `worker-A-${generateUUID()}`;
    const workerBId = `worker-B-${generateUUID()}`;

    console.log(`Worker A (${workerAId}) and Worker B (${workerBId}) attempting simultaneous claim...`);
    const [claimA, claimB] = await Promise.all([
      workerAClient.rpc('claim_pipeline_execution', {
        p_worker_id: workerAId,
        p_lease_duration: '60 seconds',
        p_max_attempts: 3
      }),
      workerBClient.rpc('claim_pipeline_execution', {
        p_worker_id: workerBId,
        p_lease_duration: '60 seconds',
        p_max_attempts: 3
      })
    ]);

    assert(!claimA.error, `Worker A RPC error: ${claimA.error?.message}`);
    assert(!claimB.error, `Worker B RPC error: ${claimB.error?.message}`);

    const workerAWon = (claimA.data?.length ?? 0) === 1;
    const workerBWon = (claimB.data?.length ?? 0) === 1;

    console.log(`Worker A claimed: ${workerAWon ? 'YES' : 'NO'}`);
    console.log(`Worker B claimed: ${workerBWon ? 'YES' : 'NO'}`);

    // Invariant: Exactly one worker wins; the other receives empty array (0 claims)
    assert(
      (workerAWon && !workerBWon) || (!workerAWon && workerBWon),
      'CRITICAL INVARIANT VIOLATION: Exactly one worker must claim the execution'
    );

    const winningClaim = workerAWon ? claimA.data![0] : claimB.data![0];
    const winningWorkerId = workerAWon ? workerAId : workerBId;
    const losingWorkerId = workerAWon ? workerBId : workerAId;

    // Verify row state in live database
    const { data: currentExecA, error: fetchErr } = await adminClient
      .from('pipeline_executions')
      .select('*')
      .eq('id', execAId)
      .single();

    assert(!fetchErr && currentExecA, `Failed to fetch execution: ${fetchErr?.message}`);
    assert(currentExecA.status === 'RUNNING', `Status must be RUNNING, got ${currentExecA.status}`);
    assert(currentExecA.lease_owner === winningWorkerId, `lease_owner must be ${winningWorkerId}`);
    assert(currentExecA.lease_token === winningClaim.lease_token, 'lease_token must match winning claim');
    assert(currentExecA.attempt_count === 1, `attempt_count must increment exactly once to 1, got ${currentExecA.attempt_count}`);

    console.log(`✓ TEST A PASSED: Exactly one worker (${winningWorkerId}) claimed execution. Attempt count = 1. Loser received 0 claims.`);
    results.testA = true;

    // Save tokens for Test B and C
    let activeWorkerId = winningWorkerId;
    let activeLeaseToken = winningClaim.lease_token;
    let staleWorkerId = losingWorkerId;
    let staleLeaseToken = winningClaim.lease_token; // will become stale after reclaim

    // -------------------------------------------------------------
    // TEST B — LEASE EXPIRY + RECLAIM
    // -------------------------------------------------------------
    console.log('\n--- TEST B: LEASE EXPIRY + RECLAIM ---');
    console.log(`Expiring lease for execution ${execAId} in live database...`);

    // Safely set lease_expires_at to 10 seconds in the past
    const expiredTimestamp = new Date(Date.now() - 10000).toISOString();
    const { error: expErr } = await adminClient
      .from('pipeline_executions')
      .update({ lease_expires_at: expiredTimestamp })
      .eq('id', execAId);
    assert(!expErr, `Failed to expire lease: ${expErr?.message}`);

    const newWorkerId = `worker-reclaim-${generateUUID()}`;
    console.log(`New worker (${newWorkerId}) attempting to claim expired execution...`);

    const { data: reclaimData, error: reclaimErr } = await workerCClient.rpc('claim_pipeline_execution', {
      p_worker_id: newWorkerId,
      p_lease_duration: '60 seconds',
      p_max_attempts: 3
    });

    assert(!reclaimErr, `Reclaim RPC error: ${reclaimErr?.message}`);
    assert(reclaimData && reclaimData.length === 1, 'Reclaiming worker must successfully claim expired execution');

    const reclaimedExec = reclaimData[0];
    assert(reclaimedExec.id === execAId, 'Claimed execution ID must match');
    assert(reclaimedExec.lease_owner === newWorkerId, `lease_owner must be updated to ${newWorkerId}`);
    assert(reclaimedExec.lease_token !== activeLeaseToken, 'lease_token must be a new distinct UUID');
    assert(reclaimedExec.attempt_count === 2, `attempt_count must increment exactly once on reclaim to 2, got ${reclaimedExec.attempt_count}`);

    console.log(`✓ TEST B PASSED: Expired lease reclaimed by ${newWorkerId}. attempt_count incremented 1 -> 2. New token generated.`);
    results.testB = true;

    // The old winning token is now definitely stale, newWorkerId holds valid lease
    staleLeaseToken = activeLeaseToken;
    activeWorkerId = newWorkerId;
    activeLeaseToken = reclaimedExec.lease_token;

    // -------------------------------------------------------------
    // TEST C — ZOMBIE WORKER FENCING
    // -------------------------------------------------------------
    console.log('\n--- TEST C: ZOMBIE WORKER FENCING ---');
    console.log(`Zombie worker attempting fenced update with stale lease_token (${staleLeaseToken})...`);

    const staleMutationResult = await repo.updateExecutionWithFencing(
      { tenantId: tenantAId, isPlatformAdmin: false },
      execAId,
      staleLeaseToken,
      {
        current_stage: 'ZOMBIE_STAGE',
        last_error: 'Stale worker should never be able to write this'
      }
    );

    assert(staleMutationResult === null, 'CRITICAL INVARIANT VIOLATION: Stale lease_token must return null (zero rows affected)');

    // Verify row in live DB was unchanged by zombie mutation
    const { data: postZombieExec } = await adminClient
      .from('pipeline_executions')
      .select('*')
      .eq('id', execAId)
      .single();

    assert(postZombieExec.current_stage !== 'ZOMBIE_STAGE', 'current_stage must NOT be updated by stale worker');
    assert(postZombieExec.lease_owner === activeWorkerId, 'lease_owner must remain the active reclaiming worker');
    assert(postZombieExec.lease_token === activeLeaseToken, 'lease_token must remain the active token');

    console.log('✓ Zombie mutation rejected. Active worker now executing legitimate fenced mutation...');

    const legitimateMutationResult = await repo.updateExecutionWithFencing(
      { tenantId: tenantAId, isPlatformAdmin: false },
      execAId,
      activeLeaseToken,
      {
        current_stage: 'EXTRACTION'
      }
    );

    assert(legitimateMutationResult !== null, 'Legitimate mutation with active token must succeed');
    assert(legitimateMutationResult.current_stage === 'EXTRACTION', 'Stage must update to EXTRACTION');

    const { data: postValidExec } = await adminClient
      .from('pipeline_executions')
      .select('*')
      .eq('id', execAId)
      .single();

    assert(postValidExec.current_stage === 'EXTRACTION', 'Database must reflect valid update');
    console.log('✓ TEST C PASSED: Zombie worker fenced out. Legitimate worker mutation committed.');
    results.testC = true;

    // -------------------------------------------------------------
    // TEST D — TERMINAL FENCING
    // -------------------------------------------------------------
    console.log('\n--- TEST D: TERMINAL FENCING ---');
    console.log('Active worker transitioning execution to COMPLETED...');

    const completedResult = await repo.updateExecutionWithFencing(
      { tenantId: tenantAId, isPlatformAdmin: false },
      execAId,
      activeLeaseToken,
      {
        status: 'COMPLETED',
        completed_at: new Date().toISOString()
      }
    );

    assert(completedResult !== null, 'Completion with valid token must succeed');
    assert(completedResult.status === 'COMPLETED', 'Status must be COMPLETED');

    console.log('Zombie worker attempting mutation on COMPLETED execution with stale token...');
    const staleTerminalMutation = await repo.updateExecutionWithFencing(
      { tenantId: tenantAId, isPlatformAdmin: false },
      execAId,
      staleLeaseToken,
      {
        status: 'FAILED',
        last_error: 'Zombie overwrite attempt'
      }
    );

    assert(staleTerminalMutation === null, 'Stale token mutation on COMPLETED execution must be rejected');

    const { data: terminalExec } = await adminClient
      .from('pipeline_executions')
      .select('*')
      .eq('id', execAId)
      .single();

    assert(terminalExec.status === 'COMPLETED', 'Status in database must remain COMPLETED');
    console.log('✓ TEST D PASSED: Terminal state (COMPLETED) protected against stale zombie writes.');
    results.testD = true;

    // -------------------------------------------------------------
    // TEST E — TENANT ISOLATION
    // -------------------------------------------------------------
    console.log('\n--- TEST E: TENANT ISOLATION ---');
    console.log('Creating execution for Tenant B...');

    const execBId = generateUUID();
    const { error: eErrB } = await adminClient.from('pipeline_executions').insert({
      id: execBId,
      tenant_id: tenantBId,
      lead_id: leadBId,
      correlation_id: generateUUID(),
      status: 'PENDING',
      attempt_count: 0
    });
    assert(!eErrB, `Failed to create Execution B: ${eErrB?.message}`);
    createdExecutionIds.push(execBId);

    const tenantAScope = { tenantId: tenantAId, isPlatformAdmin: false };
    const tenantBScope = { tenantId: tenantBId, isPlatformAdmin: false };

    // 1. Tenant A cannot read Tenant B's execution
    console.log("Verifying Tenant A cannot read Tenant B's execution...");
    const crossTenantGet = await repo.getExecution(tenantAScope, execBId);
    assert(crossTenantGet === null, "Tenant A must NOT be able to get Tenant B's execution");

    // 2. Tenant A cannot mutate Tenant B's execution via updateExecution
    console.log("Verifying Tenant A cannot mutate Tenant B's execution via updateExecution...");
    let crossTenantUpdateThrew = false;
    try {
      await repo.updateExecution(tenantAScope, execBId, { current_stage: 'ROGUE_STAGE' });
    } catch (err: any) {
      crossTenantUpdateThrew = true;
    }
    assert(crossTenantUpdateThrew, "Tenant A update of Tenant B's execution must be rejected");

    // 3. Tenant A cannot mutate Tenant B's execution via fenced update
    console.log("Verifying Tenant A cannot mutate Tenant B's execution via fenced update...");
    const crossTenantFenced = await repo.updateExecutionWithFencing(
      tenantAScope,
      execBId,
      generateUUID(),
      { current_stage: 'ROGUE_STAGE' }
    );
    assert(crossTenantFenced === null, 'Cross-tenant fenced update must return null');

    // 4. Coordinator rejects cross-tenant invocation
    console.log('Verifying BuyerPipelineCoordinator rejects cross-tenant runPipeline...');
    const coordResult = await buyerPipelineCoordinator.runPipeline({
      leadId: leadBId, // belongs to Tenant B
      tenantId: tenantAId, // requested by Tenant A
      forceRerun: false
    });
    assert(
      coordResult.success === false,
      'BuyerPipelineCoordinator must reject cross-tenant execution'
    );
    assert(
      coordResult.error && (coordResult.error.includes('isolation') || coordResult.error.includes('Tenant')),
      `Failure reason must indicate tenant isolation violation, got: ${coordResult.error}`
    );

    console.log('✓ TEST E PASSED: Strict tenant boundaries enforced across all access and execution paths.');
    results.testE = true;

    // Transition execBId to COMPLETED so it does not remain PENDING for subsequent tests
    await adminClient.from('pipeline_executions').update({ status: 'COMPLETED' }).eq('id', execBId);

    // -------------------------------------------------------------
    // TEST F — ATTEMPT COUNT INTEGRITY
    // -------------------------------------------------------------
    console.log('\n--- TEST F: ATTEMPT COUNT INTEGRITY (0 -> 1 -> 2 Sequence) ---');

    const execFId = generateUUID();
    const { error: eErrF } = await adminClient.from('pipeline_executions').insert({
      id: execFId,
      tenant_id: tenantAId,
      lead_id: leadAId,
      correlation_id: generateUUID(),
      status: 'PENDING',
      attempt_count: 0
    });
    assert(!eErrF, `Failed to insert execution for Test F: ${eErrF?.message}`);
    createdExecutionIds.push(execFId);

    // Initial state: attempt_count = 0
    const { data: initialExecF } = await adminClient
      .from('pipeline_executions')
      .select('attempt_count, status')
      .eq('id', execFId)
      .single();
    assert(initialExecF.attempt_count === 0, `Initial attempt_count must be 0, got ${initialExecF.attempt_count}`);
    assert(initialExecF.status === 'PENDING', `Initial status must be PENDING, got ${initialExecF.status}`);

    // Claim 1: Worker A
    const workerF1Id = `worker-F1-${generateUUID()}`;
    const { data: claimF1 } = await workerAClient.rpc('claim_pipeline_execution', {
      p_worker_id: workerF1Id,
      p_lease_duration: '60 seconds',
      p_max_attempts: 3
    });
    assert(claimF1 && claimF1.length === 1 && claimF1[0].id === execFId, 'Worker F1 must claim execution F');
    assert(claimF1[0].attempt_count === 1, `Claim 1 must increment attempt_count to 1, got ${claimF1[0].attempt_count}`);

    // Expire lease
    await adminClient.from('pipeline_executions').update({
      lease_expires_at: new Date(Date.now() - 10000).toISOString()
    }).eq('id', execFId);

    // Claim 2: Worker B reclaim
    const workerF2Id = `worker-F2-${generateUUID()}`;
    const { data: claimF2 } = await workerBClient.rpc('claim_pipeline_execution', {
      p_worker_id: workerF2Id,
      p_lease_duration: '60 seconds',
      p_max_attempts: 3
    });
    assert(claimF2 && claimF2.length === 1 && claimF2[0].id === execFId, 'Worker F2 must reclaim execution F');
    assert(claimF2[0].attempt_count === 2, `Claim 2 must increment attempt_count to 2, got ${claimF2[0].attempt_count}`);

    // Verify in DB directly
    const { data: finalExecF } = await adminClient
      .from('pipeline_executions')
      .select('attempt_count, status')
      .eq('id', execFId)
      .single();
    assert(finalExecF.attempt_count === 2, `Final attempt_count in DB must be exactly 2, got ${finalExecF.attempt_count}`);

    console.log('✓ TEST F PASSED: Attempt count sequence 0 -> 1 -> 2 verified with no lost or duplicate increments.');
    results.testF = true;

    // -------------------------------------------------------------
    // TEST G — COMPETING RECLAIMERS
    // -------------------------------------------------------------
    console.log('\n--- TEST G: COMPETING RECLAIMERS (Worker B and Worker C simultaneously reclaiming expired execution) ---');

    // Expire execution F again so both Worker B and Worker C compete for the reclaim
    await adminClient.from('pipeline_executions').update({
      lease_expires_at: new Date(Date.now() - 10000).toISOString()
    }).eq('id', execFId);

    const reclaimerBId = `reclaimer-B-${generateUUID()}`;
    const reclaimerCId = `reclaimer-C-${generateUUID()}`;

    console.log(`Simultaneous reclaim: ${reclaimerBId} vs ${reclaimerCId}...`);
    const [reclaimResB, reclaimResC] = await Promise.all([
      workerBClient.rpc('claim_pipeline_execution', {
        p_worker_id: reclaimerBId,
        p_lease_duration: '60 seconds',
        p_max_attempts: 5
      }),
      workerCClient.rpc('claim_pipeline_execution', {
        p_worker_id: reclaimerCId,
        p_lease_duration: '60 seconds',
        p_max_attempts: 5
      })
    ]);

    assert(!reclaimResB.error, `Reclaim B error: ${reclaimResB.error?.message}`);
    assert(!reclaimResC.error, `Reclaim C error: ${reclaimResC.error?.message}`);

    const bWon = (reclaimResB.data?.length ?? 0) === 1;
    const cWon = (reclaimResC.data?.length ?? 0) === 1;

    console.log(`Reclaimer B succeeded: ${bWon ? 'YES' : 'NO'}`);
    console.log(`Reclaimer C succeeded: ${cWon ? 'YES' : 'NO'}`);

    // Invariant: Exactly one reclaimer wins; the other receives 0 claims
    assert(
      (bWon && !cWon) || (!bWon && cWon),
      'CRITICAL INVARIANT VIOLATION: Exactly one competing reclaimer must succeed'
    );

    const winningReclaimerId = bWon ? reclaimerBId : reclaimerCId;
    const winningReclaimData = bWon ? reclaimResB.data![0] : reclaimResC.data![0];

    const { data: dbReclaimState } = await adminClient
      .from('pipeline_executions')
      .select('*')
      .eq('id', execFId)
      .single();

    assert(dbReclaimState.lease_owner === winningReclaimerId, `lease_owner must be ${winningReclaimerId}`);
    assert(dbReclaimState.lease_token === winningReclaimData.lease_token, 'lease_token must match winning reclaim');
    assert(dbReclaimState.attempt_count === 3, `attempt_count must increment from 2 to exactly 3, got ${dbReclaimState.attempt_count}`);

    console.log(`✓ TEST G PASSED: Competing reclaim serialized cleanly by PostgreSQL row lock. Winner: ${winningReclaimerId}, attempt_count: 3.`);
    results.testG = true;

  } finally {
    // -------------------------------------------------------------
    // STEP 3: SAFE CLEANUP IN REVERSE DEPENDENCY ORDER
    // -------------------------------------------------------------
    console.log('\n===============================================================');
    console.log('[CLEANUP] Cleaning up all test artifacts from live database...');

    let cleanupFailed = false;

    // 1. Delete pipeline_executions
    if (createdExecutionIds.length > 0) {
      console.log(`Deleting ${createdExecutionIds.length} test pipeline executions...`);
      const { error: delExecErr } = await adminClient
        .from('pipeline_executions')
        .delete()
        .in('id', createdExecutionIds);
      if (delExecErr) {
        console.error('Failed to clean up test pipeline executions:', delExecErr);
        cleanupFailed = true;
      }
    }

    // 2. Delete test leads
    if (createdLeadIds.length > 0) {
      console.log(`Deleting ${createdLeadIds.length} test leads...`);
      const { error: delLeadErr } = await adminClient
        .from('leads')
        .delete()
        .in('id', createdLeadIds);
      if (delLeadErr) {
        console.error('Failed to clean up test leads:', delLeadErr);
        cleanupFailed = true;
      }
    }

    // 3. Delete test tenants
    if (createdTenantIds.length > 0) {
      console.log(`Deleting ${createdTenantIds.length} test tenants...`);
      const { error: delTenantErr } = await adminClient
        .from('tenants')
        .delete()
        .in('id', createdTenantIds);
      if (delTenantErr) {
        console.error('Failed to clean up test tenants:', delTenantErr);
        cleanupFailed = true;
      }
    }

    if (cleanupFailed) {
      console.error('CRITICAL: Cleanup encountered errors! Check logs above.');
      process.exit(1);
    } else {
      console.log('✓ All test artifacts cleaned up successfully. Database in clean state.');
    }
  }

  // Summary
  console.log('\n===============================================================');
  console.log('PHASE 8B.7.9 CONCURRENCY VERIFICATION SUMMARY:');
  console.log(`TEST A (Concurrent Claim):        ${results.testA ? 'PASSED' : 'FAILED'}`);
  console.log(`TEST B (Lease Expiry + Reclaim):  ${results.testB ? 'PASSED' : 'FAILED'}`);
  console.log(`TEST C (Zombie Worker Fencing):   ${results.testC ? 'PASSED' : 'FAILED'}`);
  console.log(`TEST D (Terminal Fencing):        ${results.testD ? 'PASSED' : 'FAILED'}`);
  console.log(`TEST E (Tenant Isolation):        ${results.testE ? 'PASSED' : 'FAILED'}`);
  console.log(`TEST F (Attempt Count Integrity): ${results.testF ? 'PASSED' : 'FAILED'}`);
  console.log(`TEST G (Competing Reclaimers):    ${results.testG ? 'PASSED' : 'FAILED'}`);
  console.log('===============================================================');

  const allPassed = Object.values(results).every(Boolean);
  if (!allPassed) {
    console.error('One or more concurrency tests failed!');
    process.exit(1);
  }
}

runLiveConcurrencySuite().catch((err) => {
  console.error('Unhandled failure in Phase 8B.7.9 live concurrency test suite:', err);
  process.exit(1);
});
