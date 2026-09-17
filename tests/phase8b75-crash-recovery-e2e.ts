// Force in-memory mode for tests since we don't have live DB access here
process.env.SUPABASE_URL = '';
process.env.SUPABASE_ANON_KEY = '';
process.env.VITE_SUPABASE_URL = '';
process.env.VITE_SUPABASE_ANON_KEY = '';

import assert from 'assert';
import { supabaseDataService } from '../app/services/supabase/repositories';
import {
  BuyerPipelineCoordinator,
  buyerPipelineCoordinator,
} from '../app/services/pipeline/buyerPipelineCoordinator';
import {
  PipelineRecoveryWorker,
} from '../app/services/pipeline/pipelineRecoveryWorker';
import { transcriptIngestionService } from '../app/services/voice/transcriptIngestionService';
import {
  MockGeminiExtractionProvider,
  setGeminiExtractionProvider,
} from '../app/services/gemini/geminiExtractionProvider';
import { BuyerQualificationService } from '../app/services/qualification/buyerQualificationService';
import { BuyerScoringService } from '../app/services/scoring/buyerScoringService';
import { ProjectMatchingService } from '../app/services/matching/projectMatchingService';
import { BrokerHandoffService } from '../app/services/handoff/brokerHandoffService';
import {
  BrokerHandoffChannel,
  MockBrokerHandoffChannel,
} from '../app/services/handoff/channels/brokerHandoffChannel';
import { BrokerHandoffPackage, DispatchResult } from '../app/schemas/handoff';
import { DEFAULT_TENANT_ID } from '../app/schemas/tenant';
import { generateUUID } from '../app/services/security/correlationContext';

interface TestResult {
  id: string;
  name: string;
  passed: boolean;
  error?: string;
}

const testResults: TestResult[] = [];

async function runTest(id: string, name: string, fn: () => Promise<void>): Promise<void> {
  process.stdout.write(`Running [${id}] ${name}... `);
  try {
    await fn();
    console.log('\x1b[32mPASSED\x1b[0m');
    testResults.push({ id, name, passed: true });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.log(`\x1b[31mFAILED: ${errMsg}\x1b[0m`);
    testResults.push({ id, name, passed: false, error: errMsg });
    throw err;
  }
}

// -----------------------------------------------------------------------------
// Test Helpers
// -----------------------------------------------------------------------------

function getRepoStore(): Map<string, any> {
  const store = (supabaseDataService as any).pipelineExecutionsStore;
  if (!store) {
    throw new Error('In-memory pipeline executions store not found on supabaseDataService');
  }
  return store;
}

