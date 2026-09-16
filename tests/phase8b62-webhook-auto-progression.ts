import * as crypto from 'crypto';
import { processSarvamWebhook } from '../app/services/voice/sarvamWebhook';
import { supabaseDataService } from '../app/services/supabase/repositories';
import { transcriptIngestionService } from '../app/services/voice/transcriptIngestionService';
import { buyerPipelineCoordinator } from '../app/services/pipeline/buyerPipelineCoordinator';
import { logger } from '../app/services/security/logger';

// Mock dependencies to isolate boundary behavior
let originalIngest: any;
let originalRunPipeline: any;
let originalGetEvent: any;
let originalRecordEvent: any;
let originalUpdateEventStatus: any;
let originalGetCall: any;
let originalGetCallByProvider: any;
let originalUpdateCall: any;
let originalUpdateLead: any;
let originalAppendLeadEvent: any;
let originalCheckRateLimit: any;

let ingestCalled = 0;
let pipelineCalled = 0;
let pipelineArgs: any[] = [];
let pipelineShouldFail = false;
let updateCallArgs: any[] = [];
let updateEventStatusArgs: any[] = [];
let getEventCalls = 0;

const MOCK_SECRET = 'test-secret-12345';
const VALID_TENANT = '11111111-1111-1111-1111-111111111111';
const VALID_LEAD = '22222222-2222-2222-2222-222222222222';
const VALID_CALL = '33333333-3333-3333-3333-333333333333';
const VALID_EXTERNAL = 'ext-call-444';

function setupMocks() {
  process.env.VOICE_WEBHOOK_SECRET = MOCK_SECRET;
  
  originalIngest = transcriptIngestionService.ingestSarvamTranscript;
  originalRunPipeline = buyerPipelineCoordinator.runPipeline;
  
  originalGetEvent = supabaseDataService.webhookEvents.getEvent;
  originalRecordEvent = supabaseDataService.webhookEvents.recordEvent;
  originalUpdateEventStatus = supabaseDataService.webhookEvents.updateEventStatus;
  
  originalGetCall = supabaseDataService.calls.getCall;
  originalGetCallByProvider = supabaseDataService.calls.getCallByProviderCallId;
  originalUpdateCall = supabaseDataService.calls.updateCall;
  
  originalUpdateLead = supabaseDataService.leads.updateLead;
  originalAppendLeadEvent = supabaseDataService.leadEvents.appendLeadEvent;
  originalCheckRateLimit = supabaseDataService.security.checkAndIncrementRateLimit;
}

function resetSpies() {
  ingestCalled = 0;
  pipelineCalled = 0;
  pipelineArgs = [];
  pipelineShouldFail = false;
  updateCallArgs = [];
  updateEventStatusArgs = [];
  getEventCalls = 0;
  
  // Base successful mocks
  transcriptIngestionService.ingestSarvamTranscript = async () => { 
    ingestCalled++; 
    return {} as any; 
  };
  
  buyerPipelineCoordinator.runPipeline = async (args) => { 
    pipelineCalled++;
    pipelineArgs.push(args);
    if (pipelineShouldFail) throw new Error('Pipeline failure mock');
    return { success: true } as any; 
  };
  
  supabaseDataService.webhookEvents.getEvent = async () => {
    getEventCalls++;
    return null;
  };
  supabaseDataService.webhookEvents.recordEvent = async () => ({} as any);
  supabaseDataService.webhookEvents.updateEventStatus = async (eventId, status) => {
    updateEventStatusArgs.push({ eventId, status });
    return {} as any;
  };
  
  const mockCall = { id: VALID_CALL, lead_id: VALID_LEAD, tenant_id: VALID_TENANT, status: 'CALLING' } as any;
  supabaseDataService.calls.getCallByProviderCallId = async (ext) => ext === VALID_EXTERNAL ? mockCall : null;
  supabaseDataService.calls.getCall = async () => null;
  supabaseDataService.calls.updateCall = async (callId, data) => {
    updateCallArgs.push({ callId, data });
    return {} as any;
  };
  
  supabaseDataService.leads.updateLead = async () => ({} as any);
  supabaseDataService.leadEvents.appendLeadEvent = async () => ({} as any);
  supabaseDataService.security.checkAndIncrementRateLimit = async () => ({ allowed: true, count: 10 });
}

