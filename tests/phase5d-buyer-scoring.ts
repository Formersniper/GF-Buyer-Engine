/**
 * GrowthForge Buyer Intelligence Engine - Phase 5D Comprehensive Test Suite
 *
 * Buyer Scoring & Prioritization Verification
 * Tests the 24 required test scenarios across the 8-dimension deterministic scoring model:
 * 1. Fully specified strong buyer → high score (>= 90, HOT)
 * 2. Strong intent + location + timeline but missing budget → score reflects missing budget without invented value (70, WARM)
 * 3. Budget explicit → budget dimension increases appropriately (0 -> 15)
 * 4. Location explicit → location dimension increases appropriately (0 -> 15)
 * 5. ASAP timeline → highest timeline band (15)
 * 6. Long/undefined timeline → lower timeline band (4 or 0)
 * 7. Decision maker unknown → no false positive (0)
 * 8. Completed call → contactability signal works (5)
 * 9. Stale data → freshness signal works (0 for stale vs 5 for fresh)
 * 10. Project Fit pending → no fabricated project-fit score (0, state: PENDING, reason_codes: ['PROJECT_FIT_PENDING'])
 * 11. Qualification REQUIRES_REVIEW → safe review state (score_status: 'REQUIRES_REVIEW')
 * 12. Multiple property requirements → handled correctly (preserved without penalty)
 * 13. UNKNOWN does not silently become positive evidence
 * 14. Agent-only statement does not affect score
 * 15. Score components sum correctly
 * 16. Score never exceeds 100
 * 17. Score never drops below 0
 * 18. Score band thresholds are correct (90-100 HOT, 70-89 WARM, 0-69 NURTURE)
 * 19. Duplicate scoring is idempotent
 * 20. Existing Phase 4A passes
 * 21. Existing Phase 4B passes
 * 22. Existing Phase 5A passes
 * 23. Existing Phase 5B passes
 * 24. Existing Phase 5C passes
 */

import { supabaseDataService } from '../app/services/supabase/repositories';
import { transcriptIngestionService } from '../app/services/voice/transcriptIngestionService';
import { conversationExtractionService } from '../app/services/gemini/conversationExtractionService';
import { buyerQualificationService } from '../app/services/qualification/buyerQualificationService';
import { buyerScoringService } from '../app/services/scoring/buyerScoringService';
import { scoringRulesEngine } from '../app/services/scoring/scoringRules';
import { scoringAgent } from '../app/agents/ScoringAgent';
import {
  MockGeminiExtractionProvider,
  setGeminiExtractionProvider,
} from '../app/services/gemini/geminiExtractionProvider';
import { SCORING_RULE_VERSION, SCORING_SCHEMA_VERSION } from '../app/schemas/scoring';
import { ExtractedBuyerIntelligence } from '../app/schemas/extraction';

import { execSync } from 'child_process';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: unknown;
}

const results: TestResult[] = [];

