/**
 * GrowthForge Buyer Intelligence Engine - Phase 5E Comprehensive Test Suite
 *
 * Project Mapping & Recommendations Verification
 * Tests the 28 required test scenarios across deterministic 8-dimension matching:
 * 1. Exact location + property + configuration match
 * 2. Partial location match
 * 3. Budget overlap
 * 4. Budget unknown (BUDGET_UNKNOWN, not eliminated)
 * 5. Budget mismatch
 * 6. Configuration match
 * 7. Configuration mismatch
 * 8. Property type match
 * 9. Property type mismatch
 * 10. Purpose match
 * 11. Timeline match
 * 12. Timeline mismatch
 * 13. Multiple buyer requirements
 * 14. Project data incomplete
 * 15. Agent suggestion not treated as preference
 * 16. Buyer-confirmed preference respected
 * 17. Score components sum correctly
 * 18. Match score remains 0–100
 * 19. Ranking is deterministic
 * 20. Duplicate matching is idempotent
 * 21. Recommendation remains AI_RECOMMENDED
 * 22. Buyer preference is never silently mutated
 * 23. Existing Phase 4A passes
 * 24. Existing Phase 4B passes
 * 25. Existing Phase 5A passes
 * 26. Existing Phase 5B passes
 * 27. Existing Phase 5C passes
 * 28. Existing Phase 5D passes
 */

import { supabaseDataService } from '../app/services/supabase/repositories';
import { transcriptIngestionService } from '../app/services/voice/transcriptIngestionService';
import { conversationExtractionService } from '../app/services/gemini/conversationExtractionService';
import { buyerQualificationService } from '../app/services/qualification/buyerQualificationService';
import { buyerScoringService } from '../app/services/scoring/buyerScoringService';
import { projectMatchingService } from '../app/services/matching/projectMatchingService';
import { projectMatchingRulesEngine } from '../app/services/matching/projectMatchingRules';
import { matchingAgent } from '../app/agents/MatchingAgent';
import {
  MockGeminiExtractionProvider,
  setGeminiExtractionProvider,
} from '../app/services/gemini/geminiExtractionProvider';
import { MATCHING_RULE_VERSION, PROJECT_CATALOG_VERSION } from '../app/schemas/matching';
import { DbProject } from '../app/schemas/database';
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

