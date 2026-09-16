/**
 * GrowthForge Buyer Intelligence Engine - Phase 8B.6.1 Test Suite
 *
 * BuyerPipelineCoordinator Verification:
 * 1. Happy Path: Transcript Ingestion -> Extraction -> Qualification -> Scoring -> Matching -> Handoff
 * 2. Idempotent Re-run: Verify identical run does not create duplicate DB artifacts and returns EXISTING status
 * 3. Extraction Failure: Simulates extraction failure, verifies upstream transcript intact, downstream stages skipped
 * 4. Qualification Failure: Simulates qualification failure, verifies downstream scoring/matching/handoff skipped
 * 5. Matching Failure: Simulates matching failure, verifies handoff skipped
 * 6. Tenant Isolation: Verifies tenant B cannot process tenant A's lead through coordinator
 * 7. Provenance Preservation: Confirmed buyer stated preferences vs Inferred Scout/public intelligence
 * 8. AI Recommendation Boundary: Recommendations remain buyer_confirmed: false and AI_RECOMMENDED
 * 9. Validation Gate: Non-existent or empty transcript halts before extraction
 * 10. Audit Event Completeness: Verifies PIPELINE_STARTED, PIPELINE_COMPLETED, PIPELINE_FAILED events
 */

import { supabaseDataService } from '../app/services/supabase/repositories';
import {
  BuyerPipelineCoordinator,
  buyerPipelineCoordinator,
} from '../app/services/pipeline/buyerPipelineCoordinator';
import { transcriptIngestionService } from '../app/services/voice/transcriptIngestionService';
import {
  MockGeminiExtractionProvider,
  setGeminiExtractionProvider,
  GeminiExtractionProvider,
  ExtractionProviderInput,
  ExtractionProviderOutput,
} from '../app/services/gemini/geminiExtractionProvider';
import { BuyerQualificationService } from '../app/services/qualification/buyerQualificationService';
import { ProjectMatchingService } from '../app/services/matching/projectMatchingService';
import { generateUUID } from '../app/services/security/correlationContext';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: unknown;
}

const results: TestResult[] = [];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  process.stdout.write(`Testing: ${name}... `);
  try {
    await fn();
    console.log('\x1b[32mPASSED\x1b[0m');
    results.push({ name, passed: true });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.log(`\x1b[31mFAILED: ${errMsg}\x1b[0m`);
    results.push({ name, passed: false, error: errMsg });
  }
}

// -----------------------------------------------------------------------------
// Test Helpers
// -----------------------------------------------------------------------------

async function createLeadAndCall(options?: { tenantId?: string; leadIdPrefix?: string }) {
  const timestamp = Date.now();
  const randomSuffix = Math.floor(Math.random() * 10000);
  const tenantId = options?.tenantId;

  const lead = await supabaseDataService.leads.createLead(
    tenantId ? { tenantId } : {},
    {
      lead_id: `${options?.leadIdPrefix || 'GF-P8B6'}-${timestamp}-${randomSuffix}`,
      name: 'Ananya Deshmukh',
      phone: `+919876${Math.floor(100000 + Math.random() * 900000)}`,
      source: 'CSV_IMPORT',
      status: 'RAW',
      tenant_id: tenantId || null,
    }
  );

  const call = await supabaseDataService.calls.createCall(
    tenantId ? { tenantId } : {},
    {
      lead_id: lead.id,
      provider: 'sarvam',
      provider_call_id: `sarvam-call-${timestamp}-${randomSuffix}`,
      status: 'COMPLETED',
      duration_seconds: 210,
      tenant_id: tenantId || null,
    }
  );

  return { lead, call };
}

// -----------------------------------------------------------------------------
// Test Execution
// -----------------------------------------------------------------------------

