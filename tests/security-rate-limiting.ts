/**
 * GrowthForge Phase 8A.8 — Security Rate Limiting Test Suite
 * Verifies tenant-aware rate limiting, isolation, 429 responses, and quota enforcement.
 */

import { supabaseDataService } from '../app/services/supabase/repositories';
import { rateLimit, RateLimitError } from '../app/middleware/rateLimit';

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

async function runRateLimitingSuite() {
  console.log('============================================================');
  console.log('GROWTHFORGE SECURITY — PHASE 8A.8 RATE LIMITING VERIFICATION');
  console.log('============================================================\n');

  // Test 1: Rate limiter allows requests within limit
  try {
    const tenantId = `tenant-rl-${Date.now()}`;
    const res = await supabaseDataService.security.checkAndIncrementRateLimit(tenantId, 'test_api', 60, 5);
    assert(res.allowed === true && res.count === 1, '1. Rate limiter allows request within limit');
  } catch (err: unknown) {
    assert(false, '1. Rate limiter allows request within limit', err instanceof Error ? err.message : String(err));
  }

  // Test 2: Rate limiter blocks requests exceeding limit
  try {
    const tenantId = `tenant-rl-block-${Date.now()}`;
    // Exhaust limit of 2
    await supabaseDataService.security.checkAndIncrementRateLimit(tenantId, 'test_api_block', 60, 2);
    await supabaseDataService.security.checkAndIncrementRateLimit(tenantId, 'test_api_block', 60, 2);
    const third = await supabaseDataService.security.checkAndIncrementRateLimit(tenantId, 'test_api_block', 60, 2);
    assert(third.allowed === false && third.count === 3, '2. Rate limiter blocks requests exceeding limit');
  } catch (err: unknown) {
    assert(false, '2. Rate limiter blocks requests exceeding limit', err instanceof Error ? err.message : String(err));
  }

  // Test 3: Tenant isolation (tenant A limit does not affect tenant B)
  try {
    const tenantA = `tenant-a-${Date.now()}`;
    const tenantB = `tenant-b-${Date.now()}`;
    await supabaseDataService.security.checkAndIncrementRateLimit(tenantA, 'shared_op', 60, 1);
    const resB = await supabaseDataService.security.checkAndIncrementRateLimit(tenantB, 'shared_op', 60, 1);
    assert(resB.allowed === true, '3. Tenant-aware rate limiting isolation works correctly');
  } catch (err: unknown) {
    assert(false, '3. Tenant-aware rate limiting isolation works correctly', err instanceof Error ? err.message : String(err));
  }

  // Test 4: RateLimitError properties (429 code)
  try {
    const err = new RateLimitError('Too many requests', { operation: 'test' });
    assert(err.statusCode === 429 && err.name === 'RateLimitError', '4. RateLimitError status code is 429');
  } catch (err: unknown) {
    assert(false, '4. RateLimitError status code is 429', err instanceof Error ? err.message : String(err));
  }

  console.log('\n------------------------------------------------------------');
  console.log(`RATE LIMITING TESTS SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('------------------------------------------------------------');
  if (failed > 0) {
    process.exit(1);
  }
}

runRateLimitingSuite().catch((err) => {
  console.error('Rate limiting test suite fatal error:', err);
  process.exit(1);
});
