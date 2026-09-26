/**
 * GROWTHFORGE PHASE 12.1 — PRODUCTION VOICE AUTHORIZATION CONTRACT REGRESSION SUITE
 *
 * SPECIFICATION & INVARIANTS:
 * - Deterministic validation of evaluateProductionVoiceAuthorization gate.
 * - ZERO external calls: Sarvam API and real PSTN calls are strictly forbidden.
 * - Verifies all 17 unit assertions and CallService execution-path integration assertion.
 */

import {
  evaluateProductionVoiceAuthorization,
  PRODUCTION_VOICE_AUTHORIZATION_POLICY_VERSION,
  ProductionVoiceAuthorizationInput,
} from '../app/services/calls/productionVoiceAuthorization';
import { callService, CallService } from '../app/services/calls/callService';
import { IVoiceProvider, VoiceCallResult } from '../app/services/voice/voiceProvider';
import { getSupabaseAdminClient, getSupabaseClient } from '../app/services/supabase/client';
import { supabaseDataService } from '../app/services/supabase/repositories';

let passed = 0;
let failed = 0;

function assert(code: string, desc: string, condition: boolean, details?: any) {
  if (condition) {
    console.log(`  ✅ [PASS] ${code}: ${desc}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${code}: ${desc}`, details !== undefined ? details : '');
    failed++;
  }
}

