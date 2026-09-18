/**
 * GrowthForge Buyer Intelligence Engine - Phase 9.3.1 Verification Matrix
 *
 * SPECIFICATION:
 * - Deterministic, configurable call-compliance policy (calling hours, timezone, cooldown, max attempts)
 * - First-party inbound leads in RESOLVED status can reach call eligibility with permissible consent
 * - Strict tenant isolation on call history
 * - Invariant: Zero external network or LLM calls. Fully deterministic with clock injection.
 */

import {
  CALL_COMPLIANCE_POLICY_VERSION,
  CallAttemptRecord,
  createDateInTimezone,
  evaluateCallCompliance,
  getZonedTime,
} from '../app/services/calls/callCompliance';
import {
  CALL_ELIGIBILITY_POLICY_VERSION,
  evaluateCallEligibility,
  FIRST_PARTY_INBOUND_SOURCES,
} from '../app/services/calls/callEligibility';

let passCount = 0;
let failCount = 0;

function assert(testId: string, description: string, condition: boolean, details?: unknown) {
  if (condition) {
    console.log(`  ✅ [PASS] ${testId}: ${description}`);
    passCount++;
  } else {
    console.error(`  ❌ [FAIL] ${testId}: ${description}`);
    if (details !== undefined) {
      console.error('     Details:', JSON.stringify(details, null, 2));
    }
    failCount++;
  }
}