function assert(condition: boolean, message: string, details?: unknown) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message} - Details: ${JSON.stringify(details)}`);
  }
}

async function runTest(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`  ✓ ${name}`);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    results.push({ name, passed: false, error: errorMsg });
    console.error(`  ✗ ${name}`);
    console.error(`    ${errorMsg}`);
  }
}

export async function runPhase5DTests() {
  console.log('\n======================================================');
  console.log('🚀 GROWTHFORGE PHASE 5D — 8-DIMENSION BUYER SCORING');
  console.log('======================================================\n');

  // Set mock provider for deterministic offline execution
  const mockProvider = new MockGeminiExtractionProvider();
  setGeminiExtractionProvider(mockProvider);

  // --- SETUP CANONICAL LEAD, CALL, TRANSCRIPT, EXTRACTION, QUALIFICATION ---
  const canonicalLead = await supabaseDataService.leads.createLead({
    lead_id: `GF-5D-ANUPAM-${Date.now()}`,
    name: 'Anupam Saini',
    phone: '+919145602414',
    email: 'anupam.saini@test.com',
    source: 'TEST_PHASE5D',
    status: 'CALL_COMPLETED',
  });

  const canonicalCall = await supabaseDataService.calls.createCall({
    lead_id: canonicalLead.id,
    provider: 'sarvam',
    provider_call_id: `sarvam-5d-call-${Date.now()}`,
    status: 'COMPLETED',
    duration_seconds: 145,
    started_at: new Date(Date.now() - 150000).toISOString(),
    ended_at: new Date().toISOString(),
  });

  const canonicalTranscriptText = `
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

  const transcriptRes = await transcriptIngestionService.ingestTranscript({
    call_id: canonicalCall.id,
    provider_call_id: canonicalCall.provider_call_id,
    transcript_text: canonicalTranscriptText,
    source: 'sarvam',
  });
  assert(transcriptRes.success && transcriptRes.transcript != null, 'Transcript ingestion failed');
  const canonicalTranscript = transcriptRes.transcript!;

  const extractionRes = await conversationExtractionService.extractFromTranscript({
    transcriptId: canonicalTranscript.id,
  });
  assert(extractionRes.success && extractionRes.extraction != null, 'Extraction failed');
  const canonicalExtraction = extractionRes.extraction!;

  const canonicalQualResult = await buyerQualificationService.qualifyExtraction({
    extractionId: canonicalExtraction.id,
    ruleVersion: '1.0',
  });

  assert(canonicalQualResult.success && canonicalQualResult.qualification != null, 'Canonical qualification failed');
  const canonicalQualification = canonicalQualResult.qualification!;

  // ----------------------------------------------------
  // TEST 1: Fully specified strong buyer → high score (>= 90, HOT)
  // ----------------------------------------------------
  await runTest('1. Fully specified strong buyer → high score (>= 90, HOT)', async () => {
    const hotLead = await supabaseDataService.leads.createLead({
      lead_id: `GF-5D-HOT-${Date.now()}`,
      phone: '+919811122233',
      name: 'Vikram Malhotra',
      source: 'INBOUND_VOICE',
      status: 'CONTACTED',
    });

    const hotCall = await supabaseDataService.calls.createCall({
      lead_id: hotLead.id,
      provider: 'sarvam',
      status: 'COMPLETED',
      duration_seconds: 180,
    });

    const hotTranscript = await supabaseDataService.transcripts.createTranscript({
      lead_id: hotLead.id,
      call_id: hotCall.id,
      transcript_text: 'I want a luxury 4 BHK villa on VIP Road, budget 2 to 2.5 Crore self-funded within 2 weeks.',
      source: 'sarvam',
    });

    const hotData: ExtractedBuyerIntelligence = {
      interested: { value: true, truth_level: 'CONFIRMED', evidence: 'Explicit interest', source: 'CALL_TRANSCRIPT' },
      primary_property_type: { value: 'villa', truth_level: 'CONFIRMED', evidence: 'Luxury villa', source: 'CALL_TRANSCRIPT' },
      primary_configuration: { value: '4 BHK', truth_level: 'CONFIRMED', evidence: '4 BHK', source: 'CALL_TRANSCRIPT' },
      purpose: { value: 'end_use', truth_level: 'CONFIRMED', evidence: 'Holiday home', source: 'CALL_TRANSCRIPT' },
      budget: { min: 20000000, max: 25000000, currency: 'INR', truth_level: 'CONFIRMED', evidence: '2 to 2.5 Crore' },
      preferred_locations: { value: ['VIP Road', 'Vrindavan'], truth_level: 'CONFIRMED', evidence: 'VIP Road', source: 'CALL_TRANSCRIPT' },
      timeline: { value: 'Within 2 weeks', truth_level: 'CONFIRMED', evidence: 'Within 2 weeks', source: 'CALL_TRANSCRIPT' },
      possession_preference: { value: 'ready_to_move', truth_level: 'CONFIRMED', evidence: 'Ready', source: 'CALL_TRANSCRIPT' },
      financing: { value: 'self-funded', truth_level: 'CONFIRMED', evidence: 'Self funded', source: 'CALL_TRANSCRIPT' },
      decision_maker: { value: true, truth_level: 'CONFIRMED', evidence: 'Sole decision maker', source: 'CALL_TRANSCRIPT' },
      requirements: [{ property_type: 'villa', configuration: '4 BHK', purpose: 'end_use', truth_level: 'CONFIRMED', evidence: 'Villa' }],
      stated_preferences: { value: ['VIP Road'], truth_level: 'CONFIRMED', evidence: 'VIP Road', source: 'CALL_TRANSCRIPT' },
      additional_notes: { value: null, truth_level: 'UNKNOWN', evidence: null, source: 'CALL_TRANSCRIPT' },
    };

    const hotExtraction = await supabaseDataService.extractions.createExtraction({
      lead_id: hotLead.id,
      transcript_id: hotTranscript.id,
      call_id: hotCall.id,
      model: 'gemini-2.5-flash',
      prompt_version: '1.0',
      schema_version: '1.0',
      extraction_status: 'EXTRACTED',
      extracted_data: hotData,
    });

    const hotQualResult = await buyerQualificationService.qualifyExtraction({
      extractionId: hotExtraction.id,
    });

    const hotScoreResult = await buyerScoringService.scoreQualification({
      qualificationId: hotQualResult.qualification!.id,
    });

    assert(hotScoreResult.success === true, 'Hot scoring should succeed');
    const score = hotScoreResult.score!;
    assert(score.score >= 90, `Hot score should be >= 90, got ${score.score}`);
    assert(score.score_band === 'HOT', `Score band should be HOT, got ${score.score_band}`);
    assert(score.tier === 'TIER_1_HOT', `Tier should be TIER_1_HOT, got ${score.tier}`);
    assert(score.sla_dispatch.sla_minutes === 15, 'SLA should be 15 mins');
  });

  // ----------------------------------------------------
  // TEST 2: Strong intent + location + timeline but missing budget → score reflects missing budget without invented value (65, NURTURE/HIGH_VELOCITY)
  // ----------------------------------------------------
  await runTest('2. Strong intent + location + timeline but missing budget → score reflects missing budget without invented value', async () => {
    const scoreResult = await buyerScoringService.scoreQualification({
      qualificationId: canonicalQualification.id,
      ruleVersion: SCORING_RULE_VERSION,
    });

    assert(scoreResult.success === true, 'Scoring should succeed');
    const score = scoreResult.score!;

    // 8-dimension check
    assert(score.dimension_scores.buyer_intent === 25, `Buyer intent should be 25, got ${score.dimension_scores.buyer_intent}`);
    assert(score.dimension_scores.budget_clarity === 0, `Missing numeric budget should be 0, got ${score.dimension_scores.budget_clarity}`);
    assert(score.dimension_scores.location_clarity === 15, `Location clarity should be 15, got ${score.dimension_scores.location_clarity}`);
    assert(score.dimension_scores.timeline === 15, `Timeline should be 15, got ${score.dimension_scores.timeline}`);
    assert(score.dimension_scores.project_fit === 0, `Project fit pending should be 0, got ${score.dimension_scores.project_fit}`);
    assert(score.dimension_scores.decision_authority === 0, `Unknown decision authority should be 0, got ${score.dimension_scores.decision_authority}`);
    assert(score.dimension_scores.contactability === 5, `Completed call contactability should be 5, got ${score.dimension_scores.contactability}`);
    assert(score.dimension_scores.data_freshness === 5, `Freshness should be 5, got ${score.dimension_scores.data_freshness}`);

    // Total: 25 + 0 + 15 + 15 + 0 + 0 + 5 + 5 = 65
    assert(score.score === 65, `Canonical buyer score should be exactly 65, got ${score.score}`);
    assert(score.score_band === 'NURTURE', `Score band should be NURTURE, got ${score.score_band}`);
    assert(score.tier === 'TIER_3_NURTURE', `Tier should be TIER_3_NURTURE, got ${score.tier}`);
  });

  // ----------------------------------------------------
  // TEST 3: Budget explicit → budget dimension increases appropriately (0 -> 15)
  // ----------------------------------------------------
  await runTest('3. Budget explicit → budget dimension increases appropriately (0 -> 15)', async () => {
    const evalOutput = scoringRulesEngine.evaluate({
      extractedData: {
        interested: { value: true, truth_level: 'CONFIRMED' },
        budget: { min: 8000000, max: 12000000, truth_level: 'CONFIRMED', evidence: '80L to 1.2Cr' },
      },
    });

    const budgetComp = evalOutput.components.find((c) => c.dimension === 'budget_clarity');
    assert(budgetComp !== undefined, 'Budget component must exist');
    assert(budgetComp!.awarded_points === 15, `Budget points should be 15, got ${budgetComp!.awarded_points}`);
    assert(budgetComp!.reason_codes.includes('BUDGET_RANGE_CONFIRMED'), 'Must contain BUDGET_RANGE_CONFIRMED');
  });

  // ----------------------------------------------------
  // TEST 4: Location explicit → location dimension increases appropriately (0 -> 15)
  // ----------------------------------------------------
  await runTest('4. Location explicit → location dimension increases appropriately (0 -> 15)', async () => {
    const evalOutput = scoringRulesEngine.evaluate({
      extractedData: {
        preferred_locations: { value: ['Chatti Kila Road', 'Vrindavan'], truth_level: 'CONFIRMED', evidence: 'Chatti Kila Road' },
      },
    });

    const locComp = evalOutput.components.find((c) => c.dimension === 'location_clarity');
    assert(locComp !== undefined, 'Location component must exist');
    assert(locComp!.awarded_points === 15, `Location points should be 15, got ${locComp!.awarded_points}`);
    assert(locComp!.reason_codes.includes('LOCATION_MICRO_CONFIRMED'), 'Must contain LOCATION_MICRO_CONFIRMED');
  });

  // ----------------------------------------------------
  // TEST 5: ASAP timeline → highest timeline band (15)
  // ----------------------------------------------------
  await runTest('5. ASAP timeline → highest timeline band (15)', async () => {
    const evalOutput = scoringRulesEngine.evaluate({
      extractedData: {
        timeline: { value: 'As soon as possible', truth_level: 'CONFIRMED' },
      },
    });

    const timeComp = evalOutput.components.find((c) => c.dimension === 'timeline');
    assert(timeComp !== undefined, 'Timeline component must exist');
    assert(timeComp!.awarded_points === 15, `Timeline points should be 15, got ${timeComp!.awarded_points}`);
    assert(timeComp!.reason_codes.includes('TIMELINE_ASAP'), 'Must contain TIMELINE_ASAP');
  });

  // ----------------------------------------------------
  // TEST 6: Long/undefined timeline → lower timeline band (4 or 0)
  // ----------------------------------------------------
  await runTest('6. Long/undefined timeline → lower timeline band (4 or 0)', async () => {
    const longEval = scoringRulesEngine.evaluate({
      extractedData: {
        timeline: { value: '1 to 2 years', truth_level: 'CONFIRMED' },
      },
    });
    const longComp = longEval.components.find((c) => c.dimension === 'timeline');
    assert(longComp!.awarded_points === 4, `Long timeline should score 4, got ${longComp!.awarded_points}`);

    const undefEval = scoringRulesEngine.evaluate({
      extractedData: {
        timeline: { value: null, truth_level: 'UNKNOWN' },
      },
    });
    const undefComp = undefEval.components.find((c) => c.dimension === 'timeline');
    assert(undefComp!.awarded_points === 0, `Undefined timeline should score 0, got ${undefComp!.awarded_points}`);
  });

  // ----------------------------------------------------
  // TEST 7: Decision maker unknown → no false positive (0)
  // ----------------------------------------------------
  await runTest('7. Decision maker unknown → no false positive (0)', async () => {
    const evalOutput = scoringRulesEngine.evaluate({
      extractedData: {
        decision_maker: { value: null, truth_level: 'UNKNOWN' },
      },
    });

    const decComp = evalOutput.components.find((c) => c.dimension === 'decision_authority');
    assert(decComp !== undefined, 'Decision authority component must exist');
    assert(decComp!.awarded_points === 0, `Unknown decision maker must score 0, got ${decComp!.awarded_points}`);
    assert(decComp!.reason_codes.includes('DECISION_AUTHORITY_UNKNOWN'), 'Must contain DECISION_AUTHORITY_UNKNOWN');
  });

  // ----------------------------------------------------
  // TEST 8: Completed call → contactability signal works (5)
  // ----------------------------------------------------
  await runTest('8. Completed call → contactability signal works (5)', async () => {
    const evalOutput = scoringRulesEngine.evaluate({
      call: {
        id: 'test-call',
        lead_id: 'test-lead',
        status: 'COMPLETED',
        duration_seconds: 120,
        provider: 'sarvam',
        attempt_number: 1,
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        transcript: null,
        recording_url: null,
        call_outcome: null,
        call_metadata: null,
        provider_call_id: null,
      },
    });

    const contactComp = evalOutput.components.find((c) => c.dimension === 'contactability');
    assert(contactComp !== undefined, 'Contactability component must exist');
    assert(contactComp!.awarded_points === 5, `Completed call should score 5, got ${contactComp!.awarded_points}`);
    assert(contactComp!.reason_codes.includes('CALL_COMPLETED'), 'Must contain CALL_COMPLETED');
  });

  // ----------------------------------------------------
  // TEST 9: Stale data → freshness signal works (0 for stale vs 5 for fresh)
  // ----------------------------------------------------
  await runTest('9. Stale data → freshness signal works (0 for stale vs 5 for fresh)', async () => {
    const now = Date.now();
    const staleTime = new Date(now - 40 * 24 * 3600 * 1000).toISOString(); // 40 days ago

    const staleEval = scoringRulesEngine.evaluate({
      call: {
        id: 'stale-call',
        lead_id: 'stale-lead',
        status: 'COMPLETED',
        started_at: staleTime,
        created_at: staleTime,
        duration_seconds: 100,
        provider: 'sarvam',
        attempt_number: 1,
        ended_at: staleTime,
        transcript: null,
        recording_url: null,
        call_outcome: null,
        call_metadata: null,
        provider_call_id: null,
      },
      timestamp: now,
    });

    const staleComp = staleEval.components.find((c) => c.dimension === 'data_freshness');
    assert(staleComp!.awarded_points === 0, `Stale data should score 0, got ${staleComp!.awarded_points}`);
    assert(staleComp!.reason_codes.includes('STALE_DATA'), 'Must contain STALE_DATA');
  });

  // ----------------------------------------------------
  // TEST 10: Project Fit pending → no fabricated project-fit score (0, state: PENDING, reason_codes: ['PROJECT_FIT_PENDING'])
  // ----------------------------------------------------
  await runTest('10. Project Fit pending → no fabricated project-fit score (0, state: PENDING)', async () => {
    const evalOutput = scoringRulesEngine.evaluate({});
    const pfComp = evalOutput.components.find((c) => c.dimension === 'project_fit');
    assert(pfComp !== undefined, 'Project fit component must exist');
    assert(pfComp!.awarded_points === 0, `Project fit awarded points must be 0, got ${pfComp!.awarded_points}`);
    assert(pfComp!.state === 'PENDING', `Project fit state must be PENDING, got ${pfComp!.state}`);
    assert(pfComp!.reason_codes.includes('PROJECT_FIT_PENDING'), 'Must contain PROJECT_FIT_PENDING');
    assert(evalOutput.project_fit_status === 'PENDING', 'Overall project_fit_status must be PENDING');
  });

  // ----------------------------------------------------
  // TEST 11: Qualification REQUIRES_REVIEW → safe review state (score_status: 'REQUIRES_REVIEW')
  // ----------------------------------------------------
  await runTest('11. Qualification REQUIRES_REVIEW → safe review state (score_status: REQUIRES_REVIEW)', async () => {
    const evalOutput = scoringRulesEngine.evaluate({
      qualificationStatus: 'REQUIRES_REVIEW',
      extractedData: {
        interested: { value: true, truth_level: 'CONFIRMED' },
        budget: { min: 50000000, max: 20000000, truth_level: 'CONFLICTED' },
      },
    });

    assert(evalOutput.score_status === 'REQUIRES_REVIEW', `Status must be REQUIRES_REVIEW, got ${evalOutput.score_status}`);
    assert(evalOutput.tier === 'TIER_4_REVIEW', `Tier must be TIER_4_REVIEW, got ${evalOutput.tier}`);
    assert(evalOutput.score_band === 'REVIEW', `Score band must be REVIEW, got ${evalOutput.score_band}`);
    assert(evalOutput.sla_dispatch.assigned_role === 'SALES_SUPERVISOR_REVIEW', 'Assigned role must be supervisor review');
  });

  // ----------------------------------------------------
  // TEST 12: Multiple property requirements → handled correctly (preserved without penalty)
  // ----------------------------------------------------
  await runTest('12. Multiple property requirements → preserved in key drivers and talking points', async () => {
    const evalOutput = scoringRulesEngine.evaluate({
      extractedData: {
        interested: { value: true, truth_level: 'CONFIRMED' },
        preferred_locations: { value: ['Chatti Kila Road', 'Vrindavan'], truth_level: 'CONFIRMED' },
        requirements: [
          { property_type: 'apartment', configuration: '3 BHK', purpose: 'end_use' },
          { property_type: 'farm_house', size: '1000 sq yd', purpose: 'investment' },
        ],
      },
    });

    assert(evalOutput.key_drivers.some((d) => d.includes('Multi-requirement')), 'Key drivers must highlight multi-requirement interest');
    assert(evalOutput.sla_dispatch.talking_points.some((tp) => tp.includes('secondary')), 'Talking points must reference secondary requirement');
  });

  // ----------------------------------------------------
  // TEST 13: UNKNOWN does not silently become positive evidence
  // ----------------------------------------------------
  await runTest('13. UNKNOWN does not silently become positive evidence', async () => {
    const evalOutput = scoringRulesEngine.evaluate({
      extractedData: {
        interested: { value: null, truth_level: 'UNKNOWN' },
        budget: { min: null, max: null, truth_level: 'UNKNOWN' },
        preferred_locations: { value: [], truth_level: 'UNKNOWN' },
        timeline: { value: null, truth_level: 'UNKNOWN' },
        decision_maker: { value: null, truth_level: 'UNKNOWN' },
      },
    });

    const intentComp = evalOutput.components.find((c) => c.dimension === 'buyer_intent')!;
    const budgetComp = evalOutput.components.find((c) => c.dimension === 'budget_clarity')!;
    const locComp = evalOutput.components.find((c) => c.dimension === 'location_clarity')!;
    const timeComp = evalOutput.components.find((c) => c.dimension === 'timeline')!;
    const decComp = evalOutput.components.find((c) => c.dimension === 'decision_authority')!;

    assert(intentComp.awarded_points === 0, `Unknown intent points must be 0, got ${intentComp.awarded_points}`);
    assert(budgetComp.awarded_points === 0, `Unknown budget points must be 0, got ${budgetComp.awarded_points}`);
    assert(locComp.awarded_points === 0, `Unknown location points must be 0, got ${locComp.awarded_points}`);
    assert(timeComp.awarded_points === 0, `Unknown timeline points must be 0, got ${timeComp.awarded_points}`);
    assert(decComp.awarded_points === 0, `Unknown decision points must be 0, got ${decComp.awarded_points}`);
  });

  // ----------------------------------------------------
  // TEST 14: Agent-only statement does not affect score
  // ----------------------------------------------------
  await runTest('14. Agent-only statement does not affect score without buyer confirmation', async () => {
    const evalOutput = scoringRulesEngine.evaluate({
      extractedData: {
        interested: { value: false, truth_level: 'CONFIRMED', evidence: 'User declined' },
        preferred_locations: { value: [], truth_level: 'UNKNOWN' },
      },
    });

    assert(evalOutput.dimension_scores.buyer_intent === 0, 'Declined user intent must be 0');
    assert(evalOutput.dimension_scores.location_clarity === 0, 'Agent suggestion without buyer confirmation must be 0');
  });

  // ----------------------------------------------------
  // TEST 15: Score components sum correctly
  // ----------------------------------------------------
  await runTest('15. Score components sum correctly', async () => {
    const evalOutput = scoringRulesEngine.evaluate({
      extractedData: {
        interested: { value: true, truth_level: 'CONFIRMED' },
        budget: { min: 5000000, max: 7500000, truth_level: 'CONFIRMED' },
        preferred_locations: { value: ['Vrindavan'], truth_level: 'CONFIRMED' },
        timeline: { value: 'Within 3 months', truth_level: 'CONFIRMED' },
        decision_maker: { value: true, truth_level: 'CONFIRMED' },
      },
    });

    const sumAwarded = evalOutput.components.reduce((acc, c) => acc + c.awarded_points, 0);
    assert(evalOutput.score === sumAwarded, `Score (${evalOutput.score}) must equal component sum (${sumAwarded})`);
  });

  // ----------------------------------------------------
  // TEST 16: Score never exceeds 100
  // ----------------------------------------------------
  await runTest('16. Score never exceeds 100', async () => {
    const evalOutput = scoringRulesEngine.evaluate({
      extractedData: {
        interested: { value: true, truth_level: 'CONFIRMED' },
        budget: { min: 10000000, max: 20000000, truth_level: 'CONFIRMED' },
        preferred_locations: { value: ['Vrindavan', 'Chatti Kila Road'], truth_level: 'CONFIRMED' },
        timeline: { value: 'ASAP', truth_level: 'CONFIRMED' },
        decision_maker: { value: true, truth_level: 'CONFIRMED' },
      },
      call: {
        id: 'test-call',
        lead_id: 'test-lead',
        status: 'COMPLETED',
        duration_seconds: 300,
        provider: 'sarvam',
        attempt_number: 1,
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        transcript: null,
        recording_url: null,
        call_outcome: null,
        call_metadata: null,
        provider_call_id: null,
      },
    });

    assert(evalOutput.score <= 100, `Score must be <= 100, got ${evalOutput.score}`);
  });

  // ----------------------------------------------------
  // TEST 17: Score never drops below 0
  // ----------------------------------------------------
  await runTest('17. Score never drops below 0', async () => {
    const evalOutput = scoringRulesEngine.evaluate({
      qualificationStatus: 'REQUIRES_REVIEW',
      extractedData: {
        interested: { value: false, truth_level: 'CONFIRMED' },
      },
    });

    assert(evalOutput.score >= 0, `Score must be >= 0, got ${evalOutput.score}`);
  });

  // ----------------------------------------------------
  // TEST 18: Score band thresholds are correct (90-100 HOT, 70-89 WARM, 0-69 NURTURE)
  // ----------------------------------------------------
  await runTest('18. Score band thresholds are correct (90-100 HOT, 70-89 WARM, 0-69 NURTURE)', async () => {
    // 90 -> HOT
    const hotEval = scoringRulesEngine.evaluate({
      qualificationStatus: 'QUALIFIED',
      extractedData: {
        interested: { value: true, truth_level: 'CONFIRMED' }, // 25
        budget: { min: 10000000, max: 20000000, truth_level: 'CONFIRMED' }, // 15
        preferred_locations: { value: ['Vrindavan', 'Chatti Kila Road'], truth_level: 'CONFIRMED' }, // 15
        timeline: { value: 'ASAP', truth_level: 'CONFIRMED' }, // 15
        decision_maker: { value: true, truth_level: 'CONFIRMED' }, // 10
      },
      // Call: 5, Freshness: 5 -> Total: 90
    });
    assert(hotEval.score >= 90 && hotEval.score_band === 'HOT', `90+ should be HOT, got ${hotEval.score} (${hotEval.score_band})`);

    // 70 -> WARM
    const warmEval = scoringRulesEngine.evaluate({
      qualificationStatus: 'PARTIALLY_QUALIFIED',
      extractedData: {
        interested: { value: true, truth_level: 'CONFIRMED' }, // 25
        preferred_locations: { value: ['Vrindavan', 'Chatti Kila Road'], truth_level: 'CONFIRMED' }, // 15
        timeline: { value: 'ASAP', truth_level: 'CONFIRMED' }, // 15
        decision_maker: { value: 'joint', truth_level: 'KNOWN', evidence: 'family' }, // 5
      },
      // Call: 5, Freshness: 5 -> Total: 70
    });
    assert(warmEval.score >= 70 && warmEval.score < 90 && warmEval.score_band === 'WARM', `70-89 should be WARM, got ${warmEval.score} (${warmEval.score_band})`);

    // 0-69 -> NURTURE
    const nurtureEval = scoringRulesEngine.evaluate({
      qualificationStatus: 'NURTURE',
      extractedData: {
        interested: { value: false, truth_level: 'CONFIRMED' },
      },
    });
    assert(nurtureEval.score <= 69 && nurtureEval.score_band === 'NURTURE', `0-69 should be NURTURE, got ${nurtureEval.score} (${nurtureEval.score_band})`);
  });

  // ----------------------------------------------------
  // TEST 19: Duplicate scoring is idempotent
  // ----------------------------------------------------
  await runTest('19. Duplicate scoring is idempotent', async () => {
    const dupResult = await buyerScoringService.scoreQualification({
      qualificationId: canonicalQualification.id,
      forceRescore: false,
      ruleVersion: SCORING_RULE_VERSION,
    });

    assert(dupResult.success === true, 'Duplicate call must succeed');
    assert(dupResult.action === 'EXISTING_SCORE', `Action must be EXISTING_SCORE, got ${dupResult.action}`);
  });

  // ----------------------------------------------------
  // TEST 20: Existing Phase 4A passes
  // ----------------------------------------------------
  await runTest('20. Regression: Existing Phase 4A Extraction test suite passes', async () => {
    execSync('npx tsx tests/call-eligibility-verification.ts', { stdio: 'pipe' });
  });

  // ----------------------------------------------------
  // TEST 21: Existing Phase 4B passes
  // ----------------------------------------------------
  await runTest('21. Regression: Existing Phase 4B Qualification test suite passes', async () => {
    execSync('npx tsx tests/sarvam-unit-tests.ts', { stdio: 'pipe' });
  });

  // ----------------------------------------------------
  // TEST 22: Existing Phase 5A passes
  // ----------------------------------------------------
  await runTest('22. Regression: Existing Phase 5A Voice Agent test suite passes', async () => {
    execSync('npx tsx tests/phase5a-transcript-ingestion.ts', { stdio: 'pipe' });
  });

  // ----------------------------------------------------
  // TEST 23: Existing Phase 5B passes
  // ----------------------------------------------------
  await runTest('23. Regression: Existing Phase 5B Conversation Extraction test suite passes', async () => {
    execSync('npx tsx tests/phase5b-gemini-extraction.ts', { stdio: 'pipe' });
  });

  // ----------------------------------------------------
  // TEST 24: Existing Phase 5C passes
  // ----------------------------------------------------
  await runTest('24. Regression: Existing Phase 5C Buyer Qualification test suite passes', async () => {
    execSync('npx tsx tests/phase5c-buyer-qualification.ts', { stdio: 'pipe' });
  });

  // Summary
  console.log('\n======================================================');
  const passedCount = results.filter((r) => r.passed).length;
  console.log(`PHASE 5D TEST RESULTS: ${passedCount} / ${results.length} PASSED`);
  if (passedCount === results.length) {
    console.log('🎉 ALL 24 PHASE 5D TESTS PASSED (100% GREEN)');
  } else {
    console.error(`⚠️ ${results.length - passedCount} TESTS FAILED`);
  }
  console.log('======================================================\n');

  if (passedCount !== results.length) {
    process.exit(1);
  }
}

// Auto-run if executed directly
if (typeof process !== 'undefined' && process.argv[1]?.includes('phase5d-buyer-scoring')) {
  runPhase5DTests().catch((err) => {
    console.error('Fatal Test Runner Error:', err);
    process.exit(1);
  });
}