function restoreMocks() {
  transcriptIngestionService.ingestSarvamTranscript = originalIngest;
  buyerPipelineCoordinator.runPipeline = originalRunPipeline;
  supabaseDataService.webhookEvents.getEvent = originalGetEvent;
  supabaseDataService.webhookEvents.recordEvent = originalRecordEvent;
  supabaseDataService.webhookEvents.updateEventStatus = originalUpdateEventStatus;
  supabaseDataService.calls.getCall = originalGetCall;
  supabaseDataService.calls.getCallByProviderCallId = originalGetCallByProvider;
  supabaseDataService.calls.updateCall = originalUpdateCall;
  supabaseDataService.leads.updateLead = originalUpdateLead;
  supabaseDataService.leadEvents.appendLeadEvent = originalAppendLeadEvent;
  supabaseDataService.security.checkAndIncrementRateLimit = originalCheckRateLimit;
}

const results: { name: string; passed: boolean; error?: string }[] = [];
async function runTest(name: string, testFn: () => Promise<void>) {
  process.stdout.write(`Testing: ${name}... `);
  try {
    resetSpies();
    await testFn();
    console.log(`\x1b[32mPASSED\x1b[0m`);
    results.push({ name, passed: true });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.log(`\x1b[31mFAILED: ${errMsg}\x1b[0m`);
    results.push({ name, passed: false, error: errMsg });
  }
}

// -----------------------------------------------------------------------------
// Test Suite
// -----------------------------------------------------------------------------

