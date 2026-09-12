/**
 * GrowthForge Phase 8A.8 — Provider Cost Controls & Stress Test Suite
 * Verifies tenant quotas, quota exceeded 429 handling, and high-concurrency stress tests.
 */

import { costAndConcurrencyControl, QuotaExceededError } from '../app/services/security/costAndConcurrencyControl';

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

async function runCostControlsSuite() {
  console.log('============================================================');
  console.log('GROWTHFORGE SECURITY — PHASE 8A.8 COST CONTROLS & STRESS');
  console.log('============================================================\n');

  // Test 1: Tenant quota enforcement & QuotaExceededError
  try {
    const tenantId = `tenant-quota-${Date.now()}`;
    let quotaErrorCaught = false;
    try {
      for (let i = 0; i < 30; i++) {
        await costAndConcurrencyControl.enforceTenantQuota(tenantId, 'sarvam');
      }
    } catch (err: unknown) {
      if (err instanceof QuotaExceededError && err.statusCode === 429) {
        quotaErrorCaught = true;
      }
    }
    assert(quotaErrorCaught === true, '1. Tenant quota enforcement throws QuotaExceededError (429) when exceeded');
  } catch (err: unknown) {
    assert(false, '1. Tenant quota enforcement', err instanceof Error ? err.message : String(err));
  }

  // Test 2: Stress test — 100 concurrent identical Sarvam-dispatch requests -> exactly 1 dispatch, 99 cached responses
  try {
    const leadId = `lead-stress-${Date.now()}`;
    const key = `stress-key-${Date.now()}`;
    let dispatches = 0;

    const fn = async () => {
      dispatches++;
      return { status: 'OK', dispatchId: dispatches };
    };

    const validUuidTenant = '12345678-1234-1234-1234-123456789012';
    const promises = Array.from({ length: 100 }, () =>
      costAndConcurrencyControl.withSarvamDispatchConcurrency(leadId, validUuidTenant, key, fn)
    );

    const results = await Promise.all(promises);
    const cachedCount = results.filter((r) => r.cached).length;
    const freshCount = results.filter((r) => !r.cached).length;
    console.log(`[DEBUG] freshCount=${freshCount}, cachedCount=${cachedCount}, dispatches=${dispatches}`);

    assert(freshCount === 1 && cachedCount === 99 && dispatches === 1, '2. Stress test: 100 concurrent requests result in 1 fresh dispatch and 99 idempotent cached responses');
  } catch (err: unknown) {
    assert(false, '2. Stress test concurrency', err instanceof Error ? err.message : String(err));
  }

  console.log('\n------------------------------------------------------------');
  console.log(`COST CONTROLS & STRESS TESTS SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('------------------------------------------------------------');
  if (failed > 0) {
    process.exit(1);
  }
}

runCostControlsSuite().catch((err) => {
  console.error('Cost controls test suite fatal error:', err);
  process.exit(1);
});
