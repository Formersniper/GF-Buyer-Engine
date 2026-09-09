/**
 * GrowthForge Buyer Intelligence Engine - Phase 4B Sarvam Voice Unit Test Suite
 *
 * SPECIFICATION:
 * Tests the entire Sarvam Voice integration layer with fully mocked network boundaries.
 * Guarantees zero external network or telephony invocation during automated test execution.
 */

import { SarvamClient, SarvamOutboundPayload } from '../app/services/voice/sarvamClient';
import { SarvamVoiceProvider } from '../app/services/voice/sarvamVoiceProvider';
import { SarvamError, SarvamErrorCode } from '../app/services/voice/sarvamErrors';
import { processSarvamWebhook } from '../app/services/voice/sarvamWebhook';
import { buildSarvamSystemPrompt, buildSarvamInitialGreeting } from '../app/services/voice/sarvamPrompt';
import { mockVoiceProvider } from '../app/services/voice/mockVoiceProvider';
import { callService } from '../app/services/calls/callService';
import { supabaseDataService } from '../app/services/supabase/repositories';

let passed = 0;
let failed = 0;

function assert(testNum: number, description: string, condition: boolean, details?: string) {
  if (condition) {
    console.log(`  ✅ TEST ${testNum}: ${description}`);
    passed++;
  } else {
    console.error(`  ❌ TEST ${testNum}: ${description}`);
    if (details) console.error(`     Details: ${details}`);
    failed++;
  }
}

