import assert from 'assert';
import { pipelineRecoveryWorker } from '../app/services/pipeline/pipelineRecoveryWorker';
import { gracefulShutdown, trackInFlightTask, resetShutdownStateForTesting, getInFlightTaskCount } from '../server';
import { buyerPipelineCoordinator } from '../app/services/pipeline/buyerPipelineCoordinator';
import { createPipelineExecutionsRepository } from '../app/services/supabase/repos/pipelineExecutionsRepo';
import { resetSupabaseClient } from '../app/services/supabase/client';
import { generateUUID } from '../app/services/security/correlationContext';
import { DEFAULT_TENANT_ID } from '../app/schemas/tenant';
import { supabaseDataService } from '../app/services/supabase/repositories';

async function runTests() {
  console.log('====================================================');
  console.log('Phase 8B.7.8: Service-Role Alignment & Shutdown Tests');
  console.log('====================================================');

  const origUrl = process.env.SUPABASE_URL;
  const origAnonKey = process.env.SUPABASE_ANON_KEY;
  const origServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    // -------------------------------------------------------------
    // TEST A — ADMIN CLIENT USED FOR DURABLE EXECUTION
    // -------------------------------------------------------------
    console.log('\n--- TEST A: Admin client used for durable execution ---');
    {
      const store = new Map();
      const repo = createPipelineExecutionsRepository(store);
      assert(typeof repo.claimExecution === 'function', 'claimExecution must exist');
      assert(typeof repo.updateExecutionWithFencing === 'function', 'updateExecutionWithFencing must exist');
      assert(typeof repo.createExecution === 'function', 'createExecution must exist');
      console.log('✓ TEST A PASSED: Repository interface matches durable execution contract');
    }

    // -------------------------------------------------------------
    // TEST B — NO SILENT ANON FALLBACK
    // -------------------------------------------------------------
    console.log('\n--- TEST B: No silent anon fallback when admin key missing ---');
    {
      // Configure live Supabase URL + Anon Key, but explicitly remove Service Role Key
      process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
      process.env.SUPABASE_ANON_KEY = 'fake-anon-key';
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      resetSupabaseClient();

      const store = new Map();
      const repo = createPipelineExecutionsRepository(store);

      let createError: any = null;
      try {
        await repo.createExecution(
          { tenantId: 'tenant-1', isPlatformAdmin: false },
          { lead_id: generateUUID(), correlation_id: generateUUID() }
        );
      } catch (err: any) {
        createError = err;
      }
      assert(createError !== null, 'createExecution MUST throw when SUPABASE_SERVICE_ROLE_KEY is missing');
      assert(
        createError.message.includes('SUPABASE_SERVICE_ROLE_KEY environment variable is required'),
        `Error message must demand SUPABASE_SERVICE_ROLE_KEY, got: ${createError.message}`
      );

      let claimError: any = null;
      try {
        await repo.claimExecution('worker-test', 60000, 3);
      } catch (err: any) {
        claimError = err;
      }
      assert(claimError !== null, 'claimExecution MUST throw when SUPABASE_SERVICE_ROLE_KEY is missing');
      assert(
        claimError.message.includes('SUPABASE_SERVICE_ROLE_KEY environment variable is required'),
        `Error message must demand SUPABASE_SERVICE_ROLE_KEY, got: ${claimError.message}`
      );

      let fenceError: any = null;
      try {
        await repo.updateExecutionWithFencing(
          { tenantId: 'tenant-1', isPlatformAdmin: false },
          generateUUID(),
          generateUUID(),
          { status: 'RUNNING' }
        );
      } catch (err: any) {
        fenceError = err;
      }
      assert(fenceError !== null, 'updateExecutionWithFencing MUST throw when SUPABASE_SERVICE_ROLE_KEY is missing');
      assert(
        fenceError.message.includes('SUPABASE_SERVICE_ROLE_KEY environment variable is required'),
        `Error message must demand SUPABASE_SERVICE_ROLE_KEY, got: ${fenceError.message}`
      );

      console.log('✓ TEST B PASSED: Strict rejection with no silent anon downgrade');
    }

    // Restore environment after Test B
    if (origUrl !== undefined) process.env.SUPABASE_URL = origUrl; else delete process.env.SUPABASE_URL;
    if (origAnonKey !== undefined) process.env.SUPABASE_ANON_KEY = origAnonKey; else delete process.env.SUPABASE_ANON_KEY;
    if (origServiceKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = origServiceKey; else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    resetSupabaseClient();

    // -------------------------------------------------------------
    // TEST C — TENANT CONTEXT PRESERVED
    // -------------------------------------------------------------
    console.log('\n--- TEST C: Tenant context preserved (cross-tenant rejected) ---');
    {
      const tenant1 = '11111111-1111-1111-1111-111111111111';
      const tenant2 = '22222222-2222-2222-2222-222222222222';
      const leadId = generateUUID();
      const leadBusinessId = `LEAD-${generateUUID()}`;

      // Create lead belonging to tenant2 in repository store
      await supabaseDataService.leads.createLead(
        { tenantId: tenant2, isPlatformAdmin: false },
        {
          id: leadId,
          lead_id: leadBusinessId,
          first_name: 'Cross',
          last_name: 'Tenant',
          status: 'RAW'
        } as any
      );

      // Now run pipeline with tenant1 scope
      const res = await buyerPipelineCoordinator.runPipeline({
        executionId: generateUUID(),
        leadId,
        tenantId: tenant1,
        forceRerun: false
      });

      assert(res.success === false, 'Cross-tenant execution must fail');
      assert(
        res.error?.toLowerCase().includes('tenant isolation violation') ||
        res.error?.includes('not found in authorized tenant context'),
        `Expected tenant isolation error, got: ${res.error}`
      );
      console.log('✓ TEST C PASSED: Tenant isolation strictly enforced');
    }

    // -------------------------------------------------------------
    // TEST D — SIGTERM SHUTDOWN
    // -------------------------------------------------------------
    console.log('\n--- TEST D: SIGTERM shutdown stops polling and drains ---');
    {
      resetShutdownStateForTesting();
      pipelineRecoveryWorker.start();
      assert((pipelineRecoveryWorker as any).isRunning === true, 'Worker should be running');

      await gracefulShutdown('SIGTERM', { drainTimeoutMs: 100, exitProcess: false });

      assert((pipelineRecoveryWorker as any).isRunning === false, 'Worker must be stopped after SIGTERM');
      assert((pipelineRecoveryWorker as any).intervalId === null, 'Worker polling interval must be cleared');
      console.log('✓ TEST D PASSED: SIGTERM shutdown successfully stopped worker and cleared interval');
    }

    // -------------------------------------------------------------
    // TEST E — SIGINT SHUTDOWN
    // -------------------------------------------------------------
    console.log('\n--- TEST E: SIGINT shutdown stops polling and drains ---');
    {
      resetShutdownStateForTesting();
      pipelineRecoveryWorker.start();
      assert((pipelineRecoveryWorker as any).isRunning === true, 'Worker should be running');

      await gracefulShutdown('SIGINT', { drainTimeoutMs: 100, exitProcess: false });

      assert((pipelineRecoveryWorker as any).isRunning === false, 'Worker must be stopped after SIGINT');
      assert((pipelineRecoveryWorker as any).intervalId === null, 'Worker polling interval must be cleared');
      console.log('✓ TEST E PASSED: SIGINT shutdown successfully stopped worker and cleared interval');
    }

    // -------------------------------------------------------------
    // TEST F — ACTIVE EXECUTION DRAIN & BOUNDED TIMEOUT
    // -------------------------------------------------------------
    console.log('\n--- TEST F: Active execution drain and bounded timeout ---');
    {
      resetShutdownStateForTesting();
      pipelineRecoveryWorker.start();

      // 1. Task settles before drain timeout
      let settled: boolean = false;
      const fastTask = new Promise<void>((resolve) => {
        setTimeout(() => {
          settled = true;
          resolve();
        }, 50);
      });
      trackInFlightTask(fastTask);
      assert(getInFlightTaskCount() === 1, 'In flight task count should be 1');

      await gracefulShutdown('SIGTERM', { drainTimeoutMs: 500, exitProcess: false });
      assert(Boolean(settled) === true, 'Active task should have settled within drain window');
      assert(getInFlightTaskCount() === 0, 'In flight task count should be 0');

      // 2. Task times out — bounded shutdown does NOT wait forever
      resetShutdownStateForTesting();
      pipelineRecoveryWorker.start();

      let hungTaskFinished: boolean = false;
      const hungTask = new Promise<void>((resolve) => {
        setTimeout(() => {
          hungTaskFinished = true;
          resolve();
        }, 5000); // Takes 5 seconds
      });
      trackInFlightTask(hungTask);

      const t0 = Date.now();
      // Drain timeout is 100ms
      await gracefulShutdown('SIGTERM', { drainTimeoutMs: 100, exitProcess: false });
      const elapsed = Date.now() - t0;

      assert(elapsed < 1000, `Shutdown should exit near drain timeout (100ms), took ${elapsed}ms`);
      assert(Boolean(hungTaskFinished) === false, 'Hung task must NOT block shutdown from exiting');
      console.log(`✓ TEST F PASSED: Bounded drain timed out cleanly in ${elapsed}ms without hanging`);
    }

    // -------------------------------------------------------------
    // TEST G — REPEATED SIGNAL
    // -------------------------------------------------------------
    console.log('\n--- TEST G: Repeated signal handled idempotently ---');
    {
      resetShutdownStateForTesting();
      pipelineRecoveryWorker.start();

      await gracefulShutdown('SIGTERM', { drainTimeoutMs: 50, exitProcess: false });
      // Call again immediately with SIGINT
      await gracefulShutdown('SIGINT', { drainTimeoutMs: 50, exitProcess: false });

      assert((pipelineRecoveryWorker as any).isRunning === false, 'Worker remains stopped');
      console.log('✓ TEST G PASSED: Repeated shutdown signals handled idempotently');
    }

    console.log('\n====================================================');
    console.log('All Phase 8B.7.8 Targeted Tests PASSED!');
    console.log('====================================================');
  } finally {
    // Restore initial env
    if (origUrl !== undefined) process.env.SUPABASE_URL = origUrl;
    if (origAnonKey !== undefined) process.env.SUPABASE_ANON_KEY = origAnonKey;
    if (origServiceKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = origServiceKey;
    resetSupabaseClient();
    resetShutdownStateForTesting();
    pipelineRecoveryWorker.stop();
  }
}

runTests().catch((err) => {
  console.error('Test failure:', err);
  process.exit(1);
});