async function runPhase121Tests() {
  console.log('======================================================');
  console.log('🧪 GROWTHFORGE PHASE 12.1 — PRODUCTION VOICE AUTHORIZATION');
  console.log('======================================================\n');

  // P12.1-01: development + MOCK + eligible -> AUTHORIZED_MOCK
  const res1 = evaluateProductionVoiceAuthorization({
    environment: 'development',
    voiceMode: 'MOCK',
    provider: 'mock',
    tenantId: '00000000-0000-0000-0000-000000000001',
    leadId: 'test-lead-001',
    eligibilityDecision: 'ELIGIBLE',
    productionVoiceEnabled: false,
    globalKillSwitchActive: false,
  });
  assert(
    'P12.1-01',
    'development + MOCK + eligible -> AUTHORIZED_MOCK',
    res1.authorized === true &&
      res1.decision === 'AUTHORIZED_MOCK' &&
      res1.reasonCodes.includes('MOCK_ALLOWED_NON_PRODUCTION')
  );

  // P12.1-02: test + MOCK + eligible -> AUTHORIZED_MOCK
  const res2 = evaluateProductionVoiceAuthorization({
    environment: 'test',
    voiceMode: 'MOCK',
    provider: 'mock',
    tenantId: '00000000-0000-0000-0000-000000000001',
    leadId: 'test-lead-001',
    eligibilityDecision: 'ELIGIBLE',
    productionVoiceEnabled: false,
    globalKillSwitchActive: false,
  });
  assert(
    'P12.1-02',
    'test + MOCK + eligible -> AUTHORIZED_MOCK',
    res2.authorized === true &&
      res2.decision === 'AUTHORIZED_MOCK' &&
      res2.reasonCodes.includes('MOCK_ALLOWED_NON_PRODUCTION')
  );

  // P12.1-03: production + MOCK + eligible -> BLOCKED
  const res3 = evaluateProductionVoiceAuthorization({
    environment: 'production',
    voiceMode: 'MOCK',
    provider: 'mock',
    tenantId: '00000000-0000-0000-0000-000000000001',
    leadId: 'test-lead-001',
    eligibilityDecision: 'ELIGIBLE',
    productionVoiceEnabled: false,
    globalKillSwitchActive: false,
  });
  assert(
    'P12.1-03',
    'production + MOCK + eligible -> BLOCKED',
    res3.authorized === false &&
      res3.decision === 'BLOCKED' &&
      res3.reasonCodes.includes('REAL_VOICE_REQUIRES_PRODUCTION')
  );

  // P12.1-04: development + REAL + eligible -> BLOCKED
  const res4 = evaluateProductionVoiceAuthorization({
    environment: 'development',
    voiceMode: 'REAL',
    provider: 'sarvam',
    tenantId: '00000000-0000-0000-0000-000000000001',
    leadId: 'test-lead-001',
    eligibilityDecision: 'ELIGIBLE',
    productionVoiceEnabled: true,
    globalKillSwitchActive: false,
  });
  assert(
    'P12.1-04',
    'development + REAL + eligible -> BLOCKED',
    res4.authorized === false &&
      res4.decision === 'BLOCKED' &&
      res4.reasonCodes.includes('REAL_VOICE_REQUIRES_PRODUCTION')
  );

  // P12.1-05: production + REAL + productionVoiceEnabled=false -> BLOCKED
  const res5 = evaluateProductionVoiceAuthorization({
    environment: 'production',
    voiceMode: 'REAL',
    provider: 'sarvam',
    tenantId: '00000000-0000-0000-0000-000000000001',
    leadId: 'test-lead-001',
    eligibilityDecision: 'ELIGIBLE',
    productionVoiceEnabled: false,
    globalKillSwitchActive: false,
  });
  assert(
    'P12.1-05',
    'production + REAL + productionVoiceEnabled=false -> BLOCKED',
    res5.authorized === false &&
      res5.decision === 'BLOCKED' &&
      res5.reasonCodes.includes('REAL_VOICE_NOT_ENABLED')
  );

  // P12.1-06: production + REAL + killSwitch=true -> BLOCKED
  const res6 = evaluateProductionVoiceAuthorization({
    environment: 'production',
    voiceMode: 'REAL',
    provider: 'sarvam',
    tenantId: '00000000-0000-0000-0000-000000000001',
    leadId: 'test-lead-001',
    eligibilityDecision: 'ELIGIBLE',
    productionVoiceEnabled: true,
    globalKillSwitchActive: true,
  });
  assert(
    'P12.1-06',
    'production + REAL + killSwitch=true -> BLOCKED',
    res6.authorized === false &&
      res6.decision === 'BLOCKED' &&
      res6.reasonCodes.includes('GLOBAL_VOICE_KILL_SWITCH_ACTIVE')
  );

  // P12.1-07: production + REAL + eligible + enabled + Sarvam -> AUTHORIZED
  const res7 = evaluateProductionVoiceAuthorization({
    environment: 'production',
    voiceMode: 'REAL',
    provider: 'sarvam',
    tenantId: '00000000-0000-0000-0000-000000000001',
    leadId: 'test-lead-001',
    eligibilityDecision: 'ELIGIBLE',
    productionVoiceEnabled: true,
    globalKillSwitchActive: false,
    realProviderAllowlist: ['sarvam'],
  });
  assert(
    'P12.1-07',
    'production + REAL + eligible + enabled + Sarvam -> AUTHORIZED',
    res7.authorized === true &&
      res7.decision === 'AUTHORIZED' &&
      res7.reasonCodes.length === 0
  );

  // P12.1-08: production + REAL + enabled + non-allowlisted provider -> BLOCKED
  const res8 = evaluateProductionVoiceAuthorization({
    environment: 'production',
    voiceMode: 'REAL',
    provider: 'unapproved_provider',
    tenantId: '00000000-0000-0000-0000-000000000001',
    leadId: 'test-lead-001',
    eligibilityDecision: 'ELIGIBLE',
    productionVoiceEnabled: true,
    globalKillSwitchActive: false,
    realProviderAllowlist: ['sarvam'],
  });
  assert(
    'P12.1-08',
    'production + REAL + enabled + non-allowlisted provider -> BLOCKED',
    res8.authorized === false &&
      res8.decision === 'BLOCKED' &&
      res8.reasonCodes.includes('REAL_PROVIDER_NOT_ALLOWED')
  );

  // P12.1-09: missing tenant -> BLOCKED
  const res9 = evaluateProductionVoiceAuthorization({
    environment: 'production',
    voiceMode: 'REAL',
    provider: 'sarvam',
    tenantId: '',
    leadId: 'test-lead-001',
    eligibilityDecision: 'ELIGIBLE',
    productionVoiceEnabled: true,
    globalKillSwitchActive: false,
  });
  assert(
    'P12.1-09',
    'missing tenant -> BLOCKED',
    res9.authorized === false &&
      res9.decision === 'BLOCKED' &&
      res9.reasonCodes.includes('TENANT_CONTEXT_MISSING')
  );

  // P12.1-10: missing lead -> BLOCKED
  const res10 = evaluateProductionVoiceAuthorization({
    environment: 'production',
    voiceMode: 'REAL',
    provider: 'sarvam',
    tenantId: '00000000-0000-0000-0000-000000000001',
    leadId: null,
    eligibilityDecision: 'ELIGIBLE',
    productionVoiceEnabled: true,
    globalKillSwitchActive: false,
  });
  assert(
    'P12.1-10',
    'missing lead -> BLOCKED',
    res10.authorized === false &&
      res10.decision === 'BLOCKED' &&
      res10.reasonCodes.includes('LEAD_CONTEXT_MISSING')
  );

  // P12.1-11: eligibility != ELIGIBLE -> BLOCKED
  const res11 = evaluateProductionVoiceAuthorization({
    environment: 'production',
    voiceMode: 'REAL',
    provider: 'sarvam',
    tenantId: '00000000-0000-0000-0000-000000000001',
    leadId: 'test-lead-001',
    eligibilityDecision: 'NOT_ELIGIBLE',
    productionVoiceEnabled: true,
    globalKillSwitchActive: false,
  });
  assert(
    'P12.1-11',
    'eligibility != ELIGIBLE -> BLOCKED',
    res11.authorized === false &&
      res11.decision === 'BLOCKED' &&
      res11.reasonCodes.includes('ELIGIBILITY_NOT_CONFIRMED')
  );

  // P12.1-12: kill switch overrides production enablement
  const res12 = evaluateProductionVoiceAuthorization({
    environment: 'production',
    voiceMode: 'REAL',
    provider: 'sarvam',
    tenantId: '00000000-0000-0000-0000-000000000001',
    leadId: 'test-lead-001',
    eligibilityDecision: 'ELIGIBLE',
    productionVoiceEnabled: true,
    globalKillSwitchActive: true,
  });
  assert(
    'P12.1-12',
    'kill switch overrides production enablement',
    res12.authorized === false &&
      res12.decision === 'BLOCKED' &&
      res12.reasonCodes.includes('GLOBAL_VOICE_KILL_SWITCH_ACTIVE')
  );

  // P12.1-13: provider credentials existing without explicit production enablement -> BLOCKED
  const res13 = evaluateProductionVoiceAuthorization({
    environment: 'production',
    voiceMode: 'REAL',
    provider: 'sarvam',
    tenantId: '00000000-0000-0000-0000-000000000001',
    leadId: 'test-lead-001',
    eligibilityDecision: 'ELIGIBLE',
    productionVoiceEnabled: false, // Credentials present in env, but flag is false
    globalKillSwitchActive: false,
  });
  assert(
    'P12.1-13',
    'provider credentials existing without explicit production enablement -> BLOCKED',
    res13.authorized === false &&
      res13.decision === 'BLOCKED' &&
      res13.reasonCodes.includes('REAL_VOICE_NOT_ENABLED')
  );

  // P12.1-14: REAL mode never falls back to MOCK when real configuration is missing
  const prevVoiceMode = process.env.VOICE_MODE;
  const prevSarvamKey = process.env.SARVAM_API_KEY;
  try {
    process.env.VOICE_MODE = 'REAL';
    delete process.env.SARVAM_API_KEY;
    let thrown = false;
    try {
      callService.getActiveVoiceProvider();
    } catch (err: any) {
      thrown = err.message.includes('VOICE_MODE=REAL requires valid Sarvam configuration');
    }
    assert(
      'P12.1-14',
      'REAL mode never falls back to MOCK when real configuration is missing',
      thrown
    );
  } finally {
    process.env.VOICE_MODE = prevVoiceMode;
    if (prevSarvamKey) process.env.SARVAM_API_KEY = prevSarvamKey;
  }

  // P12.1-15: authorization decision is deterministic for identical inputs
  const inputSample: ProductionVoiceAuthorizationInput = {
    environment: 'production',
    voiceMode: 'REAL',
    provider: 'sarvam',
    tenantId: '00000000-0000-0000-0000-000000000001',
    leadId: 'test-lead-001',
    eligibilityDecision: 'ELIGIBLE',
    productionVoiceEnabled: true,
    globalKillSwitchActive: false,
  };
  const res15a = evaluateProductionVoiceAuthorization(inputSample);
  const res15b = evaluateProductionVoiceAuthorization(inputSample);
  assert(
    'P12.1-15',
    'authorization decision is deterministic for identical inputs',
    res15a.authorized === res15b.authorized &&
      res15a.decision === res15b.decision &&
      JSON.stringify(res15a.reasonCodes) === JSON.stringify(res15b.reasonCodes)
  );

  // P12.1-16: authorization result contains policy version
  assert(
    'P12.1-16',
    'authorization result contains policy version',
    res1.policyVersion === PRODUCTION_VOICE_AUTHORIZATION_POLICY_VERSION
  );

  // P12.1-17: reason codes contain no secrets or PII
  const allReasonCodes = [
    ...res1.reasonCodes,
    ...res3.reasonCodes,
    ...res5.reasonCodes,
    ...res6.reasonCodes,
    ...res8.reasonCodes,
    ...res9.reasonCodes,
  ];
  const safeRegex = /^[A-Z_]+$/;
  const leakFound = allReasonCodes.some((code) => !safeRegex.test(code));
  assert(
    'P12.1-17',
    'reason codes contain no secrets or PII',
    !leakFound && allReasonCodes.length > 0
  );

  // ======================================================
  // 14. EXECUTION-PATH INTEGRATION TEST
  // ======================================================
  console.log('\n--- Section 14: Execution-Path CallService Integration Test ---');

  let spyInitiated = false;
  const spyProvider: IVoiceProvider = {
    providerName: 'sarvam',
    async initiateCall(): Promise<VoiceCallResult> {
      spyInitiated = true;
      return {
        callId: 'SPY-001',
        provider: 'sarvam',
        status: 'DISPATCHED',
        initiated: true,
        created_at: new Date().toISOString(),
      };
    },
    async getCallStatus(callId: string) {
      return {
        callId,
        leadId: 'test-lead-001',
        provider: 'sarvam',
        status: 'COMPLETED' as any,
        initiated: true,
        duration: 0,
      };
    },
  };

  const originalVoiceMode = process.env.VOICE_MODE;
  const originalVoiceEnabled = process.env.VOICE_PRODUCTION_ENABLED;
  const originalNodeEnv = process.env.NODE_ENV;

  try {
    process.env.NODE_ENV = 'test';
    process.env.VOICE_MODE = 'REAL';
    process.env.VOICE_PRODUCTION_ENABLED = 'false';

    const client = getSupabaseAdminClient() || getSupabaseClient();
    if (!client) throw new Error('No Supabase client');

    const testLeadId = '44ebcb9a-94da-49e5-a285-d10ec64eb1d2';
    const testTenantId = 'be7e913b-8253-42f4-bf29-132849335947';

    // Ensure lead is CALL_PENDING for test
    await supabaseDataService.leads.updateLead(
      { tenantId: testTenantId },
      testLeadId,
      { status: 'CALL_PENDING' }
    );

    let callError: Error | null = null;
    try {
      await callService.startCall(testLeadId, {
        tenantId: testTenantId,
        provider: spyProvider,
      });
    } catch (err: any) {
      callError = err;
    }

    assert(
      'P12.1-EXEC-01',
      'CallService returned blocked authorization/readiness error when VOICE_PRODUCTION_ENABLED=false / non-production',
      callError !== null &&
        (callError.message.includes('Production voice authorization BLOCKED') ||
          callError.message.includes('Production voice activation readiness BLOCKED'))
    );

    assert(
      'P12.1-EXEC-02',
      'Spy/Voice provider initiateCall MUST NOT execute when authorization is blocked',
      spyInitiated === false
    );

    // Verify audit event VOICE_AUTHORIZATION_DECIDED was recorded
    const events = await supabaseDataService.leadEvents.getLeadEvents(
      { tenantId: testTenantId },
      testLeadId
    );
    const authEvents = events.filter((e) => e.event_type === 'VOICE_AUTHORIZATION_DECIDED');
    const latestAuthEvent = authEvents[authEvents.length - 1];

    assert(
      'P12.1-EXEC-03',
      'VOICE_AUTHORIZATION_DECIDED audit event was recorded with decision=BLOCKED',
      latestAuthEvent !== undefined &&
        latestAuthEvent.event_data?.decision === 'BLOCKED' &&
        Array.isArray(latestAuthEvent.event_data?.reason_codes) &&
        latestAuthEvent.event_data.reason_codes.length > 0
    );

    // Verify NO CALL_PROVIDER_ACCEPTED event occurred for this call attempt
    const acceptedEvents = events.filter(
      (e) =>
        e.event_type === 'CALL_PROVIDER_ACCEPTED' &&
        new Date(e.created_at).getTime() > Date.now() - 10000
    );
    assert(
      'P12.1-EXEC-04',
      'No CALL_PROVIDER_ACCEPTED audit event recorded for blocked call',
      acceptedEvents.length === 0
    );

    // Reset lead back to RESOLVED
    await supabaseDataService.leads.updateLead(
      { tenantId: testTenantId },
      testLeadId,
      { status: 'RESOLVED' }
    );
  } finally {
    if (originalVoiceMode !== undefined) process.env.VOICE_MODE = originalVoiceMode;
    else delete process.env.VOICE_MODE;

    if (originalVoiceEnabled !== undefined) process.env.VOICE_PRODUCTION_ENABLED = originalVoiceEnabled;
    else delete process.env.VOICE_PRODUCTION_ENABLED;

    if (originalNodeEnv !== undefined) process.env.NODE_ENV = originalNodeEnv;
    else delete process.env.NODE_ENV;
  }

  console.log('\n======================================================');
  console.log(`📊 PHASE 12.1 TEST SUMMARY: ${passed} PASSED / ${failed} FAILED`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase121Tests().catch((err) => {
  console.error('Phase 12.1 Test Suite Error:', err);
  process.exit(1);
});
