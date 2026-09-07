/**
 * GrowthForge Buyer Intelligence Engine - Phase 4A Call Eligibility Test Matrix
 *
 * Covers Tests 1 through 15 specified in Phase 4A contract.
 */

import { evaluateCallEligibility, validatePhoneFormat } from '../app/services/calls/callEligibility';
import { callService } from '../app/services/calls/callService';
import { mockVoiceProvider } from '../app/services/voice/mockVoiceProvider';
import { supabaseDataService } from '../app/services/supabase/repositories';

async function runTestSuite() {
  console.log('======================================================');
  console.log('🧪 GROWTHFORGE PHASE 4A — CALL ELIGIBILITY TEST MATRIX');
  console.log('======================================================\n');

  let passedTests = 0;
  let totalTests = 15;
  const results: { test: number; name: string; status: 'PASS' | 'FAIL'; details?: string }[] = [];

  // Helper assertion
  function assert(testNum: number, name: string, condition: boolean, details?: string) {
    if (condition) {
      passedTests++;
      console.log(`  ✅ TEST ${testNum}: ${name}`);
      results.push({ test: testNum, name, status: 'PASS' });
    } else {
      console.error(`  ❌ TEST ${testNum} FAILED: ${name} — ${details}`);
      results.push({ test: testNum, name, status: 'FAIL', details });
    }
  }

  // --- UNIT TESTS: DETERMINISTIC POLICY ENGINE ---

  // TEST 1: ENRICHED + valid phone + permissible calling state -> ELIGIBLE
  const res1 = evaluateCallEligibility({
    leadId: 'test-lead-1',
    status: 'ENRICHED',
    phone: '+919876543210',
    consentStatus: 'PERMISSIBLE',
  });
  assert(
    1,
    'ENRICHED + valid phone + permissible calling state -> ELIGIBLE',
    res1.eligible === true && res1.decision === 'ELIGIBLE' && res1.policyVersion === 'CALL_ELIGIBILITY_V1'
  );

  // TEST 2: ENRICHED + missing phone -> NOT_ELIGIBLE
  const res2 = evaluateCallEligibility({
    leadId: 'test-lead-2',
    status: 'ENRICHED',
    phone: null,
    consentStatus: 'PERMISSIBLE',
  });
  assert(
    2,
    'ENRICHED + missing phone -> NOT_ELIGIBLE',
    res2.eligible === false && res2.decision === 'NOT_ELIGIBLE' && res2.phone_format_valid === false
  );

  // TEST 3: ENRICHED + invalid phone -> NOT_ELIGIBLE
  const res3 = evaluateCallEligibility({
    leadId: 'test-lead-3',
    status: 'ENRICHED',
    phone: 'invalid-phone-abc',
    consentStatus: 'PERMISSIBLE',
  });
  assert(
    3,
    'ENRICHED + invalid phone -> NOT_ELIGIBLE',
    res3.eligible === false && res3.decision === 'NOT_ELIGIBLE' && res3.phone_format_valid === false
  );

  // TEST 4: ENRICHED + explicit opt-out -> NOT_ELIGIBLE
  const res4 = evaluateCallEligibility({
    leadId: 'test-lead-4',
    status: 'ENRICHED',
    phone: '+919876543210',
    consentStatus: 'OPT_OUT',
  });
  assert(
    4,
    'ENRICHED + explicit opt-out -> NOT_ELIGIBLE',
    res4.eligible === false && res4.decision === 'NOT_ELIGIBLE' && res4.consent_state === 'OPT_OUT'
  );

  // TEST 5: ENRICHED + unknown consent state -> REQUIRES_REVIEW
  const res5 = evaluateCallEligibility({
    leadId: 'test-lead-5',
    status: 'ENRICHED',
    phone: '+919876543210',
    consentStatus: 'UNKNOWN',
  });
  assert(
    5,
    'ENRICHED + unknown consent state -> REQUIRES_REVIEW',
    res5.eligible === false && res5.decision === 'REQUIRES_REVIEW' && res5.phone_format_valid === true
  );

  // TEST 6: RAW + valid phone -> NOT_ELIGIBLE
  const res6 = evaluateCallEligibility({
    leadId: 'test-lead-6',
    status: 'RAW',
    phone: '+919876543210',
    consentStatus: 'PERMISSIBLE',
  });
  assert(
    6,
    'RAW + valid phone -> NOT_ELIGIBLE',
    res6.eligible === false && res6.decision === 'NOT_ELIGIBLE'
  );

  // TEST 7: ENRICHING + valid phone -> NOT_ELIGIBLE
  const res7 = evaluateCallEligibility({
    leadId: 'test-lead-7',
    status: 'ENRICHING',
    phone: '+919876543210',
    consentStatus: 'PERMISSIBLE',
  });
  assert(
    7,
    'ENRICHING + valid phone -> NOT_ELIGIBLE',
    res7.eligible === false && res7.decision === 'NOT_ELIGIBLE'
  );

  // TEST 8: ENRICHMENT_FAILED + valid phone -> NOT_ELIGIBLE
  const res8 = evaluateCallEligibility({
    leadId: 'test-lead-8',
    status: 'ENRICHMENT_FAILED',
    phone: '+919876543210',
    consentStatus: 'PERMISSIBLE',
  });
  assert(
    8,
    'ENRICHMENT_FAILED + valid phone -> NOT_ELIGIBLE',
    res8.eligible === false && res8.decision === 'NOT_ELIGIBLE'
  );

  // --- SERVICE & WORKFLOW TESTS ---

  // Set up a test fixture lead in memory/store
  const testLeadRecord = await supabaseDataService.leads.createLead({
    lead_id: `GF-TEST-ELIG-${Date.now()}`,
    name: 'Ananya Sharma',
    phone: '+919876543210',
    email: 'ananya.sharma@example.com',
    source: 'WEB_FORM',
    source_reference: null,
    status: 'ENRICHED',
  });

  // TEST 9: ELIGIBLE lead handed to MockVoiceProvider -> MOCK_READY -> initiated = false
  const mockCallResult = await mockVoiceProvider.initiateCall({
    lead_id: testLeadRecord.id,
    phone_number: '+919876543210',
    contact_name: 'Ananya Sharma',
  });
  assert(
    9,
    'ELIGIBLE lead handed to MockVoiceProvider -> MOCK_READY -> initiated = false',
    mockCallResult.status === 'MOCK_READY' &&
      mockCallResult.initiated === false &&
      mockCallResult.provider === 'mock' &&
      mockCallResult.callId.startsWith('MOCK-CALL-')
  );

  // TEST 10: Verify no real voice provider/network invocation occurred
  const checkStatus = await mockVoiceProvider.getCallStatus(mockCallResult.callId);
  assert(
    10,
    'Verify no real voice provider/network invocation occurred',
    checkStatus.provider === 'mock' && checkStatus.initiated === false && checkStatus.started_at === null
  );

  // TEST 11 & 12: Verify CALL_ELIGIBILITY_STARTED & CALL_ELIGIBILITY_DECIDED events
  const execution = await callService.evaluateAndPrepareCall(testLeadRecord.id, {
    consentOverride: 'PERMISSIBLE',
  });
  const events = await supabaseDataService.leadEvents.getLeadEvents(testLeadRecord.id);
  const startedEvent = events.find((e) => e.event_type === 'CALL_ELIGIBILITY_STARTED');
  const decidedEvent = events.find((e) => e.event_type === 'CALL_ELIGIBILITY_DECIDED');

  assert(
    11,
    'Verify CALL_ELIGIBILITY_STARTED event recorded in Supabase audit trail',
    !!startedEvent && startedEvent.event_data?.policy_version === 'CALL_ELIGIBILITY_V1'
  );

  assert(
    12,
    'Verify CALL_ELIGIBILITY_DECIDED event recorded in Supabase audit trail',
    !!decidedEvent &&
      decidedEvent.event_data?.decision === 'ELIGIBLE' &&
      decidedEvent.event_data?.phone_format_valid === true
  );

  // TEST 13: Verify ELIGIBLE lead reaches CALL_PENDING
  assert(
    13,
    'Verify ELIGIBLE lead reaches CALL_PENDING',
    execution.newStatus === 'CALL_PENDING' && execution.canonicalLead.workflow.status === 'CALL_PENDING'
  );

  // TEST 14: Verify NOT_ELIGIBLE lead does not reach CALL_PENDING
  const ineligibleLeadRecord = await supabaseDataService.leads.createLead({
    lead_id: `GF-TEST-INELIG-${Date.now()}`,
    name: 'Opted Out Buyer',
    phone: '+919876543210',
    email: 'optout@example.com',
    source: 'COLD_LIST',
    source_reference: null,
    status: 'ENRICHED',
  });

  const ineligExecution = await callService.evaluateAndPrepareCall(ineligibleLeadRecord.id, {
    consentOverride: 'OPT_OUT',
  });
  assert(
    14,
    'Verify NOT_ELIGIBLE lead does not reach CALL_PENDING (transitions to NURTURE)',
    ineligExecution.newStatus === 'NURTURE' &&
      ineligExecution.canonicalLead.workflow.status === 'NURTURE' &&
      ineligExecution.mockCallResult === undefined
  );

  // TEST 15: Verify REQUIRES_REVIEW lead does not reach CALL_PENDING
  const ambiguousLeadRecord = await supabaseDataService.leads.createLead({
    lead_id: `GF-TEST-AMBIG-${Date.now()}`,
    name: 'Ambiguous Consent Buyer',
    phone: '+919876543210',
    email: 'ambiguous@example.com',
    source: 'UNKNOWN_SOURCE',
    source_reference: null,
    status: 'ENRICHED',
  });

  const ambigExecution = await callService.evaluateAndPrepareCall(ambiguousLeadRecord.id, {
    consentOverride: 'UNKNOWN',
  });
  assert(
    15,
    'Verify REQUIRES_REVIEW lead does not reach CALL_PENDING (transitions to REQUIRES_REVIEW)',
    ambigExecution.newStatus === 'REQUIRES_REVIEW' &&
      ambigExecution.canonicalLead.workflow.status === 'REQUIRES_REVIEW' &&
      ambigExecution.mockCallResult === undefined
  );

  console.log('\n======================================================');
  console.log(`📊 PHASE 4A TEST RESULTS: ${passedTests} / ${totalTests} TESTS PASSED`);
  console.log('======================================================\n');

  if (passedTests === totalTests) {
    console.log('🎉 ALL 15 PHASE 4A TESTS COMPLETED: PASS\n');
  } else {
    console.error('❌ SOME TESTS FAILED');
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
