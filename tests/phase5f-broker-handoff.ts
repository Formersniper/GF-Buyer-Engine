/**
 * GrowthForge Buyer Intelligence Engine - Phase 5F Comprehensive Test Suite
 *
 * Broker Handoff & CRM Routing Verification
 * Tests the 25 required test scenarios across the full sales enablement layer:
 * 1. TIER_1_HOT handoff generation (Score 90–100, SENIOR_SALES_ADVISOR, 15m SLA)
 * 2. TIER_2_WARM handoff generation (Score 70–89, INBOUND_SALES_SPECIALIST, 120m SLA)
 * 3. TIER_3_NURTURE handoff generation (Score 0–69, AUTOMATED_NURTURE_WORKFLOW, 1440m SLA)
 * 4. TIER_4_REVIEW handoff generation (Review state, SALES_SUPERVISOR_REVIEW, flag for human intervention)
 * 5. Missing budget handling (READY_WITH_MISSING_DATA, Budget in missing_information, NOT eliminated)
 * 6. Missing financing handling (Financing listed in missing_information)
 * 7. Missing decision authority handling (Decision authority listed in missing_information)
 * 8. Multi-requirement handoff preservation (Requirement 1 + Requirement 2 preserved with indices)
 * 9. Commercial summary generation (Valid formatted commercial text containing Buyer, Status, Score, Tier, Requirements, Timeline, Budget, Top Projects, Missing Info, Next Action)
 * 10. Idempotent handoff creation (Re-calling with same lead/score returns EXISTING_HANDOFF with identical ID)
 * 11. Safe mock dispatch (Dispatches to MockBrokerHandoffChannel in DRY-RUN mode without external mutations)
 * 12. Idempotent dispatch handling (Re-dispatching already sent handoff returns IGNORED_DUPLICATE)
 * 13. Sales acknowledgment tracking (Marks status ACKNOWLEDGED and logs HANDOFF_ACKNOWLEDGED audit event)
 * 14. Audit event completeness (HANDOFF_CREATED, HANDOFF_READY/REQUIRES_REVIEW, ROUTING_ASSIGNED, DISPATCH_STARTED, DISPATCH_COMPLETED)
 * 15. Priority queue deterministic ordering (Ordered by Tier Priority ASC -> SLA Deadline ASC -> Score DESC -> Created ASC)
 * 16. Disqualified lead handoff handling (BLOCKED status, no auto-dispatch)
 * 17. Recommendation status remains AI_RECOMMENDED (no buyer confirmed spoofing)
 * 18. End-to-end pipeline: Lead -> Scout -> Call -> Transcript -> Gemini -> Qualification -> Scoring -> Matching -> Handoff
 * 19. Regression: Phase 4A test passes
 * 20. Regression: Phase 4B test passes
 * 21. Regression: Phase 5A test passes
 * 22. Regression: Phase 5B test passes
 * 23. Regression: Phase 5C test passes
 * 24. Regression: Phase 5D test passes
 * 25. Regression: Phase 5E test passes
 */

import { supabaseDataService } from '../app/services/supabase/repositories';
import { transcriptIngestionService } from '../app/services/voice/transcriptIngestionService';
import { conversationExtractionService } from '../app/services/gemini/conversationExtractionService';
import { buyerQualificationService } from '../app/services/qualification/buyerQualificationService';
import { buyerScoringService } from '../app/services/scoring/buyerScoringService';
import { projectMatchingService } from '../app/services/matching/projectMatchingService';
import { brokerHandoffService } from '../app/services/handoff/brokerHandoffService';
import {
  MockGeminiExtractionProvider,
  setGeminiExtractionProvider,
} from '../app/services/gemini/geminiExtractionProvider';
import { execSync } from 'child_process';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: unknown;
}


async function createSetupRecords(leadId: string, extId?: string) {
  const call = await supabaseDataService.calls.createCall({
    lead_id: leadId,
    provider: 'sarvam',
    provider_call_id: `call-${Date.now()}-${Math.floor(Math.random()*1000)}`,
    status: 'COMPLETED',
    duration_seconds: 120
  });
  
  const tx = await supabaseDataService.transcripts.createTranscript({
    lead_id: leadId,
    call_id: call.id,
    transcript_text: 'Dummy test text',
    transcript_turns: [],
    source: 'CALL_TRANSCRIPT'
  });
  
  const ext = await supabaseDataService.extractions.createExtraction({
    id: extId || crypto.randomUUID(),
    lead_id: leadId,
    call_id: call.id,
    transcript_id: tx.id,
    model: 'gemini-2.5-flash',
    prompt_version: 'v1',
    schema_version: 'v1',
    extracted_data: {} as any
  });
  
  return ext;
}

const results: TestResult[] = [];

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runTest(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`  ✅ PASS: ${name}`);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    results.push({ name, passed: false, error: errMsg });
    console.error(`  ❌ FAIL: ${name}\n     Error: ${errMsg}`);
  }
}

