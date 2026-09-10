/**
 * GrowthForge Buyer Intelligence Engine - Phase 5C Buyer Qualification Test Suite
 *
 * Deterministic Test Coverage:
 * 1. Canonical multi-requirement buyer (Anupam Saini) evaluated to PARTIALLY_QUALIFIED
 * 2. Strict reason codes matching extracted evidence
 * 3. Blocking fields ('budget') and follow-up fields ('budget', 'financing', 'decision_maker')
 * 4. Fully qualified buyer with confirmed numeric budget evaluated to QUALIFIED
 * 5. Disinterested buyer (interested: false) evaluated to NURTURE
 * 6. Vague exploratory buyer with no actionable criteria evaluated to NURTURE
 * 7. Distant timeline buyer with unresolved requirements evaluated to NURTURE
 * 8. Contradictory extraction data evaluated to REQUIRES_REVIEW
 * 9. Missing extraction data / failed extraction handled gracefully with REQUIRES_REVIEW
 * 10. Missing extraction record (invalid ID) returns EXTRACTION_NOT_FOUND
 * 11. Deterministic idempotency: Duplicate qualification returns EXISTING_QUALIFICATION
 * 12. Forced requalification (forceRequalify: true)
 * 13. Audit events logged to lead_events (QUALIFICATION_STARTED, QUALIFICATION_COMPLETED, QUALIFICATION_DUPLICATE)
 * 14. Phase 5B extraction immutability verified
 * 15. Phase 5A transcript immutability verified
 * 16. Multi-requirement preservation without collapsing
 * 17. Epistemic UNKNOWN preservation without guessing or hallucinating
 * 18. API / repository retrieval by ID, extraction ID, and lead ID
 */

import { supabaseDataService } from '../app/services/supabase/repositories';
import { transcriptIngestionService } from '../app/services/voice/transcriptIngestionService';
import { conversationExtractionService } from '../app/services/gemini/conversationExtractionService';
import { buyerQualificationService } from '../app/services/qualification/buyerQualificationService';
import { qualificationRulesEngine } from '../app/services/qualification/qualificationRules';
import {
  MockGeminiExtractionProvider,
  setGeminiExtractionProvider,
} from '../app/services/gemini/geminiExtractionProvider';
import {
  QUALIFICATION_RULE_VERSION,
  QUALIFICATION_SCHEMA_VERSION,
} from '../app/schemas/qualification';
import { ExtractedBuyerIntelligence } from '../app/schemas/extraction';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: unknown;
}

const results: TestResult[] = [];

function assert(condition: boolean, name: string, message?: string) {
  if (condition) {
    results.push({ name, passed: true });
    console.log(`  ✓ PASS: ${name}`);
  } else {
    results.push({ name, passed: false, error: message || 'Assertion failed' });
    console.error(`  ✗ FAIL: ${name} — ${message || 'Assertion failed'}`);
  }
}