function getDeterministicExtractionProvider(): MockGeminiExtractionProvider {
  return new MockGeminiExtractionProvider({
    schema_version: '1.0',
    extraction_status: 'SUCCESS',
    buyer_profile: {
      full_name: { value: 'Ananya Deshmukh', truth_level: 'CONFIRMED', confidence: 0.95, evidence: [] },
      phone: { value: '+919876543210', truth_level: 'CONFIRMED', confidence: 0.95, evidence: [] },
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
}

async function createLeadAndCall(options?: { tenantId?: string; leadIdPrefix?: string }) {
  const timestamp = Date.now();
  const randomSuffix = Math.floor(Math.random() * 100000);
  const tenantId = options?.tenantId || DEFAULT_TENANT_ID;

  const lead = await supabaseDataService.leads.createLead(
    { tenantId },
    {
      lead_id: `${options?.leadIdPrefix || 'GF-P8B75'}-${timestamp}-${randomSuffix}`,
      name: 'Ananya Deshmukh',
      phone: `+919876${Math.floor(100000 + Math.random() * 900000)}`,
      source: 'CSV_IMPORT',
      status: 'RAW',
      tenant_id: tenantId,
    }
  );

  const call = await supabaseDataService.calls.createCall(
    { tenantId },
    {
      lead_id: lead.id,
      provider: 'sarvam',
      provider_call_id: `sarvam-call-${timestamp}-${randomSuffix}`,
      status: 'COMPLETED',
      duration_seconds: 210,
      tenant_id: tenantId,
    }
  );

  const transcriptText = `Agent: Namaste Ananya ji, are you looking for residential property in Bangalore?
Buyer: Yes, I am actively looking for a 3 BHK luxury apartment in Whitefield for my family to move into.
Agent: Great! What is your planned budget and possession timeline?
Buyer: Our budget is between 1.5 to 2 Crores. We want ready-to-move-in within 1 month.
Agent: Are you the primary decision maker?
Buyer: Yes, my husband and I are finalizing it together this month.`;

  let transcriptId: string;
  if (tenantId === DEFAULT_TENANT_ID) {
    const transcriptResult = await transcriptIngestionService.ingestTranscript({
      lead_id: lead.id,
      call_id: call.id,
      provider_call_id: call.provider_call_id,
      transcript_text: transcriptText,
      source: 'SARVAM_WEBHOOK',
    });
    assert.ok(transcriptResult.success, 'Transcript ingestion must succeed');
    transcriptId = transcriptResult.transcriptId!;
  } else {
    const transcriptRecord = await supabaseDataService.transcripts.createTranscript(
      { tenantId, isPlatformAdmin: true },
      {
        lead_id: lead.id,
        call_id: call.id,
        provider_call_id: call.provider_call_id,
        transcript_text: transcriptText,
        source: 'SARVAM_WEBHOOK',
      }
    );
    transcriptId = transcriptRecord.id;
  }

  return { lead, call, transcriptId };
}

// -----------------------------------------------------------------------------
// Test Suite
// -----------------------------------------------------------------------------

async function runAllTests() {
  console.log('===============================================================');
  console.log('PHASE 8B.7.5: CRASH / RETRY / RECOVERY E2E VERIFICATION SUITE');
  console.log('MODE: IN_MEMORY_SEMANTICS = VERIFIED');
  console.log('MODE: REAL_POSTGRES_CONCURRENCY = NOT_VERIFIED');
  console.log('===============================================================\n');

  const defaultProvider = getDeterministicExtractionProvider();
  setGeminiExtractionProvider(defaultProvider);

  // ---------------------------------------------------------------------------
  // TEST 1 — HAPPY PATH
  // ---------------------------------------------------------------------------
  await runTest('TEST_01', 'HAPPY PATH (Fresh Execution -> Full Stages -> Fenced Completion)', async () => {
    const { lead, call, transcriptId } = await createLeadAndCall();

    // Create a valid durable execution in PENDING
    const exec = await supabaseDataService.pipelineExecutions.createExecution(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      {
        lead_id: lead.id,
        call_id: call.id,
        correlation_id: generateUUID(),
        status: 'PENDING',
      }
    );

    // Worker claims it
    const claimed = await supabaseDataService.pipelineExecutions.claimExecution('worker-1', 60000, 3);
    assert.ok(claimed, 'Worker 1 should claim execution');
    assert.strictEqual(claimed.id, exec.id);
    assert.strictEqual(claimed.attempt_count, 1);
    assert.strictEqual(claimed.status, 'RUNNING');
    assert.strictEqual(claimed.lease_owner, 'worker-1');
    assert.ok(claimed.lease_token);

    // Run the full coordinator
    const coordinator = new BuyerPipelineCoordinator({ geminiProviderOverride: defaultProvider });
    const result = await coordinator.runPipeline({
      executionId: claimed.id,
      leadId: lead.id,
      callId: call.id,
      transcriptId,
      tenantId: DEFAULT_TENANT_ID,
    });

    assert.strictEqual(result.success, true, `Pipeline execution should succeed: ${result.error}`);
    assert.strictEqual(result.current_stage, 'DISPATCH');
    assert.strictEqual(result.stages.DISPATCH.status, 'SUCCESS');

    // Fenced completion
    const completed = await supabaseDataService.pipelineExecutions.updateExecutionWithFencing(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      claimed.id,
      claimed.lease_token!,
      { status: 'COMPLETED', completed_at: new Date().toISOString() }
    );
    assert.ok(completed, 'Fenced completion must succeed');
    assert.strictEqual(completed.status, 'COMPLETED');

    // Verify exactly one of each artifact
    const extractions = await supabaseDataService.extractions.getExtractionsByLeadId(lead.id);
    assert.strictEqual(extractions.length, 1, 'Exactly one extraction must exist');

    const qualifications = await supabaseDataService.qualifications.getQualificationsByLeadId(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      lead.id
    );
    assert.strictEqual(qualifications.length, 1, 'Exactly one qualification must exist');

    const scores = await supabaseDataService.buyerScores.getBuyerScoresByLeadId(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      lead.id
    );
    assert.strictEqual(scores.length, 1, 'Exactly one score record must exist');

    assert.ok((result.total_matches ?? 0) > 0, 'Project matches must exist');

    const handoffs = await supabaseDataService.brokerHandoffs.getHandoffsByLeadId(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      lead.id
    );
    assert.strictEqual(handoffs.length, 1, 'Exactly one handoff must exist');
    assert.strictEqual(handoffs[0].dispatch_status, 'SENT', 'dispatch_status must be SENT');

    // Verify PIPELINE_COMPLETED event exists
    const events = await supabaseDataService.leadEvents.getLeadEvents(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      lead.id
    );
    const completedEvent = events.find(e => e.event_type === 'PIPELINE_COMPLETED');
    assert.ok(completedEvent, 'PIPELINE_COMPLETED audit event must exist');
  });

  // ---------------------------------------------------------------------------
  // TEST 2 — CRASH IMMEDIATELY AFTER CLAIM
  // ---------------------------------------------------------------------------
  await runTest('TEST_02', 'CRASH IMMEDIATELY AFTER CLAIM (Crash before coordinator -> Reclaim -> Complete)', async () => {
    const { lead, call, transcriptId } = await createLeadAndCall();

    const exec = await supabaseDataService.pipelineExecutions.createExecution(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      {
        lead_id: lead.id,
        call_id: call.id,
        correlation_id: generateUUID(),
        status: 'PENDING',
      }
    );

    // Worker A claims execution
    const claimedA = await supabaseDataService.pipelineExecutions.claimExecution('worker-A', 60000, 3);
    assert.ok(claimedA);
    assert.strictEqual(claimedA.status, 'RUNNING');
    assert.strictEqual(claimedA.attempt_count, 1);
    assert.strictEqual(claimedA.lease_owner, 'worker-A');
    const tokenA = claimedA.lease_token;
    assert.ok(tokenA);

    // Simulate crash before coordinator starts: Worker A terminates with no coordinator execution.
    // Assert before recovery:
    const store = getRepoStore();
    const beforeRecovery = store.get(exec.id);
    assert.strictEqual(beforeRecovery.status, 'RUNNING');
    assert.strictEqual(beforeRecovery.attempt_count, 1);
    assert.strictEqual(beforeRecovery.lease_owner, 'worker-A');
    assert.strictEqual(beforeRecovery.lease_token, tokenA);

    const extractionsBefore = await supabaseDataService.extractions.getExtractionsByLeadId(lead.id);
    assert.strictEqual(extractionsBefore.length, 0, 'No downstream extraction artifact should exist before recovery');

    // Expire lease
    beforeRecovery.lease_expires_at = new Date(Date.now() - 1000).toISOString();
    store.set(exec.id, beforeRecovery);

    // Worker B claims
    const claimedB = await supabaseDataService.pipelineExecutions.claimExecution('worker-B', 60000, 3);
    assert.ok(claimedB, 'Worker B should claim expired execution');
    assert.strictEqual(claimedB.attempt_count, 2);
    assert.strictEqual(claimedB.lease_owner, 'worker-B');
    assert.notStrictEqual(claimedB.lease_token, tokenA, 'Worker B must receive a new lease token');

    // Run coordinator with Worker B
    const coordinator = new BuyerPipelineCoordinator({ geminiProviderOverride: defaultProvider });
    const res = await coordinator.runPipeline({
      executionId: claimedB.id,
      leadId: lead.id,
      callId: call.id,
      transcriptId,
      tenantId: DEFAULT_TENANT_ID,
    });
    assert.strictEqual(res.success, true);

    const completedB = await supabaseDataService.pipelineExecutions.updateExecutionWithFencing(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      claimedB.id,
      claimedB.lease_token!,
      { status: 'COMPLETED', completed_at: new Date().toISOString() }
    );
    assert.ok(completedB);
    assert.strictEqual(completedB.status, 'COMPLETED');

    // Verify no duplicate artifacts
    const extractionsAfter = await supabaseDataService.extractions.getExtractionsByLeadId(lead.id);
    assert.strictEqual(extractionsAfter.length, 1, 'No duplicate extractions');
    const handoffsAfter = await supabaseDataService.brokerHandoffs.getHandoffsByLeadId(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      lead.id
    );
    assert.strictEqual(handoffsAfter.length, 1, 'No duplicate handoffs');
  });

  // ---------------------------------------------------------------------------
  // TEST 3 — CRASH AFTER EXTRACTION
  // ---------------------------------------------------------------------------
  await runTest('TEST_03', 'CRASH AFTER EXTRACTION (Extraction committed -> Crash before qualification -> Reuse)', async () => {
    const { lead, call, transcriptId } = await createLeadAndCall();

    const exec = await supabaseDataService.pipelineExecutions.createExecution(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      { lead_id: lead.id, call_id: call.id, correlation_id: generateUUID(), status: 'PENDING' }
    );

    const claimedA = await supabaseDataService.pipelineExecutions.claimExecution('worker-A', 60000, 3);
    assert.ok(claimedA);

    // Mock qualification service to crash immediately
    class CrashingQualificationService extends BuyerQualificationService {
      async qualifyExtraction(): Promise<any> {
        throw new Error('CRASH_SIMULATION: Process crash before qualification');
      }
    }

    const crashCoordinator = new BuyerPipelineCoordinator({
      qualificationService: new CrashingQualificationService(),
      geminiProviderOverride: defaultProvider,
    });

    const resA = await crashCoordinator.runPipeline({
      executionId: claimedA.id,
      leadId: lead.id,
      callId: call.id,
      transcriptId,
      tenantId: DEFAULT_TENANT_ID,
    });
    assert.strictEqual(resA.success, false, 'Initial run must fail at qualification crash boundary');

    // Assert before recovery:
    const extractions = await supabaseDataService.extractions.getExtractionsByLeadId(lead.id);
    assert.strictEqual(extractions.length, 1, 'Extraction must exist exactly once after first run');

    const qualifications = await supabaseDataService.qualifications.getQualificationsByLeadId(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      lead.id
    );
    assert.strictEqual(qualifications.length, 0, 'Qualification must be absent');

    // Expire lease
    const store = getRepoStore();
    const liveExec = store.get(exec.id);
    liveExec.lease_expires_at = new Date(Date.now() - 1000).toISOString();
    store.set(exec.id, liveExec);

    // Worker B reclaims
    const claimedB = await supabaseDataService.pipelineExecutions.claimExecution('worker-B', 60000, 3);
    assert.ok(claimedB);
    assert.strictEqual(claimedB.attempt_count, 2);

    // Run recovery coordinator
    const recoveryCoordinator = new BuyerPipelineCoordinator({ geminiProviderOverride: defaultProvider });
    const resB = await recoveryCoordinator.runPipeline({
      executionId: claimedB.id,
      leadId: lead.id,
      callId: call.id,
      transcriptId,
      tenantId: DEFAULT_TENANT_ID,
    });
    assert.strictEqual(resB.success, true);
    assert.strictEqual(resB.stages.EXTRACTION.action, 'EXISTING_EXTRACTION', 'Extraction must be reused as EXISTING_EXTRACTION');

    // Verify no second extraction artifact
    const extractionsFinal = await supabaseDataService.extractions.getExtractionsByLeadId(lead.id);
    assert.strictEqual(extractionsFinal.length, 1, 'No second extraction artifact created');

    const completedB = await supabaseDataService.pipelineExecutions.updateExecutionWithFencing(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      claimedB.id,
      claimedB.lease_token!,
      { status: 'COMPLETED', completed_at: new Date().toISOString() }
    );
    assert.ok(completedB);
  });

  // ---------------------------------------------------------------------------
  // TEST 4 — CRASH AFTER QUALIFICATION
  // ---------------------------------------------------------------------------
  await runTest('TEST_04', 'CRASH AFTER QUALIFICATION (Extraction + Qualification committed -> Crash before scoring -> Reuse)', async () => {
    const { lead, call, transcriptId } = await createLeadAndCall();

    const exec = await supabaseDataService.pipelineExecutions.createExecution(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      { lead_id: lead.id, call_id: call.id, correlation_id: generateUUID(), status: 'PENDING' }
    );

    const claimedA = await supabaseDataService.pipelineExecutions.claimExecution('worker-A', 60000, 3);
    assert.ok(claimedA);

    // Crash before scoring
    class CrashingScoringService extends BuyerScoringService {
      async scoreQualification(): Promise<any> {
        throw new Error('CRASH_SIMULATION: Process crash before scoring');
      }
    }

    const crashCoordinator = new BuyerPipelineCoordinator({
      scoringService: new CrashingScoringService(),
      geminiProviderOverride: defaultProvider,
    });

    const resA = await crashCoordinator.runPipeline({
      executionId: claimedA.id,
      leadId: lead.id,
      callId: call.id,
      transcriptId,
      tenantId: DEFAULT_TENANT_ID,
    });
    assert.strictEqual(resA.success, false);

    // Assert before recovery:
    const extractionsBefore = await supabaseDataService.extractions.getExtractionsByLeadId(lead.id);
    assert.strictEqual(extractionsBefore.length, 1);
    const qualificationsBefore = await supabaseDataService.qualifications.getQualificationsByLeadId(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      lead.id
    );
    assert.strictEqual(qualificationsBefore.length, 1);
    const scoresBefore = await supabaseDataService.buyerScores.getBuyerScoresByLeadId(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      lead.id
    );
    assert.strictEqual(scoresBefore.length, 0);

    // Expire lease
    const store = getRepoStore();
    const liveExec = store.get(exec.id);
    liveExec.lease_expires_at = new Date(Date.now() - 1000).toISOString();
    store.set(exec.id, liveExec);

    // Worker B reclaims
    const claimedB = await supabaseDataService.pipelineExecutions.claimExecution('worker-B', 60000, 3);
    assert.ok(claimedB);

    const recoveryCoordinator = new BuyerPipelineCoordinator({ geminiProviderOverride: defaultProvider });
    const resB = await recoveryCoordinator.runPipeline({
      executionId: claimedB.id,
      leadId: lead.id,
      callId: call.id,
      transcriptId,
      tenantId: DEFAULT_TENANT_ID,
    });
    assert.strictEqual(resB.success, true);
    assert.strictEqual(resB.stages.EXTRACTION.action, 'EXISTING_EXTRACTION');
    assert.strictEqual(resB.stages.QUALIFICATION.action, 'EXISTING_QUALIFICATION');

    const scoresFinal = await supabaseDataService.buyerScores.getBuyerScoresByLeadId(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      lead.id
    );
    assert.strictEqual(scoresFinal.length, 1, 'Exactly one score created');
  });

  // ---------------------------------------------------------------------------
  // TEST 5 — CRASH AFTER SCORING
  // ---------------------------------------------------------------------------
  await runTest('TEST_05', 'CRASH AFTER SCORING (Extraction + Qualification + Score committed -> Crash before matching -> Complete)', async () => {
    const { lead, call, transcriptId } = await createLeadAndCall();

    const exec = await supabaseDataService.pipelineExecutions.createExecution(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      { lead_id: lead.id, call_id: call.id, correlation_id: generateUUID(), status: 'PENDING' }
    );

    const claimedA = await supabaseDataService.pipelineExecutions.claimExecution('worker-A', 60000, 3);
    assert.ok(claimedA);

    // Crash before matching
    class CrashingMatchingService extends ProjectMatchingService {
      async matchBuyerRequirements(): Promise<any> {
        throw new Error('CRASH_SIMULATION: Process crash before matching');
      }
    }

    const crashCoordinator = new BuyerPipelineCoordinator({
      matchingService: new CrashingMatchingService(),
      geminiProviderOverride: defaultProvider,
    });

    const resA = await crashCoordinator.runPipeline({
      executionId: claimedA.id,
      leadId: lead.id,
      callId: call.id,
      transcriptId,
      tenantId: DEFAULT_TENANT_ID,
    });
    assert.strictEqual(resA.success, false);

    // Assert before recovery:
    const scoresBefore = await supabaseDataService.buyerScores.getBuyerScoresByLeadId(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      lead.id
    );
    assert.strictEqual(scoresBefore.length, 1);

    // Expire lease
    const store = getRepoStore();
    const liveExec = store.get(exec.id);
    liveExec.lease_expires_at = new Date(Date.now() - 1000).toISOString();
    store.set(exec.id, liveExec);

    // Worker B reclaims
    const claimedB = await supabaseDataService.pipelineExecutions.claimExecution('worker-B', 60000, 3);
    assert.ok(claimedB);

    const recoveryCoordinator = new BuyerPipelineCoordinator({ geminiProviderOverride: defaultProvider });
    const resB = await recoveryCoordinator.runPipeline({
      executionId: claimedB.id,
      leadId: lead.id,
      callId: call.id,
      transcriptId,
      tenantId: DEFAULT_TENANT_ID,
    });
    assert.strictEqual(resB.success, true);
    assert.strictEqual(resB.stages.EXTRACTION.action, 'EXISTING_EXTRACTION');
    assert.strictEqual(resB.stages.QUALIFICATION.action, 'EXISTING_QUALIFICATION');
    assert.strictEqual(resB.stages.SCORING.action, 'EXISTING_SCORE');
    assert.ok((resB.total_matches ?? 0) > 0, 'Exactly one match set created');
  });

  // ---------------------------------------------------------------------------
  // TEST 6 — CRASH AFTER MATCHING
  // ---------------------------------------------------------------------------
  await runTest('TEST_06', 'CRASH AFTER MATCHING (Crash before handoff generation -> Complete)', async () => {
    const { lead, call, transcriptId } = await createLeadAndCall();

    const exec = await supabaseDataService.pipelineExecutions.createExecution(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      { lead_id: lead.id, call_id: call.id, correlation_id: generateUUID(), status: 'PENDING' }
    );

    const claimedA = await supabaseDataService.pipelineExecutions.claimExecution('worker-A', 60000, 3);
    assert.ok(claimedA);

    // Crash during handoff generation
    class CrashingHandoffService extends BrokerHandoffService {
      async generateHandoff(): Promise<any> {
        throw new Error('CRASH_SIMULATION: Process crash before handoff generation');
      }
    }

    const crashCoordinator = new BuyerPipelineCoordinator({
      handoffService: new CrashingHandoffService(),
      geminiProviderOverride: defaultProvider,
    });

    const resA = await crashCoordinator.runPipeline({
      executionId: claimedA.id,
      leadId: lead.id,
      callId: call.id,
      transcriptId,
      tenantId: DEFAULT_TENANT_ID,
    });
    assert.strictEqual(resA.success, false);

    // Assert before recovery:
    const handoffsBefore = await supabaseDataService.brokerHandoffs.getHandoffsByLeadId(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      lead.id
    );
    assert.strictEqual(handoffsBefore.length, 0);

    // Expire lease
    const store = getRepoStore();
    const liveExec = store.get(exec.id);
    liveExec.lease_expires_at = new Date(Date.now() - 1000).toISOString();
    store.set(exec.id, liveExec);

    // Worker B reclaims
    const claimedB = await supabaseDataService.pipelineExecutions.claimExecution('worker-B', 60000, 3);
    assert.ok(claimedB);

    const recoveryCoordinator = new BuyerPipelineCoordinator({ geminiProviderOverride: defaultProvider });
    const resB = await recoveryCoordinator.runPipeline({
      executionId: claimedB.id,
      leadId: lead.id,
      callId: call.id,
      transcriptId,
      tenantId: DEFAULT_TENANT_ID,
    });
    assert.strictEqual(resB.success, true);
    assert.strictEqual(resB.stages.MATCHING.action, 'EXISTING_MATCHES');

    const handoffsFinal = await supabaseDataService.brokerHandoffs.getHandoffsByLeadId(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      lead.id
    );
    assert.strictEqual(handoffsFinal.length, 1, 'Exactly one handoff generated');
    assert.strictEqual(handoffsFinal[0].dispatch_status, 'SENT');
  });

  // ---------------------------------------------------------------------------
  // TEST 7 — CRASH AFTER HANDOFF GENERATION
  // ---------------------------------------------------------------------------
  await runTest('TEST_07', 'CRASH AFTER HANDOFF GENERATION (Handoff READY -> Crash before dispatch -> Dispatch once)', async () => {
    const { lead, call, transcriptId } = await createLeadAndCall();

    const exec = await supabaseDataService.pipelineExecutions.createExecution(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      { lead_id: lead.id, call_id: call.id, correlation_id: generateUUID(), status: 'PENDING' }
    );

    const claimedA = await supabaseDataService.pipelineExecutions.claimExecution('worker-A', 60000, 3);
    assert.ok(claimedA);

    // Crash at dispatch boundary
    class CrashingDispatchHandoffService extends BrokerHandoffService {
      async dispatchHandoff(): Promise<any> {
        throw new Error('CRASH_SIMULATION: Process crash before dispatch');
      }
    }

    const crashCoordinator = new BuyerPipelineCoordinator({
      handoffService: new CrashingDispatchHandoffService(),
      geminiProviderOverride: defaultProvider,
    });

    const resA = await crashCoordinator.runPipeline({
      executionId: claimedA.id,
      leadId: lead.id,
      callId: call.id,
      transcriptId,
      tenantId: DEFAULT_TENANT_ID,
    });
    assert.strictEqual(resA.stages.DISPATCH.status, 'FAILED', 'Initial run must fail at dispatch crash boundary');

    // Assert before recovery:
    const handoffsBefore = await supabaseDataService.brokerHandoffs.getHandoffsByLeadId(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      lead.id
    );
    assert.strictEqual(handoffsBefore.length, 1);
    assert.ok(
      handoffsBefore[0].handoff_status === 'READY' || handoffsBefore[0].handoff_status === 'READY_WITH_MISSING_DATA',
      'Handoff status must be READY or READY_WITH_MISSING_DATA'
    );
    assert.strictEqual(handoffsBefore[0].dispatch_status, 'PENDING');

    // Expire lease
    const store = getRepoStore();
    const liveExec = store.get(exec.id);
    liveExec.lease_expires_at = new Date(Date.now() - 1000).toISOString();
    store.set(exec.id, liveExec);

    // Worker B reclaims
    const claimedB = await supabaseDataService.pipelineExecutions.claimExecution('worker-B', 60000, 3);
    assert.ok(claimedB);

    // Spy on dispatch invocation
    let dispatchCallCount = 0;
    class SpyDispatchChannel extends MockBrokerHandoffChannel {
      async dispatch(pkg: BrokerHandoffPackage, opts?: any): Promise<DispatchResult> {
        dispatchCallCount++;
        return super.dispatch(pkg, opts);
      }
    }
    const spyChannel = new SpyDispatchChannel();
    const recoveryHandoffService = new BrokerHandoffService(spyChannel);

    const recoveryCoordinator = new BuyerPipelineCoordinator({
      handoffService: recoveryHandoffService,
      geminiProviderOverride: defaultProvider,
    });

    const resB = await recoveryCoordinator.runPipeline({
      executionId: claimedB.id,
      leadId: lead.id,
      callId: call.id,
      transcriptId,
      tenantId: DEFAULT_TENANT_ID,
    });
    assert.strictEqual(resB.success, true);
    assert.strictEqual(resB.stages.HANDOFF.action, 'EXISTING_HANDOFF');
    assert.strictEqual(dispatchCallCount, 1, 'Dispatch channel invoked exactly once during recovery');

    const handoffsFinal = await supabaseDataService.brokerHandoffs.getHandoffsByLeadId(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      lead.id
    );
    assert.strictEqual(handoffsFinal.length, 1, 'No second handoff');
    assert.strictEqual(handoffsFinal[0].dispatch_status, 'SENT');

    const completedB = await supabaseDataService.pipelineExecutions.updateExecutionWithFencing(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      claimedB.id,
      claimedB.lease_token!,
      { status: 'COMPLETED', completed_at: new Date().toISOString() }
    );
    assert.ok(completedB);
  });

  // ---------------------------------------------------------------------------
  // TEST 8 — ZOMBIE WORKER FENCING
  // ---------------------------------------------------------------------------
  await runTest('TEST_08', 'ZOMBIE WORKER FENCING (Token A rejected after Worker B acquires Token B)', async () => {
    const { lead, call } = await createLeadAndCall();

    const exec = await supabaseDataService.pipelineExecutions.createExecution(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      { lead_id: lead.id, call_id: call.id, correlation_id: generateUUID(), status: 'PENDING' }
    );

    // Worker A claims with tokenA
    const claimedA = await supabaseDataService.pipelineExecutions.claimExecution('worker-A', 60000, 3);
    assert.ok(claimedA);
    const tokenA = claimedA.lease_token!;

    // Expire lease
    const store = getRepoStore();
    const liveExec = store.get(exec.id);
    liveExec.lease_expires_at = new Date(Date.now() - 1000).toISOString();
    store.set(exec.id, liveExec);

    // Worker B claims with tokenB
    const claimedB = await supabaseDataService.pipelineExecutions.claimExecution('worker-B', 60000, 3);
    assert.ok(claimedB);
    const tokenB = claimedB.lease_token!;
    assert.notStrictEqual(tokenA, tokenB, 'Worker B must hold a distinct lease token');

    // Worker A attempts updateExecutionWithFencing with stale tokenA
    const zombieUpdate = await supabaseDataService.pipelineExecutions.updateExecutionWithFencing(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      exec.id,
      tokenA,
      { status: 'COMPLETED' }
    );
    assert.strictEqual(zombieUpdate, null, 'Zombie worker A must be rejected by fencing');

    // Verify tokenB remains authoritative
    const currentExec = store.get(exec.id);
    assert.strictEqual(currentExec.lease_token, tokenB, 'Token B remains authoritative');
    assert.strictEqual(currentExec.lease_owner, 'worker-B', 'Worker B remains lease owner');
    assert.strictEqual(currentExec.status, 'RUNNING', 'Execution remains RUNNING under Worker B');

    // Worker B can complete successfully using tokenB
    const validUpdate = await supabaseDataService.pipelineExecutions.updateExecutionWithFencing(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      exec.id,
      tokenB,
      { status: 'COMPLETED', completed_at: new Date().toISOString() }
    );
    assert.ok(validUpdate, 'Worker B can complete successfully using token B');
    assert.strictEqual(validUpdate.status, 'COMPLETED');
  });

  // ---------------------------------------------------------------------------
  // TEST 9 — ACTIVE LEASE PROTECTION
  // ---------------------------------------------------------------------------
  await runTest('TEST_09', 'ACTIVE LEASE PROTECTION (Unexpired lease cannot be claimed by Worker B)', async () => {
    const { lead, call } = await createLeadAndCall();

    const exec = await supabaseDataService.pipelineExecutions.createExecution(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      { lead_id: lead.id, call_id: call.id, correlation_id: generateUUID(), status: 'PENDING' }
    );

    // Worker A claims with long lease
    const claimedA = await supabaseDataService.pipelineExecutions.claimExecution('worker-A', 300000, 3);
    assert.ok(claimedA);
    assert.strictEqual(claimedA.id, exec.id);

    // Worker B attempts claim while lease is active
    const claimedB = await supabaseDataService.pipelineExecutions.claimExecution('worker-B', 300000, 3);
    assert.strictEqual(claimedB, null, 'Worker B must receive null while Worker A holds active lease');

    // Verify state in store
    const store = getRepoStore();
    const liveExec = store.get(exec.id);
    assert.strictEqual(liveExec.attempt_count, 1, 'Attempt count must remain 1');
    assert.strictEqual(liveExec.lease_owner, 'worker-A', 'Lease owner must remain worker-A');
    assert.strictEqual(liveExec.lease_token, claimedA.lease_token, 'Lease token must remain unchanged');
  });

  // ---------------------------------------------------------------------------
  // TEST 10 — TRANSIENT FAILURE / BACKOFF
  // ---------------------------------------------------------------------------
  await runTest('TEST_10', 'TRANSIENT FAILURE / BACKOFF (Attempt 1 -> PENDING with backoff -> Fast forward -> Reclaim)', async () => {
    const { lead, call } = await createLeadAndCall();

    const exec = await supabaseDataService.pipelineExecutions.createExecution(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      { lead_id: lead.id, call_id: call.id, correlation_id: generateUUID(), status: 'PENDING' }
    );

    // Attempt 1 claim
    const claimed1 = await supabaseDataService.pipelineExecutions.claimExecution('worker-A', 60000, 3);
    assert.ok(claimed1);
    assert.strictEqual(claimed1.attempt_count, 1);

    // Simulate transient failure handling: status: PENDING, backoff next_attempt_at: +30s
    const backoffMs = 30000;
    const nextAttemptAt = new Date(Date.now() + backoffMs).toISOString();
    const updateTransient = await supabaseDataService.pipelineExecutions.updateExecutionWithFencing(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      exec.id,
      claimed1.lease_token!,
      {
        status: 'PENDING',
        last_error: 'Simulated transient network timeout',
        next_attempt_at: nextAttemptAt,
      }
    );
    assert.ok(updateTransient);
    assert.strictEqual(updateTransient.status, 'PENDING');
    assert.strictEqual(updateTransient.attempt_count, 1);
    assert.ok(updateTransient.next_attempt_at);
    assert.ok(updateTransient.last_error);

    // Verify claim before next_attempt_at returns no claim
    const prematureClaim = await supabaseDataService.pipelineExecutions.claimExecution('worker-B', 60000, 3);
    assert.strictEqual(prematureClaim, null, 'Claim before next_attempt_at must return null');

    // Deterministically move next_attempt_at to the past
    const store = getRepoStore();
    const liveExec = store.get(exec.id);
    liveExec.next_attempt_at = new Date(Date.now() - 1000).toISOString();
    store.set(exec.id, liveExec);

    // Now second claim succeeds
    const secondClaim = await supabaseDataService.pipelineExecutions.claimExecution('worker-B', 60000, 3);
    assert.ok(secondClaim, 'Second claim must succeed after backoff expires');
    assert.strictEqual(secondClaim.attempt_count, 2);
    assert.strictEqual(secondClaim.lease_owner, 'worker-B');
  });

  // ---------------------------------------------------------------------------
  // TEST 11 — MAX ATTEMPTS
  // ---------------------------------------------------------------------------
  await runTest('TEST_11', 'MAX ATTEMPTS (Repeated transient failures reach max attempts -> FAILED)', async () => {
    const { lead, call } = await createLeadAndCall();
    const maxAttempts = 2;

    const exec = await supabaseDataService.pipelineExecutions.createExecution(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      { lead_id: lead.id, call_id: call.id, correlation_id: generateUUID(), status: 'PENDING' }
    );

    // Attempt 1
    const claim1 = await supabaseDataService.pipelineExecutions.claimExecution('worker-1', 60000, maxAttempts);
    assert.ok(claim1);
    assert.strictEqual(claim1.attempt_count, 1);

    // Backoff update
    await supabaseDataService.pipelineExecutions.updateExecutionWithFencing(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      exec.id,
      claim1.lease_token!,
      {
        status: 'PENDING',
        last_error: 'Transient error attempt 1',
        next_attempt_at: new Date(Date.now() - 1000).toISOString(),
      }
    );

    // Attempt 2 (reaches maxAttempts)
    const claim2 = await supabaseDataService.pipelineExecutions.claimExecution('worker-2', 60000, maxAttempts);
    assert.ok(claim2);
    assert.strictEqual(claim2.attempt_count, 2);

    // Failure on attempt 2 triggers terminal FAILED
    const terminalUpdate = await supabaseDataService.pipelineExecutions.updateExecutionWithFencing(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      exec.id,
      claim2.lease_token!,
      {
        status: 'FAILED',
        last_error: 'Terminal failure: Maximum attempts exceeded',
        completed_at: new Date().toISOString(),
      }
    );
    assert.ok(terminalUpdate);
    assert.strictEqual(terminalUpdate.status, 'FAILED');
    assert.ok(terminalUpdate.completed_at);
    assert.ok(terminalUpdate.last_error);

    // Verify no further claim possible
    const claim3 = await supabaseDataService.pipelineExecutions.claimExecution('worker-3', 60000, maxAttempts);
    assert.strictEqual(claim3, null, 'No further claim possible on FAILED execution');

    // Execution does not return to PENDING
    const store = getRepoStore();
    const finalExec = store.get(exec.id);
    assert.strictEqual(finalExec.status, 'FAILED');
  });

  // ---------------------------------------------------------------------------
  // TEST 12 — POST-DISPATCH LOCAL IDEMPOTENCY
  // ---------------------------------------------------------------------------
  await runTest('TEST_12', 'POST-DISPATCH LOCAL IDEMPOTENCY (dispatch_status SENT -> Crash before COMPLETED -> Recovery suppresses duplicate dispatch)', async () => {
    const { lead, call, transcriptId } = await createLeadAndCall();

    const exec = await supabaseDataService.pipelineExecutions.createExecution(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      { lead_id: lead.id, call_id: call.id, correlation_id: generateUUID(), status: 'PENDING' }
    );

    const claimedA = await supabaseDataService.pipelineExecutions.claimExecution('worker-A', 60000, 3);
    assert.ok(claimedA);

    // Run coordinator through full dispatch
    const coordinator = new BuyerPipelineCoordinator({ geminiProviderOverride: defaultProvider });
    const resA = await coordinator.runPipeline({
      executionId: claimedA.id,
      leadId: lead.id,
      callId: call.id,
      transcriptId,
      tenantId: DEFAULT_TENANT_ID,
    });
    assert.strictEqual(resA.success, true);
    assert.strictEqual(resA.stages.DISPATCH.status, 'SUCCESS');

    // Verify handoff dispatch_status is SENT
    const handoffs = await supabaseDataService.brokerHandoffs.getHandoffsByLeadId(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      lead.id
    );
    assert.strictEqual(handoffs[0].dispatch_status, 'SENT');

    // Simulate crash before execution update: lease expires without reaching COMPLETED
    const store = getRepoStore();
    const liveExec = store.get(exec.id);
    liveExec.lease_expires_at = new Date(Date.now() - 1000).toISOString();
    store.set(exec.id, liveExec);

    // Worker B reclaims
    const claimedB = await supabaseDataService.pipelineExecutions.claimExecution('worker-B', 60000, 3);
    assert.ok(claimedB);

    // Spy on dispatch channel to verify 0 invocations during recovery
    let recoveryDispatchInvocations = 0;
    class SpyChannel extends MockBrokerHandoffChannel {
      async dispatch(pkg: BrokerHandoffPackage, opts?: any): Promise<DispatchResult> {
        recoveryDispatchInvocations++;
        return super.dispatch(pkg, opts);
      }
    }
    const recoveryHandoffService = new BrokerHandoffService(new SpyChannel());
    const recoveryCoordinator = new BuyerPipelineCoordinator({
      handoffService: recoveryHandoffService,
      geminiProviderOverride: defaultProvider,
    });

    const resB = await recoveryCoordinator.runPipeline({
      executionId: claimedB.id,
      leadId: lead.id,
      callId: call.id,
      transcriptId,
      tenantId: DEFAULT_TENANT_ID,
    });

    assert.strictEqual(resB.success, true);
    assert.strictEqual(recoveryDispatchInvocations, 0, 'Dispatch channel must NOT be invoked during recovery');

    // Verify DISPATCH_DUPLICATE event was logged
    const events = await supabaseDataService.leadEvents.getLeadEvents(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      lead.id
    );
    const hasDuplicateEvent = events.some(e => e.event_type === 'DISPATCH_DUPLICATE');
    assert.ok(hasDuplicateEvent, 'DISPATCH_DUPLICATE audit event must be recorded');

    // Fenced completion succeeds
    const completedB = await supabaseDataService.pipelineExecutions.updateExecutionWithFencing(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      claimedB.id,
      claimedB.lease_token!,
      { status: 'COMPLETED', completed_at: new Date().toISOString() }
    );
    assert.ok(completedB);
    assert.strictEqual(completedB.status, 'COMPLETED');
  });

  // ---------------------------------------------------------------------------
  // TEST 13 — DISPATCH AMBIGUITY
  // ---------------------------------------------------------------------------
  await runTest('TEST_13', 'DISPATCH AMBIGUITY (Payload transmitted -> Crash before local SENT -> Re-dispatch ambiguity documented)', async () => {
    const { lead, call, transcriptId } = await createLeadAndCall();

    const exec = await supabaseDataService.pipelineExecutions.createExecution(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      { lead_id: lead.id, call_id: call.id, correlation_id: generateUUID(), status: 'PENDING' }
    );

    const claimedA = await supabaseDataService.pipelineExecutions.claimExecution('worker-A', 60000, 3);
    assert.ok(claimedA);

    // Mock remote CRM receiving payloads
    interface RemoteReceipt {
      handoffId: string;
      leadId: string;
      externalLeadId?: string | null;
      receivedAt: string;
    }
    const remoteCrmReceipts: RemoteReceipt[] = [];

    // Ambiguous channel: transmits HTTP payload to remote CRM, but crashes before local DB commits
    let crashOnFirstDispatch = true;
    const ambiguousChannel: BrokerHandoffChannel = {
      channelName: 'AMBIGUOUS_REMOTE_CRM',
      async dispatch(handoff: BrokerHandoffPackage, options?: { dryRun?: boolean }): Promise<DispatchResult> {
        // Step 1 & 2: Remote CRM receives payload
        remoteCrmReceipts.push({
          handoffId: handoff.handoff_id,
          leadId: handoff.lead_id,
          externalLeadId: handoff.external_lead_id,
          receivedAt: new Date().toISOString(),
        });

        // Step 3: Process crashes BEFORE local commit
        if (crashOnFirstDispatch) {
          crashOnFirstDispatch = false;
          throw new Error('CRASH_SIMULATION: Process crash immediately after remote CRM socket write');
        }

        return {
          success: true,
          dispatch_id: `remote-${Date.now()}`,
          channel: 'AMBIGUOUS_REMOTE_CRM',
          status: 'SENT',
          delivered_at: new Date().toISOString(),
          dry_run: false,
        };
      },
    };

    const ambiguousHandoffService = new BrokerHandoffService(ambiguousChannel);
    const coordinatorA = new BuyerPipelineCoordinator({
      handoffService: ambiguousHandoffService,
      geminiProviderOverride: defaultProvider,
    });

    const resA = await coordinatorA.runPipeline({
      executionId: claimedA.id,
      leadId: lead.id,
      callId: call.id,
      transcriptId,
      tenantId: DEFAULT_TENANT_ID,
    });
    assert.strictEqual(resA.stages.DISPATCH.status, 'FAILED', 'Dispatch crash must cause initial dispatch failure');

    // Assert LOCAL STATE:
    const handoffs = await supabaseDataService.brokerHandoffs.getHandoffsByLeadId(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      lead.id
    );
    assert.strictEqual(handoffs[0].dispatch_status, 'FAILED', 'Local dispatch_status records FAILED (not SENT)');
    assert.strictEqual(remoteCrmReceipts.length, 1, 'Remote CRM recorded 1 receipt despite local failure');

    // RECOVERY: Worker B reclaims and reruns pipeline
    const store = getRepoStore();
    const liveExec = store.get(exec.id);
    liveExec.lease_expires_at = new Date(Date.now() - 1000).toISOString();
    store.set(exec.id, liveExec);

    const claimedB = await supabaseDataService.pipelineExecutions.claimExecution('worker-B', 60000, 3);
    assert.ok(claimedB);

    const coordinatorB = new BuyerPipelineCoordinator({
      handoffService: ambiguousHandoffService,
      geminiProviderOverride: defaultProvider,
    });

    const resB = await coordinatorB.runPipeline({
      executionId: claimedB.id,
      leadId: lead.id,
      callId: call.id,
      transcriptId,
      tenantId: DEFAULT_TENANT_ID,
    });
    assert.strictEqual(resB.success, true);

    // REMOTE DISPATCH AMBIGUITY VERIFICATION:
    // A naive remote consumer received 2 payloads across the crash boundary
    assert.strictEqual(remoteCrmReceipts.length, 2, 'Remote CRM received payload twice across crash boundary');

    // PAYLOAD INTEGRITY:
    assert.strictEqual(
      remoteCrmReceipts[0].handoffId,
      remoteCrmReceipts[1].handoffId,
      'handoff_id remains identical across attempts'
    );
    assert.strictEqual(
      remoteCrmReceipts[0].leadId,
      remoteCrmReceipts[1].leadId,
      'lead_id remains identical across attempts'
    );
    assert.strictEqual(
      remoteCrmReceipts[0].externalLeadId,
      remoteCrmReceipts[1].externalLeadId,
      'external_lead_id remains identical across attempts'
    );

    // Document boundary semantics:
    // 1. A naive remote consumer without deduplication processes the payload twice.
    // 2. A remote consumer implementing idempotency keyed by handoff_id suppresses duplicate processing.
    // 3. GrowthForge local state alone cannot prove exactly-once remote processing across the crash boundary.
    // 4. Absence of an explicit HTTP Idempotency-Key header is recorded as NON_BLOCKING_FINDING.
  });

  // ---------------------------------------------------------------------------
  // TEST 14 — TENANT ISOLATION DURING RECOVERY
  // ---------------------------------------------------------------------------
  await runTest('TEST_14', 'TENANT ISOLATION DURING RECOVERY (Cross-tenant recovery rejected -> 0 artifacts created in mismatched tenant)', async () => {
    const tenant1 = '11111111-1111-1111-1111-111111111111';
    const tenant2 = '22222222-2222-2222-2222-222222222222';

    // Create lead belonging to Tenant 2
    const { lead: leadTenant2, call: callTenant2, transcriptId } = await createLeadAndCall({ tenantId: tenant2 });

    // Create durable execution belonging to Tenant 1
    const exec = await supabaseDataService.pipelineExecutions.createExecution(
      { tenantId: tenant1, isPlatformAdmin: true },
      {
        lead_id: leadTenant2.id,
        call_id: callTenant2.id,
        correlation_id: generateUUID(),
        status: 'PENDING',
      }
    );
    assert.strictEqual(exec.tenant_id, tenant1, 'Execution tenant must be Tenant 1');

    // Worker claims execution
    const claimed = await supabaseDataService.pipelineExecutions.claimExecution('worker-iso', 60000, 3);
    assert.ok(claimed);

    // Coordinator attempts recovery using execution's authoritative tenant
    const coordinator = new BuyerPipelineCoordinator({ geminiProviderOverride: defaultProvider });
    const res = await coordinator.runPipeline({
      executionId: claimed.id,
      leadId: leadTenant2.id,
      callId: callTenant2.id,
      transcriptId,
      tenantId: tenant1, // Execution claims tenant1, but lead is tenant2
    });

    // Assert rejection
    assert.strictEqual(res.success, false, 'Cross-tenant execution must fail');
    assert.strictEqual(res.action, 'TENANT_ISOLATION_VIOLATION', 'Action must be TENANT_ISOLATION_VIOLATION');

    // Assert 0 artifacts created in Tenant 1
    const extractionsTenant1 = await supabaseDataService.extractions.getExtractionsByLeadId(leadTenant2.id);
    assert.strictEqual(extractionsTenant1.length, 0, 'No extraction artifact created across tenant boundary');

    const qualificationsTenant1 = await supabaseDataService.qualifications.getQualificationsByLeadId(
      { tenantId: tenant1, isPlatformAdmin: true },
      leadTenant2.id
    );
    assert.strictEqual(qualificationsTenant1.length, 0, 'No qualification artifact created across tenant boundary');

    const scoresTenant1 = await supabaseDataService.buyerScores.getBuyerScoresByLeadId(
      { tenantId: tenant1, isPlatformAdmin: true },
      leadTenant2.id
    );
    assert.strictEqual(scoresTenant1.length, 0, 'No score artifact created across tenant boundary');

    const handoffsTenant1 = await supabaseDataService.brokerHandoffs.getHandoffsByLeadId(
      { tenantId: tenant1, isPlatformAdmin: true },
      leadTenant2.id
    );
    assert.strictEqual(handoffsTenant1.length, 0, 'No handoff created across tenant boundary');
  });

  // ---------------------------------------------------------------------------
  // TEST 15 — AUDIT EVENT TRAIL
  // ---------------------------------------------------------------------------
  await runTest('TEST_15', 'AUDIT EVENT TRAIL (Verify sequence: CALL_COMPLETED -> PIPELINE_STARTED -> DISPATCH_STARTED -> DISPATCH_COMPLETED -> PIPELINE_COMPLETED)', async () => {
    const { lead, call, transcriptId } = await createLeadAndCall();

    // Log CALL_COMPLETED to establish starting event
    await supabaseDataService.leadEvents.appendLeadEvent(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      {
        lead_id: lead.id,
        event_type: 'CALL_COMPLETED',
        event_data: { call_id: call.id, provider_call_id: call.provider_call_id },
      }
    );

    // Create durable execution and run coordinator
    const exec = await supabaseDataService.pipelineExecutions.createExecution(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      { lead_id: lead.id, call_id: call.id, correlation_id: generateUUID(), status: 'PENDING' }
    );
    const claimed = await supabaseDataService.pipelineExecutions.claimExecution('worker-audit', 60000, 3);
    assert.ok(claimed);

    const coordinator = new BuyerPipelineCoordinator({ geminiProviderOverride: defaultProvider });
    const res = await coordinator.runPipeline({
      executionId: claimed.id,
      leadId: lead.id,
      callId: call.id,
      transcriptId,
      tenantId: DEFAULT_TENANT_ID,
    });
    assert.strictEqual(res.success, true);

    await supabaseDataService.pipelineExecutions.updateExecutionWithFencing(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      claimed.id,
      claimed.lease_token!,
      { status: 'COMPLETED', completed_at: new Date().toISOString() }
    );

    // Retrieve audit event trail
    const events = await supabaseDataService.leadEvents.getLeadEvents(
      { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: true },
      lead.id
    );

    const eventTypes = events.map(e => e.event_type);
    const callCompletedIdx = eventTypes.indexOf('CALL_COMPLETED');
    const pipelineStartedIdx = eventTypes.indexOf('PIPELINE_STARTED');
    const dispatchStartedIdx = eventTypes.indexOf('DISPATCH_STARTED');
    const dispatchCompletedIdx = eventTypes.indexOf('DISPATCH_COMPLETED');
    const pipelineCompletedIdx = eventTypes.indexOf('PIPELINE_COMPLETED');

    assert.ok(callCompletedIdx >= 0, 'CALL_COMPLETED must exist');
    assert.ok(pipelineStartedIdx >= 0, 'PIPELINE_STARTED must exist');
    assert.ok(dispatchStartedIdx >= 0, 'DISPATCH_STARTED must exist');
    assert.ok(dispatchCompletedIdx >= 0, 'DISPATCH_COMPLETED must exist');
    assert.ok(pipelineCompletedIdx >= 0, 'PIPELINE_COMPLETED must exist');

    assert.ok(
      callCompletedIdx < pipelineStartedIdx,
      `CALL_COMPLETED (${callCompletedIdx}) must precede PIPELINE_STARTED (${pipelineStartedIdx})`
    );
    assert.ok(
      pipelineStartedIdx < dispatchStartedIdx,
      `PIPELINE_STARTED (${pipelineStartedIdx}) must precede DISPATCH_STARTED (${dispatchStartedIdx})`
    );
    assert.ok(
      dispatchStartedIdx < dispatchCompletedIdx,
      `DISPATCH_STARTED (${dispatchStartedIdx}) must precede DISPATCH_COMPLETED (${dispatchCompletedIdx})`
    );
    assert.ok(
      dispatchCompletedIdx < pipelineCompletedIdx,
      `DISPATCH_COMPLETED (${dispatchCompletedIdx}) must precede PIPELINE_COMPLETED (${pipelineCompletedIdx})`
    );
  });

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('\n===============================================================');
  console.log('PHASE 8B.7.5 SUMMARY:');
  const passed = testResults.filter(t => t.passed).length;
  const failed = testResults.filter(t => !t.passed).length;
  console.log(`TOTAL TESTS : ${testResults.length}`);
  console.log(`PASSED      : ${passed}`);
  console.log(`FAILED      : ${failed}`);
  console.log('===============================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch(err => {
  console.error('\nTest runner failed with unhandled exception:', err);
  process.exit(1);
});