async function executeTests() {
  console.log('=== GrowthForge Phase 8B.6.2 Webhook Auto-Progression Tests ===');
  setupMocks();

  await runTest('TEST A - VALID COMPLETED EVENT', async () => {
    const payload = { call_id: VALID_EXTERNAL, status: 'call.ended', transcript: 'hello' };
    const res = await processSarvamWebhook(payload, { 'authorization': `Bearer ${MOCK_SECRET}` });
    if (!res.success) throw new Error('Webhook failed');
    if (ingestCalled !== 1) throw new Error('Ingest not called');
    if (pipelineCalled !== 1) throw new Error('Coordinator not invoked exactly once');
    
    // Assert State Changes
    if (updateCallArgs.length === 0) throw new Error('Call state was not updated');
    
    const callUpdate = updateCallArgs.find(u => u.data && u.data.status === 'COMPLETED');
    if (!callUpdate) throw new Error('Call not set to COMPLETED. Args were: ' + JSON.stringify(updateCallArgs));
    
    if (updateEventStatusArgs.length === 0) throw new Error('Webhook event state not updated');
    const eventUpdate = updateEventStatusArgs.find(u => u.status === 'COMPLETED');
    if (!eventUpdate) throw new Error('Webhook event not set to COMPLETED');

    const args = pipelineArgs[0];
    if (args.tenantId !== VALID_TENANT) throw new Error('Tenant ID mismatch');
    if (args.leadId !== VALID_LEAD) throw new Error('Lead ID mismatch');
    if (args.callId !== VALID_CALL) throw new Error('Call ID mismatch');
    if (!args.correlationId) throw new Error('Missing correlation ID');
  });

  await runTest('TEST B - DUPLICATE WEBHOOK', async () => {
    supabaseDataService.webhookEvents.getEvent = async () => ({ id: 'existing' } as any);
    const payload = { call_id: VALID_EXTERNAL, status: 'call.ended', transcript: 'hello' };
    const res = await processSarvamWebhook(payload, { 'authorization': `Bearer ${MOCK_SECRET}` });
    
    if (!res.success || res.action !== 'IGNORED_DUPLICATE') throw new Error('Did not ignore duplicate');
    if (ingestCalled > 0) throw new Error('Ingest was called on duplicate');
    if (pipelineCalled > 0) throw new Error('Coordinator was invoked on duplicate');
  });

  await runTest('TEST C - INVALID SIGNATURE', async () => {
    const payload = { call_id: VALID_EXTERNAL, status: 'call.ended', transcript: 'hello' };
    const res = await processSarvamWebhook(payload, { 'authorization': `Bearer wrong` });
    
    if (res.success) throw new Error('Accepted invalid signature');
    if (pipelineCalled > 0) throw new Error('Coordinator invoked without auth');
  });

  await runTest('TEST D - NON-COMPLETED EVENT', async () => {
    const payload = { call_id: VALID_EXTERNAL, status: 'call.started', transcript: 'hello' };
    const res = await processSarvamWebhook(payload, { 'authorization': `Bearer ${MOCK_SECRET}` });
    
    if (!res.success) throw new Error('Webhook failed for valid non-completed event');
    if (ingestCalled !== 1) throw new Error('Should ingest transcript if present');
    if (pipelineCalled > 0) throw new Error('Coordinator erroneously invoked for started call');
  });

  await runTest('TEST E - UNKNOWN CALL', async () => {
    const payload = { call_id: 'unknown-call', status: 'call.ended', transcript: 'hello' };
    const res = await processSarvamWebhook(payload, { 'authorization': `Bearer ${MOCK_SECRET}` });
    
    if (res.success) throw new Error('Accepted unknown call');
    if (pipelineCalled > 0) throw new Error('Coordinator invoked for unknown call');
  });

  await runTest('TEST F - TRANSCRIPT INGESTION FAILURE', async () => {
    transcriptIngestionService.ingestSarvamTranscript = async () => { throw new Error('Ingest failed'); };
    const payload = { call_id: VALID_EXTERNAL, status: 'call.ended', transcript: 'hello' };
    const res = await processSarvamWebhook(payload, { 'authorization': `Bearer ${MOCK_SECRET}` });
    
    if (!res.success) throw new Error('Webhook should still succeed even if ingest fails');
    if (pipelineCalled !== 0) throw new Error('Coordinator invoked despite ingest failure');
  });

  await runTest('TEST G - COORDINATOR FAILURE', async () => {
    pipelineShouldFail = true;
    const payload = { call_id: VALID_EXTERNAL, status: 'call.ended', transcript: 'hello' };
    const res = await processSarvamWebhook(payload, { 'authorization': `Bearer ${MOCK_SECRET}` });
    
    if (!res.success) throw new Error('Webhook failed when coordinator rejected');
    // Promise rejection handled asynchronously. Wait a tick.
    await new Promise(r => setTimeout(r, 10));
    if (pipelineCalled !== 1) throw new Error('Coordinator not called');
  });

  await runTest('TEST H - CORRELATION PROPAGATION', async () => {
    const payload = { call_id: VALID_EXTERNAL, status: 'call.ended', transcript: 'hello' };
    const res = await processSarvamWebhook(payload, { 'authorization': `Bearer ${MOCK_SECRET}` });
    if (!res.success) throw new Error('Webhook failed');
    const args = pipelineArgs[0];
    if (!args.correlationId || typeof args.correlationId !== 'string') {
      throw new Error('Correlation ID missing or invalid type');
    }
  });

  await runTest('TEST I - TENANT ISOLATION', async () => {
    const payload = { call_id: VALID_EXTERNAL, status: 'call.ended', transcript: 'hello', tenant_id: 'fake-tenant' } as any;
    const res = await processSarvamWebhook(payload, { 'authorization': `Bearer ${MOCK_SECRET}` });
    const args = pipelineArgs[0];
    if (args.tenantId !== VALID_TENANT) throw new Error('Payload manipulated tenant_id');
  });

  await runTest('TEST J - REPEATED EVENT AFTER SUCCESSFUL PIPELINE', async () => {
    // If a webhook payload is sent again, webhook deduplication (checking getEvent) should catch it
    supabaseDataService.webhookEvents.getEvent = async () => ({ id: 'existing' } as any);
    const payload = { call_id: VALID_EXTERNAL, status: 'call.ended', transcript: 'hello' };
    const res = await processSarvamWebhook(payload, { 'authorization': `Bearer ${MOCK_SECRET}` });
    if (pipelineCalled !== 0) throw new Error('Duplicate event triggered pipeline');
    if (res.action !== 'IGNORED_DUPLICATE') throw new Error('Action was not IGNORED_DUPLICATE');
  });

  await runTest('TEST K - REPEATED EVENT AFTER PIPELINE FAILURE', async () => {
    // Even if pipeline failed previously, if the webhook was recorded, it's a duplicate
    supabaseDataService.webhookEvents.getEvent = async () => ({ id: 'existing' } as any);
    const payload = { call_id: VALID_EXTERNAL, status: 'call.ended', transcript: 'hello' };
    const res = await processSarvamWebhook(payload, { 'authorization': `Bearer ${MOCK_SECRET}` });
    if (pipelineCalled !== 0) throw new Error('Duplicate event triggered pipeline');
    if (res.action !== 'IGNORED_DUPLICATE') throw new Error('Action was not IGNORED_DUPLICATE');
  });

  restoreMocks();

  const failedCount = results.filter(r => !r.passed).length;
  console.log('=============================================================');
  console.log(`Phase 8B.6.2 Webhook Auto-Progression Test Suite Results: ${results.length - failedCount} Passed, ${failedCount} Failed`);
  console.log('=============================================================');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

executeTests().catch(console.error);