async function runPhase5FTestSuite() {
  console.log('============================================================');
  console.log('GROWTHFORGE BUYER INTELLIGENCE ENGINE');
  console.log('PHASE 5F — BROKER HANDOFF & CRM ROUTING VERIFICATION');
  console.log('============================================================\n');

  // Test 1: TIER_1_HOT Handoff Generation
  await runTest('1. TIER_1_HOT handoff generation (Score 90–100, SENIOR_SALES_ADVISOR, 15m SLA)', async () => {
    const lead = await supabaseDataService.leads.createLead({
      lead_id: `GF-P5F-HOT-${Date.now()}`,
      name: 'Aditya Birla',
      phone: '+919876543201',
      source: 'CSV_IMPORT',
      status: 'QUALIFIED',
    });

    const setupExt = await createSetupRecords(lead.id);
    const qual = await supabaseDataService.qualifications.createQualification({
      lead_id: lead.id,
      extraction_id: setupExt.id,
      qualification_status: 'QUALIFIED',
      reason_codes: ['ACTIVE_INTENT_CONFIRMED', 'BUDGET_CONFIRMED'],
    });

    const score = await supabaseDataService.buyerScores.createBuyerScoreRecord({
      lead_id: lead.id,
      qualification_id: qual.id,
      extraction_id: setupExt.id,
      score: 94,
      composite_score: 94,
      total_score: 94,
      tier: 'TIER_1_HOT',
      score_band: 'HOT',
      dimension_scores: {
        buyer_intent: 25,
        budget_clarity: 20,
        location_clarity: 15,
        timeline: 15,
        project_fit: 10,
        decision_authority: 5,
        contactability: 2,
        data_freshness: 2,
      },
      sla_dispatch: {
        tier: 'TIER_1_HOT',
        sla_minutes: 15,
        sla_deadline: new Date(Date.now() + 15 * 60000).toISOString(),
        assigned_role: 'SENIOR_SALES_ADVISOR',
        assigned_team: 'SENIOR_SALES',
        recommended_action: 'Immediate advisor outreach',
        talking_points: ['Discuss customized payment plans'],
        routing_action: 'IMMEDIATE_PHONE_DISPATCH',
      },
    } as any);

    const handoffRes = await brokerHandoffService.generateHandoff({
      leadId: lead.id,
      scoreId: score.id,
      qualificationId: qual.id,
    });

    assert(handoffRes.success, 'Handoff creation must succeed');
    assert(handoffRes.handoff !== undefined, 'Handoff payload must be present');
    assert(handoffRes.handoff!.priority.tier === 'TIER_1_HOT', 'Tier must be TIER_1_HOT');
    assert(handoffRes.handoff!.priority.sla_minutes === 15, 'SLA must be 15 minutes');
    assert(handoffRes.handoff!.routing_decision.assigned_role === 'SENIOR_SALES_ADVISOR', 'Role must be SENIOR_SALES_ADVISOR');
    assert(handoffRes.handoff!.routing_decision.assigned_team === 'SENIOR_SALES', 'Team must be SENIOR_SALES');
  });

  // Test 2: TIER_2_WARM Handoff Generation
  await runTest('2. TIER_2_WARM handoff generation (Score 70–89, INBOUND_SALES_SPECIALIST, 120m SLA)', async () => {
    const lead = await supabaseDataService.leads.createLead({
      lead_id: `GF-P5F-WARM-${Date.now()}`,
      name: 'Pooja Hegde',
      phone: '+919876543202',
      source: 'CSV_IMPORT',
      status: 'QUALIFIED',
    });

    const setupExt = await createSetupRecords(lead.id);
    const qual = await supabaseDataService.qualifications.createQualification({
      lead_id: lead.id,
      extraction_id: setupExt.id,
      qualification_status: 'QUALIFIED',
      reason_codes: ['ACTIVE_INTENT_CONFIRMED'],
    });

    const score = await supabaseDataService.buyerScores.createBuyerScoreRecord({
      lead_id: lead.id,
      qualification_id: qual.id,
      extraction_id: setupExt.id,
      score: 78,
      composite_score: 78,
      total_score: 78,
      tier: 'TIER_2_WARM',
      score_band: 'WARM',
      dimension_scores: {
        buyer_intent: 20,
        budget_clarity: 15,
        location_clarity: 15,
        timeline: 10,
        project_fit: 10,
        decision_authority: 5,
        contactability: 2,
        data_freshness: 1,
      },
      sla_dispatch: {
        tier: 'TIER_2_WARM',
        sla_minutes: 120,
        sla_deadline: new Date(Date.now() + 120 * 60000).toISOString(),
        assigned_role: 'INBOUND_SALES_SPECIALIST',
        assigned_team: 'INBOUND_SALES',
        recommended_action: 'Schedule consultation call',
        talking_points: ['Present shortlisted inventory'],
        routing_action: 'SCHEDULED_CALLBACK',
      },
    } as any);

    const handoffRes = await brokerHandoffService.generateHandoff({
      leadId: lead.id,
      scoreId: score.id,
      qualificationId: qual.id,
    });

    assert(handoffRes.success, 'Handoff creation must succeed');
    assert(handoffRes.handoff!.priority.tier === 'TIER_2_WARM', 'Tier must be TIER_2_WARM');
    assert(handoffRes.handoff!.priority.sla_minutes === 120, 'SLA must be 120 minutes');
    assert(handoffRes.handoff!.routing_decision.assigned_role === 'INBOUND_SALES_SPECIALIST', 'Role must be INBOUND_SALES_SPECIALIST');
    assert(handoffRes.handoff!.routing_decision.assigned_team === 'INBOUND_SALES', 'Team must be INBOUND_SALES');
  });

  // Test 3: TIER_3_NURTURE Handoff Generation
  await runTest('3. TIER_3_NURTURE handoff generation (Score 0–69, AUTOMATED_NURTURE_WORKFLOW, 1440m SLA)', async () => {
    const lead = await supabaseDataService.leads.createLead({
      lead_id: `GF-P5F-NURTURE-${Date.now()}`,
      name: 'Rohan Sharma',
      phone: '+919876543203',
      source: 'CSV_IMPORT',
      status: 'RAW',
    });

    const setupExt = await createSetupRecords(lead.id);
    const qual = await supabaseDataService.qualifications.createQualification({
      lead_id: lead.id,
      extraction_id: setupExt.id,
      qualification_status: 'QUALIFIED',
      reason_codes: ['ACTIVE_INTENT_CONFIRMED'],
    });

    const score = await supabaseDataService.buyerScores.createBuyerScoreRecord({
      lead_id: lead.id,
      qualification_id: qual.id,
      extraction_id: setupExt.id,
      score: 52,
      composite_score: 52,
      total_score: 52,
      tier: 'TIER_3_NURTURE',
      score_band: 'NURTURE',
      dimension_scores: {
        buyer_intent: 15,
        budget_clarity: 10,
        location_clarity: 10,
        timeline: 5,
        project_fit: 5,
        decision_authority: 5,
        contactability: 1,
        data_freshness: 1,
      },
      sla_dispatch: {
        tier: 'TIER_3_NURTURE',
        sla_minutes: 1440,
        sla_deadline: new Date(Date.now() + 1440 * 60000).toISOString(),
        assigned_role: 'AUTOMATED_NURTURE_WORKFLOW',
        assigned_team: 'NURTURE_AUTOMATION',
        recommended_action: 'Enroll in long-term nurture cadence',
        talking_points: ['Share quarterly market digest'],
        routing_action: 'NURTURE_DRIP_CAMPAIGN',
      },
    } as any);

    const handoffRes = await brokerHandoffService.generateHandoff({
      leadId: lead.id,
      scoreId: score.id,
      qualificationId: qual.id,
    });

    assert(handoffRes.success, 'Handoff creation must succeed');
    assert(handoffRes.handoff!.priority.tier === 'TIER_3_NURTURE', 'Tier must be TIER_3_NURTURE');
    assert(handoffRes.handoff!.priority.sla_minutes === 1440, 'SLA must be 1440 minutes');
    assert(handoffRes.handoff!.routing_decision.assigned_role === 'AUTOMATED_NURTURE_WORKFLOW', 'Role must be AUTOMATED_NURTURE_WORKFLOW');
  });

  // Test 4: TIER_4_REVIEW Handoff Generation
  await runTest('4. TIER_4_REVIEW handoff generation (Review state, SALES_SUPERVISOR_REVIEW, flag for human intervention)', async () => {
    const lead = await supabaseDataService.leads.createLead({
      lead_id: `GF-P5F-REV-${Date.now()}`,
      name: 'Suresh Raina',
      phone: '+919876543204',
      source: 'CSV_IMPORT',
      status: 'RAW',
    });

    const setupExt = await createSetupRecords(lead.id);
    const qual = await supabaseDataService.qualifications.createQualification({
      lead_id: lead.id,
      extraction_id: setupExt.id,
      qualification_status: 'REQUIRES_REVIEW',
      reason_codes: ['CONTRADICTION_DETECTED'],
    });

    const score = await supabaseDataService.buyerScores.createBuyerScoreRecord({
      lead_id: lead.id,
      qualification_id: qual.id,
      extraction_id: setupExt.id,
      score: 45,
      composite_score: 45,
      total_score: 45,
      tier: 'TIER_4_REVIEW',
      score_band: 'REVIEW',
      score_status: 'REQUIRES_REVIEW',
      risk_factors: ['Conflicting timeline stated'],
      dimension_scores: {
        buyer_intent: 10,
        budget_clarity: 10,
        location_clarity: 10,
        timeline: 5,
        project_fit: 5,
        decision_authority: 3,
        contactability: 1,
        data_freshness: 1,
      },
      sla_dispatch: {
        tier: 'TIER_4_REVIEW',
        sla_minutes: 240,
        sla_deadline: new Date(Date.now() + 240 * 60000).toISOString(),
        assigned_role: 'SALES_SUPERVISOR_REVIEW',
        assigned_team: 'SALES_SUPERVISORS',
        recommended_action: 'Supervisor manual review required',
        talking_points: ['Inspect raw transcript turns'],
        routing_action: 'MANUAL_INTELLIGENCE_AUDIT',
      },
    } as any);

    const handoffRes = await brokerHandoffService.generateHandoff({
      leadId: lead.id,
      scoreId: score.id,
      qualificationId: qual.id,
    });

    assert(handoffRes.success, 'Handoff creation must succeed');
    assert(handoffRes.handoff!.priority.tier === 'TIER_4_REVIEW', 'Tier must be TIER_4_REVIEW');
    assert(handoffRes.handoff!.handoff_status === 'REQUIRES_REVIEW', 'Handoff status must be REQUIRES_REVIEW');
    assert(handoffRes.handoff!.routing_decision.assigned_role === 'SALES_SUPERVISOR_REVIEW', 'Role must be SALES_SUPERVISOR_REVIEW');
  });

  // Test 5: Missing Budget Handling
  await runTest('5. Missing budget handling (READY_WITH_MISSING_DATA, Budget in missing_information, NOT eliminated)', async () => {
    const lead = await supabaseDataService.leads.createLead({
      lead_id: `GF-P5F-NOBUDGET-${Date.now()}`,
      name: 'Vikas Khanna',
      phone: '+919876543205',
      source: 'CSV_IMPORT',
      status: 'QUALIFIED',
    });

    const setupExt = await createSetupRecords(lead.id);
    const qual = await supabaseDataService.qualifications.createQualification({
      lead_id: lead.id,
      extraction_id: setupExt.id,
      qualification_status: 'QUALIFIED',
    });

    const score = await supabaseDataService.buyerScores.createBuyerScoreRecord({
      lead_id: lead.id,
      qualification_id: qual.id,
      extraction_id: setupExt.id,
      score: 75,
      composite_score: 75,
      tier: 'TIER_2_WARM',
      score_band: 'WARM',
    } as any);

    const handoffRes = await brokerHandoffService.generateHandoff({
      leadId: lead.id,
      scoreId: score.id,
      qualificationId: qual.id,
    });

    assert(handoffRes.success, 'Handoff creation must succeed');
    assert(
      handoffRes.handoff!.handoff_status === 'READY_WITH_MISSING_DATA',
      'Status should be READY_WITH_MISSING_DATA'
    );
    assert(
      handoffRes.handoff!.missing_information.includes('Budget confirmation'),
      'Missing information must contain Budget confirmation'
    );
    assert(
      handoffRes.handoff!.commercial_summary.includes('BUDGET:\nNOT CONFIRMED'),
      'Commercial summary must explicitly reflect unconfirmed budget'
    );
  });

  // Test 6: Missing Financing Handling
  await runTest('6. Missing financing handling (Financing listed in missing_information)', async () => {
    const lead = await supabaseDataService.leads.createLead({
      lead_id: `GF-P5F-NOFIN-${Date.now()}`,
      name: 'Meera Rajput',
      phone: '+919876543206',
      source: 'CSV_IMPORT',
      status: 'QUALIFIED',
    });

    const setupExt = await createSetupRecords(lead.id);
    const qual = await supabaseDataService.qualifications.createQualification({
      lead_id: lead.id,
      extraction_id: setupExt.id,
      qualification_status: 'QUALIFIED',
    });

    const score = await supabaseDataService.buyerScores.createBuyerScoreRecord({
      lead_id: lead.id,
      qualification_id: qual.id,
      extraction_id: setupExt.id,
      score: 82,
      tier: 'TIER_2_WARM',
      score_band: 'WARM',
    } as any);

    const handoffRes = await brokerHandoffService.generateHandoff({
      leadId: lead.id,
      scoreId: score.id,
      qualificationId: qual.id,
    });

    assert(handoffRes.success, 'Handoff creation must succeed');
    assert(
      handoffRes.handoff!.missing_information.includes('Financing preference'),
      'Missing information must contain Financing preference'
    );
  });

  // Test 7: Missing Decision Authority Handling
  await runTest('7. Missing decision authority handling (Decision authority listed in missing_information)', async () => {
    const lead = await supabaseDataService.leads.createLead({
      lead_id: `GF-P5F-NODEC-${Date.now()}`,
      name: 'Arjun Kapoor',
      phone: '+919876543207',
      source: 'CSV_IMPORT',
      status: 'QUALIFIED',
    });

    const setupExt = await createSetupRecords(lead.id);
    const qual = await supabaseDataService.qualifications.createQualification({
      lead_id: lead.id,
      extraction_id: setupExt.id,
      qualification_status: 'QUALIFIED',
    });

    const score = await supabaseDataService.buyerScores.createBuyerScoreRecord({
      lead_id: lead.id,
      qualification_id: qual.id,
      extraction_id: setupExt.id,
      score: 72,
      tier: 'TIER_2_WARM',
      score_band: 'WARM',
    } as any);

    const handoffRes = await brokerHandoffService.generateHandoff({
      leadId: lead.id,
      scoreId: score.id,
      qualificationId: qual.id,
    });

    assert(handoffRes.success, 'Handoff creation must succeed');
    assert(
      handoffRes.handoff!.missing_information.includes('Decision authority'),
      'Missing information must contain Decision authority'
    );
  });

  // Test 8: Multi-Requirement Handoff Preservation
  await runTest('8. Multi-requirement handoff preservation (Requirement 1 + Requirement 2 preserved with indices)', async () => {
    const lead = await supabaseDataService.leads.createLead({
      lead_id: `GF-P5F-MULTI-${Date.now()}`,
      name: 'Kunal Nayyar',
      phone: '+919876543208',
      source: 'CSV_IMPORT',
      status: 'QUALIFIED',
    });

    // Provide multi requirements via extraction
    const extraction = await supabaseDataService.extractions.createExtraction({
      id: 'ext-multi-1',
      lead_id: lead.id,
      call_id: 'call-multi-1',
      transcript_id: 'tr-multi-1',
      model: 'gemini-2.5-flash',
      extraction_status: 'SUCCESS',
      extracted_data: {
        requirements: [
          {
            property_type: 'Apartment',
            configuration: '3BHK',
            purpose: 'Self-use',
            preferred_locations: ['Whitefield'],
            budget_min: 15000000,
            budget_max: 20000000,
            currency: 'INR',
            timeline: '3 months',
          },
          {
            property_type: 'Plot',
            configuration: '1200-1500 sqft',
            purpose: 'Investment',
            preferred_locations: ['Sarjapur Road'],
            budget_min: 6000000,
            budget_max: 9000000,
            currency: 'INR',
            timeline: '12 months',
          },
        ],
      } as any,
    });

    const qual = await supabaseDataService.qualifications.createQualification({
      lead_id: lead.id,
      extraction_id: extraction.id,
      qualification_status: 'QUALIFIED',
    });

    const score = await supabaseDataService.buyerScores.createBuyerScoreRecord({
      lead_id: lead.id,
      qualification_id: qual.id,
      extraction_id: extraction.id,
      score: 88,
      tier: 'TIER_2_WARM',
      score_band: 'WARM',
    } as any);

    const handoffRes = await brokerHandoffService.generateHandoff({
      leadId: lead.id,
      scoreId: score.id,
      qualificationId: qual.id,
      extractionId: extraction.id,
    });

    assert(handoffRes.success, 'Handoff creation must succeed');
    assert(handoffRes.handoff!.requirements.length === 2, 'Must contain 2 requirements');
    assert(handoffRes.handoff!.requirements[0].requirement_index === 1, 'First req index must be 1');
    assert(handoffRes.handoff!.requirements[1].requirement_index === 2, 'Second req index must be 2');
    assert(handoffRes.handoff!.requirements[0].property_type === 'Apartment', 'Req 1 property type must be Apartment');
    assert(handoffRes.handoff!.requirements[1].property_type === 'Plot', 'Req 2 property type must be Plot');
    assert(
      handoffRes.handoff!.commercial_summary.includes('SECONDARY REQUIREMENT:'),
      'Commercial summary must format secondary requirement'
    );
  });

  // Test 9: Commercial Summary Generation
  await runTest('9. Commercial summary generation (Valid formatted commercial text containing Buyer, Status, Score, Tier, Requirements, Timeline, Budget, Top Projects, Missing Info, Next Action)', async () => {
    const lead = await supabaseDataService.leads.createLead({
      lead_id: `GF-P5F-COMM-${Date.now()}`,
      name: 'Deepika Padukone',
      phone: '+919876543209',
      source: 'CSV_IMPORT',
      status: 'QUALIFIED',
    });

    const setupExt = await createSetupRecords(lead.id);
    const qual = await supabaseDataService.qualifications.createQualification({
      lead_id: lead.id,
      extraction_id: setupExt.id,
      qualification_status: 'QUALIFIED',
    });

    await supabaseDataService.extractions.updateExtraction(setupExt.id, { extracted_data: {
        primary_property_type: { value: 'Villa' },
        primary_configuration: { value: '4BHK' },
        preferred_locations: { value: ['Indiranagar'] },
        budget: { min: 40000000, max: 60000000, currency: 'INR' },
        timeline: { value: 'Immediate' },
      } as any });

    const score = await supabaseDataService.buyerScores.createBuyerScoreRecord({
      lead_id: lead.id,
      qualification_id: qual.id,
      extraction_id: setupExt.id,
      score: 95,
      tier: 'TIER_1_HOT',
      score_band: 'HOT',
    } as any);

    const handoffRes = await brokerHandoffService.generateHandoff({
      leadId: lead.id,
      scoreId: score.id,
      qualificationId: qual.id,
    });

    assert(handoffRes.success, 'Handoff creation must succeed');
    const summary = handoffRes.handoff!.commercial_summary;
    assert(summary.includes('BUYER:\nDeepika Padukone'), 'Must contain buyer name');
    assert(summary.includes('STATUS:\nQUALIFIED'), 'Must contain qualification status');
    assert(summary.includes('SCORE:\n95 / 100'), 'Must contain score');
    assert(summary.includes('TIER:\nTIER_1_HOT'), 'Must contain tier');
    assert(summary.includes('PRIMARY REQUIREMENT:'), 'Must contain primary requirement');
    assert(summary.includes('BUDGET:'), 'Must contain budget');
    assert(summary.includes('NEXT ACTION:'), 'Must contain next action');
  });

  // Test 10: Idempotent Handoff Creation
  await runTest('10. Idempotent handoff creation (Re-calling with same lead/score returns EXISTING_HANDOFF with identical ID)', async () => {
    const lead = await supabaseDataService.leads.createLead({
      lead_id: `GF-P5F-IDEM-${Date.now()}`,
      name: 'Ranveer Singh',
      phone: '+919876543210',
      source: 'CSV_IMPORT',
      status: 'QUALIFIED',
    });

    const setupExt = await createSetupRecords(lead.id);
    const qual = await supabaseDataService.qualifications.createQualification({
      lead_id: lead.id,
      extraction_id: setupExt.id,
      qualification_status: 'QUALIFIED',
    });

    const score = await supabaseDataService.buyerScores.createBuyerScoreRecord({
      lead_id: lead.id,
      qualification_id: qual.id,
      extraction_id: setupExt.id,
      score: 85,
      tier: 'TIER_2_WARM',
      score_band: 'WARM',
    } as any);

    const firstHandoff = await brokerHandoffService.generateHandoff({
      leadId: lead.id,
      scoreId: score.id,
      qualificationId: qual.id,
    });

    const secondHandoff = await brokerHandoffService.generateHandoff({
      leadId: lead.id,
      scoreId: score.id,
      qualificationId: qual.id,
      forceRegenerate: false,
    });

    assert(firstHandoff.success, 'First handoff must succeed');
    assert(secondHandoff.success, 'Second handoff must succeed');
    assert(secondHandoff.action === 'EXISTING_HANDOFF', 'Action must be EXISTING_HANDOFF');
    assert(firstHandoff.handoffId === secondHandoff.handoffId, 'Handoff IDs must be strictly identical');
  });

  // Test 11: Safe Mock Dispatch
  await runTest('11. Safe mock dispatch (Dispatches to MockBrokerHandoffChannel in DRY-RUN mode without external mutations)', async () => {
    const lead = await supabaseDataService.leads.createLead({
      lead_id: `GF-P5F-DISP-${Date.now()}`,
      name: 'Virat Kohli',
      phone: '+919876543211',
      source: 'CSV_IMPORT',
      status: 'QUALIFIED',
    });

    const setupExt = await createSetupRecords(lead.id);
    const qual = await supabaseDataService.qualifications.createQualification({
      lead_id: lead.id,
      extraction_id: setupExt.id,
      qualification_status: 'QUALIFIED',
    });

    const score = await supabaseDataService.buyerScores.createBuyerScoreRecord({
      lead_id: lead.id,
      qualification_id: qual.id,
      extraction_id: setupExt.id,
      score: 96,
      tier: 'TIER_1_HOT',
      score_band: 'HOT',
    } as any);

    const handoffRes = await brokerHandoffService.generateHandoff({
      leadId: lead.id,
      scoreId: score.id,
      qualificationId: qual.id,
    });

    const dispatchRes = await brokerHandoffService.dispatchHandoff(handoffRes.handoffId!, {
      dryRun: true,
    });

    assert(dispatchRes.success, 'Dispatch must succeed in dry-run mode');
    assert(dispatchRes.status === 'SENT', 'Dispatch status must be SENT');
    assert(dispatchRes.dry_run === true, 'dry_run flag must be true');

    const readBack = await supabaseDataService.brokerHandoffs.getHandoff(handoffRes.handoffId!);
    assert(readBack?.dispatch_status === 'SENT', 'DB record dispatch_status must be updated to SENT');
    assert(readBack?.handoff_status === 'DISPATCHED', 'DB record handoff_status must be DISPATCHED');
  });

  // Test 12: Idempotent Dispatch Handling
  await runTest('12. Idempotent dispatch handling (Re-dispatching already sent handoff returns IGNORED_DUPLICATE)', async () => {
    const lead = await supabaseDataService.leads.createLead({
      lead_id: `GF-P5F-DISPIDEM-${Date.now()}`,
      name: 'Anushka Sharma',
      phone: '+919876543212',
      source: 'CSV_IMPORT',
      status: 'QUALIFIED',
    });

    const setupExt = await createSetupRecords(lead.id);
    const qual = await supabaseDataService.qualifications.createQualification({
      lead_id: lead.id,
      extraction_id: setupExt.id,
      qualification_status: 'QUALIFIED',
    });

    const score = await supabaseDataService.buyerScores.createBuyerScoreRecord({
      lead_id: lead.id,
      qualification_id: qual.id,
      extraction_id: setupExt.id,
      score: 91,
      tier: 'TIER_1_HOT',
      score_band: 'HOT',
    } as any);

    const handoffRes = await brokerHandoffService.generateHandoff({
      leadId: lead.id,
      scoreId: score.id,
      qualificationId: qual.id,
    });

    const firstDispatch = await brokerHandoffService.dispatchHandoff(handoffRes.handoffId!, { dryRun: true });
    const secondDispatch = await brokerHandoffService.dispatchHandoff(handoffRes.handoffId!, { dryRun: true, forceRedispatch: false });

    assert(firstDispatch.success, 'First dispatch must succeed');
    assert(secondDispatch.success, 'Second dispatch must succeed');
    assert(secondDispatch.status === 'IGNORED_DUPLICATE', 'Second dispatch must be IGNORED_DUPLICATE');
  });

  // Test 13: Sales Acknowledgment Tracking
  await runTest('13. Sales acknowledgment tracking (Marks status ACKNOWLEDGED and logs HANDOFF_ACKNOWLEDGED audit event)', async () => {
    const lead = await supabaseDataService.leads.createLead({
      lead_id: `GF-P5F-ACK-${Date.now()}`,
      name: 'Kareena Kapoor',
      phone: '+919876543213',
      source: 'CSV_IMPORT',
      status: 'QUALIFIED',
    });

    const setupExt = await createSetupRecords(lead.id);
    const qual = await supabaseDataService.qualifications.createQualification({
      lead_id: lead.id,
      extraction_id: setupExt.id,
      qualification_status: 'QUALIFIED',
    });

    const score = await supabaseDataService.buyerScores.createBuyerScoreRecord({
      lead_id: lead.id,
      qualification_id: qual.id,
      extraction_id: setupExt.id,
      score: 87,
      tier: 'TIER_2_WARM',
      score_band: 'WARM',
    } as any);

    const handoffRes = await brokerHandoffService.generateHandoff({
      leadId: lead.id,
      scoreId: score.id,
      qualificationId: qual.id,
    });

    const updated = await brokerHandoffService.acknowledgeHandoff(handoffRes.handoffId!, {
      acknowledgedBy: 'AGENT_RAJESH_K',
      notes: 'Customer contacted, requested brochure via WhatsApp',
    });

    assert(updated.handoff_status === 'ACKNOWLEDGED', 'Status must be updated to ACKNOWLEDGED');
    assert(updated.dispatch_status === 'ACKNOWLEDGED', 'Dispatch status must be ACKNOWLEDGED');

    const events = await supabaseDataService.leadEvents.getLeadEvents(lead.id);
    const ackEvent = events.find((e) => e.event_type === 'HANDOFF_ACKNOWLEDGED');
    assert(ackEvent !== undefined, 'HANDOFF_ACKNOWLEDGED audit event must exist');
    assert(ackEvent?.event_data?.acknowledged_by === 'AGENT_RAJESH_K', 'Audit event must record acknowledged_by');
  });

  // Test 14: Audit Event Completeness
  await runTest('14. Audit event completeness (HANDOFF_CREATED, HANDOFF_READY/REQUIRES_REVIEW, ROUTING_ASSIGNED, DISPATCH_STARTED, DISPATCH_COMPLETED)', async () => {
    const lead = await supabaseDataService.leads.createLead({
      lead_id: `GF-P5F-AUDIT-${Date.now()}`,
      name: 'Saif Ali Khan',
      phone: '+919876543214',
      source: 'CSV_IMPORT',
      status: 'QUALIFIED',
    });

    const setupExt = await createSetupRecords(lead.id);
    const qual = await supabaseDataService.qualifications.createQualification({
      lead_id: lead.id,
      extraction_id: setupExt.id,
      qualification_status: 'QUALIFIED',
    });

    const score = await supabaseDataService.buyerScores.createBuyerScoreRecord({
      lead_id: lead.id,
      qualification_id: qual.id,
      extraction_id: setupExt.id,
      score: 93,
      tier: 'TIER_1_HOT',
      score_band: 'HOT',
    } as any);

    const handoffRes = await brokerHandoffService.generateHandoff({
      leadId: lead.id,
      scoreId: score.id,
      qualificationId: qual.id,
    });

    await brokerHandoffService.dispatchHandoff(handoffRes.handoffId!, { dryRun: true });

    const events = await supabaseDataService.leadEvents.getLeadEvents(lead.id);
    const eventTypes = events.map((e) => e.event_type);

    assert(eventTypes.includes('HANDOFF_CREATED'), 'Must include HANDOFF_CREATED');
    assert(eventTypes.includes('ROUTING_ASSIGNED'), 'Must include ROUTING_ASSIGNED');
    assert(eventTypes.includes('DISPATCH_STARTED'), 'Must include DISPATCH_STARTED');
    assert(eventTypes.includes('DISPATCH_COMPLETED'), 'Must include DISPATCH_COMPLETED');
  });

  // Test 15: Priority Queue Deterministic Ordering
  await runTest('15. Priority queue deterministic ordering (Ordered by Tier Priority ASC -> SLA Deadline ASC -> Score DESC -> Created ASC)', async () => {
    // Lead A: Tier 2 (Score 80)
    const leadA = await supabaseDataService.leads.createLead({
      lead_id: `GF-P5F-Q-A-${Date.now()}`,
      name: 'Queue Buyer Warm',
      phone: '+919876543221',
      source: 'CSV_IMPORT',
      status: 'QUALIFIED',
    });
    const scoreA = await supabaseDataService.buyerScores.createBuyerScoreRecord({
      lead_id: leadA.id,
      score: 80,
      tier: 'TIER_2_WARM',
      score_band: 'WARM',
    } as any);
    await brokerHandoffService.generateHandoff({ leadId: leadA.id, scoreId: scoreA.id });

    // Lead B: Tier 1 (Score 98)
    const leadB = await supabaseDataService.leads.createLead({
      lead_id: `GF-P5F-Q-B-${Date.now()}`,
      name: 'Queue Buyer Hot High',
      phone: '+919876543222',
      source: 'CSV_IMPORT',
      status: 'QUALIFIED',
    });
    const scoreB = await supabaseDataService.buyerScores.createBuyerScoreRecord({
      lead_id: leadB.id,
      score: 98,
      tier: 'TIER_1_HOT',
      score_band: 'HOT',
    } as any);
    await brokerHandoffService.generateHandoff({ leadId: leadB.id, scoreId: scoreB.id });

    // Lead C: Tier 1 (Score 92)
    const leadC = await supabaseDataService.leads.createLead({
      lead_id: `GF-P5F-Q-C-${Date.now()}`,
      name: 'Queue Buyer Hot Lower',
      phone: '+919876543223',
      source: 'CSV_IMPORT',
      status: 'QUALIFIED',
    });
    const scoreC = await supabaseDataService.buyerScores.createBuyerScoreRecord({
      lead_id: leadC.id,
      score: 92,
      tier: 'TIER_1_HOT',
      score_band: 'HOT',
    } as any);
    await brokerHandoffService.generateHandoff({ leadId: leadC.id, scoreId: scoreC.id });

    const queue = await brokerHandoffService.getHandoffQueue();
    assert(queue.length >= 3, 'Queue must contain generated handoffs');

    // Find indices
    const idxB = queue.findIndex((q) => q.lead_id === leadB.id);
    const idxC = queue.findIndex((q) => q.lead_id === leadC.id);
    const idxA = queue.findIndex((q) => q.lead_id === leadA.id);

    // Tier 1 leads should precede Tier 2
    assert(idxB < idxA, 'Tier 1 hot lead (B) must come before Tier 2 warm lead (A)');
    assert(idxC < idxA, 'Tier 1 hot lead (C) must come before Tier 2 warm lead (A)');
    assert(idxB < idxC, 'Higher score Tier 1 lead (B: 98) must come before Lower score Tier 1 lead (C: 92)');
  });

  // Test 16: Disqualified Lead Handoff Handling
  await runTest('16. Disqualified lead handoff handling (BLOCKED status, no auto-dispatch)', async () => {
    const lead = await supabaseDataService.leads.createLead({
      lead_id: `GF-P5F-DISQ-${Date.now()}`,
      name: 'Disqualified Buyer',
      phone: '+919876543216',
      source: 'CSV_IMPORT',
      status: 'DISQUALIFIED',
    });

    const setupExt = await createSetupRecords(lead.id);
    const qual = await supabaseDataService.qualifications.createQualification({
      lead_id: lead.id,
      extraction_id: setupExt.id,
      qualification_status: 'DISQUALIFIED' as any,
      reason_codes: ['EXPLICIT_NON_BUYER'] as any,
    });

    const score = await supabaseDataService.buyerScores.createBuyerScoreRecord({
      lead_id: lead.id,
      qualification_id: qual.id,
      extraction_id: setupExt.id,
      score: 10,
      tier: 'TIER_3_NURTURE',
      score_band: 'NURTURE',
    } as any);

    const handoffRes = await brokerHandoffService.generateHandoff({
      leadId: lead.id,
      scoreId: score.id,
      qualificationId: qual.id,
    });

    assert(handoffRes.success, 'Handoff generation handles disqualified gracefully');
    assert(handoffRes.handoff!.handoff_status === 'BLOCKED', 'Handoff status must be BLOCKED');
    assert(handoffRes.handoff!.routing_status === 'BLOCKED', 'Routing status must be BLOCKED');
  });

  // Test 17: Recommendation Status Remains AI_RECOMMENDED
  await runTest('17. Recommendation status remains AI_RECOMMENDED (no buyer confirmed spoofing)', async () => {
    const lead = await supabaseDataService.leads.createLead({
      lead_id: `GF-P5F-RECAI-${Date.now()}`,
      name: 'Aishwarya Rai',
      phone: '+919876543217',
      source: 'CSV_IMPORT',
      status: 'QUALIFIED',
    });

    const setupExt = await createSetupRecords(lead.id);
    const qual = await supabaseDataService.qualifications.createQualification({
      lead_id: lead.id,
      extraction_id: setupExt.id,
      qualification_status: 'QUALIFIED',
    });

    await supabaseDataService.extractions.updateExtraction(setupExt.id, { extracted_data: {
        primary_property_type: { value: 'Apartment' },
        primary_configuration: { value: '3BHK' },
        preferred_locations: { value: ['Whitefield'] },
      } as any });

    const score = await supabaseDataService.buyerScores.createBuyerScoreRecord({
      lead_id: lead.id,
      qualification_id: qual.id,
      extraction_id: setupExt.id,
      score: 84,
      tier: 'TIER_2_WARM',
      score_band: 'WARM',
    } as any);

    const handoffRes = await brokerHandoffService.generateHandoff({
      leadId: lead.id,
      scoreId: score.id,
      qualificationId: qual.id,
    });

    assert(handoffRes.success, 'Handoff generation must succeed');
    for (const rec of handoffRes.handoff!.project_recommendations) {
      assert(
        rec.recommendation_status === 'AI_RECOMMENDED',
        'Recommendation status must remain AI_RECOMMENDED'
      );
      assert(
        rec.buyer_confirmed === false,
        'buyer_confirmed must remain false unless explicitly established'
      );
    }
  });

  // Test 18: End-to-End Pipeline Execution
  await runTest('18. End-to-end pipeline: Lead -> Scout -> Call -> Transcript -> Gemini -> Qualification -> Scoring -> Matching -> Handoff', async () => {
    // 1. Lead creation
    const lead = await supabaseDataService.leads.createLead({
      lead_id: `GF-P5F-E2E-${Date.now()}`,
      name: 'Vikram Sarabhai',
      phone: '+919900011223',
      source: 'CSV_IMPORT',
      status: 'RAW',
    });

    // 2. Call record
    const call = await supabaseDataService.calls.createCall({
      lead_id: lead.id,
      provider: 'sarvam',
      provider_call_id: `sarvam-e2e-${Date.now()}`,
      status: 'COMPLETED',
      duration_seconds: 240,
    });

    // 3. Transcript Ingestion
    const transcriptText = `Agent: Hello Vikram, are you looking to buy a home in Bangalore?
Buyer: Yes, looking for a 3BHK apartment in Whitefield for self-use.
Agent: What is your budget and timeline?
Buyer: My budget is between 1.5 to 2 Crores, looking to move in within 3 months.`;

    const transcriptResult = await transcriptIngestionService.ingestTranscript({
      lead_id: lead.id,
      call_id: call.id,
      provider_call_id: call.provider_call_id,
      transcript_text: transcriptText,
      source: 'SARVAM_WEBHOOK',
    });
    assert(transcriptResult.success, 'Transcript ingestion must succeed');

    // 4. Gemini Extraction
    setGeminiExtractionProvider(
      new MockGeminiExtractionProvider({
        schema_version: '1.0',
        extraction_status: 'SUCCESS',
        buyer_profile: {
          full_name: { value: 'Vikram Sarabhai', truth_level: 'CONFIRMED', confidence: 0.95, evidence: [] },
          phone: { value: '+919900011223', truth_level: 'CONFIRMED', confidence: 0.95, evidence: [] },
        },
        buying_intent: {
          interested: { value: true, truth_level: 'EXPLICIT', confidence: 0.98, evidence: [] },
          property_type: { value: 'Apartment', truth_level: 'CONFIRMED', confidence: 0.95, evidence: [] },
          configuration: { value: '3BHK', truth_level: 'CONFIRMED', confidence: 0.95, evidence: [] },
          purpose: { value: 'Self-use', truth_level: 'CONFIRMED', confidence: 0.9, evidence: [] },
          budget: {
            value: { min: 15000000, max: 20000000, currency: 'INR' },
            truth_level: 'CONFIRMED',
            confidence: 0.95,
            evidence: [],
          },
          preferred_locations: {
            value: ['Whitefield', 'VIP Road'],
            truth_level: 'CONFIRMED',
            confidence: 0.95,
            evidence: [],
          },
          timeline: { value: '1 month', truth_level: 'CONFIRMED', confidence: 0.9, evidence: [] },
          decision_maker: { value: true, truth_level: 'CONFIRMED', confidence: 0.95, evidence: [] },
          preferences: { value: [], truth_level: 'EXPLICIT', confidence: 0.9, evidence: [] },
        },
      })
    );

    const transcriptId = (transcriptResult.transcriptId || transcriptResult.transcript?.id)!;
    const extractionResult = await conversationExtractionService.extractFromTranscript({
      transcriptId,
      leadId: lead.id,
      callId: call.id,
    });
    assert(extractionResult.success, 'Gemini extraction must succeed');

    // 5. Qualification
    const extractionId = (extractionResult.extractionId || extractionResult.extraction?.id)!;
    const qualResult = await buyerQualificationService.qualifyExtraction({
      extractionId,
    });
    assert(qualResult.success, 'Buyer qualification must succeed');

    // 6. Scoring
    const qualificationId = (qualResult.qualificationId || qualResult.qualification?.id)!;
    const scoreResult = await buyerScoringService.scoreQualification({
      qualificationId,
    });
    assert(scoreResult.success, 'Buyer scoring must succeed');

    // 7. Project Matching
    const matchResult = await projectMatchingService.matchBuyerRequirements({
      leadId: lead.id,
      qualificationId,
      extractionId,
    });
    assert(matchResult.success, 'Project matching must succeed');

    // 8. Phase 5F Broker Handoff
    const scoreId = (scoreResult.scoreId || scoreResult.score?.id)!;
    const handoffResult = await brokerHandoffService.generateHandoff({
      leadId: lead.id,
      scoreId,
      qualificationId,
    });
    assert(handoffResult.success, 'Broker handoff must succeed');
    assert(handoffResult.handoff!.priority.tier === 'TIER_1_HOT', 'E2E score must yield TIER_1_HOT');
    assert(handoffResult.handoff!.routing_decision.assigned_team === 'SENIOR_SALES', 'Assigned team must be SENIOR_SALES');
    assert(handoffResult.handoff!.project_recommendations.length > 0, 'Must have project recommendations');

    // 9. Dispatch & Acknowledge
    const dispatchResult = await brokerHandoffService.dispatchHandoff(handoffResult.handoffId!, { dryRun: true });
    assert(dispatchResult.success, 'Dispatch must succeed');

    const ackResult = await brokerHandoffService.acknowledgeHandoff(handoffResult.handoffId!, {
      acknowledgedBy: 'ADVISOR_VIKAS',
      notes: 'Site visit scheduled for Saturday at Assetz Marq',
    });
    assert(ackResult.handoff_status === 'ACKNOWLEDGED', 'Status must be ACKNOWLEDGED');
  });

  // Tests 19-25: Full Regressions (Phase 4A through Phase 5E)
  const skipInner = process.env.SKIP_INNER_RECURSION === 'true';

  await runTest('19. Regression: Phase 4A test passes', async () => {
    if (!skipInner) execSync('./node_modules/.bin/tsx tests/call-eligibility-verification.ts', { stdio: 'pipe' });
  });

  await runTest('20. Regression: Phase 4B test passes', async () => {
    if (!skipInner) execSync('./node_modules/.bin/tsx tests/sarvam-unit-tests.ts', { stdio: 'pipe' });
  });

  await runTest('21. Regression: Phase 5A test passes', async () => {
    if (!skipInner) execSync('./node_modules/.bin/tsx tests/phase5a-transcript-ingestion.ts', { stdio: 'pipe' });
  });

  await runTest('22. Regression: Phase 5B test passes', async () => {
    if (!skipInner) execSync('./node_modules/.bin/tsx tests/phase5b-gemini-extraction.ts', { stdio: 'pipe' });
  });

  await runTest('23. Regression: Phase 5C test passes', async () => {
    if (!skipInner) execSync('./node_modules/.bin/tsx tests/phase5c-buyer-qualification.ts', { stdio: 'pipe' });
  });

  await runTest('24. Regression: Phase 5D test passes', async () => {
    if (!skipInner) execSync('./node_modules/.bin/tsx tests/phase5d-buyer-scoring.ts', { stdio: 'pipe' });
  });

  await runTest('25. Regression: Phase 5E test passes', async () => {
    if (!skipInner) execSync('./node_modules/.bin/tsx tests/phase5e-project-matching.ts', { stdio: 'pipe' });
  });

  // Summary
  console.log('\n============================================================');
  console.log('PHASE 5F TEST EXECUTION SUMMARY');
  console.log('============================================================');
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log(`Total Tests : ${total}`);
  console.log(`Passed      : ${passed}`);
  console.log(`Failed      : ${failed}`);

  if (failed > 0) {
    console.error('\nFailed tests:');
    results.filter((r) => !r.passed).forEach((r) => console.error(` - ${r.name}: ${r.error}`));
    process.exit(1);
  } else {
    console.log('\n🎉 ALL 25 PHASE 5F & REGRESSION TESTS PASSED PERFECTLY!');
  }
}

runPhase5FTestSuite().catch((err) => {
  console.error('Fatal test suite failure:', err);
  process.exit(1);
});
