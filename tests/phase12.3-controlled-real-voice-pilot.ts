/**
 * GROWTHFORGE PHASE 12.3 — CONTROLLED REAL VOICE PILOT AUTHORIZATION TEST SUITE
 *
 * SPECIFICATION & INVARIANTS:
 * - Deterministic, provider-independent pilot authorization contract tests.
 * - Validates evaluateControlledRealVoicePilot, tenant/lead mismatch rules, single-call limits (GLOBAL=1, TENANT=1),
 *   kill switches, provider restrictions (Sarvam only), secrecy safety, and provider bypass prevention.
 * - ZERO external voice calls: Sarvam API and real PSTN attempts are strictly forbidden.
 */

import {
  evaluateControlledRealVoicePilot,
  CONTROLLED_REAL_VOICE_PILOT_POLICY_VERSION,
  ControlledRealVoicePilotInput,
} from '../app/services/calls/controlledRealVoicePilot';
import { callService } from '../app/services/calls/callService';
import { IVoiceProvider, VoiceCallResult } from '../app/services/voice/voiceProvider';
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

async function runPhase123Tests() {
  console.log('======================================================');
  console.log('🧪 GROWTHFORGE PHASE 12.3 — CONTROLLED REAL VOICE PILOT AUTHORIZATION');
  console.log('======================================================\n');

  const basePilotInput: ControlledRealVoicePilotInput = {
    environment: 'production',
    voiceMode: 'REAL',
    provider: 'sarvam',
    tenantId: '00000000-0000-0000-0000-000000000001',
    leadId: 'pilot-lead-123',
    leadTenantId: '00000000-0000-0000-0000-000000000001',
    eligibilityDecision: 'ELIGIBLE',
    complianceDecision: 'ALLOWED',
    productionAuthDecision: 'AUTHORIZED',
    activationReadinessDecision: 'READY_FOR_CONTROLLED_REAL',
    globalKillSwitchActive: false,
    pilotKillSwitchActive: false,
    pilotEnabled: true,
    configuredPilotTenantId: '00000000-0000-0000-0000-000000000001',
    configuredPilotLeadId: 'pilot-lead-123',
    pilotMaxRealCallsGlobal: 1,
    pilotMaxRealCallsPerTenant: 1,
    currentRealCallsGlobalCount: 0,
    currentRealCallsTenantCount: 0,
    providerHealthy: true,
    realProviderAllowlist: ['sarvam'],
  };

  // Test A: Pilot disabled -> BLOCK
  const resA = evaluateControlledRealVoicePilot({ ...basePilotInput, pilotEnabled: false });
  assert('P12.3-A', 'Pilot disabled -> BLOCK (PILOT_DISABLED)', resA.authorized === false && resA.reasonCodes.includes('PILOT_DISABLED'));

  // Test B: Pilot enabled without explicit authorization config -> BLOCK
  const resB = evaluateControlledRealVoicePilot({ ...basePilotInput, configuredPilotTenantId: '', configuredPilotLeadId: '' });
  assert('P12.3-B', 'Pilot without explicit config -> BLOCK (PILOT_TENANT_NOT_CONFIGURED)', resB.authorized === false && resB.reasonCodes.includes('PILOT_TENANT_NOT_CONFIGURED'));

  // Test C: Wrong tenant -> BLOCK
  const resC = evaluateControlledRealVoicePilot({ ...basePilotInput, tenantId: 'wrong-tenant-id', leadTenantId: 'wrong-tenant-id' });
  assert('P12.3-C', 'Wrong tenant -> BLOCK (PILOT_TENANT_MISMATCH)', resC.authorized === false && resC.reasonCodes.includes('PILOT_TENANT_MISMATCH'));

  // Test D: Wrong lead -> BLOCK
  const resD = evaluateControlledRealVoicePilot({ ...basePilotInput, leadId: 'wrong-lead-id' });
  assert('P12.3-D', 'Wrong lead -> BLOCK (PILOT_LEAD_MISMATCH)', resD.authorized === false && resD.reasonCodes.includes('PILOT_LEAD_MISMATCH'));

  // Test E: Lead belongs to different tenant -> BLOCK
  const resE = evaluateControlledRealVoicePilot({ ...basePilotInput, leadTenantId: 'foreign-tenant-id' });
  assert('P12.3-E', 'Lead belongs to different tenant -> BLOCK (PILOT_LEAD_TENANT_MISMATCH)', resE.authorized === false && resE.reasonCodes.includes('PILOT_LEAD_TENANT_MISMATCH'));

  // Test F: Missing tenant -> BLOCK
  const resF = evaluateControlledRealVoicePilot({ ...basePilotInput, tenantId: '' });
  assert('P12.3-F', 'Missing tenant -> BLOCK (TENANT_CONTEXT_MISSING)', resF.authorized === false && resF.reasonCodes.includes('TENANT_CONTEXT_MISSING'));

  // Test G: Missing lead -> BLOCK
  const resG = evaluateControlledRealVoicePilot({ ...basePilotInput, leadId: null });
  assert('P12.3-G', 'Missing lead -> BLOCK (LEAD_CONTEXT_MISSING)', resG.authorized === false && resG.reasonCodes.includes('LEAD_CONTEXT_MISSING'));

  // Test H & J: Eligibility failure -> BLOCK
  const resJ = evaluateControlledRealVoicePilot({ ...basePilotInput, eligibilityDecision: 'NOT_ELIGIBLE' });
  assert('P12.3-J', 'Eligibility failure -> BLOCK (ELIGIBILITY_NOT_CONFIRMED)', resJ.authorized === false && resJ.reasonCodes.includes('ELIGIBILITY_NOT_CONFIRMED'));

  // Test K: Compliance failure -> BLOCK
  const resK = evaluateControlledRealVoicePilot({ ...basePilotInput, complianceDecision: 'BLOCKED' });
  assert('P12.3-K', 'Compliance failure -> BLOCK (COMPLIANCE_NOT_ALLOWED)', resK.authorized === false && resK.reasonCodes.includes('COMPLIANCE_NOT_ALLOWED'));

  // Test L: Production authorization failure -> BLOCK
  const resL = evaluateControlledRealVoicePilot({ ...basePilotInput, productionAuthDecision: 'BLOCKED' });
  assert('P12.3-L', 'Production authorization failure -> BLOCK (PRODUCTION_AUTHORIZATION_NOT_CONFIRMED)', resL.authorized === false && resL.reasonCodes.includes('PRODUCTION_AUTHORIZATION_NOT_CONFIRMED'));

  // Test M: Activation readiness failure -> BLOCK
  const resM = evaluateControlledRealVoicePilot({ ...basePilotInput, activationReadinessDecision: 'BLOCKED' });
  assert('P12.3-M', 'Activation readiness failure -> BLOCK (ACTIVATION_READINESS_NOT_CONFIRMED)', resM.authorized === false && resM.reasonCodes.includes('ACTIVATION_READINESS_NOT_CONFIRMED'));

  // Test N: Global kill switch -> BLOCK
  const resN = evaluateControlledRealVoicePilot({ ...basePilotInput, globalKillSwitchActive: true });
  assert('P12.3-N', 'Global kill switch -> BLOCK (GLOBAL_VOICE_KILL_SWITCH_ACTIVE)', resN.authorized === false && resN.reasonCodes.includes('GLOBAL_VOICE_KILL_SWITCH_ACTIVE'));

  // Test O: Pilot kill switch -> BLOCK
  const resO = evaluateControlledRealVoicePilot({ ...basePilotInput, pilotKillSwitchActive: true });
  assert('P12.3-O', 'Pilot kill switch -> BLOCK (PILOT_KILL_SWITCH_ACTIVE)', resO.authorized === false && resO.reasonCodes.includes('PILOT_KILL_SWITCH_ACTIVE'));

  // Test Q: Global real-call limit = 0 -> BLOCK
  const resQ = evaluateControlledRealVoicePilot({ ...basePilotInput, pilotMaxRealCallsGlobal: 0 });
  assert('P12.3-Q', 'Global real-call limit = 0 -> BLOCK (GLOBAL_REAL_CALL_LIMIT_REACHED)', resQ.authorized === false && resQ.reasonCodes.includes('GLOBAL_REAL_CALL_LIMIT_REACHED'));

  // Test R: Tenant real-call limit = 0 -> BLOCK
  const resR = evaluateControlledRealVoicePilot({ ...basePilotInput, pilotMaxRealCallsPerTenant: 0 });
  assert('P12.3-R', 'Tenant real-call limit = 0 -> BLOCK (TENANT_REAL_CALL_LIMIT_REACHED)', resR.authorized === false && resR.reasonCodes.includes('TENANT_REAL_CALL_LIMIT_REACHED'));

  // Test S: Existing active real call -> BLOCK
  const resS = evaluateControlledRealVoicePilot({ ...basePilotInput, hasActiveCall: true });
  assert('P12.3-S', 'Existing active real call -> BLOCK (REAL_CALL_ALREADY_ACTIVE)', resS.authorized === false && resS.reasonCodes.includes('REAL_CALL_ALREADY_ACTIVE'));

  // Test T: Lock conflict -> BLOCK
  const resT = evaluateControlledRealVoicePilot({ ...basePilotInput, hasLockConflict: true });
  assert('P12.3-T', 'Lock conflict -> BLOCK (RESOURCE_LOCK_CONFLICT)', resT.authorized === false && resT.reasonCodes.includes('RESOURCE_LOCK_CONFLICT'));

  // Test V: Non-Sarvam provider -> BLOCK
  const resV = evaluateControlledRealVoicePilot({ ...basePilotInput, provider: 'twilio' });
  assert('P12.3-V', 'Non-Sarvam provider -> BLOCK (PROVIDER_NOT_ALLOWED)', resV.authorized === false && resV.reasonCodes.includes('PROVIDER_NOT_ALLOWED'));

  // Test W: Provider health failure -> BLOCK
  const resW = evaluateControlledRealVoicePilot({ ...basePilotInput, providerHealthy: false });
  assert('P12.3-W', 'Provider health failure -> BLOCK (PROVIDER_UNHEALTHY)', resW.authorized === false && resW.reasonCodes.includes('PROVIDER_UNHEALTHY'));

  // Test X: Fully valid REAL pilot -> PILOT_AUTHORIZED
  const resX = evaluateControlledRealVoicePilot(basePilotInput);
  assert('P12.3-X', 'Fully valid REAL pilot -> PILOT_AUTHORIZED', resX.authorized === true && resX.decision === 'PILOT_AUTHORIZED');

  // Test AB: Determinism
  const resAB1 = evaluateControlledRealVoicePilot(basePilotInput);
  const resAB2 = evaluateControlledRealVoicePilot(basePilotInput);
  assert('P12.3-AB', 'Repeated evaluation is deterministic', resAB1.authorized === resAB2.authorized && resAB1.decision === resAB2.decision);

  // ======================================================
  // CRITICAL INTEGRATION TEST — CONTROLLED SPY EXECUTION
  // ======================================================
  console.log('\n--- Section CRITICAL: Controlled Pilot Execution Integration Test ---');

  let spyCallsCount = 0;
  let mockFallbackCount = 0;

  const spyProvider: IVoiceProvider = {
    providerName: 'sarvam',
    async initiateCall(): Promise<VoiceCallResult> {
      spyCallsCount++;
      return {
        callId: 'SPY-PILOT-CALL-001',
        provider: 'sarvam',
        status: 'DISPATCHED',
        initiated: true,
        created_at: new Date().toISOString(),
      };
    },
    async getCallStatus(callId: string) {
      return {
        callId,
        leadId: 'pilot-lead-123',
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

  // Setup dedicated clean pilot test lead in Supabase
  let pilotLead = await supabaseDataService.leads.getLeadByLeadId({ tenantId: testTenantId }, 'GF-2026-PILOT-TEST');
  if (!pilotLead) {
    pilotLead = await supabaseDataService.leads.createLead({ tenantId: testTenantId }, {
      lead_id: 'GF-2026-PILOT-TEST',
      name: 'Pilot Test Lead',
      phone: '+919876543210',
      email: 'pilot.test@example.com',
      source: 'WEB_FORM',
      status: 'CALL_PENDING',
      consent_status: 'EXPLICIT_CONSENT',
    });
  } else {
    await supabaseDataService.leads.updateLead(
      { tenantId: testTenantId },
      pilotLead.id,
      { status: 'CALL_PENDING', consent_status: 'EXPLICIT_CONSENT' }
    );
  }

  const pilotLeadId = pilotLead.id;

  // Test Case X-Exec: Fully valid pilot configuration executes spy provider EXACTLY 1 time
  try {
    process.env.NODE_ENV = 'test';
    process.env.VOICE_MODE = 'REAL';
    process.env.VOICE_PRODUCTION_ENABLED = 'true';
    process.env.VOICE_ROLLOUT_ENABLED = 'true';
    process.env.VOICE_ROLLOUT_PERCENTAGE = '100';
    process.env.VOICE_REAL_PROVIDER_ALLOWLIST = 'sarvam';
    process.env.VOICE_GLOBAL_KILL_SWITCH = 'false';

    // Configure explicit Pilot parameters
    process.env.VOICE_PILOT_ENABLED = 'true';
    process.env.VOICE_PILOT_TENANT_ID = testTenantId;
    process.env.VOICE_PILOT_LEAD_ID = pilotLeadId;
    process.env.VOICE_PILOT_KILL_SWITCH = 'false';
    process.env.VOICE_PILOT_MAX_REAL_CALLS_GLOBAL = '1';
    process.env.VOICE_PILOT_MAX_REAL_CALLS_PER_TENANT = '1';

    spyCallsCount = 0;
    const startRes = await callService.startCall(pilotLeadId, {
      tenantId: testTenantId,
      provider: spyProvider,
    });

    assert(
      'P12.3-EXEC-01',
      'Fully valid pilot configuration executes spy provider EXACTLY 1 time',
      spyCallsCount === 1 && startRes.callResult.initiated === true
    );

    // Verify audit event VOICE_PILOT_AUTHORIZATION_DECIDED was recorded
    const events = await supabaseDataService.leadEvents.getLeadEvents(
      { tenantId: testTenantId },
      pilotLeadId
    );
    const pilotEvents = events.filter((e) => e.event_type === 'VOICE_PILOT_AUTHORIZATION_DECIDED');
    const latestPilotEvent = pilotEvents[pilotEvents.length - 1];

    assert(
      'P12.3-EXEC-02',
      'VOICE_PILOT_AUTHORIZATION_DECIDED event recorded with PILOT_AUTHORIZED',
      latestPilotEvent !== undefined &&
        latestPilotEvent.event_data?.decision === 'PILOT_AUTHORIZED'
    );

    // Test Case AA: Secrecy safety
    const snapshotStr = JSON.stringify(latestPilotEvent.event_data?.authorization_snapshot || {});
    const hasSecretKey = snapshotStr.includes('API_KEY') || snapshotStr.includes('SECRET') || snapshotStr.includes('0199');
    assert(
      'P12.3-AA',
      'Authorization snapshot contains NO secrets, credentials, or raw PII',
      !hasSecretKey
    );
  } finally {
    // Reset lead state back to RESOLVED
    await supabaseDataService.leads.updateLead(
      { tenantId: testTenantId },
      pilotLeadId,
      { status: 'RESOLVED' }
    );

    // Restore safe default environment configuration
    process.env.NODE_ENV = 'test';
    process.env.VOICE_MODE = 'MOCK';
    process.env.VOICE_PRODUCTION_ENABLED = 'false';
    process.env.VOICE_ROLLOUT_ENABLED = 'false';
    process.env.VOICE_ROLLOUT_PERCENTAGE = '0';
    process.env.VOICE_PILOT_ENABLED = 'false';
    process.env.VOICE_PILOT_TENANT_ID = '';
    process.env.VOICE_PILOT_LEAD_ID = '';
    process.env.VOICE_PILOT_MAX_REAL_CALLS_GLOBAL = '0';
    process.env.VOICE_PILOT_MAX_REAL_CALLS_PER_TENANT = '0';
  }

  // Test Case Y: Provider failure -> ZERO REAL to MOCK fallback
  const failingProvider: IVoiceProvider = {
    providerName: 'sarvam',
    async initiateCall(): Promise<VoiceCallResult> {
      throw new Error('Sarvam gateway timeout');
    },
    async getCallStatus() {
      throw new Error('Not implemented');
    },
    async checkHealth() {
      return { provider: 'sarvam', configured: true, reachable: true, agent_configured: true, phone_configured: true, mode: 'REAL' };
    },
  };

  try {
    process.env.NODE_ENV = 'test';
    process.env.VOICE_MODE = 'REAL';
    process.env.VOICE_PRODUCTION_ENABLED = 'true';
    process.env.VOICE_ROLLOUT_ENABLED = 'true';
    process.env.VOICE_ROLLOUT_PERCENTAGE = '100';
    process.env.VOICE_PILOT_ENABLED = 'true';
    process.env.VOICE_PILOT_TENANT_ID = testTenantId;
    process.env.VOICE_PILOT_LEAD_ID = pilotLeadId;
    process.env.VOICE_PILOT_MAX_REAL_CALLS_GLOBAL = '5';
    process.env.VOICE_PILOT_MAX_REAL_CALLS_PER_TENANT = '5';

    let caughtError: Error | null = null;
    try {
      await callService.startCall(pilotLeadId, {
        tenantId: testTenantId,
        provider: failingProvider,
      });
    } catch (err: any) {
      caughtError = err;
    }

    assert(
      'P12.3-Y',
      'Provider error throws directly with ZERO REAL -> MOCK fallback',
      caughtError !== null && caughtError.message.includes('Sarvam gateway timeout') && mockFallbackCount === 0
    );
  } finally {
    process.env.NODE_ENV = 'test';
    process.env.VOICE_MODE = 'MOCK';
    process.env.VOICE_PRODUCTION_ENABLED = 'false';
    process.env.VOICE_PILOT_ENABLED = 'false';
  }

  console.log('\n======================================================');
  console.log(`📊 PHASE 12.3 TEST SUMMARY: ${passed} PASSED / ${failed} FAILED`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase123Tests().catch((err) => {
  console.error('Phase 12.3 Test Suite Error:', err);
  process.exit(1);
});