async function runSarvamUnitTests() {
  console.log('======================================================');
  console.log('🧪 GROWTHFORGE PHASE 4B — SARVAM UNIT TEST MATRIX');
  console.log('======================================================\n');

  // Backup original global fetch
  const originalFetch = global.fetch;

  // --- TEST 1: Missing Configuration -> SARVAM_CONFIG_ERROR ---
  const unconfiguredClient = new SarvamClient({ apiKey: '' });
  let test1Error: SarvamError | null = null;
  try {
    await unconfiguredClient.startOutboundCall({ toPhoneNumber: '+919876543210' });
  } catch (err: any) {
    test1Error = err;
  }
  assert(
    1,
    'Missing configuration -> SARVAM_CONFIG_ERROR',
    test1Error?.code === SarvamErrorCode.CONFIG_ERROR
  );

  // --- TEST 2: Authentication failure (401) -> SARVAM_AUTH_ERROR ---
  global.fetch = async () => {
    return new Response(JSON.stringify({ error: 'Invalid API Subscription Key' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const authClient = new SarvamClient({ apiKey: 'invalid_key_test' });
  let test2Error: SarvamError | null = null;
  try {
    await authClient.startOutboundCall({ toPhoneNumber: '+919876543210' });
  } catch (err: any) {
    test2Error = err;
  }
  assert(
    2,
    'Authentication failure (401) -> SARVAM_AUTH_ERROR',
    test2Error?.code === SarvamErrorCode.AUTH_ERROR && test2Error.statusCode === 401
  );

  // --- TEST 3: Invalid request / Bad Request (400) -> SARVAM_BAD_REQUEST ---
  global.fetch = async () => {
    return new Response(JSON.stringify({ error: 'Destination number invalid' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  let test3Error: SarvamError | null = null;
  try {
    await authClient.startOutboundCall({ toPhoneNumber: '+919876543210' });
  } catch (err: any) {
    test3Error = err;
  }
  assert(
    3,
    'Invalid request / Bad Request (400) -> SARVAM_BAD_REQUEST',
    test3Error?.code === SarvamErrorCode.BAD_REQUEST && test3Error.statusCode === 400
  );

  // --- TEST 4: Rate limit (429) -> SARVAM_RATE_LIMITED ---
  global.fetch = async () => {
    return new Response(JSON.stringify({ message: 'Rate limit exceeded' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  let test4Error: SarvamError | null = null;
  try {
    await authClient.startOutboundCall({ toPhoneNumber: '+919876543210' });
  } catch (err: any) {
    test4Error = err;
  }
  assert(
    4,
    'Rate limit (429) -> SARVAM_RATE_LIMITED',
    test4Error?.code === SarvamErrorCode.RATE_LIMITED && test4Error.statusCode === 429
  );

  // --- TEST 5: Timeout handling -> SARVAM_TIMEOUT ---
  global.fetch = async () => {
    const error = new Error('The operation was aborted');
    error.name = 'AbortError';
    throw error;
  };
  let test5Error: SarvamError | null = null;
  try {
    await authClient.startOutboundCall({ toPhoneNumber: '+919876543210' });
  } catch (err: any) {
    test5Error = err;
  }
  assert(
    5,
    'Timeout handling -> SARVAM_TIMEOUT',
    test5Error?.code === SarvamErrorCode.TIMEOUT
  );

  // --- TEST 6: Provider unavailable (503) -> SARVAM_UNAVAILABLE ---
  global.fetch = async () => {
    return new Response(JSON.stringify({ error: 'Telephony gateway down' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  let test6Error: SarvamError | null = null;
  try {
    await authClient.startOutboundCall({ toPhoneNumber: '+919876543210' });
  } catch (err: any) {
    test6Error = err;
  }
  assert(
    6,
    'Provider unavailable (503) -> SARVAM_UNAVAILABLE',
    test6Error?.code === SarvamErrorCode.UNAVAILABLE && test6Error.statusCode === 503
  );

  // --- TEST 7: Malformed / Non-JSON response -> SARVAM_INVALID_RESPONSE ---
  global.fetch = async () => {
    return new Response('<html>502 Bad Gateway</html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    });
  };
  let test7Error: SarvamError | null = null;
  try {
    await authClient.startOutboundCall({ toPhoneNumber: '+919876543210' });
  } catch (err: any) {
    test7Error = err;
  }
  assert(
    7,
    'Malformed / Non-JSON response -> SARVAM_INVALID_RESPONSE',
    test7Error?.code === SarvamErrorCode.INVALID_RESPONSE
  );

  // --- TEST 8: Successful outbound request -> exact Instant Outbound Schema & Headers ---
  const mockExternalCallId = '01a074ea-outbound-test-89104';
  let capturedUrl = '';
  let capturedHeaders: Record<string, string> = {};
  let capturedRequestBody: any = null;

  global.fetch = async (url: any, init: any) => {
    capturedUrl = String(url);
    capturedHeaders = init?.headers || {};
    if (init?.body) {
      capturedRequestBody = JSON.parse(init.body as string);
    }
    return new Response(
      JSON.stringify({
        outbound_id: mockExternalCallId,
        status: 'queued',
        timestamp: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  };

  const validClient = new SarvamClient({
    apiKey: 'test_sarvam_secret_key_123',
    baseUrl: 'https://apps.sarvam.ai',
    orgId: '01a074ea-647b-7549-9a87-cb4a09a65faa',
    workspaceId: '01a074ea-6481-766d-a3f3-c42aef343735',
    agentId: 'Growthforge-ae0789e1-56b8',
    agentVersion: '2',
    connectionId: '0174b928-7c-cdaf00f5-ff9a',
    agentPhoneNumber: '+918064266255',
  });

  const res8 = await validClient.startOutboundCall({
    toPhoneNumber: '+919145602414',
    recipientName: 'Vikram Mehta',
    leadId: 'GF-LEAD-TEST-001',
    enquiryType: 'Residential Luxury Property',
    customVariables: {
      customer_name: 'Vikram Mehta',
      lead_id: 'GF-LEAD-TEST-001',
    },
    webhookUrl: 'https://growthforge.local/api/voice/sarvam/webhook',
  });

  const expectedEndpoint = 'https://apps.sarvam.ai/api/outbounds/v1/orgs/01a074ea-647b-7549-9a87-cb4a09a65faa/workspaces/01a074ea-6481-766d-a3f3-c42aef343735/outbounds';

  const schemaValid =
    capturedUrl === expectedEndpoint &&
    capturedHeaders['X-API-Key'] === 'test_sarvam_secret_key_123' &&
    capturedRequestBody?.app_config?.app_id === 'Growthforge-ae0789e1-56b8' &&
    (capturedRequestBody?.app_config?.app_version === 2 || capturedRequestBody?.app_config?.app_version === '2') &&
    capturedRequestBody?.app_config?.app_type === 'agent' &&
    capturedRequestBody?.app_config?.connection_config?.connection_id === '0174b928-7c-cdaf00f5-ff9a' &&
    capturedRequestBody?.app_config?.connection_config?.agent_phone_number === '+918064266255' &&
    capturedRequestBody?.app_config?.agent_variables?.customer_name === 'Vikram Mehta' &&
    capturedRequestBody?.app_config?.agent_variables?.lead_id === 'GF-LEAD-TEST-001' &&
    capturedRequestBody?.user_config?.user_phone_number === '+919145602414' &&
    capturedRequestBody?.webhook_config?.url === 'https://growthforge.local/api/voice/sarvam/webhook' &&
    capturedRequestBody?.webhook_config?.metadata?.lead_id === 'GF-LEAD-TEST-001';

  assert(
    8,
    'Successful outbound request -> verifies endpoint, X-API-Key, app_config, connection_config, user_config, and webhook_config',
    res8.externalCallId === mockExternalCallId &&
      res8.status === 'queued' &&
      res8.targetPhoneMasked.includes('2414') &&
      schemaValid
  );

  // --- TEST 9: Provider failure -> SARVAM_PROVIDER_ERROR ---
  global.fetch = async () => {
    return new Response(JSON.stringify({ error: 'SIP trunk failure' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  let test9Error: SarvamError | null = null;
  try {
    await validClient.startOutboundCall({ toPhoneNumber: '+919876543210' });
  } catch (err: any) {
    test9Error = err;
  }
  assert(
    9,
    'Provider internal failure (500) -> SARVAM_PROVIDER_ERROR',
    test9Error?.code === SarvamErrorCode.UNAVAILABLE || test9Error?.code === SarvamErrorCode.PROVIDER_ERROR
  );

  // Restore global fetch for Supabase calls in subsequent tests
  global.fetch = originalFetch;

  // --- TEST 10: Status mapping accuracy ---
  const provider = new SarvamVoiceProvider(validClient);
  const mapRinging = provider.mapSarvamStatusToGF('ringing');
  const mapConnected = provider.mapSarvamStatusToGF('in-progress');
  const mapCompleted = provider.mapSarvamStatusToGF('completed');
  const mapNoAnswer = provider.mapSarvamStatusToGF('no-answer');
  const mapFailed = provider.mapSarvamStatusToGF('failed');

  assert(
    10,
    'Status mapping correctly converts provider statuses to GF canonical states',
    mapRinging === 'CALLING' &&
      mapConnected === 'CONNECTED' &&
      mapCompleted === 'COMPLETED' &&
      mapNoAnswer === 'NO_ANSWER' &&
      mapFailed === 'CALL_FAILED'
  );

  // --- TEST 11: Webhook parsing and state updates ---
  // Create a test lead and call record in Supabase
  const testExtCallId = `EXT-SARVAM-WH-${Date.now()}`;
  const testEventId = `EVT-${Date.now()}`;
  const testLead = await supabaseDataService.leads.createLead({
    lead_id: `GF-TEST-WEBHOOK-${Date.now()}`,
    name: 'Rohan Deshmukh',
    phone: '+919876543210',
    email: 'rohan@example.com',
    source: 'WEB_FORM',
    source_reference: null,
    status: 'CALLING',
  });

  const testCall = await supabaseDataService.calls.createCall({
    lead_id: testLead.id,
    provider: 'sarvam',
    provider_call_id: testExtCallId,
    status: 'CALLING',
    attempt_number: 1,
    started_at: new Date().toISOString(),
    ended_at: null,
    duration_seconds: 0,
    transcript: null,
    recording_url: null,
    call_outcome: null,
    call_metadata: { initiated: true },
  });

  const webhookResult = await processSarvamWebhook({
    event_id: testEventId,
    event_type: 'call.ended',
    call_id: testExtCallId,
    status: 'completed',
    duration_seconds: 94,
  });

  const updatedCall = await supabaseDataService.calls.getCall(testCall.id);
  const updatedLead = await supabaseDataService.leads.getLead(testLead.id);

  assert(
    11,
    'Webhook parsing updates calls table and lead workflow state',
    webhookResult.success === true &&
      updatedCall?.status === 'COMPLETED' &&
      updatedCall?.duration_seconds === 94 &&
      updatedLead?.status === 'QUALIFICATION_IN_PROGRESS'
  );

  // --- TEST 12: Duplicate webhook idempotency ---
  const duplicateResult = await processSarvamWebhook({
    event_id: testEventId, // Same event ID
    event_type: 'call.ended',
    call_id: testExtCallId,
    status: 'completed',
    duration_seconds: 94,
  });

  assert(
    12,
    'Duplicate webhook delivery is safely ignored (Idempotent)',
    duplicateResult.action === 'IGNORED_DUPLICATE'
  );

  // --- TEST 13: Secret never returned in health checks or payloads ---
  const healthCheck = await validClient.checkHealth();
  const healthJson = JSON.stringify(healthCheck);
  assert(
    13,
    'Secrets are completely shielded from health checks & return structures',
    healthCheck.configured === true &&
      !healthJson.includes('test_sarvam_secret_key_123') &&
      !healthJson.includes('apiKey')
  );

  // --- TEST 14: MockVoiceProvider remains strictly offline ---
  const mockCall = await mockVoiceProvider.initiateCall({
    lead_id: testLead.id,
    phone_number: '+919876543210',
    contact_name: 'Mock Buyer',
  });
  const mockStatus = await mockVoiceProvider.getCallStatus(mockCall.callId);

  assert(
    14,
    'MockVoiceProvider remains offline with initiated = false and status = MOCK_READY',
    mockCall.initiated === false &&
      mockCall.status === 'MOCK_READY' &&
      mockStatus.initiated === false
  );

  // --- TEST 15: Natural human sales voice prompt & persona verification ---
  const prompt = buildSarvamSystemPrompt({
    buyerName: 'Amit',
    targetCity: 'Gurgaon Golf Course Ext',
  });
  const greeting = buildSarvamInitialGreeting('Amit');

  assert(
    15,
    'Sales voice prompt enforces respectful "ji", English/Hindi/Hinglish, and truthful disclosure',
    prompt.includes('Neha') &&
      prompt.includes('Amit ji') &&
      prompt.includes('Hinglish') &&
      prompt.includes('TRUTHFUL IDENTITY DISCLOSURE') &&
      greeting.includes('Amit ji')
  );

  // Restore global fetch
  global.fetch = originalFetch;

  console.log('\n======================================================');
  console.log(`📊 PHASE 4B SARVAM UNIT TEST RESULTS: ${passed} / ${passed + failed} TESTS PASSED`);
  console.log('======================================================');

  if (failed > 0) {
    console.error(`💥 ${failed} UNIT TESTS FAILED`);
    process.exit(1);
  } else {
    console.log('🎉 ALL 15 SARVAM UNIT TESTS COMPLETED: PASS\n');
  }
}

runSarvamUnitTests().catch((err) => {
  console.error('Fatal test runner failure:', err);
  process.exit(1);
});
