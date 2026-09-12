/**
 * GrowthForge Phase 8A.8 — Security Concurrency Test Suite
 * Verifies resource locks, duplicate enrichment prevention, and idempotency guarantees.
 */

import { supabaseDataService } from '../app/services/supabase/repositories';
import { costAndConcurrencyControl, ConcurrencyError } from '../app/services/security/costAndConcurrencyControl';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${testName}${detail ? ` -> ${detail}` : ''}`);
    failed++;
  }
}

async function runConcurrencySuite() {
  console.log('============================================================');
  console.log('GROWTHFORGE SECURITY — PHASE 8A.8 CONCURRENCY VERIFICATION');
  console.log('============================================================\n');

  // Test 1: Resource locking prevents concurrent duplicate enrichment
  try {
    const leadId = `lead-lock-${Date.now()}`;
    const locked1 = await supabaseDataService.security.acquireResourceLock('enrichment', leadId, 'tenant-1', 'worker-A', 60);
    const locked2 = await supabaseDataService.security.acquireResourceLock('enrichment', leadId, 'tenant-1', 'worker-B', 60);

    assert(locked1 === true && locked2 === false, '1. Resource locking prevents concurrent duplicate processing for same resource');
    await supabaseDataService.security.releaseResourceLock('enrichment', leadId, 'worker-A');
  } catch (err: unknown) {
    assert(false, '1. Resource locking prevents concurrent duplicate processing', err instanceof Error ? err.message : String(err));
  }

  // Test 2: Idempotency dispatch protection (`withSarvamDispatchConcurrency`)
  try {
    const leadId = `lead-idem-${Date.now()}`;
    const key = `idem-key-${Date.now()}`;
    let callCount = 0;

    const fn = async () => {
      callCount++;
      return { callId: `call-${callCount}`, status: 'DISPATCHED' };
    };

    const res1 = await costAndConcurrencyControl.withSarvamDispatchConcurrency(leadId, 'tenant-1', key, fn);
    const res2 = await costAndConcurrencyControl.withSarvamDispatchConcurrency(leadId, 'tenant-1', key, fn);

    assert(res1.cached === false && res2.cached === true && callCount === 1, '2. Sarvam duplicate call protection ensures exactly one billable dispatch');
  } catch (err: unknown) {
    assert(false, '2. Sarvam duplicate call protection', err instanceof Error ? err.message : String(err));
  }

  // Test 3: Scout concurrency wrapper (`withScoutConcurrency`)
  try {
    const leadId = `lead-scout-${Date.now()}`;
    let executed = false;
    await costAndConcurrencyControl.withScoutConcurrency(leadId, 'tenant-1', async () => {
      executed = true;
      return 'enriched';
    });
    assert(Boolean(executed), '3. Scout concurrency wrapper executes successfully');
  } catch (err: unknown) {
    assert(false, '3. Scout concurrency wrapper', err instanceof Error ? err.message : String(err));
  }

  console.log('\n------------------------------------------------------------');
  console.log(`CONCURRENCY TESTS SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('------------------------------------------------------------');
  if (failed > 0) {
    process.exit(1);
  }
}

runConcurrencySuite().catch((err) => {
  console.error('Concurrency test suite fatal error:', err);
  process.exit(1);
});