export async function runPhase931Tests() {
  console.log('======================================================');
  console.log('🧪 GROWTHFORGE PHASE 9.3.1 — COMPLIANCE & ELIGIBILITY');
  console.log('======================================================');

  // Baseline deterministic reference timestamp in calling window:
  // 2026-09-18T10:00:00.000Z -> In Asia/Kolkata (+05:30), this is 15:30:00 (3:30 PM IST)
  const baselineNow = '2026-09-18T10:00:00.000Z';

  // -------------------------------------------------------------------------
  // 1. Existing ENRICHED lead remains eligible when all requirements pass
  // -------------------------------------------------------------------------
  const res1 = evaluateCallEligibility({
    leadId: 'lead-enriched-1',
    status: 'ENRICHED',
    phone: '+919876543210',
    consentStatus: 'PERMISSIBLE',
    evaluatedAt: baselineNow,
  });
  assert(
    'TEST-1',
    'ENRICHED lead + valid phone + permissible consent -> ELIGIBLE',
    res1.eligible === true &&
      res1.decision === 'ELIGIBLE' &&
      res1.policyVersion === CALL_ELIGIBILITY_POLICY_VERSION &&
      res1.compliance?.policyVersion === CALL_COMPLIANCE_POLICY_VERSION
  );

  // -------------------------------------------------------------------------
  // 2. RESOLVED first-party inbound lead can reach eligibility
  // -------------------------------------------------------------------------
  const res2a = evaluateCallEligibility({
    leadId: 'lead-resolved-webform',
    status: 'RESOLVED',
    source: 'WEB_FORM',
    phone: '+919876543210',
    consentStatus: 'PERMISSIBLE',
    evaluatedAt: baselineNow,
  });
  assert(
    'TEST-2A',
    'RESOLVED lead + WEB_FORM source + permissible consent -> ELIGIBLE',
    res2a.eligible === true && res2a.decision === 'ELIGIBLE'
  );

  const res2b = evaluateCallEligibility({
    leadId: 'lead-resolved-api',
    status: 'RESOLVED',
    source: 'API_WEBHOOK',
    phone: '+919876543210',
    consentStatus: 'EXPLICIT_CONSENT',
    evaluatedAt: baselineNow,
  });
  assert(
    'TEST-2B',
    'RESOLVED lead + API_WEBHOOK source + EXPLICIT_CONSENT -> ELIGIBLE',
    res2b.eligible === true && res2b.decision === 'ELIGIBLE'
  );

  const res2c = evaluateCallEligibility({
    leadId: 'lead-resolved-meta',
    status: 'RESOLVED',
    source: 'META_LEAD_AD',
    phone: '+919876543210',
    consentStatus: 'DIRECT_INQUIRY',
    evaluatedAt: baselineNow,
  });
  assert(
    'TEST-2C',
    'RESOLVED lead + META_LEAD_AD source + DIRECT_INQUIRY -> ELIGIBLE',
    res2c.eligible === true && res2c.decision === 'ELIGIBLE'
  );

  // -------------------------------------------------------------------------
  // 3. RESOLVED lead without permissible first-party source is NOT eligible
  // -------------------------------------------------------------------------
  const res3a = evaluateCallEligibility({
    leadId: 'lead-resolved-csv',
    status: 'RESOLVED',
    source: 'CSV_IMPORT',
    phone: '+919876543210',
    consentStatus: 'PERMISSIBLE',
    evaluatedAt: baselineNow,
  });
  assert(
    'TEST-3A',
    'RESOLVED lead from CSV_IMPORT cannot bypass enrichment -> NOT_ELIGIBLE',
    res3a.eligible === false &&
      res3a.decision === 'NOT_ELIGIBLE' &&
      res3a.reasons.some((r) => r.includes('not an authorized first-party inbound source'))
  );

  const res3b = evaluateCallEligibility({
    leadId: 'lead-resolved-cold',
    status: 'RESOLVED',
    source: 'COLD_LIST',
    phone: '+919876543210',
    consentStatus: 'PERMISSIBLE',
    evaluatedAt: baselineNow,
  });
  assert(
    'TEST-3B',
    'RESOLVED lead from COLD_LIST cannot bypass enrichment -> NOT_ELIGIBLE',
    res3b.eligible === false && res3b.decision === 'NOT_ELIGIBLE'
  );

  // -------------------------------------------------------------------------
  // 4. Unknown or ambiguous consent returns REQUIRES_REVIEW
  // -------------------------------------------------------------------------
  const res4 = evaluateCallEligibility({
    leadId: 'lead-unknown-consent',
    status: 'RESOLVED',
    source: 'WEB_FORM',
    phone: '+919876543210',
    consentStatus: null,
    evaluatedAt: baselineNow,
  });
  assert(
    'TEST-4',
    'Missing or unknown consent returns REQUIRES_REVIEW',
    res4.eligible === false && res4.decision === 'REQUIRES_REVIEW'
  );

  // -------------------------------------------------------------------------
  // 5. Explicit opt-out always wins
  // -------------------------------------------------------------------------
  const res5 = evaluateCallEligibility({
    leadId: 'lead-optout',
    status: 'RESOLVED',
    source: 'DIRECT_INQUIRY',
    phone: '+919876543210',
    consentStatus: 'OPT_OUT',
    evaluatedAt: baselineNow,
  });
  assert(
    'TEST-5',
    'Explicit opt-out (OPT_OUT) returns NOT_ELIGIBLE immediately',
    res5.eligible === false &&
      res5.decision === 'NOT_ELIGIBLE' &&
      res5.consent_state === 'OPT_OUT'
  );

  // -------------------------------------------------------------------------
  // 6. Invalid phone is rejected
  // -------------------------------------------------------------------------
  const res6 = evaluateCallEligibility({
    leadId: 'lead-invalid-phone',
    status: 'RESOLVED',
    source: 'WEB_FORM',
    phone: 'invalid-phone-string',
    consentStatus: 'PERMISSIBLE',
    evaluatedAt: baselineNow,
  });
  assert(
    'TEST-6',
    'Invalid phone format returns NOT_ELIGIBLE with phone_format_valid: false',
    res6.eligible === false &&
      res6.decision === 'NOT_ELIGIBLE' &&
      res6.phone_format_valid === false
  );

  // -------------------------------------------------------------------------
  // 7. Dummy/repetitive phone is rejected using existing validator
  // -------------------------------------------------------------------------
  const res7 = evaluateCallEligibility({
    leadId: 'lead-dummy-phone',
    status: 'RESOLVED',
    source: 'WEB_FORM',
    phone: '+919999999999',
    consentStatus: 'PERMISSIBLE',
    evaluatedAt: baselineNow,
  });
  assert(
    'TEST-7',
    'Repetitive dummy phone (+919999999999) rejected by validator',
    res7.eligible === false &&
      res7.decision === 'NOT_ELIGIBLE' &&
      res7.phone_format_valid === false
  );

  // -------------------------------------------------------------------------
  // 8. Calling hours evaluation (09:00 - 20:00 Asia/Kolkata)
  // 08:59:59 IST = 03:29:59 UTC -> BLOCKED
  // 09:00:00 IST = 03:30:00 UTC -> ALLOWED (opening boundary)
  // 12:00:00 IST = 06:30:00 UTC -> ALLOWED (middle)
  // 19:59:59 IST = 14:29:59 UTC -> ALLOWED
  // 20:00:00 IST = 14:30:00 UTC -> BLOCKED (closing boundary)
  // 21:00:00 IST = 15:30:00 UTC -> BLOCKED (after closing)
  // -------------------------------------------------------------------------
  const beforeOpening = '2026-09-18T03:29:59.000Z'; // 08:59:59 IST
  const atOpening = '2026-09-18T03:30:00.000Z';     // 09:00:00 IST
  const atMiddle = '2026-09-18T06:30:00.000Z';      // 12:00:00 IST
  const beforeClosing = '2026-09-18T14:29:59.000Z'; // 19:59:59 IST
  const atClosing = '2026-09-18T14:30:00.000Z';     // 20:00:00 IST
  const afterClosing = '2026-09-18T15:30:00.000Z';  // 21:00:00 IST

  const chBefore = evaluateCallCompliance({
    leadId: 'test-hours',
    evaluatedAt: beforeOpening,
  });
  assert(
    'TEST-8A',
    'Calling hours: 08:59:59 IST is blocked as OUTSIDE_CALLING_HOURS',
    chBefore.compliant === false &&
      chBefore.decision === 'OUTSIDE_CALLING_HOURS' &&
      chBefore.withinCallingHours === false
  );

  const chOpening = evaluateCallCompliance({
    leadId: 'test-hours',
    evaluatedAt: atOpening,
  });
  assert(
    'TEST-8B',
    'Calling hours: 09:00:00 IST is ALLOWED at opening boundary',
    chOpening.compliant === true &&
      chOpening.decision === 'ALLOWED' &&
      chOpening.withinCallingHours === true
  );

  const chMiddle = evaluateCallCompliance({
    leadId: 'test-hours',
    evaluatedAt: atMiddle,
  });
  assert(
    'TEST-8C',
    'Calling hours: 12:00:00 IST is ALLOWED in midday',
    chMiddle.compliant === true && chMiddle.decision === 'ALLOWED'
  );

  const chBeforeClose = evaluateCallCompliance({
    leadId: 'test-hours',
    evaluatedAt: beforeClosing,
  });
  assert(
    'TEST-8D',
    'Calling hours: 19:59:59 IST is ALLOWED before closing boundary',
    chBeforeClose.compliant === true && chBeforeClose.decision === 'ALLOWED'
  );

  const chClosing = evaluateCallCompliance({
    leadId: 'test-hours',
    evaluatedAt: atClosing,
  });
  assert(
    'TEST-8E',
    'Calling hours: 20:00:00 IST is blocked at closing boundary',
    chClosing.compliant === false &&
      chClosing.decision === 'OUTSIDE_CALLING_HOURS' &&
      chClosing.withinCallingHours === false
  );

  const chAfter = evaluateCallCompliance({
    leadId: 'test-hours',
    evaluatedAt: afterClosing,
  });
  assert(
    'TEST-8F',
    'Calling hours: 21:00:00 IST is blocked after closing window',
    chAfter.compliant === false && chAfter.decision === 'OUTSIDE_CALLING_HOURS'
  );

  // -------------------------------------------------------------------------
  // 9. Timezone conversion: independent of server local timezone
  // -------------------------------------------------------------------------
  const tzCheck = getZonedTime(new Date(atOpening), 'Asia/Kolkata');
  assert(
    'TEST-9A',
    'Intl timezone conversion converts UTC 03:30 to Asia/Kolkata 09:00',
    tzCheck.hour === 9 && tzCheck.minute === 0
  );

  // Also test custom timezone configuration (e.g. America/New_York 09:00 EDT)
  const nyStart = '2026-09-18T13:00:00.000Z'; // 09:00 AM EDT
  const nyComp = evaluateCallCompliance({
    leadId: 'test-ny',
    policyConfig: { timezone: 'America/New_York' },
    evaluatedAt: nyStart,
  });
  assert(
    'TEST-9B',
    'Configurable timezone America/New_York correctly evaluates 09:00 AM local',
    nyComp.compliant === true && nyComp.withinCallingHours === true
  );

  // -------------------------------------------------------------------------
  // 10. Cooldown evaluation
  // -------------------------------------------------------------------------
  // 10a: No previous calls -> passes
  const cdNoCalls = evaluateCallCompliance({
    leadId: 'test-cooldown',
    evaluatedAt: baselineNow,
    callsHistory: [],
  });
  assert(
    'TEST-10A',
    'Cooldown: no previous calls -> passes (cooldownPassed: true)',
    cdNoCalls.cooldownPassed === true && cdNoCalls.compliant === true
  );

  // 10b: Recent call attempt 1 hour ago (< 4h cooldown) -> blocked
  const oneHourAgo = new Date(new Date(baselineNow).getTime() - 60 * 60 * 1000).toISOString();
  const cdRecent = evaluateCallCompliance({
    leadId: 'test-cooldown',
    evaluatedAt: baselineNow,
    callsHistory: [
      {
        id: 'call-1',
        lead_id: 'test-cooldown',
        status: 'COMPLETED',
        started_at: oneHourAgo,
        created_at: oneHourAgo,
        attempt_number: 1,
      },
    ],
  });
  assert(
    'TEST-10B',
    'Cooldown: call attempt 1 hour ago is blocked as COOLDOWN_ACTIVE',
    cdRecent.compliant === false &&
      cdRecent.decision === 'COOLDOWN_ACTIVE' &&
      cdRecent.cooldownPassed === false
  );

  // 10c: Exactly 4 hours cooldown boundary (240 minutes) -> passes
  const exactFourHoursAgo = new Date(new Date(baselineNow).getTime() - 240 * 60 * 1000).toISOString();
  const cdExactBoundary = evaluateCallCompliance({
    leadId: 'test-cooldown',
    evaluatedAt: baselineNow,
    callsHistory: [
      {
        id: 'call-1',
        lead_id: 'test-cooldown',
        status: 'NO_ANSWER',
        started_at: exactFourHoursAgo,
        created_at: exactFourHoursAgo,
        attempt_number: 1,
      },
    ],
  });
  assert(
    'TEST-10C',
    'Cooldown: call attempt exactly 240 minutes ago satisfies cooldown (passes)',
    cdExactBoundary.cooldownPassed === true && cdExactBoundary.compliant === true
  );

  // 10d: Cooldown expired (5 hours ago) -> passes
  const fiveHoursAgo = new Date(new Date(baselineNow).getTime() - 300 * 60 * 1000).toISOString();
  const cdExpired = evaluateCallCompliance({
    leadId: 'test-cooldown',
    evaluatedAt: baselineNow,
    callsHistory: [
      {
        id: 'call-1',
        lead_id: 'test-cooldown',
        status: 'COMPLETED',
        started_at: fiveHoursAgo,
        created_at: fiveHoursAgo,
        attempt_number: 1,
      },
    ],
  });
  assert(
    'TEST-10D',
    'Cooldown: call attempt 5 hours ago satisfies cooldown (passes)',
    cdExpired.cooldownPassed === true && cdExpired.compliant === true
  );

  // -------------------------------------------------------------------------
  // 11. Maximum attempts evaluation (Default max: 3)
  // -------------------------------------------------------------------------
  // 0 attempts -> passes
  const att0 = evaluateCallCompliance({
    leadId: 'test-att',
    evaluatedAt: baselineNow,
    callsHistory: [],
  });
  assert('TEST-11A', 'Attempts: 0 attempts -> allowed', att0.attemptsCount === 0 && att0.compliant);

  // 1 attempt 5h ago -> passes
  const att1 = evaluateCallCompliance({
    leadId: 'test-att',
    evaluatedAt: baselineNow,
    callsHistory: [
      {
        id: 'call-1',
        lead_id: 'test-att',
        status: 'NO_ANSWER',
        started_at: fiveHoursAgo,
        created_at: fiveHoursAgo,
      },
    ],
  });
  assert('TEST-11B', 'Attempts: 1 attempt -> allowed', att1.attemptsCount === 1 && att1.compliant);

  // 2 attempts (5h ago and 10h ago) -> passes
  const tenHoursAgo = new Date(new Date(baselineNow).getTime() - 600 * 60 * 1000).toISOString();
  const att2 = evaluateCallCompliance({
    leadId: 'test-att',
    evaluatedAt: baselineNow,
    callsHistory: [
      {
        id: 'call-2',
        lead_id: 'test-att',
        status: 'BUSY',
        started_at: fiveHoursAgo,
        created_at: fiveHoursAgo,
      },
      {
        id: 'call-1',
        lead_id: 'test-att',
        status: 'NO_ANSWER',
        started_at: tenHoursAgo,
        created_at: tenHoursAgo,
      },
    ],
  });
  assert('TEST-11C', 'Attempts: 2 attempts -> allowed', att2.attemptsCount === 2 && att2.compliant);

  // 3 attempts (5h, 10h, 15h ago) -> blocked as MAX_ATTEMPTS_EXCEEDED
  const fifteenHoursAgo = new Date(new Date(baselineNow).getTime() - 900 * 60 * 1000).toISOString();
  const att3 = evaluateCallCompliance({
    leadId: 'test-att',
    evaluatedAt: baselineNow,
    callsHistory: [
      { id: 'call-3', lead_id: 'test-att', status: 'NO_ANSWER', started_at: fiveHoursAgo, created_at: fiveHoursAgo },
      { id: 'call-2', lead_id: 'test-att', status: 'BUSY', started_at: tenHoursAgo, created_at: tenHoursAgo },
      { id: 'call-1', lead_id: 'test-att', status: 'FAILED', started_at: fifteenHoursAgo, created_at: fifteenHoursAgo },
    ],
  });
  assert(
    'TEST-11D',
    'Attempts: 3 attempts reaches maxAttempts cap -> MAX_ATTEMPTS_EXCEEDED',
    att3.compliant === false &&
      att3.decision === 'MAX_ATTEMPTS_EXCEEDED' &&
      att3.attemptsCount === 3 &&
      att3.nextEligibleAt === null
  );

  // 4 attempts (> 3) -> blocked as MAX_ATTEMPTS_EXCEEDED
  const att4 = evaluateCallCompliance({
    leadId: 'test-att',
    evaluatedAt: baselineNow,
    callsHistory: [
      { id: 'call-4', lead_id: 'test-att', status: 'NO_ANSWER', started_at: fiveHoursAgo, created_at: fiveHoursAgo },
      { id: 'call-3', lead_id: 'test-att', status: 'NO_ANSWER', started_at: fiveHoursAgo, created_at: fiveHoursAgo },
      { id: 'call-2', lead_id: 'test-att', status: 'BUSY', started_at: tenHoursAgo, created_at: tenHoursAgo },
      { id: 'call-1', lead_id: 'test-att', status: 'FAILED', started_at: fifteenHoursAgo, created_at: fifteenHoursAgo },
    ],
  });
  assert(
    'TEST-11E',
    'Attempts: >3 attempts -> MAX_ATTEMPTS_EXCEEDED',
    att4.compliant === false && att4.decision === 'MAX_ATTEMPTS_EXCEEDED'
  );

  // -------------------------------------------------------------------------
  // 12. Next eligible time calculation
  // -------------------------------------------------------------------------
  // 12a: Outside window (before 09:00 IST) -> nextEligibleAt is today 09:00 IST
  assert(
    'TEST-12A',
    'Next eligible time before 09:00 IST points to today 03:30:00 UTC (09:00 IST)',
    chBefore.nextEligibleAt === '2026-09-18T03:30:00.000Z'
  );

  // 12b: Outside window (after 20:00 IST) -> nextEligibleAt is tomorrow 09:00 IST
  assert(
    'TEST-12B',
    'Next eligible time after 20:00 IST points to tomorrow 03:30:00 UTC (09:00 IST next day)',
    chAfter.nextEligibleAt === '2026-09-19T03:30:00.000Z'
  );

  // 12c: In cooldown (recent call 1 hour ago) -> nextEligibleAt is exactly 3 hours from now
  const expectedCooldownExpiry = new Date(new Date(oneHourAgo).getTime() + 240 * 60 * 1000).toISOString();
  assert(
    'TEST-12C',
    'Next eligible time for active cooldown points to call timestamp + cooldownMinutes',
    cdRecent.nextEligibleAt === expectedCooldownExpiry
  );

  // 12d: Max attempts exhausted -> nextEligibleAt is null
  assert(
    'TEST-12D',
    'Next eligible time for MAX_ATTEMPTS_EXCEEDED is null',
    att3.nextEligibleAt === null
  );

  // -------------------------------------------------------------------------
  // 13. Policy versioning is present and deterministic
  // -------------------------------------------------------------------------
  assert(
    'TEST-13',
    'Policy versions are CALL_ELIGIBILITY_V1 and CALL_COMPLIANCE_V1',
    CALL_ELIGIBILITY_POLICY_VERSION === 'CALL_ELIGIBILITY_V1' &&
      CALL_COMPLIANCE_POLICY_VERSION === 'CALL_COMPLIANCE_V1' &&
      res1.policyVersion === 'CALL_ELIGIBILITY_V1' &&
      res1.compliance?.policyVersion === 'CALL_COMPLIANCE_V1'
  );

  // -------------------------------------------------------------------------
  // 14. Tenant isolation: call history from another tenant cannot affect lead
  // -------------------------------------------------------------------------
  const tenantA = '11111111-1111-4111-8111-111111111111';
  const tenantB = '22222222-2222-4222-8222-222222222222';

  const tenantCheck = evaluateCallCompliance({
    leadId: 'lead-tenant-test',
    tenantId: tenantA,
    evaluatedAt: baselineNow,
    callsHistory: [
      // 3 attempts belonging to Tenant B (must be ignored)
      { id: 'b-1', tenant_id: tenantB, status: 'NO_ANSWER', started_at: fiveHoursAgo, created_at: fiveHoursAgo },
      { id: 'b-2', tenant_id: tenantB, status: 'NO_ANSWER', started_at: fiveHoursAgo, created_at: fiveHoursAgo },
      { id: 'b-3', tenant_id: tenantB, status: 'NO_ANSWER', started_at: fiveHoursAgo, created_at: fiveHoursAgo },
      // 1 attempt belonging to Tenant A
      { id: 'a-1', tenant_id: tenantA, status: 'NO_ANSWER', started_at: fiveHoursAgo, created_at: fiveHoursAgo },
    ],
  });

  assert(
    'TEST-14',
    'Tenant isolation: foreign tenant call records ignored; only Tenant A attempt counted (1 attempt vs 4 total)',
    tenantCheck.attemptsCount === 1 &&
      tenantCheck.compliant === true &&
      tenantCheck.decision === 'ALLOWED'
  );

  console.log('======================================================');
  console.log(`📊 PHASE 9.3.1 TEST RESULTS: ${passCount} PASSED / ${failCount} FAILED`);
  console.log('======================================================');

  if (failCount > 0) {
    throw new Error(`${failCount} Phase 9.3.1 tests failed!`);
  }
}

// Execute tests
runPhase931Tests().catch((err) => {
  console.error(err);
  process.exit(1);
});
