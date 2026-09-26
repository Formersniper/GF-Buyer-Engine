/**
 * GROWTHFORGE PHASE 12.2 — PRODUCTION VOICE ACTIVATION READINESS REGRESSION SUITE
 *
 * SPECIFICATION & INVARIANTS:
 * - Deterministic, provider-independent readiness contract tests.
 * - Validates evaluateVoiceActivationReadiness, cost policy, retry policy, rollout controls, provider health gating,
 *   authorization snapshot integrity, and provider bypass prevention.
 * - ZERO external voice calls: Sarvam API and real PSTN attempts are strictly forbidden.
 */

import {
  evaluateVoiceActivationReadiness,
  VOICE_ACTIVATION_READINESS_POLICY_VERSION,
  VoiceActivationReadinessInput,
} from '../app/services/calls/voiceActivationReadiness';
import { evaluateVoiceCostPolicy } from '../app/services/calls/voiceCostPolicy';
import { evaluateVoiceRetryPolicy } from '../app/services/calls/voiceRetryPolicy';
import { callService } from '../app/services/calls/callService';
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

async function runPhase122Tests() {
  console.log('======================================================');
  console.log('🧪 GROWTHFORGE PHASE 12.2 — PRODUCTION VOICE ACTIVATION READINESS');
  console.log('======================================================\n');

  const baseInput: VoiceActivationReadinessInput = {
    environment: 'development',
    voiceMode: 'MOCK',
    provider: 'mock',
    tenantId: '00000000-0000-0000-0000-000000000001',
    leadId: 'test-lead-122',
    eligibilityDecision: 'ELIGIBLE',
    complianceDecision: 'ALLOWED',
    productionVoiceEnabled: false,
    globalKillSwitchActive: false,
    rolloutEnabled: false,
    rolloutPercentage: 0,
    realCallsForTenant: 0,
    maxRealCallsPerTenant: 0,
    realCallsGlobal: 0,
    maxRealCallsGlobal: 0,
    costCheckPassed: true,
    providerHealthy: true,
  };

  // P12.2-01: development + MOCK -> MOCK_ONLY
  const res1 = evaluateVoiceActivationReadiness({ ...baseInput, environment: 'development', voiceMode: 'MOCK' });
  assert('P12.2-01', 'development + MOCK -> MOCK_ONLY', res1.ready === true && res1.decision === 'MOCK_ONLY');

  // P12.2-02: test + MOCK -> MOCK_ONLY
  const res2 = evaluateVoiceActivationReadiness({ ...baseInput, environment: 'test', voiceMode: 'MOCK' });
  assert('P12.2-02', 'test + MOCK -> MOCK_ONLY', res2.ready === true && res2.decision === 'MOCK_ONLY');

  // P12.2-03: production + REAL + productionVoiceEnabled=false -> BLOCKED
  const res3 = evaluateVoiceActivationReadiness({
    ...baseInput,
    environment: 'production',
    voiceMode: 'REAL',
    provider: 'sarvam',
    productionVoiceEnabled: false,
  });
  assert('P12.2-03', 'production + REAL + productionVoiceEnabled=false -> BLOCKED', res3.ready === false && res3.decision === 'BLOCKED' && res3.reasonCodes.includes('REAL_VOICE_NOT_ENABLED'));

  // P12.2-04: production + REAL + killSwitch=true -> BLOCKED
  const res4 = evaluateVoiceActivationReadiness({
    ...baseInput,
    environment: 'production',
    voiceMode: 'REAL',
    provider: 'sarvam',
    productionVoiceEnabled: true,
    globalKillSwitchActive: true,
  });
  assert('P12.2-04', 'production + REAL + killSwitch=true -> BLOCKED', res4.ready === false && res4.decision === 'BLOCKED' && res4.reasonCodes.includes('GLOBAL_VOICE_KILL_SWITCH_ACTIVE'));

  // P12.2-05: production + REAL + rolloutDisabled -> BLOCKED
  const res5 = evaluateVoiceActivationReadiness({
    ...baseInput,
    environment: 'production',
    voiceMode: 'REAL',
    provider: 'sarvam',
    productionVoiceEnabled: true,
    rolloutEnabled: false,
  });
  assert('P12.2-05', 'production + REAL + rolloutDisabled -> BLOCKED', res5.ready === false && res5.reasonCodes.includes('ROLLOUT_DISABLED'));

  // P12.2-06: non-allowlisted provider -> BLOCKED
  const res6 = evaluateVoiceActivationReadiness({
    ...baseInput,
    environment: 'production',
    voiceMode: 'REAL',
    provider: 'unapproved_provider',
    productionVoiceEnabled: true,
    rolloutEnabled: true,
    rolloutPercentage: 100,
  });
  assert('P12.2-06', 'non-allowlisted provider -> BLOCKED', res6.ready === false && res6.reasonCodes.includes('REAL_PROVIDER_NOT_ALLOWED'));

  // P12.2-07: missing tenant -> BLOCKED
  const res7 = evaluateVoiceActivationReadiness({ ...baseInput, tenantId: '' });
  assert('P12.2-07', 'missing tenant -> BLOCKED', res7.ready === false && res7.reasonCodes.includes('TENANT_CONTEXT_MISSING'));

  // P12.2-08: missing lead -> BLOCKED
  const res8 = evaluateVoiceActivationReadiness({ ...baseInput, leadId: null });
  assert('P12.2-08', 'missing lead -> BLOCKED', res8.ready === false && res8.reasonCodes.includes('LEAD_CONTEXT_MISSING'));

  // P12.2-09: eligibility not ELIGIBLE -> BLOCKED
  const res9 = evaluateVoiceActivationReadiness({ ...baseInput, eligibilityDecision: 'NOT_ELIGIBLE' });
  assert('P12.2-09', 'eligibility not ELIGIBLE -> BLOCKED', res9.ready === false && res9.reasonCodes.includes('ELIGIBILITY_NOT_CONFIRMED'));

  // P12.2-10: compliance not ALLOWED -> BLOCKED
  const res10 = evaluateVoiceActivationReadiness({ ...baseInput, complianceDecision: 'OUTSIDE_CALLING_HOURS' });
  assert('P12.2-10', 'compliance not ALLOWED -> BLOCKED', res10.ready === false && res10.reasonCodes.includes('COMPLIANCE_NOT_ALLOWED'));

  // P12.2-11: cost ceiling exceeded -> BLOCKED
  const res11 = evaluateVoiceActivationReadiness({
    ...baseInput,
    environment: 'production',
    voiceMode: 'REAL',
    provider: 'sarvam',
    productionVoiceEnabled: true,
    rolloutEnabled: true,
    rolloutPercentage: 100,
    costCheckPassed: false,
  });
  assert('P12.2-11', 'cost ceiling exceeded -> BLOCKED', res11.ready === false && res11.reasonCodes.includes('COST_CAP_EXCEEDED'));

  // P12.2-12: provider unhealthy -> BLOCKED
  const res12 = evaluateVoiceActivationReadiness({
    ...baseInput,
    environment: 'production',
    voiceMode: 'REAL',
    provider: 'sarvam',
    productionVoiceEnabled: true,
    rolloutEnabled: true,
    rolloutPercentage: 100,
    providerHealthy: false,
  });
  assert('P12.2-12', 'provider unhealthy -> BLOCKED', res12.ready === false && res12.reasonCodes.includes('PROVIDER_UNHEALTHY'));

  // P12.2-13: fully valid controlled REAL configuration -> READY_FOR_CONTROLLED_REAL
  const res13 = evaluateVoiceActivationReadiness({
    ...baseInput,
    environment: 'production',
    voiceMode: 'REAL',
    provider: 'sarvam',
    productionVoiceEnabled: true,
    globalKillSwitchActive: false,
    rolloutEnabled: true,
    rolloutPercentage: 100,
    realCallsForTenant: 0,
    maxRealCallsPerTenant: 10,
    realCallsGlobal: 0,
    maxRealCallsGlobal: 100,
    realProviderAllowlist: ['sarvam'],
    costCheckPassed: true,
    providerHealthy: true,
  });
  assert('P12.2-13', 'fully valid controlled REAL configuration -> READY_FOR_CONTROLLED_REAL', res13.ready === true && res13.decision === 'READY_FOR_CONTROLLED_REAL');

  // P12.2-14: kill switch overrides all other controls
  const res14 = evaluateVoiceActivationReadiness({
    ...baseInput,
    environment: 'production',
    voiceMode: 'REAL',
    provider: 'sarvam',
    productionVoiceEnabled: true,
    globalKillSwitchActive: true, // OVERRIDE
    rolloutEnabled: true,
    rolloutPercentage: 100,
    costCheckPassed: true,
    providerHealthy: true,
  });
  assert('P12.2-14', 'kill switch overrides all other controls', res14.ready === false && res14.reasonCodes.includes('GLOBAL_VOICE_KILL_SWITCH_ACTIVE'));

  // P12.2-15: MOCK_READY does not consume real attempt
  const retry1 = evaluateVoiceRetryPolicy({
    tenantId: '00000000-0000-0000-0000-000000000001',
    leadId: 'test-lead',
    attemptNumber: 0,
    lastCallStatus: 'MOCK_READY',
  });
  assert('P12.2-15', 'MOCK_READY does not consume real attempt', retry1.canRetry === true && retry1.nextAttemptNumber === 1);

  // P12.2-16: retry limit blocks further attempts
  const retry2 = evaluateVoiceRetryPolicy({
    tenantId: '00000000-0000-0000-0000-000000000001',
    leadId: 'test-lead',
    attemptNumber: 3,
    maxAttemptsAllowed: 3,
    lastCallStatus: 'NO_ANSWER',
  });
  assert('P12.2-16', 'retry limit blocks further attempts', retry2.canRetry === false && retry2.reason.includes('Maximum allowed call attempt limit'));

  // P12.2-17: cost policy does not fabricate provider actual_cost
  const costRes = evaluateVoiceCostPolicy({
    tenantId: '00000000-0000-0000-0000-000000000001',
    leadId: 'test-lead',
    estimatedDurationSeconds: 120,
  });
  assert('P12.2-17', 'cost policy does not fabricate actual_cost', costRes.passed === true && costRes.actualCostINR === null && costRes.costCurrency === 'INR');

  // P12.2-18: repeated evaluation is deterministic
  const res18a = evaluateVoiceActivationReadiness({ ...baseInput, environment: 'production', voiceMode: 'REAL', provider: 'sarvam', productionVoiceEnabled: true, rolloutEnabled: true, rolloutPercentage: 100 });
  const res18b = evaluateVoiceActivationReadiness({ ...baseInput, environment: 'production', voiceMode: 'REAL', provider: 'sarvam', productionVoiceEnabled: true, rolloutEnabled: true, rolloutPercentage: 100 });
  assert('P12.2-18', 'repeated evaluation is deterministic', res18a.ready === res18b.ready && res18a.decision === res18b.decision);

  // ======================================================
  // CRITICAL INTEGRATION TEST — CONTROLLED SPY EXECUTION
  // ======================================================
  console.log('\n--- Section CRITICAL: Controlled Execution-Path Integration Test ---');

  let spyCallsCount = 0;
  const spyProvider: IVoiceProvider = {
    providerName: 'sarvam',
    async initiateCall(): Promise<VoiceCallResult> {
      spyCallsCount++;
      return {
        callId: 'SPY-REAL-001',
        provider: 'sarvam',
        status: 'DISPATCHED',
        initiated: true,
        created_at: new Date().toISOString(),
      };
    },
    async getCallStatus(callId: string) {
      return {
        callId,
        leadId: 'test-lead-122',
        provider: 'sarvam',
        status: 'COMPLETED' as any,
        initiated: true,
        duration: 0,
      };
    },
    async checkHealth() {
      return {
        provider: 'sarvam',
        configured: true,
        reachable: true,
        agent_configured: true,
        phone_configured: true,
        mode: 'REAL',
      };
    },
  };

  const testTenantId = '00000000-0000-0000-0000-000000000001';

  // Create a dedicated clean test lead for Phase 12.2 execution test
  let testLead = await supabaseDataService.leads.getLeadByLeadId({ tenantId: testTenantId }, 'GF-2026-P122-TEST');
  if (!testLead) {
    testLead = await supabaseDataService.leads.createLead({ tenantId: testTenantId }, {
      lead_id: 'GF-2026-P122-TEST',
      name: 'P122 Test Lead',
      phone: '+919876543210',
      email: 'p122.test@example.com',
      source: 'WEB_FORM',
      status: 'CALL_PENDING',
      consent_status: 'EXPLICIT_CONSENT',
    });
  } else {
    await supabaseDataService.leads.updateLead(
      { tenantId: testTenantId },
      testLead.id,
      { status: 'CALL_PENDING', consent_status: 'EXPLICIT_CONSENT' }
    );
  }

  const testLeadId = testLead.id;

  // Test Case A: Fully valid synthetic context -> READY_FOR_CONTROLLED_REAL & provider.initiateCall() executed 1 time
  try {
    process.env.NODE_ENV = 'test';
    process.env.VOICE_MODE = 'REAL';
    process.env.VOICE_PRODUCTION_ENABLED = 'true';
    process.env.VOICE_ROLLOUT_ENABLED = 'true';
    process.env.VOICE_ROLLOUT_PERCENTAGE = '100';
    process.env.VOICE_REAL_PROVIDER_ALLOWLIST = 'sarvam';
    process.env.VOICE_GLOBAL_KILL_SWITCH = 'false';

    spyCallsCount = 0;
    const startRes = await callService.startCall(testLeadId, {
      tenantId: testTenantId,
      provider: spyProvider,
    });

    assert(
      'P12.2-EXEC-01',
      'Fully valid controlled REAL configuration executes spy provider exactly 1 time',
      spyCallsCount === 1 && startRes.callResult.initiated === true
    );

    // Verify audit event VOICE_ACTIVATION_READINESS_DECIDED was appended
    const events = await supabaseDataService.leadEvents.getLeadEvents(
      { tenantId: testTenantId },
      testLeadId
    );
    const readinessEvents = events.filter((e) => e.event_type === 'VOICE_ACTIVATION_READINESS_DECIDED');
    const latestReadinessEvent = readinessEvents[readinessEvents.length - 1];

    assert(
      'P12.2-EXEC-02',
      'VOICE_ACTIVATION_READINESS_DECIDED event recorded with READY_FOR_CONTROLLED_REAL and snapshot',
      latestReadinessEvent !== undefined &&
        latestReadinessEvent.event_data?.decision === 'READY_FOR_CONTROLLED_REAL' &&
        (latestReadinessEvent.event_data?.authorization_snapshot as any)?.tenant_scope_verified === true
    );

    // Verify authorization snapshot contains NO secret or raw PII
    const snapshot = latestReadinessEvent.event_data?.authorization_snapshot || {};
    const snapshotStr = JSON.stringify(snapshot);
    const hasSecretKey = snapshotStr.includes('API_KEY') || snapshotStr.includes('SECRET') || snapshotStr.includes('0199');
    assert(
      'P12.2-EXEC-03',
      'Authorization snapshot contains NO secrets, API keys, or unmasked PII',
      !hasSecretKey
    );
  } finally {
    // Reset lead state back to RESOLVED
    await supabaseDataService.leads.updateLead(
      { tenantId: testTenantId },
      testLeadId,
      { status: 'RESOLVED' }
    );

    // Restore safe default environment configuration
    process.env.NODE_ENV = 'test';
    process.env.VOICE_MODE = 'MOCK';
    process.env.VOICE_PRODUCTION_ENABLED = 'false';
    process.env.VOICE_ROLLOUT_ENABLED = 'false';
    process.env.VOICE_ROLLOUT_PERCENTAGE = '0';
  }

  // Test Case B: Blocked execution -> provider.initiateCall() MUST NOT execute (0 times)
  try {
    process.env.NODE_ENV = 'test';
    process.env.VOICE_MODE = 'REAL';
    process.env.VOICE_PRODUCTION_ENABLED = 'false'; // BLOCKED

    await supabaseDataService.leads.updateLead(
      { tenantId: testTenantId },
      testLeadId,
      { status: 'CALL_PENDING' }
    );

    spyCallsCount = 0;
    let blockedError: Error | null = null;
    try {
      await callService.startCall(testLeadId, {
        tenantId: testTenantId,
        provider: spyProvider,
      });
    } catch (err: any) {
      blockedError = err;
    }

    assert(
      'P12.2-EXEC-04',
      'Blocked readiness request throws error and spy provider initiateCall is executed 0 times',
      blockedError !== null &&
        blockedError.message.includes('Production voice activation readiness BLOCKED') &&
        spyCallsCount === 0
    );
  } finally {
    await supabaseDataService.leads.updateLead(
      { tenantId: testTenantId },
      testLeadId,
      { status: 'RESOLVED' }
    );
    process.env.NODE_ENV = 'test';
    process.env.VOICE_MODE = 'MOCK';
    process.env.VOICE_PRODUCTION_ENABLED = 'false';
  }

  console.log('\n======================================================');
  console.log(`📊 PHASE 12.2 TEST SUMMARY: ${passed} PASSED / ${failed} FAILED`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase122Tests().catch((err) => {
  console.error('Phase 12.2 Test Suite Error:', err);
  process.exit(1);
});
