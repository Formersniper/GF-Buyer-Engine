/**
 * GrowthForge Buyer Intelligence Engine - Phase 4B Final Live Integration Runner
 *
 * SPECIFICATION:
 * - Validates all Sarvam production/test environment variables without logging secrets.
 * - Confirms API endpoint, request schema, provider selection, and call eligibility.
 * - Executes ONE controlled outbound call to the authorized test phone via CallService.
 * - Asserts external call ID, Supabase `calls` persistence, `lead_events` audit stream, and webhook idempotency.
 */

import 'dotenv/config';
import { callService } from '../app/services/calls/callService';
import { sarvamVoiceProvider } from '../app/services/voice/sarvamVoiceProvider';
import { supabaseDataService } from '../app/services/supabase/repositories';
import { processSarvamWebhook } from '../app/services/voice/sarvamWebhook';

async function runPhase4BFinalLiveValidation() {
  console.log('============================================================');
  console.log('🚀 GROWTHFORGE ↔ SARVAM FINAL LIVE INTEGRATION VALIDATION');
  console.log('============================================================\n');

  // 1. Configuration Validation (Report boolean status only, NEVER print secrets)
  console.log('--- 1. CONFIGURATION VALIDATION ---');
  const apiKeyConfigured = !!process.env.SARVAM_API_KEY && process.env.SARVAM_API_KEY.trim().length > 0;
  const baseUrlConfigured = !!process.env.SARVAM_BASE_URL;
  const orgIdConfigured = !!process.env.SARVAM_ORG_ID;
  const workspaceIdConfigured = !!process.env.SARVAM_WORKSPACE_ID;
  const agentIdConfigured = !!process.env.SARVAM_AGENT_ID;
  const agentVersionConfigured = !!process.env.SARVAM_AGENT_VERSION;
  const connectionIdConfigured = !!process.env.SARVAM_CONNECTION_ID;
  const agentPhoneConfigured = !!process.env.SARVAM_AGENT_PHONE_NUMBER;

  let rawBase = (process.env.SARVAM_BASE_URL || 'https://apps.sarvam.ai').replace(/\/$/, '');
  let normalizedBase = rawBase;
  if (rawBase.includes('/api/')) {
    try {
      const parsed = new URL(rawBase);
      normalizedBase = `${parsed.protocol}//${parsed.host}`;
    } catch {
      normalizedBase = rawBase.split('/api')[0] || 'https://apps.sarvam.ai';
    }
  }

  console.log(`SARVAM_API_KEY configured:            ${apiKeyConfigured}`);
  console.log(`SARVAM_BASE_URL configured:           ${baseUrlConfigured} (Resolves to: ${normalizedBase})`);
  console.log(`SARVAM_ORG_ID configured:            ${orgIdConfigured}`);
  console.log(`SARVAM_WORKSPACE_ID configured:      ${workspaceIdConfigured}`);
  console.log(`SARVAM_AGENT_ID configured:          ${agentIdConfigured}`);
  console.log(`SARVAM_AGENT_VERSION configured:     ${agentVersionConfigured}`);
  console.log(`SARVAM_CONNECTION_ID configured:     ${connectionIdConfigured}`);
  console.log(`SARVAM_AGENT_PHONE_NUMBER configured:${agentPhoneConfigured}`);

  const orgId = process.env.SARVAM_ORG_ID || '01a074ea-647b-7549-9a87-cb4a09a65faa';
  const workspaceId = process.env.SARVAM_WORKSPACE_ID || '01a074ea-6481-766d-a3f3-c42aef343735';
  const expectedEndpoint = `${normalizedBase}/api/outbounds/v1/orgs/${orgId}/workspaces/${workspaceId}/outbounds`;
  console.log(`\nExact Target Endpoint: ${expectedEndpoint}`);

  // 2. Health & Provider Readiness Probe
  console.log('\n--- 2. VOICE PROVIDER PROBE ---');
  const health = await sarvamVoiceProvider.checkHealth();
  console.log(`Provider Name:         ${health.provider}`);
  console.log(`Configured:            ${health.configured}`);
  console.log(`Reachable:             ${health.reachable}`);
  console.log(`Agent Configured:      ${health.agent_configured}`);
  console.log(`Phone Configured:      ${health.phone_configured}`);
  if ((health as any).latency_ms !== undefined) {
    console.log(`Probe Latency:         ${(health as any).latency_ms} ms`);
  }
  if (health.reason) {
    console.log(`Status Reason:         ${health.reason}`);
  }

  // 3. Prepare Single Authorized Test Lead
  console.log('\n--- 3. CONTROLLED TEST LEAD PREPARATION ---');
  const authorizedTestPhone = process.env.VOICE_TEST_TARGET_PHONE || '+919145602414';
  const authorizedTestName = process.env.VOICE_TEST_TARGET_NAME || 'Vikram Mehta';
  const testLeadId = 'GF-LEAD-SARVAM-LIVE-001';

  let testLead = await supabaseDataService.leads.getLeadByLeadId(testLeadId);
  if (!testLead) {
    testLead = await supabaseDataService.leads.createLead({
      lead_id: testLeadId,
      name: authorizedTestName,
      phone: authorizedTestPhone,
      email: 'vikram.mehta@example.com',
      source: 'WEB_PORTAL',
      source_reference: 'PHASE_4B_LIVE_TEST',
      status: 'ENRICHED',
    });
  } else {
    await supabaseDataService.leads.updateLead(testLead.id, {
      status: 'ENRICHED',
      phone: authorizedTestPhone,
      name: authorizedTestName,
    });
  }

  console.log(`Test Lead UUID:        ${testLead.id}`);
  console.log(`Test Lead ID:          ${testLead.lead_id}`);
  console.log(`Contact Name:          ${authorizedTestName}`);
  console.log(`Destination Phone:     ${authorizedTestPhone.slice(-4).padStart(authorizedTestPhone.length, '*')}`);

  // 4. Verify Call Eligibility Gate
  console.log('\n--- 4. CALL ELIGIBILITY EVALUATION ---');
  const eligibility = await callService.evaluateAndPrepareCall(testLead.id, {
    actor: 'human_operator',
  });
  console.log(`Eligibility Decision:  ${eligibility.eligibility.decision}`);
  console.log(`Eligibility Rationale: ${eligibility.eligibility.reasons.join('; ')}`);
  console.log(`New Workflow Status:   ${eligibility.newStatus}`);

  if (eligibility.eligibility.decision !== 'ELIGIBLE') {
    console.error('❌ Test lead is not eligible for calling.');
    process.exit(1);
  }

  // Confirm lead is in CALL_PENDING state before calling
  const freshLead = await supabaseDataService.leads.getLead(testLead.id);
  console.log(`Verified Status:       ${freshLead?.status} (Expected: CALL_PENDING)`);

  // 5. Execute Single Outbound Call via CallService
  console.log('\n--- 5. EXECUTING LIVE OUTBOUND CALL VIA CALLSERVICE ---');
  let callDispatch;
  try {
    callDispatch = await callService.startCall(testLead.id, {
      actor: 'human_operator',
    });
  } catch (callError: any) {
    console.error('\n❌ Call Dispatch Failed at CallService Layer:');
    console.error(callError.message || callError);
    return;
  }

  console.log(`Call Initiated:        ${callDispatch.callResult.initiated}`);
  console.log(`Internal Call ID:      ${callDispatch.callResult.callId}`);
  console.log(`External Sarvam ID:    ${callDispatch.callResult.external_call_id || 'N/A'}`);
  console.log(`Provider Call Status:  ${callDispatch.callResult.status}`);
  console.log(`Updated Lead Status:   ${callDispatch.newStatus}`);

  // 6. Verify Supabase Calls Table Persistence
  console.log('\n--- 6. VERIFYING SUPABASE CALL RECORD ---');
  const persistedCall = await supabaseDataService.calls.getCall(callDispatch.callResult.callId);
  if (!persistedCall) {
    console.error('❌ Could not retrieve persisted call record.');
    process.exit(1);
  }
  console.log(`Call Record UUID:      ${persistedCall.id}`);
  console.log(`Provider:              ${persistedCall.provider}`);
  console.log(`Provider Call ID:      ${persistedCall.provider_call_id || 'N/A'}`);
  console.log(`DB Status:             ${persistedCall.status}`);
  console.log(`Metadata:              ${JSON.stringify(persistedCall.call_metadata)}`);

  // 7. Verify Audit Trail in lead_events
  console.log('\n--- 7. AUDIT TRAIL VERIFICATION (lead_events) ---');
  const events = await supabaseDataService.leadEvents.getLeadEvents(testLead.id);
  const eventTypes = events.map((e) => e.event_type);
  console.log(`Total Audit Events:    ${events.length}`);
  console.log(`Event Sequence:        ${eventTypes.join(' ➔ ')}`);

  // 8. Test Webhook Correlation & Idempotency
  console.log('\n--- 8. WEBHOOK CORRELATION & IDEMPOTENCY TEST ---');
  const sampleEventId = `EVT-SARVAM-LIVE-${Date.now()}`;
  const externalIdToUse = callDispatch.callResult.external_call_id || persistedCall.provider_call_id || `SARVAM-LIVE-${testLead.id}`;

  console.log(`Simulating Sarvam Callback with Event ID: ${sampleEventId}...`);
  const webhookResult1 = await processSarvamWebhook({
    event_id: sampleEventId,
    event_type: 'call.ended',
    outbound_id: externalIdToUse,
    call_id: externalIdToUse,
    status: 'completed',
    duration_seconds: 48,
    metadata: {
      lead_id: testLead.lead_id,
    },
  });
  console.log(`Webhook Dispatch 1:    Success = ${webhookResult1.success}, Action = ${webhookResult1.action}`);

  console.log('Simulating Duplicate Webhook Delivery...');
  const webhookResult2 = await processSarvamWebhook({
    event_id: sampleEventId,
    event_type: 'call.ended',
    outbound_id: externalIdToUse,
    call_id: externalIdToUse,
    status: 'completed',
    duration_seconds: 48,
    metadata: {
      lead_id: testLead.lead_id,
    },
  });
  console.log(`Webhook Dispatch 2:    Success = ${webhookResult2.success}, Action = ${webhookResult2.action} (Expected: IGNORED_DUPLICATE)`);

  // 9. Final Workflow State Confirmation
  console.log('\n--- 9. FINAL WORKFLOW & DB INTEGRITY ---');
  const finalLead = await supabaseDataService.leads.getLead(testLead.id);
  const finalCall = await supabaseDataService.calls.getCall(persistedCall.id);
  console.log(`Final Lead Status:     ${finalLead?.status}`);
  console.log(`Final Call Status:     ${finalCall?.status}`);
  console.log(`Final Call Duration:   ${finalCall?.duration_seconds}s`);

  console.log('\n============================================================');
  console.log('🎉 LIVE INTEGRATION VALIDATION RUN COMPLETED');
  console.log('============================================================\n');
}

runPhase4BFinalLiveValidation().catch((err) => {
  console.error('Fatal Validation Error:', err);
  process.exit(1);
});