async function main() {
  console.log('=== GrowthForge Phase 8B.6.1 Buyer Pipeline Coordinator Tests ===\n');

  // Enforce mock provider for deterministic test execution
  setGeminiExtractionProvider(new MockGeminiExtractionProvider());

  // Test 1: Happy Path Full Pipeline Execution
  await runTest('1. Happy Path: Transcript -> Extraction -> Qualification -> Scoring -> Matching -> Handoff', async () => {
    const { lead, call } = await createLeadAndCall({ leadIdPrefix: 'GF-P8B6-HP' });

    const transcriptText = `Agent: Namaste Ananya ji, are you looking for residential property in Bangalore?
Buyer: Yes, I am actively looking for a 3 BHK luxury apartment in Whitefield for my family to move into.
Agent: Great! What is your planned budget and possession timeline?
Buyer: Our budget is between 1.5 to 2 Crores. We want ready-to-move-in within 1 month.
Agent: Are you the primary decision maker?
Buyer: Yes, my husband and I are finalizing it together this month.`;

    const transcriptResult = await transcriptIngestionService.ingestTranscript({
      lead_id: lead.id,
      call_id: call.id,
      provider_call_id: call.provider_call_id,
      transcript_text: transcriptText,
      source: 'SARVAM_WEBHOOK',
    });

    assert(transcriptResult.success, 'Transcript ingestion must succeed');
    const transcriptId = transcriptResult.transcriptId!;

    // Custom deterministic provider for full pipeline test matching phase5f fixture
    const mockProvider = new MockGeminiExtractionProvider({
      schema_version: '1.0',
      extraction_status: 'SUCCESS',
      buyer_profile: {
        full_name: { value: 'Ananya Deshmukh', truth_level: 'CONFIRMED', confidence: 0.95, evidence: [] },
        phone: { value: lead.phone, truth_level: 'CONFIRMED', confidence: 0.95, evidence: [] },
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
    });

    const coordinator = new BuyerPipelineCoordinator({
      geminiProviderOverride: mockProvider,
    });

    const result = await coordinator.runPipeline({
      leadId: lead.id,
      callId: call.id,
      transcriptId,
    });

    assert(result.success, `Pipeline must succeed: ${result.error}`);
    assert(result.action === 'PIPELINE_COMPLETED', `Action must be PIPELINE_COMPLETED, got ${result.action}`);
    assert(result.current_stage === 'DISPATCH', `Current stage must be DISPATCH, got ${result.current_stage}`);

    // Verify all stage records
    assert(result.stages.VALIDATION.status === 'SUCCESS', 'Stage VALIDATION must succeed');
    assert(result.stages.EXTRACTION.status === 'SUCCESS', 'Stage EXTRACTION must succeed');
    assert(result.stages.QUALIFICATION.status === 'SUCCESS', 'Stage QUALIFICATION must succeed');
    assert(result.stages.SCORING.status === 'SUCCESS', 'Stage SCORING must succeed');
    assert(result.stages.MATCHING.status === 'SUCCESS', 'Stage MATCHING must succeed');
    assert(result.stages.HANDOFF.status === 'SUCCESS', 'Stage HANDOFF must succeed');

    // Verify artifacts
    assert(Boolean(result.extraction_id), 'Extraction ID must be present');
    assert(Boolean(result.qualification_id), 'Qualification ID must be present');
    assert(Boolean(result.score_id), 'Score ID must be present');
    assert(Boolean(result.handoff_id), 'Handoff ID must be present');
    assert(result.qualification?.qualification_status === 'QUALIFIED', 'Qualification status must be QUALIFIED');
    assert(
      result.score?.tier === 'TIER_1_HOT' || result.score?.tier === 'TIER_2_WARM',
      `Score tier must be valid, got ${result.score?.tier}`
    );
    assert(Boolean(result.handoff?.priority.tier), 'Handoff priority tier must be defined');

    // Verify audit events
    const events = await supabaseDataService.leadEvents.getLeadEvents(lead.id);
    const eventTypes = events.map((e) => e.event_type);
    assert(eventTypes.includes('PIPELINE_STARTED'), 'Must log PIPELINE_STARTED audit event');
    assert(eventTypes.includes('PIPELINE_COMPLETED'), 'Must log PIPELINE_COMPLETED audit event');

    // Verify lead status transition
    const updatedLead = await supabaseDataService.leads.getLead(lead.id);
    assert(updatedLead?.status === 'HANDOFF', `Lead status should transition to HANDOFF, got ${updatedLead?.status}`);
  });

  // Test 2: Idempotent Re-Run
  await runTest('2. Idempotent Re-run: Second run preserves existing artifacts and produces no duplicates', async () => {
    const { lead, call } = await createLeadAndCall({ leadIdPrefix: 'GF-P8B6-IDEMP' });

    const transcriptResult = await transcriptIngestionService.ingestTranscript({
      lead_id: lead.id,
      call_id: call.id,
      provider_call_id: call.provider_call_id,
      transcript_text: 'Buyer: Need 3BHK in Whitefield for 2 Crores ready to move.',
      source: 'SARVAM_WEBHOOK',
    });

    const mockProvider = new MockGeminiExtractionProvider();
    const coordinator = new BuyerPipelineCoordinator({ geminiProviderOverride: mockProvider });

    // Run 1
    const run1 = await coordinator.runPipeline({
      leadId: lead.id,
      callId: call.id,
      transcriptId: transcriptResult.transcriptId,
    });
    assert(run1.success, 'First run must succeed');

    // Run 2 (without forceRerun)
    const run2 = await coordinator.runPipeline({
      leadId: lead.id,
      callId: call.id,
      transcriptId: transcriptResult.transcriptId,
    });

    assert(run2.success, 'Second run must succeed');
    assert(run2.action === 'PIPELINE_EXISTING', `Action should be PIPELINE_EXISTING, got ${run2.action}`);
    assert(run2.extraction_id === run1.extraction_id, 'Extraction ID must be identical');
    assert(run2.qualification_id === run1.qualification_id, 'Qualification ID must be identical');
    assert(run2.score_id === run1.score_id, 'Score ID must be identical');
    assert(run2.handoff_id === run1.handoff_id, 'Handoff ID must be identical');

    assert(run2.stages.EXTRACTION.status === 'EXISTING', 'Extraction stage should report EXISTING');
    assert(run2.stages.QUALIFICATION.status === 'EXISTING', 'Qualification stage should report EXISTING');
    assert(run2.stages.SCORING.status === 'EXISTING', 'Scoring stage should report EXISTING');
    assert(run2.stages.MATCHING.status === 'EXISTING', 'Matching stage should report EXISTING');
    assert(run2.stages.HANDOFF.status === 'EXISTING', 'Handoff stage should report EXISTING');

    // Verify DB count: only 1 handoff record exists for this lead
    const allHandoffs = await supabaseDataService.brokerHandoffs.getHandoffsByLeadId(lead.id);
    assert(allHandoffs.length === 1, `Expected exactly 1 handoff record, found ${allHandoffs.length}`);
  });

  // Test 3: Extraction Failure
  await runTest('3. Extraction Failure: Halts downstream execution, preserves transcript, records failure', async () => {
    const { lead, call } = await createLeadAndCall({ leadIdPrefix: 'GF-P8B6-EXTFAIL' });

    const transcriptResult = await transcriptIngestionService.ingestTranscript({
      lead_id: lead.id,
      call_id: call.id,
      provider_call_id: call.provider_call_id,
      transcript_text: 'Buyer: Hello? Can you hear me? Connection is very bad...',
      source: 'SARVAM_WEBHOOK',
    });

    // Create a provider that throws an extraction error
    class FailingGeminiProvider implements GeminiExtractionProvider {
      public readonly providerName = 'FailingGeminiProvider';
      async extractBuyerIntelligence(_input: ExtractionProviderInput): Promise<ExtractionProviderOutput> {
        throw new Error('Gemini API quota exceeded: 429 RESOURCE_EXHAUSTED');
      }
    }

    const coordinator = new BuyerPipelineCoordinator({
      geminiProviderOverride: new FailingGeminiProvider(),
    });

    const result = await coordinator.runPipeline({
      leadId: lead.id,
      callId: call.id,
      transcriptId: transcriptResult.transcriptId,
    });

    assert(!result.success, 'Pipeline must fail when extraction fails');
    assert(result.current_stage === 'EXTRACTION', `Failed stage must be EXTRACTION, got ${result.current_stage}`);
    assert(result.stages.VALIDATION.status === 'SUCCESS', 'Validation must have succeeded');
    assert(result.stages.EXTRACTION.status === 'FAILED', 'Extraction must be marked FAILED');
    assert(result.stages.QUALIFICATION.status === 'SKIPPED', 'Qualification must be SKIPPED');
    assert(result.stages.SCORING.status === 'SKIPPED', 'Scoring must be SKIPPED');
    assert(result.stages.MATCHING.status === 'SKIPPED', 'Matching must be SKIPPED');
    assert(result.stages.HANDOFF.status === 'SKIPPED', 'Handoff must be SKIPPED');

    assert(!result.qualification_id, 'No qualification ID should be returned');
    assert(!result.score_id, 'No score ID should be returned');
    assert(!result.handoff_id, 'No handoff ID should be returned');

    // Upstream transcript remains intact
    const transcriptInDb = await supabaseDataService.transcripts.getTranscript(transcriptResult.transcriptId!);
    assert(Boolean(transcriptInDb), 'Upstream transcript must remain intact in database');

    // Verify PIPELINE_FAILED event
    const events = await supabaseDataService.leadEvents.getLeadEvents(lead.id);
    const failedEvent = events.find((e) => e.event_type === 'PIPELINE_FAILED');
    assert(Boolean(failedEvent), 'Must log PIPELINE_FAILED audit event');
    assert(
      (failedEvent?.event_data as Record<string, unknown>)?.failed_stage === 'EXTRACTION',
      'PIPELINE_FAILED event must identify EXTRACTION as failed stage'
    );
  });

  // Test 4: Qualification Failure
  await runTest('4. Qualification Failure: Halts downstream scoring, matching, and handoff', async () => {
    const { lead, call } = await createLeadAndCall({ leadIdPrefix: 'GF-P8B6-QUALFAIL' });

    const transcriptResult = await transcriptIngestionService.ingestTranscript({
      lead_id: lead.id,
      call_id: call.id,
      provider_call_id: call.provider_call_id,
      transcript_text: 'Buyer: Looking for 2 BHK in Indiranagar.',
      source: 'SARVAM_WEBHOOK',
    });

    // Mock qualification service that fails
    const mockFailingQualService = {
      qualifyExtraction: async () => ({
        success: false,
        action: 'QUALIFICATION_ERROR' as const,
        qualificationId: null,
        qualification: null,
        error: 'Database constraint violation during qualification',
      }),
    } as unknown as BuyerQualificationService;

    const coordinator = new BuyerPipelineCoordinator({
      qualificationService: mockFailingQualService,
      geminiProviderOverride: new MockGeminiExtractionProvider(),
    });

    const result = await coordinator.runPipeline({
      leadId: lead.id,
      callId: call.id,
      transcriptId: transcriptResult.transcriptId,
    });

    assert(!result.success, 'Pipeline must fail when qualification fails');
    assert(result.current_stage === 'QUALIFICATION', `Current stage must be QUALIFICATION, got ${result.current_stage}`);
    assert(result.stages.EXTRACTION.status === 'SUCCESS', 'Extraction must have succeeded');
    assert(result.stages.QUALIFICATION.status === 'FAILED', 'Qualification must be marked FAILED');
    assert(result.stages.SCORING.status === 'SKIPPED', 'Scoring must be SKIPPED');
    assert(result.stages.MATCHING.status === 'SKIPPED', 'Matching must be SKIPPED');
    assert(result.stages.HANDOFF.status === 'SKIPPED', 'Handoff must be SKIPPED');
    assert(!result.score_id, 'Score ID must be null');
    assert(!result.handoff_id, 'Handoff ID must be null');
  });

  // Test 5: Matching Failure
  await runTest('5. Matching Failure: Halts handoff generation', async () => {
    const { lead, call } = await createLeadAndCall({ leadIdPrefix: 'GF-P8B6-MATCHFAIL' });

    const transcriptResult = await transcriptIngestionService.ingestTranscript({
      lead_id: lead.id,
      call_id: call.id,
      provider_call_id: call.provider_call_id,
      transcript_text: 'Buyer: Looking for 3 BHK in Whitefield for 2 Crores.',
      source: 'SARVAM_WEBHOOK',
    });

    // Mock matching service that returns a failure
    const mockFailingMatchService = {
      matchBuyerRequirements: async () => ({
        success: false,
        action: 'MATCHING_ERROR',
        lead_id: lead.id,
        total_recommendations: 0,
        recommendations: [],
        matching_version: '1.0',
        rule_version: '1.0',
        catalog_version: '1.0',
        calculated_at: new Date().toISOString(),
        error: 'Inventory catalog connection timeout',
      }),
    } as unknown as ProjectMatchingService;

    const coordinator = new BuyerPipelineCoordinator({
      matchingService: mockFailingMatchService,
      geminiProviderOverride: new MockGeminiExtractionProvider(),
    });

    const result = await coordinator.runPipeline({
      leadId: lead.id,
      callId: call.id,
      transcriptId: transcriptResult.transcriptId,
    });

    assert(!result.success, 'Pipeline must fail when matching fails');
    assert(result.current_stage === 'MATCHING', `Current stage must be MATCHING, got ${result.current_stage}`);
    assert(result.stages.QUALIFICATION.status === 'SUCCESS', 'Qualification must succeed');
    assert(result.stages.SCORING.status === 'SUCCESS', 'Scoring must succeed');
    assert(result.stages.MATCHING.status === 'FAILED', 'Matching must be marked FAILED');
    assert(result.stages.HANDOFF.status === 'SKIPPED', 'Handoff must be SKIPPED');
    assert(!result.handoff_id, 'Handoff must not be falsely generated');
  });

  // Test 6: Tenant Isolation
  await runTest('6. Tenant Isolation: Rejects cross-tenant execution with TENANT_ISOLATION_VIOLATION', async () => {
    const tenantA = '11111111-1111-1111-1111-111111111111';
    const tenantB = '22222222-2222-2222-2222-222222222222';

    // Create lead belonging to Tenant A
    const { lead, call } = await createLeadAndCall({
      tenantId: tenantA,
      leadIdPrefix: 'GF-P8B6-TISO',
    });

    const transcriptResult = await transcriptIngestionService.ingestTranscript({
      lead_id: lead.id,
      call_id: call.id,
      provider_call_id: call.provider_call_id,
      transcript_text: 'Buyer: Hello, I am calling from Tenant A organization.',
      source: 'SARVAM_WEBHOOK',
    });

    const coordinator = new BuyerPipelineCoordinator({
      geminiProviderOverride: new MockGeminiExtractionProvider(),
    });

    // Attempt to invoke coordinator as Tenant B
    const crossTenantResult = await coordinator.runPipeline({
      leadId: lead.id,
      callId: call.id,
      transcriptId: transcriptResult.transcriptId,
      tenantId: tenantB,
    });

    assert(!crossTenantResult.success, 'Cross-tenant execution must be rejected');
    assert(
      crossTenantResult.action === 'TENANT_ISOLATION_VIOLATION',
      `Expected TENANT_ISOLATION_VIOLATION, got ${crossTenantResult.action}`
    );
    assert(
      crossTenantResult.current_stage === 'VALIDATION',
      `Current stage must halt at VALIDATION, got ${crossTenantResult.current_stage}`
    );
    assert(
      crossTenantResult.stages.EXTRACTION.status === 'SKIPPED',
      'No downstream extraction should be attempted'
    );
  });

  // Test 7: Provenance Preservation
  await runTest('7. Provenance Preservation: Buyer stated preferences retain CONFIRMED; Scout remains INFERRED', async () => {
    const { lead, call } = await createLeadAndCall({ leadIdPrefix: 'GF-P8B6-PROV' });

    // Seed Scout enrichment with INFERRED intelligence in official lead_enrichment table
    await supabaseDataService.leadEnrichment.createEnrichment({
      lead_id: lead.id,
      platform: 'SCOUT_REGISTRY',
      username: null,
      profile_url: null,
      full_name: null,
      bio: null,
      website: null,
      company: null,
      location: null,
      raw_data: null,
      source_confidence: 0.9,
      enriched_data: {
        estimated_wealth_band: 'HNI_INFERRED',
        inferred_budget_range: '1.5Cr - 3Cr',
        truth_level: 'INFERRED',
        source: 'PUBLIC_REGISTRY_ANALYSIS',
      },
    });

    const transcriptText = `Agent: Namaste, are you interested in Vrindavan property?
Buyer: Yes, I specifically want 3 BHK residential property in Vrindavan for residence.`;

    const transcriptResult = await transcriptIngestionService.ingestTranscript({
      lead_id: lead.id,
      call_id: call.id,
      provider_call_id: call.provider_call_id,
      transcript_text: transcriptText,
      source: 'SARVAM_WEBHOOK',
    });

    const coordinator = new BuyerPipelineCoordinator({
      geminiProviderOverride: new MockGeminiExtractionProvider(),
    });

    const result = await coordinator.runPipeline({
      leadId: lead.id,
      callId: call.id,
      transcriptId: transcriptResult.transcriptId,
    });

    assert(result.success, 'Pipeline must succeed');

    // Verify buyer stated preferences are CONFIRMED
    const extractedData = result.extraction?.extracted_data;
    assert(extractedData, 'Extracted data must be present');
    assert(
      extractedData.primary_property_type?.truth_level === 'CONFIRMED',
      'Property type truth level must be CONFIRMED from explicit buyer statement'
    );
    assert(
      extractedData.primary_configuration?.truth_level === 'CONFIRMED',
      'Configuration truth level must be CONFIRMED from explicit buyer statement'
    );

    // Verify Scout enrichment remains intact and INFERRED in database
    const scoutEnrichments = await supabaseDataService.leadEnrichment.getEnrichment(lead.id);
    assert(scoutEnrichments.length > 0, 'Scout enrichment must be preserved');
    const scoutData = scoutEnrichments[0].enriched_data as Record<string, unknown>;
    assert(scoutData.truth_level === 'INFERRED', 'Scout enrichment truth level must remain strictly INFERRED');
  });

  // Test 8: AI Recommendation Boundary
  await runTest('8. AI Recommendation Boundary: Recommendations remain buyer_confirmed: false and AI_RECOMMENDED', async () => {
    const { lead, call } = await createLeadAndCall({ leadIdPrefix: 'GF-P8B6-RECBOUND' });

    const transcriptResult = await transcriptIngestionService.ingestTranscript({
      lead_id: lead.id,
      call_id: call.id,
      provider_call_id: call.provider_call_id,
      transcript_text: 'Buyer: Need 3 BHK Apartment in Whitefield, budget 1.8 Crores.',
      source: 'SARVAM_WEBHOOK',
    });

    const coordinator = new BuyerPipelineCoordinator({
      geminiProviderOverride: new MockGeminiExtractionProvider(),
    });

    const result = await coordinator.runPipeline({
      leadId: lead.id,
      callId: call.id,
      transcriptId: transcriptResult.transcriptId,
    });

    assert(result.success, 'Pipeline must succeed');
    const handoff = result.handoff;
    assert(handoff, 'Handoff must be returned');

    // Invariant check on all project recommendations
    for (const rec of handoff.project_recommendations) {
      assert(
        rec.recommendation_status === 'AI_RECOMMENDED',
        `Recommendation status must be AI_RECOMMENDED, got ${rec.recommendation_status}`
      );
      assert(
        rec.buyer_confirmed === false,
        `buyer_confirmed must be strictly false without explicit verified intent flow, got ${rec.buyer_confirmed}`
      );
    }
  });

  // Test 9: Missing or Empty Transcript Validation
  await runTest('9. Validation Gate: Missing or empty transcript halts before extraction', async () => {
    const { lead, call } = await createLeadAndCall({ leadIdPrefix: 'GF-P8B6-NOTRANS' });

    const coordinator = new BuyerPipelineCoordinator({
      geminiProviderOverride: new MockGeminiExtractionProvider(),
    });

    // Call without existing transcript
    const resultMissing = await coordinator.runPipeline({
      leadId: lead.id,
      callId: call.id,
    });

    assert(!resultMissing.success, 'Pipeline must fail when transcript does not exist');
    assert(
      resultMissing.action === 'TRANSCRIPT_NOT_FOUND',
      `Expected TRANSCRIPT_NOT_FOUND, got ${resultMissing.action}`
    );
    assert(resultMissing.current_stage === 'VALIDATION', 'Stage must be VALIDATION');
    assert(resultMissing.stages.EXTRACTION.status === 'SKIPPED', 'Extraction must be SKIPPED');

    // Ingest transcript with empty whitespace text
    const emptyTranscript = await supabaseDataService.transcripts.createTranscript({
      lead_id: lead.id,
      call_id: call.id,
      transcript_text: '     \n\t  ',
      source: 'SARVAM_WEBHOOK',
      ingestion_status: 'COMPLETED',
    });

    const resultEmpty = await coordinator.runPipeline({
      leadId: lead.id,
      callId: call.id,
      transcriptId: emptyTranscript.id,
    });

    assert(!resultEmpty.success, 'Pipeline must fail on empty transcript text');
    assert(
      resultEmpty.action === 'EMPTY_TRANSCRIPT',
      `Expected EMPTY_TRANSCRIPT, got ${resultEmpty.action}`
    );
    assert(resultEmpty.stages.VALIDATION.status === 'FAILED', 'Validation stage must fail');
    assert(resultEmpty.stages.EXTRACTION.status === 'SKIPPED', 'Extraction must be SKIPPED');
  });

  // Test 10: Audit Event Completeness and Correlation Propagation
  await runTest('10. Audit Event Completeness: Verifies correlation_id propagation and full audit event trail', async () => {
    const { lead, call } = await createLeadAndCall({ leadIdPrefix: 'GF-P8B6-AUDIT' });
    const correlationId = `corr-test-${Date.now()}`;

    const transcriptResult = await transcriptIngestionService.ingestTranscript({
      lead_id: lead.id,
      call_id: call.id,
      provider_call_id: call.provider_call_id,
      transcript_text: 'Buyer: Looking for 3 BHK in Whitefield for 2.2 Crores.',
      source: 'SARVAM_WEBHOOK',
    });

    const coordinator = new BuyerPipelineCoordinator({
      geminiProviderOverride: new MockGeminiExtractionProvider(),
    });

    const result = await coordinator.runPipeline({
      leadId: lead.id,
      callId: call.id,
      transcriptId: transcriptResult.transcriptId,
      correlationId,
    });

    assert(result.success, 'Pipeline must succeed');
    assert(result.correlation_id === correlationId, 'Result correlation_id must match input correlationId');

    const events = await supabaseDataService.leadEvents.getLeadEvents(lead.id);
    const startEvent = events.find((e) => e.event_type === 'PIPELINE_STARTED');
    const completeEvent = events.find((e) => e.event_type === 'PIPELINE_COMPLETED');

    assert(Boolean(startEvent), 'PIPELINE_STARTED event must exist');
    assert(Boolean(completeEvent), 'PIPELINE_COMPLETED event must exist');

    assert(
      (startEvent?.event_data as Record<string, unknown>)?.correlation_id === correlationId,
      'PIPELINE_STARTED must record correlation_id'
    );
    assert(
      (completeEvent?.event_data as Record<string, unknown>)?.correlation_id === correlationId,
      'PIPELINE_COMPLETED must record correlation_id'
    );
  });

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('\n=============================================================');
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;
  console.log(`Phase 8B.6.1 Test Suite Results: ${passedCount} Passed, ${failedCount} Failed`);
  console.log('=============================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