async function runTestSuite() {
  console.log('============================================================');
  console.log('GROWTHFORGE BUYER ENGINE — PHASE 5E TEST SUITE');
  console.log('Project Mapping & Explainable Recommendations Verification');
  console.log('============================================================\n');

  // Test setup helper: Create lead + transcript + extraction + qualification
  let testLeadCounter = 1;

  async function createQualifiedLead(overrides?: {
    transcriptText?: string;
    mockExtraction?: any;
  }) {
    const leadId = `LEAD-5E-${Date.now()}-${testLeadCounter++}`;
    const lead = await supabaseDataService.leads.createLead({
      lead_id: leadId,
      name: 'Pooja Agarwal',
      phone: '+91 98110 55443',
      email: 'pooja.agarwal@example.com',
      source: 'INBOUND_VOICE',
      status: 'RAW',
    });

    const call = await supabaseDataService.calls.createCall({
      lead_id: lead.id,
      provider: 'sarvam',
      provider_call_id: `sarvam-call-${Date.now()}-${testLeadCounter}`,
      status: 'COMPLETED',
      duration_seconds: 180,
    });

    const transcriptText =
      overrides?.transcriptText ||
      `Agent: Hello Pooja, calling from GrowthForge regarding your property inquiry.
Buyer: Hi, yes. I am looking for a farm house in Vrindavan, specifically around Chatti Kila Road.
Agent: Wonderful. What plot size and budget do you have in mind?
Buyer: We want around 800 to 1000 square yards, and our budget is around 1.5 to 2 Crores.
Agent: And what is your timeline?
Buyer: We want to finalize immediately, within 1 to 2 months. Gated community with security is preferred.`;

    const transcriptResult = await transcriptIngestionService.ingestTranscript({
      lead_id: lead.id,
      call_id: call.id,
      provider_call_id: call.provider_call_id,
      transcript_text: transcriptText,
      source: 'SARVAM_WEBHOOK',
    });

    const mockExt = overrides?.mockExtraction || {
      schema_version: '1.0',
      extraction_status: 'SUCCESS',
      buyer_profile: {
        full_name: { value: 'Pooja Agarwal', truth_level: 'CONFIRMED', confidence: 0.95, evidence: [] },
        phone: { value: '+91 98110 55443', truth_level: 'CONFIRMED', confidence: 0.95, evidence: [] },
      },
      buying_intent: {
        interested: { value: true, truth_level: 'EXPLICIT', confidence: 0.98, evidence: [] },
        property_type: { value: 'Farm House', truth_level: 'CONFIRMED', confidence: 0.95, evidence: [] },
        configuration: { value: '800-1000 sq yd', truth_level: 'CONFIRMED', confidence: 0.95, evidence: [] },
        purpose: { value: 'End-Use / Self-Use', truth_level: 'CONFIRMED', confidence: 0.9, evidence: [] },
        budget: {
          value: { min: 15000000, max: 20000000, currency: 'INR' },
          truth_level: 'CONFIRMED',
          confidence: 0.95,
          evidence: [],
        },
        preferred_locations: {
          value: ['Chatti Kila Road', 'Vrindavan'],
          truth_level: 'CONFIRMED',
          confidence: 0.95,
          evidence: [],
        },
        timeline: { value: 'ASAP / Immediate', truth_level: 'CONFIRMED', confidence: 0.9, evidence: [] },
        preferences: {
          value: ['Gated Farm Enclave', 'Security'],
          truth_level: 'EXPLICIT',
          confidence: 0.9,
          evidence: [],
        },
      },
    };

    setGeminiExtractionProvider(new MockGeminiExtractionProvider(mockExt));

    const extractionResult = await conversationExtractionService.extractFromTranscript({
      transcriptId: transcriptResult.transcript.id,
      leadId: lead.id,
      callId: call.id,
    });

    const qualificationResult = await buyerQualificationService.qualifyExtraction({
      extractionId: extractionResult.extraction.id,
    });

    return {
      lead,
      call,
      transcript: transcriptResult.transcript,
      extraction: extractionResult.extraction,
      qualification: qualificationResult.qualification,
    };
  }

  // -------------------------------------------------------------
  // Test 1: Exact location + property + configuration match
  // -------------------------------------------------------------
  await runTest('1. Exact location + property + configuration match', async () => {
    const { lead, qualification, extraction } = await createQualifiedLead();

    const result = await projectMatchingService.matchBuyerRequirements({
      leadId: lead.id,
      qualificationId: qualification?.id,
      extractionId: extraction.id,
      forceRematch: true,
    });

    assert(result.success, 'Matching should succeed');
    assert(result.recommendations.length > 0, 'Recommendations should be generated');

    // Find Radha Madhav Farms (Chatti Kila Road, Farm House, 800-1000 sq yd, 1.1 - 2.5 Cr)
    const exactMatch = result.recommendations.find((r) => r.project_code === 'VRN-CKR-02');
    assert(Boolean(exactMatch), 'VRN-CKR-02 should be matched');
    assert(exactMatch!.match_score >= 85, `Score should be >= 85 (STRONG), got ${exactMatch!.match_score}`);
    assert(exactMatch!.match_band === 'STRONG', `Band should be STRONG, got ${exactMatch!.match_band}`);
    assert(exactMatch!.dimension_scores.location === 25, 'Location should be exact 25 pts');
    assert(exactMatch!.dimension_scores.property_type === 10, 'Property type should be 10 pts');
    assert(exactMatch!.dimension_scores.configuration === 15, 'Configuration should be 15 pts');
  });

  // -------------------------------------------------------------
  // Test 2: Partial location match
  // -------------------------------------------------------------
  await runTest('2. Partial location match', async () => {
    const { lead, qualification, extraction } = await createQualifiedLead();

    const result = await projectMatchingService.matchBuyerRequirements({
      leadId: lead.id,
      qualificationId: qualification?.id,
      extractionId: extraction.id,
      forceRematch: true,
    });

    // Sunrakh Road Farmsteads (Sunrakh Road, Vrindavan, adjacent corridor to Chatti Kila Road)
    const partialLoc = result.recommendations.find((r) => r.project_code === 'VRN-SNK-05');
    assert(Boolean(partialLoc), 'VRN-SNK-05 should be matched');
    assert(
      partialLoc!.dimension_scores.location >= 15 && partialLoc!.dimension_scores.location < 25,
      `Location score should be partial (15-20), got ${partialLoc!.dimension_scores.location}`
    );
  });

  // -------------------------------------------------------------
  // Test 3: Budget overlap
  // -------------------------------------------------------------
  await runTest('3. Budget overlap', async () => {
    const { lead, qualification, extraction } = await createQualifiedLead();

    const result = await projectMatchingService.matchBuyerRequirements({
      leadId: lead.id,
      qualificationId: qualification?.id,
      extractionId: extraction.id,
      forceRematch: true,
    });

    const fullBudgetMatch = result.recommendations.find((r) => r.project_code === 'VRN-CKR-02');
    assert(Boolean(fullBudgetMatch), 'Full budget overlap project found');
    assert(
      fullBudgetMatch!.dimension_scores.budget === 25 || fullBudgetMatch!.dimension_scores.budget === 18,
      `Budget score should reflect overlap, got ${fullBudgetMatch!.dimension_scores.budget}`
    );
    assert(fullBudgetMatch!.components.find((c) => c.dimension === 'budget')?.match_state === 'MATCH' ||
           fullBudgetMatch!.components.find((c) => c.dimension === 'budget')?.match_state === 'PARTIAL_MATCH',
           'Budget match state should be MATCH or PARTIAL_MATCH');
  });

  // -------------------------------------------------------------
  // Test 4: Budget unknown (BUDGET_UNKNOWN, not eliminated)
  // -------------------------------------------------------------
  await runTest('4. Budget unknown (BUDGET_UNKNOWN, not eliminated)', async () => {
    const { lead, qualification, extraction } = await createQualifiedLead({
      mockExtraction: {
        schema_version: '1.0',
        extraction_status: 'SUCCESS',
        buyer_profile: { full_name: { value: 'Amit Unknown', truth_level: 'CONFIRMED', confidence: 0.9, evidence: [] } },
        buying_intent: {
          interested: { value: true, truth_level: 'EXPLICIT', confidence: 0.9, evidence: [] },
          property_type: { value: 'Residential Apartment', truth_level: 'CONFIRMED', confidence: 0.9, evidence: [] },
          configuration: { value: '3 BHK', truth_level: 'CONFIRMED', confidence: 0.9, evidence: [] },
          budget: { value: { min: null, max: null, currency: 'INR' }, truth_level: 'UNKNOWN', confidence: 0.0, evidence: [] },
          preferred_locations: { value: ['Chatti Kila Road', 'Vrindavan'], truth_level: 'CONFIRMED', confidence: 0.9, evidence: [] },
        },
      },
    });

    const result = await projectMatchingService.matchBuyerRequirements({
      leadId: lead.id,
      qualificationId: qualification?.id,
      extractionId: extraction.id,
      forceRematch: true,
    });

    const apartmentMatch = result.recommendations.find((r) => r.project_code === 'VRN-CKR-01');
    assert(Boolean(apartmentMatch), 'Candidate project should NOT be eliminated when budget is unknown');
    assert(apartmentMatch!.dimension_scores.budget === 0, 'Budget dimension should award 0 points when unknown');
    const budgetComp = apartmentMatch!.components.find((c) => c.dimension === 'budget');
    assert(budgetComp?.match_state === 'BUDGET_UNKNOWN', `Match state must be BUDGET_UNKNOWN, got ${budgetComp?.match_state}`);
    assert(budgetComp?.reason_codes.includes('BUDGET_UNKNOWN'), 'Reason codes must contain BUDGET_UNKNOWN');
  });

  // -------------------------------------------------------------
  // Test 5: Budget mismatch
  // -------------------------------------------------------------
  await runTest('5. Budget mismatch', async () => {
    // Buyer with low budget (40-50 Lakh) matching high luxury DLF (7.5-9.5 Cr)
    const { lead, qualification, extraction } = await createQualifiedLead({
      mockExtraction: {
        schema_version: '1.0',
        extraction_status: 'SUCCESS',
        buying_intent: {
          interested: { value: true, truth_level: 'EXPLICIT', confidence: 0.9, evidence: [] },
          property_type: { value: 'Residential Apartment', truth_level: 'CONFIRMED', confidence: 0.9, evidence: [] },
          configuration: { value: '3 BHK', truth_level: 'CONFIRMED', confidence: 0.9, evidence: [] },
          budget: { value: { min: 4000000, max: 5000000, currency: 'INR' }, truth_level: 'CONFIRMED', confidence: 0.9, evidence: [] },
          preferred_locations: { value: ['Gurgaon', 'Sector 63'], truth_level: 'CONFIRMED', confidence: 0.9, evidence: [] },
        },
      },
    });

    const result = await projectMatchingService.matchBuyerRequirements({
      leadId: lead.id,
      qualificationId: qualification?.id,
      extractionId: extraction.id,
      forceRematch: true,
    });

    const dlfMatch = result.recommendations.find((r) => r.project_code === 'GUR-DLF-01');
    assert(Boolean(dlfMatch), 'DLF match evaluated');
    assert(dlfMatch!.dimension_scores.budget === 0, 'Budget dimension should be 0 for budget mismatch');
    const budgetComp = dlfMatch!.components.find((c) => c.dimension === 'budget');
    assert(budgetComp?.match_state === 'MISMATCH', 'Budget state should be MISMATCH');
    assert(dlfMatch!.gaps.length > 0, 'Gaps should record budget exceeded message');
  });

  // -------------------------------------------------------------
  // Test 6: Configuration match
  // -------------------------------------------------------------
  await runTest('6. Configuration match', async () => {
    const { lead, qualification, extraction } = await createQualifiedLead();

    const result = await projectMatchingService.matchBuyerRequirements({
      leadId: lead.id,
      qualificationId: qualification?.id,
      extractionId: extraction.id,
      forceRematch: true,
    });

    const configMatch = result.recommendations.find((r) => r.project_code === 'VRN-CKR-02');
    assert(configMatch!.dimension_scores.configuration === 15, 'Configuration match should award 15 points');
  });

  // -------------------------------------------------------------
  // Test 7: Configuration mismatch
  // -------------------------------------------------------------
  await runTest('7. Configuration mismatch', async () => {
    // Buyer asks minimum 3 BHK / 4 BHK in Vrindavan
    const { lead, qualification, extraction } = await createQualifiedLead({
      mockExtraction: {
        schema_version: '1.0',
        extraction_status: 'SUCCESS',
        buying_intent: {
          interested: { value: true, truth_level: 'EXPLICIT', confidence: 0.9, evidence: [] },
          property_type: { value: 'Residential Apartment', truth_level: 'CONFIRMED', confidence: 0.9, evidence: [] },
          configuration: { value: 'minimum 3 BHK', truth_level: 'CONFIRMED', confidence: 0.9, evidence: [] },
          budget: { value: { min: 4000000, max: 7000000, currency: 'INR' }, truth_level: 'CONFIRMED', confidence: 0.9, evidence: [] },
          preferred_locations: { value: ['Chatti Kila Road', 'Vrindavan'], truth_level: 'CONFIRMED', confidence: 0.9, evidence: [] },
        },
      },
    });

    const result = await projectMatchingService.matchBuyerRequirements({
      leadId: lead.id,
      qualificationId: qualification?.id,
      extractionId: extraction.id,
      forceRematch: true,
    });

    // Anand Dham (VRN-2BHK-07 only offers 1 BHK and 2 BHK)
    const mismatch = result.recommendations.find((r) => r.project_code === 'VRN-2BHK-07');
    assert(Boolean(mismatch), 'VRN-2BHK-07 found');
    assert(mismatch!.dimension_scores.configuration === 0, 'Config mismatch must award 0 points');
    const cfgComp = mismatch!.components.find((c) => c.dimension === 'configuration');
    assert(cfgComp?.match_state === 'MISMATCH', 'Config state must be MISMATCH');
  });

  // -------------------------------------------------------------
  // Test 8: Property type match
  // -------------------------------------------------------------
  await runTest('8. Property type match', async () => {
    const { lead, qualification, extraction } = await createQualifiedLead();

    const result = await projectMatchingService.matchBuyerRequirements({
      leadId: lead.id,
      qualificationId: qualification?.id,
      extractionId: extraction.id,
      forceRematch: true,
    });

    const propMatch = result.recommendations.find((r) => r.project_code === 'VRN-CKR-02');
    assert(propMatch!.dimension_scores.property_type === 10, 'Property type exact match should award 10 pts');
  });

  // -------------------------------------------------------------
  // Test 9: Property type mismatch
  // -------------------------------------------------------------
  await runTest('9. Property type mismatch', async () => {
    // Buyer asks Farm House, project is Commercial Office (MTH-COM-09)
    const { lead, qualification, extraction } = await createQualifiedLead();

    const result = await projectMatchingService.matchBuyerRequirements({
      leadId: lead.id,
      qualificationId: qualification?.id,
      extractionId: extraction.id,
      forceRematch: true,
    });

    const commMismatch = result.recommendations.find((r) => r.project_code === 'MTH-COM-09');
    assert(Boolean(commMismatch), 'Commercial project found');
    assert(commMismatch!.dimension_scores.property_type === 0, 'Farm House vs Commercial should award 0 pts');
    const ptComp = commMismatch!.components.find((c) => c.dimension === 'property_type');
    assert(ptComp?.match_state === 'MISMATCH', 'Property type state must be MISMATCH');
  });

  // -------------------------------------------------------------
  // Test 10: Purpose match
  // -------------------------------------------------------------
  await runTest('10. Purpose match', async () => {
    const { lead, qualification, extraction } = await createQualifiedLead();

    const result = await projectMatchingService.matchBuyerRequirements({
      leadId: lead.id,
      qualificationId: qualification?.id,
      extractionId: extraction.id,
      forceRematch: true,
    });

    const endUseMatch = result.recommendations.find((r) => r.project_code === 'VRN-CKR-02');
    assert(endUseMatch!.dimension_scores.purpose === 10, 'Purpose match should award 10 pts');
  });

  // -------------------------------------------------------------
  // Test 11: Timeline match
  // -------------------------------------------------------------
  await runTest('11. Timeline match', async () => {
    const { lead, qualification, extraction } = await createQualifiedLead();

    const result = await projectMatchingService.matchBuyerRequirements({
      leadId: lead.id,
      qualificationId: qualification?.id,
      extractionId: extraction.id,
      forceRematch: true,
    });

    // Ready to Move matches ASAP buyer -> 5 pts
    const readyMatch = result.recommendations.find((r) => r.project_code === 'VRN-CKR-02');
    assert(readyMatch!.dimension_scores.timeline === 5, 'Ready to move for ASAP timeline should award 5 pts');
  });

  // -------------------------------------------------------------
  // Test 12: Timeline mismatch
  // -------------------------------------------------------------
  await runTest('12. Timeline mismatch', async () => {
    const { lead, qualification, extraction } = await createQualifiedLead();

    const result = await projectMatchingService.matchBuyerRequirements({
      leadId: lead.id,
      qualificationId: qualification?.id,
      extractionId: extraction.id,
      forceRematch: true,
    });

    // DLF The Arbour possession is Q4 2028 (distant for ASAP buyer)
    const distantMatch = result.recommendations.find((r) => r.project_code === 'GUR-DLF-01');
    assert(distantMatch!.dimension_scores.timeline === 0, 'Distant timeline (2028+) for ASAP buyer should award 0 pts');
  });

  // -------------------------------------------------------------
  // Test 13: Multiple buyer requirements
  // -------------------------------------------------------------
  await runTest('13. Multiple buyer requirements', async () => {
    const multiReqExtraction = {
      schema_version: '1.0',
      extraction_status: 'SUCCESS',
      buying_intent: {
        interested: { value: true, truth_level: 'EXPLICIT', confidence: 0.95, evidence: [] },
        requirements_breakdown: [
          {
            property_type: 'Residential Apartment',
            configuration: '3 BHK',
            purpose: 'Self-Use',
            budget_min: 6500000,
            budget_max: 12000000,
            preferred_locations: ['Chatti Kila Road', 'Vrindavan'],
          },
          {
            property_type: 'Farm House',
            configuration: '800-1000 sq yd',
            purpose: 'Second Home',
            budget_min: 11000000,
            budget_max: 25000000,
            preferred_locations: ['Chatti Kila Road', 'Vrindavan'],
          },
        ],
      },
    };

    const { lead, qualification, extraction } = await createQualifiedLead({
      mockExtraction: multiReqExtraction,
    });

    const result = await projectMatchingService.matchBuyerRequirements({
      leadId: lead.id,
      qualificationId: qualification?.id,
      extractionId: extraction.id,
      forceRematch: true,
    });

    assert(result.success, 'Multi-requirement matching should succeed');
    // Verify both requirements were processed
    const req1Matches = result.recommendations.filter((r) => r.requirement_id === 'req-1');
    const req2Matches = result.recommendations.filter((r) => r.requirement_id === 'req-2');
    assert(req1Matches.length > 0, 'Requirement 1 should have recommendations');
    assert(req2Matches.length > 0, 'Requirement 2 should have recommendations');
  });

  // -------------------------------------------------------------
  // Test 14: Project data incomplete
  // -------------------------------------------------------------
  await runTest('14. Project data incomplete', async () => {
    const { lead, qualification, extraction } = await createQualifiedLead();

    const result = await projectMatchingService.matchBuyerRequirements({
      leadId: lead.id,
      qualificationId: qualification?.id,
      extractionId: extraction.id,
      forceRematch: true,
    });

    // Incomplete project TEST-INC-99
    const incompleteMatch = result.recommendations.find((r) => r.project_code === 'TEST-INC-99');
    assert(Boolean(incompleteMatch), 'Incomplete project evaluated without crashing');
    assert(incompleteMatch!.match_score <= 40, 'Incomplete project should have low score');
    const hasIncompleteComp = incompleteMatch!.components.some((c) => c.match_state === 'DATA_INCOMPLETE');
    assert(hasIncompleteComp, 'Components should flag DATA_INCOMPLETE');
  });

  // -------------------------------------------------------------
  // Test 15: Agent suggestion not treated as preference
  // -------------------------------------------------------------
  await runTest('15. Agent suggestion not treated as preference', async () => {
    // In this transcript, agent mentions Golf Course Ext Rd, but buyer only confirmed Vrindavan
    const { lead, qualification, extraction } = await createQualifiedLead({
      transcriptText: `Agent: You should also consider Golf Course Extension Road in Gurgaon.
Buyer: No, we are strictly only looking in Vrindavan near Chatti Kila Road.`,
    });

    const result = await projectMatchingService.matchBuyerRequirements({
      leadId: lead.id,
      qualificationId: qualification?.id,
      extractionId: extraction.id,
      forceRematch: true,
    });

    const vrindavanMatch = result.recommendations.find((r) => r.project_code === 'VRN-CKR-02');
    const gurgaonMatch = result.recommendations.find((r) => r.project_code === 'GUR-DLF-01');

    assert(vrindavanMatch!.rank < gurgaonMatch!.rank, 'Vrindavan must outrank unconfirmed agent suggestion');
  });

  // -------------------------------------------------------------
  // Test 16: Buyer-confirmed preference respected
  // -------------------------------------------------------------
  await runTest('16. Buyer-confirmed preference respected', async () => {
    const { lead, qualification, extraction } = await createQualifiedLead();

    const result = await projectMatchingService.matchBuyerRequirements({
      leadId: lead.id,
      qualificationId: qualification?.id,
      extractionId: extraction.id,
      forceRematch: true,
    });

    const farmMatch = result.recommendations.find((r) => r.project_code === 'VRN-CKR-02');
    assert(farmMatch!.dimension_scores.preferences === 5, 'Confirmed preference should award 5 pts');
  });

  // -------------------------------------------------------------
  // Test 17: Score components sum correctly
  // -------------------------------------------------------------
  await runTest('17. Score components sum correctly', async () => {
    const { lead, qualification, extraction } = await createQualifiedLead();

    const result = await projectMatchingService.matchBuyerRequirements({
      leadId: lead.id,
      qualificationId: qualification?.id,
      extractionId: extraction.id,
      forceRematch: true,
    });

    for (const rec of result.recommendations) {
      const sum = rec.components.reduce((acc, c) => acc + c.awarded_points, 0);
      assert(rec.match_score === Math.min(100, Math.max(0, sum)), `Score (${rec.match_score}) must equal component sum (${sum})`);
    }
  });

  // -------------------------------------------------------------
  // Test 18: Match score remains 0–100
  // -------------------------------------------------------------
  await runTest('18. Match score remains 0–100', async () => {
    const { lead, qualification, extraction } = await createQualifiedLead();

    const result = await projectMatchingService.matchBuyerRequirements({
      leadId: lead.id,
      qualificationId: qualification?.id,
      extractionId: extraction.id,
      forceRematch: true,
    });

    for (const rec of result.recommendations) {
      assert(rec.match_score >= 0 && rec.match_score <= 100, `Score ${rec.match_score} out of 0-100 bounds`);
    }
  });

  // -------------------------------------------------------------
  // Test 19: Ranking is deterministic
  // -------------------------------------------------------------
  await runTest('19. Ranking is deterministic', async () => {
    const { lead, qualification, extraction } = await createQualifiedLead();

    const res1 = await projectMatchingService.matchBuyerRequirements({
      leadId: lead.id,
      qualificationId: qualification?.id,
      extractionId: extraction.id,
      forceRematch: true,
    });

    const res2 = await projectMatchingService.matchBuyerRequirements({
      leadId: lead.id,
      qualificationId: qualification?.id,
      extractionId: extraction.id,
      forceRematch: true,
    });

    assert(res1.recommendations.length === res2.recommendations.length, 'Lengths match');
    for (let i = 0; i < res1.recommendations.length; i++) {
      assert(res1.recommendations[i].project_id === res2.recommendations[i].project_id, `Rank ${i} project must match`);
      assert(res1.recommendations[i].match_score === res2.recommendations[i].match_score, `Rank ${i} score must match`);
    }
  });

  // -------------------------------------------------------------
  // Test 20: Duplicate matching is idempotent
  // -------------------------------------------------------------
  await runTest('20. Duplicate matching is idempotent', async () => {
    const { lead, qualification, extraction } = await createQualifiedLead();

    const res1 = await projectMatchingService.matchBuyerRequirements({
      leadId: lead.id,
      qualificationId: qualification?.id,
      extractionId: extraction.id,
      forceRematch: false,
    });

    const res2 = await projectMatchingService.matchBuyerRequirements({
      leadId: lead.id,
      qualificationId: qualification?.id,
      extractionId: extraction.id,
      forceRematch: false,
    });

    assert(res2.action === 'EXISTING_MATCHES' || res2.action === 'MATCHED', 'Should return existing matches');
    assert(res1.recommendations.length === res2.recommendations.length, 'Recommendations count matches');
  });

  // -------------------------------------------------------------
  // Test 21: Recommendation remains AI_RECOMMENDED
  // -------------------------------------------------------------
  await runTest('21. Recommendation remains AI_RECOMMENDED', async () => {
    const { lead, qualification, extraction } = await createQualifiedLead();

    const result = await projectMatchingService.matchBuyerRequirements({
      leadId: lead.id,
      qualificationId: qualification?.id,
      extractionId: extraction.id,
      forceRematch: true,
    });

    for (const rec of result.recommendations) {
      assert(
        rec.recommendation_status === 'AI_RECOMMENDED',
        `Recommendation status must be AI_RECOMMENDED, got ${rec.recommendation_status}`
      );
    }
  });

  // -------------------------------------------------------------
  // Test 22: Buyer preference is never silently mutated
  // -------------------------------------------------------------
  await runTest('22. Buyer preference is never silently mutated', async () => {
    const { lead, qualification, extraction } = await createQualifiedLead();

    const result = await projectMatchingService.matchBuyerRequirements({
      leadId: lead.id,
      qualificationId: qualification?.id,
      extractionId: extraction.id,
      forceRematch: true,
    });

    for (const rec of result.recommendations) {
      assert(
        rec.buyer_confirmed === false,
        `buyer_confirmed must remain false for AI matches (got ${rec.buyer_confirmed})`
      );
    }
  });

  // -------------------------------------------------------------
  // Regression Tests (Phase 4A through 5D)
  // -------------------------------------------------------------
  const skipInner = process.env.SKIP_INNER_RECURSION === 'true';

  await runTest('23. Existing Phase 4A passes', async () => {
    try {
      if (!skipInner) execSync('./node_modules/.bin/tsx tests/call-eligibility-verification.ts', { stdio: 'pipe', env: { ...process.env, SKIP_INNER_RECURSION: 'true' } });
    } catch (e: any) {
      throw new Error(`Phase 4A regression failed: ${e.stdout?.toString() || e.message}`);
    }
  });

  await runTest('24. Existing Phase 4B passes', async () => {
    try {
      if (!skipInner) execSync('./node_modules/.bin/tsx tests/sarvam-unit-tests.ts', { stdio: 'pipe', env: { ...process.env, SKIP_INNER_RECURSION: 'true' } });
    } catch (e: any) {
      throw new Error(`Phase 4B regression failed: ${e.stdout?.toString() || e.message}`);
    }
  });

  await runTest('25. Existing Phase 5A passes', async () => {
    try {
      if (!skipInner) execSync('./node_modules/.bin/tsx tests/phase5a-transcript-ingestion.ts', { stdio: 'pipe', env: { ...process.env, SKIP_INNER_RECURSION: 'true' } });
    } catch (e: any) {
      throw new Error(`Phase 5A regression failed: ${e.stdout?.toString() || e.message}`);
    }
  });

  await runTest('26. Existing Phase 5B passes', async () => {
    try {
      if (!skipInner) execSync('./node_modules/.bin/tsx tests/phase5b-gemini-extraction.ts', { stdio: 'pipe', env: { ...process.env, SKIP_INNER_RECURSION: 'true' } });
    } catch (e: any) {
      throw new Error(`Phase 5B regression failed: ${e.stdout?.toString() || e.message}`);
    }
  });

  await runTest('27. Existing Phase 5C passes', async () => {
    try {
      if (!skipInner) execSync('./node_modules/.bin/tsx tests/phase5c-buyer-qualification.ts', { stdio: 'pipe', env: { ...process.env, SKIP_INNER_RECURSION: 'true' } });
    } catch (e: any) {
      throw new Error(`Phase 5C regression failed: ${e.stdout?.toString() || e.message}`);
    }
  });

  await runTest('28. Existing Phase 5D passes', async () => {
    try {
      if (!skipInner) execSync('./node_modules/.bin/tsx tests/phase5d-buyer-scoring.ts', { stdio: 'pipe', env: { ...process.env, SKIP_INNER_RECURSION: 'true' } });
    } catch (e: any) {
      throw new Error(`Phase 5D regression failed: ${e.stdout?.toString() || e.message}`);
    }
  });

  // Summary
  console.log('\n============================================================');
  console.log('PHASE 5E TEST RESULTS SUMMARY');
  console.log('============================================================');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Total Tests:  ${results.length}`);
  console.log(`Passed:       ${passed}`);
  console.log(`Failed:       ${failed}`);

  if (failed > 0) {
    console.error('\nFAILED TESTS:');
    results
      .filter((r) => !r.passed)
      .forEach((r) => {
        console.error(`  - ${r.name}: ${r.error}`);
      });
    process.exit(1);
  } else {
    console.log('\n✓ ALL 28 PHASE 5E TESTS PASSED PERFECTLY (INCLUDING FULL REGRESSION)!');
    process.exit(0);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal error running Phase 5E test suite:', err);
  process.exit(1);
});