async function runPhase5cTests() {
  console.log('============================================================');
  console.log('GROWTHFORGE PHASE 5C — BUYER QUALIFICATION ENGINE TESTS');
  console.log('============================================================\n');

  // Set mock provider for deterministic offline testing
  const mockProvider = new MockGeminiExtractionProvider();
  setGeminiExtractionProvider(mockProvider);

  // --- SETUP CANONICAL LEAD, CALL, TRANSCRIPT, EXTRACTION ---
  const lead1 = await supabaseDataService.leads.createLead({
    lead_id: `GF-5C-LEAD-${Date.now()}-1`,
    name: 'Anupam Saini',
    phone: '+919145602414',
    email: 'anupam.saini@test.com',
    source: 'TEST_PHASE5C',
    source_reference: 'REF-5C-01',
    status: 'CALL_COMPLETED',
  });

  const call1 = await supabaseDataService.calls.createCall({
    lead_id: lead1.id,
    provider: 'sarvam',
    provider_call_id: `sarvam-5c-call-001-${Date.now()}`,
    status: 'COMPLETED',
    duration_seconds: 142,
    started_at: new Date(Date.now() - 150000).toISOString(),
    ended_at: new Date().toISOString(),
  });

  const canonicalTranscript = `
Agent: Namaste Anupam ji, main GrowthForge ki taraf se bol raha hoon. Kya aap Vrindavan mein property dekh rahe hain?
User: Haan ji, main Vrindavan mein property dekh raha hoon. Chatti Kila Road ke paas preference hai.
Agent: Bahut badhiya. Aapka budget aur configuration kya hai?
User: Minimum 3 BHK hona chahiye. Budget area par depend karega. End use / residence ke liye dekh rahe hain.
Agent: Theek hai. Kya aapko koi farmhouse ya plot bhi chahiye?
User: Haan, agar 800 se 1000 square yards ka farm house mile toh investment ke liye woh bhi dekh lenge.
Agent: Timeline kya hai aapka?
User: As soon as possible plan hai. Ready-to-move and under-construction dono chalega.
Agent: Kya aap decision maker hain ya kisi aur se discuss karna hai?
User: Dekhte hain, family se baat karenge.
Agent: Theek hai, thank you.
`.trim();

  const transcriptRes1 = await transcriptIngestionService.ingestTranscript({
    call_id: call1.id,
    provider_call_id: call1.provider_call_id,
    transcript_text: canonicalTranscript,
    source: 'sarvam',
  });

  const extractionRes1 = await conversationExtractionService.extractFromTranscript({
    transcriptId: transcriptRes1.transcriptId!,
  });

  const extraction1 = extractionRes1.extraction!;

  // -------------------------------------------------------------
  // TEST 1: Canonical Sample Buyer Qualification (Anupam Saini)
  // -------------------------------------------------------------
  console.log('[Scenario 1: Canonical Sample Buyer Qualification]');
  const qualRes1 = await buyerQualificationService.qualifyExtraction({
    extractionId: extraction1.id,
  });

  assert(qualRes1.success === true, 'Canonical buyer qualification succeeds');
  assert(qualRes1.action === 'PARTIALLY_QUALIFIED', 'Canonical buyer is PARTIALLY_QUALIFIED');
  assert(
    qualRes1.qualification?.qualification_status === 'PARTIALLY_QUALIFIED',
    'Qualification record status is PARTIALLY_QUALIFIED'
  );

  // -------------------------------------------------------------
  // TEST 2: Reason Codes & Epistemic Truth for Canonical Buyer
  // -------------------------------------------------------------
  console.log('\n[Scenario 2: Reason Codes & Truth Model]');
  const codes1 = qualRes1.qualification?.reason_codes || [];
  assert(codes1.includes('ACTIVE_INTENT_CONFIRMED'), 'Includes ACTIVE_INTENT_CONFIRMED');
  assert(codes1.includes('LOCATION_CONFIRMED'), 'Includes LOCATION_CONFIRMED');
  assert(codes1.includes('REQUIREMENT_CONFIRMED'), 'Includes REQUIREMENT_CONFIRMED');
  assert(codes1.includes('CONFIGURATION_CONFIRMED'), 'Includes CONFIGURATION_CONFIRMED');
  assert(codes1.includes('PURPOSE_CONFIRMED'), 'Includes PURPOSE_CONFIRMED');
  assert(codes1.includes('TIMELINE_CONFIRMED'), 'Includes TIMELINE_CONFIRMED');
  assert(codes1.includes('BUDGET_MISSING'), 'Includes BUDGET_MISSING (no numeric budget)');
  assert(codes1.includes('FINANCING_UNKNOWN'), 'Includes FINANCING_UNKNOWN');
  assert(codes1.includes('DECISION_MAKER_UNKNOWN'), 'Includes DECISION_MAKER_UNKNOWN');
  assert(codes1.includes('MULTI_REQUIREMENT_DETECTED'), 'Includes MULTI_REQUIREMENT_DETECTED');

  // -------------------------------------------------------------
  // TEST 3: Blocking & Follow-up Fields
  // -------------------------------------------------------------
  console.log('\n[Scenario 3: Blocking and Follow-up Fields]');
  const blocking1 = qualRes1.qualification?.blocking_fields || [];
  const followUp1 = qualRes1.qualification?.follow_up_fields || [];
  assert(blocking1.includes('budget'), 'Blocking fields contains budget');
  assert(followUp1.includes('budget'), 'Follow-up fields contains budget');
  assert(followUp1.includes('financing'), 'Follow-up fields contains financing');
  assert(followUp1.includes('decision_maker'), 'Follow-up fields contains decision_maker');

  // -------------------------------------------------------------
  // TEST 4: Fully Qualified Buyer with Confirmed Budget
  // -------------------------------------------------------------
  console.log('\n[Scenario 4: Fully Qualified Buyer with Numeric Budget]');
  const fullBuyerData: ExtractedBuyerIntelligence = {
    ...extraction1.extracted_data!,
    budget: {
      min: 15000000,
      max: 20000000,
      currency: 'INR',
      raw_expression: '1.5 se 2 crore',
      truth_level: 'CONFIRMED',
      evidence: 'Budget lagbhag 1.5 se 2 crore tak ka hai',
    },
    financing: {
      value: 'Self-funded',
      truth_level: 'CONFIRMED',
      evidence: 'Apne funds se lenge, koi loan nahi chahiye',
      source: 'CALL_TRANSCRIPT',
    },
    decision_maker: {
      value: true,
      truth_level: 'CONFIRMED',
      evidence: 'Main hi final decision leta hoon',
      source: 'CALL_TRANSCRIPT',
    },
  };

  const leadFull = await supabaseDataService.leads.createLead({
    lead_id: `GF-5C-LEAD-FULL-${Date.now()}`,
    name: 'Rajesh Sharma',
    phone: '+919876543210',
    source: 'TEST_PHASE5C',
    status: 'CALL_COMPLETED',
  });

  const callFull = await supabaseDataService.calls.createCall({
    lead_id: leadFull.id,
    provider: 'sarvam',
    status: 'COMPLETED',
    duration_seconds: 120,
  });

  const transcriptFull = await supabaseDataService.transcripts.createTranscript({
    lead_id: leadFull.id,
    call_id: callFull.id,
    transcript_text: 'Full qualification transcript',
    source: 'sarvam',
    ingestion_status: 'INGESTED',
    ingestion_version: '1.0',
    captured_at: new Date().toISOString(),
  });

  const extractionFull = await supabaseDataService.extractions.createExtraction({
    lead_id: leadFull.id,
    call_id: callFull.id,
    transcript_id: transcriptFull.id,
    model: 'gemini-2.5-flash',
    prompt_version: '1.0',
    schema_version: '1.0',
    extraction_status: 'EXTRACTED',
    extracted_data: fullBuyerData,
  });

  const qualResFull = await buyerQualificationService.qualifyExtraction({
    extractionId: extractionFull.id,
  });

  assert(qualResFull.success === true, 'Full buyer qualification succeeds');
  assert(qualResFull.action === 'QUALIFIED', 'Buyer with confirmed budget is QUALIFIED');
  assert(
    qualResFull.qualification?.reason_codes.includes('BUDGET_CONFIRMED') === true,
    'Reason codes include BUDGET_CONFIRMED'
  );
  assert(
    qualResFull.qualification?.blocking_fields.length === 0,
    'No blocking fields for fully qualified buyer'
  );

  // -------------------------------------------------------------
  // TEST 5: Disinterested Buyer (interested: false) -> NURTURE
  // -------------------------------------------------------------
  console.log('\n[Scenario 5: Disinterested Buyer]');
  const disinterestedData: ExtractedBuyerIntelligence = {
    ...extraction1.extracted_data!,
    interested: {
      value: false,
      truth_level: 'CONFIRMED',
      evidence: 'Nahi, mujhe koi property nahi leni hai, wrong number',
      source: 'CALL_TRANSCRIPT',
    },
  };

  const qualDisinterested = qualificationRulesEngine.evaluate({
    extractedData: disinterestedData,
  });

  assert(qualDisinterested.status === 'NURTURE', 'Disinterested buyer is NURTURE');
  assert(
    qualDisinterested.reason_codes.includes('ACTIVE_INTENT_DISCONFIRMED'),
    'Includes ACTIVE_INTENT_DISCONFIRMED'
  );

  // -------------------------------------------------------------
  // TEST 6: Vague Exploratory Buyer -> NURTURE
  // -------------------------------------------------------------
  console.log('\n[Scenario 6: Vague Exploratory Buyer]');
  const vagueData: ExtractedBuyerIntelligence = {
    ...extraction1.extracted_data!,
    interested: {
      value: null,
      truth_level: 'UNKNOWN',
      evidence: null,
      source: 'CALL_TRANSCRIPT',
    },
    primary_property_type: {
      value: null,
      truth_level: 'UNKNOWN',
      evidence: null,
      source: 'CALL_TRANSCRIPT',
    },
    preferred_locations: {
      value: [],
      truth_level: 'UNKNOWN',
      evidence: null,
      source: 'CALL_TRANSCRIPT',
    },
    requirements: [],
  };

  const qualVague = qualificationRulesEngine.evaluate({
    extractedData: vagueData,
  });

  assert(qualVague.status === 'NURTURE', 'Vague exploratory buyer with no criteria is NURTURE');

  // -------------------------------------------------------------
  // TEST 7: Distant Timeline Buyer -> NURTURE
  // -------------------------------------------------------------
  console.log('\n[Scenario 7: Distant Timeline Buyer]');
  const distantTimelineData: ExtractedBuyerIntelligence = {
    ...vagueData,
    interested: {
      value: true,
      truth_level: 'CONFIRMED',
      evidence: 'Haan dekh rahe hain',
      source: 'CALL_TRANSCRIPT',
    },
    timeline: {
      value: 'After 2 years, just exploring',
      truth_level: 'CONFIRMED',
      evidence: 'Abhi nahi, do saal baad plan banega',
      source: 'CALL_TRANSCRIPT',
    },
  };

  const qualDistant = qualificationRulesEngine.evaluate({
    extractedData: distantTimelineData,
  });

  assert(
    qualDistant.status === 'NURTURE',
    'Distant timeline (2 years) with unresolved requirements is NURTURE'
  );
  assert(qualDistant.reason_codes.includes('TIMELINE_DISTANT'), 'Includes TIMELINE_DISTANT');

  // -------------------------------------------------------------
  // TEST 8: Contradictory Extraction Data -> REQUIRES_REVIEW
  // -------------------------------------------------------------
  console.log('\n[Scenario 8: Contradictory Extraction Data]');
  const contradictoryData: ExtractedBuyerIntelligence = {
    ...fullBuyerData,
    budget: {
      min: 50000000,
      max: 10000000, // min > max contradiction
      currency: 'INR',
      truth_level: 'CONFIRMED',
      evidence: '5 crore se 1 crore',
    },
  };

  const qualContradiction = qualificationRulesEngine.evaluate({
    extractedData: contradictoryData,
  });

  assert(
    qualContradiction.status === 'REQUIRES_REVIEW',
    'Contradictory extraction (min > max) evaluates to REQUIRES_REVIEW'
  );
  assert(
    qualContradiction.reason_codes.includes('CONTRADICTION_DETECTED'),
    'Includes CONTRADICTION_DETECTED'
  );

  // -------------------------------------------------------------
  // TEST 9: Missing / Failed Extraction Data -> REQUIRES_REVIEW
  // -------------------------------------------------------------
  console.log('\n[Scenario 9: Missing / Failed Extraction Data]');
  const qualMissingData = qualificationRulesEngine.evaluate({
    extractedData: null,
    extractionStatus: 'EXTRACTION_FAILED',
  });

  assert(
    qualMissingData.status === 'REQUIRES_REVIEW',
    'Null extracted data evaluates to REQUIRES_REVIEW'
  );
  assert(
    qualMissingData.reason_codes.includes('EXTRACTION_DATA_INVALID'),
    'Includes EXTRACTION_DATA_INVALID'
  );

  // -------------------------------------------------------------
  // TEST 10: Non-existent Extraction ID -> EXTRACTION_NOT_FOUND
  // -------------------------------------------------------------
  console.log('\n[Scenario 10: Non-existent Extraction Record]');
  const nonExistentRes = await buyerQualificationService.qualifyExtraction({
    extractionId: '00000000-0000-0000-0000-000000000000',
  });

  assert(
    nonExistentRes.success === false,
    'Non-existent extraction returns success: false'
  );
  assert(
    nonExistentRes.action === 'EXTRACTION_NOT_FOUND',
    'Action is EXTRACTION_NOT_FOUND'
  );

  // -------------------------------------------------------------
  // TEST 11: Deterministic Idempotency
  // -------------------------------------------------------------
  console.log('\n[Scenario 11: Idempotency & Duplicate Handling]');
  const qualDuplicate = await buyerQualificationService.qualifyExtraction({
    extractionId: extraction1.id,
  });

  assert(
    qualDuplicate.action === 'EXISTING_QUALIFICATION',
    'Re-qualifying without force returns EXISTING_QUALIFICATION'
  );
  assert(
    qualDuplicate.qualificationId === qualRes1.qualificationId,
    'Returns existing qualification ID'
  );

  // -------------------------------------------------------------
  // TEST 12: Force Requalification
  // -------------------------------------------------------------
  console.log('\n[Scenario 12: Forced Requalification]');
  const qualForced = await buyerQualificationService.qualifyExtraction({
    extractionId: extraction1.id,
    forceRequalify: true,
  });

  assert(
    qualForced.action === 'PARTIALLY_QUALIFIED',
    'Forced qualification re-evaluates and returns PARTIALLY_QUALIFIED'
  );

  // -------------------------------------------------------------
  // TEST 13: Audit Events Logged to lead_events
  // -------------------------------------------------------------
  console.log('\n[Scenario 13: Lead Events Audit Logging]');
  const events1 = await supabaseDataService.leadEvents.getLeadEvents(lead1.id);
  const eventTypes1 = events1.map((e) => e.event_type);

  assert(
    eventTypes1.includes('QUALIFICATION_STARTED'),
    'lead_events contains QUALIFICATION_STARTED'
  );
  assert(
    eventTypes1.includes('QUALIFICATION_COMPLETED'),
    'lead_events contains QUALIFICATION_COMPLETED'
  );
  assert(
    eventTypes1.includes('QUALIFICATION_DUPLICATE'),
    'lead_events contains QUALIFICATION_DUPLICATE'
  );

  // -------------------------------------------------------------
  // TEST 14: Phase 5B Extraction Immutability
  // -------------------------------------------------------------
  console.log('\n[Scenario 14: Phase 5B Extraction Immutability]');
  const extractionAfter = await supabaseDataService.extractions.getExtraction(extraction1.id);
  assert(
    JSON.stringify(extractionAfter?.extracted_data) === JSON.stringify(extraction1.extracted_data),
    'Extraction data remains strictly unchanged after qualification'
  );

  // -------------------------------------------------------------
  // TEST 15: Phase 5A Transcript Immutability
  // -------------------------------------------------------------
  console.log('\n[Scenario 15: Phase 5A Transcript Immutability]');
  const transcriptAfter = await supabaseDataService.transcripts.getTranscript(transcriptRes1.transcriptId!);
  assert(
    transcriptAfter?.transcript_text === canonicalTranscript,
    'Transcript text remains strictly unchanged after qualification'
  );

  // -------------------------------------------------------------
  // TEST 16: Multi-Requirement Preservation
  // -------------------------------------------------------------
  console.log('\n[Scenario 16: Multi-Requirement Preservation]');
  const reqs = extraction1.extracted_data?.requirements || [];
  assert(reqs.length === 2, 'Preserves exactly 2 property requirements');
  assert(
    reqs[0].property_type === 'residential' && reqs[0].configuration === '3 BHK',
    'Requirement 1 is residential 3 BHK'
  );
  assert(
    reqs[1].property_type === 'farm_house' && reqs[1].land_area?.min === 800,
    'Requirement 2 is farmhouse 800-1000 sq yd'
  );

  // -------------------------------------------------------------
  // TEST 17: Retrieval by ID, Extraction ID, Lead ID
  // -------------------------------------------------------------
  console.log('\n[Scenario 17: Repository Retrieval Endpoints]');
  const byId = await supabaseDataService.qualifications.getQualification(qualRes1.qualificationId!);
  const byExtraction = await supabaseDataService.qualifications.getQualificationByExtractionId(extraction1.id);
  const byLead = await supabaseDataService.qualifications.getQualificationsByLeadId(lead1.id);

  assert(byId !== null && byId.id === qualRes1.qualificationId, 'getQualification returns matching record');
  assert(
    byExtraction !== null && byExtraction.extraction_id === extraction1.id && byExtraction.id === qualForced.qualificationId,
    'getQualificationByExtractionId returns latest qualification record'
  );
  assert(
    byLead.length >= 1 && byLead[0].lead_id === lead1.id,
    'getQualificationsByLeadId returns lead records'
  );

  // --- SUMMARY ---
  console.log('\n============================================================');
  console.log('TEST EXECUTION COMPLETE');
  console.log('============================================================');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);

  if (failed > 0) {
    console.error(`\n❌ ${failed} test(s) failed!`);
    process.exit(1);
  } else {
    console.log('\n✅ All Phase 5C qualification tests passed successfully!');
  }
}

runPhase5cTests().catch((err) => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});
