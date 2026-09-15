/**
 * GrowthForge Buyer Intelligence Engine - Phase 8B.5.3 Integration Test Suite
 *
 * Production Webhook Channel Integration Verification
 * Tests the 14 required test scenarios across brokerHandoffService & crmConfigRepo:
 * 1. Dry-run configuration → Mock channel
 * 2. Production WEBHOOK configuration → Webhook channel
 * 3. Missing configuration → FAILED, NOT MOCK
 * 4. Disabled configuration → FAILED, NOT MOCK
 * 5. Missing endpoint → FAILED, NOT MOCK
 * 6. Unsupported destination type → FAILED
 * 7. Tenant A configuration cannot be used for Tenant B
 * 8. Successful webhook dispatch persists SENT
 * 9. Webhook 4xx persists FAILED + retry=false
 * 10. Webhook 5xx persists FAILED + retry=true
 * 11. Timeout persists FAILED + retry=true
 * 12. Existing duplicate dispatch behavior remains intact
 * 13. forceRedispatch behavior remains intact
 * 14. Credentials never appear in persisted errors/events
 */

import assert from 'assert';
import { supabaseDataService } from '../app/services/supabase/repositories';
import { brokerHandoffService } from '../app/services/handoff/brokerHandoffService';

const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';
const TENANT_ALPHA_ID = '11111111-1111-1111-1111-111111111111';
const TENANT_BETA_ID = '22222222-2222-2222-2222-222222222222';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

async function runTest(name: string, fn: () => Promise<void>) {
  process.stdout.write(`Testing: ${name}... `);
  try {
    await fn();
    console.log('✅ PASSED');
    results.push({ name, passed: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`❌ FAILED: ${msg}`);
    results.push({ name, passed: false, error: msg });
  }
}

function setWebhookFetch(mockHandler: (url: string, init?: RequestInit) => Promise<Response>) {
  const originalFetch = global.fetch;
  global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    if (urlStr.includes('supabase.co') || (process.env.VITE_SUPABASE_URL && urlStr.includes(process.env.VITE_SUPABASE_URL))) {
      return originalFetch(input, init);
    }
    return mockHandler(urlStr, init);
  };
  return () => {
    global.fetch = originalFetch;
  };
}

async function clearTenantConfigs(tenantId: string) {
  const configs = await supabaseDataService.crmConfigs.listConfigs({ tenantId, isPlatformAdmin: true });
  for (const cfg of configs) {
    await supabaseDataService.crmConfigs.deleteConfig({ tenantId, isPlatformAdmin: true }, cfg.id);
  }
}

async function createTenantConfig(tenantId: string, cfg: any) {
  return supabaseDataService.crmConfigs.createConfig(
    { tenantId },
    {
      metadata: null,
      ...cfg,
    } as any
  );
}

async function createHandoffForTenant(tenantId: string) {
  const lead = await supabaseDataService.leads.createLead(
    { tenantId },
    {
      lead_id: `GF-INT-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      name: 'Integration Test Buyer',
      phone: '+15550199',
      source: 'CSV_IMPORT',
      status: 'QUALIFIED',
      tenant_id: tenantId,
    } as any
  );

  const score = await supabaseDataService.buyerScores.createBuyerScoreRecord(
    { tenantId },
    {
      lead_id: lead.id,
      score: 92,
      composite_score: 92,
      tier: 'TIER_1_HOT',
      score_band: 'HOT',
      tenant_id: tenantId,
    } as any
  );

  const handoffRes = await brokerHandoffService.generateHandoff({
    leadId: lead.id,
    scoreId: score.id,
  });

  assert.ok(handoffRes.success && handoffRes.handoffId, 'Handoff generation failed');
  return { lead, score, handoffId: handoffRes.handoffId };
}

async function runAllIntegrationTests() {
  console.log('============================================================');
  console.log('PHASE 8B.5.3 — PRODUCTION WEBHOOK CHANNEL INTEGRATION TESTS');
  console.log('============================================================\n');

  // -------------------------------------------------------------
  // Test 1: Dry-run configuration → Mock channel
  // -------------------------------------------------------------
  await runTest('1. Dry-run configuration → Mock channel', async () => {
    const tenantId = DEFAULT_TENANT_ID;
    await clearTenantConfigs(tenantId);
    let fetchCalled = false;

    // Create config with dry_run_mode = true
    await createTenantConfig(tenantId, {
      provider_name: 'Mock Salesforce',
      destination_type: 'WEBHOOK',
      endpoint_url: 'https://example.com/webhook',
      is_enabled: true,
      dry_run_mode: true,
    });

    const { handoffId } = await createHandoffForTenant(tenantId);

    const restoreFetch = setWebhookFetch(async () => {
      fetchCalled = true;
      throw new Error('Network should not be called in dry-run mode');
    });

    try {
      const res = await brokerHandoffService.dispatchHandoff(handoffId, { dryRun: false });
      assert.strictEqual(fetchCalled, false, 'Network was unexpectedly contacted during dry-run config');
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.status, 'SENT');
      assert.strictEqual(res.dry_run, true);
      assert.ok(res.dispatch_id.startsWith('mock-dispatch-') || res.dispatch_id.startsWith('dry-run-'));
    } finally {
      restoreFetch();
    }
  });

  // -------------------------------------------------------------
  // Test 2: Production WEBHOOK configuration → Webhook channel
  // -------------------------------------------------------------
  await runTest('2. Production WEBHOOK configuration → Webhook channel', async () => {
    const tenantId = DEFAULT_TENANT_ID;
    await clearTenantConfigs(tenantId);
    let fetchCalled = false;
    let requestedUrl = '';

    await createTenantConfig(tenantId, {
      provider_name: 'Production HubSpot',
      destination_type: 'WEBHOOK',
      endpoint_url: 'https://example.com/prod/webhook',
      is_enabled: true,
      dry_run_mode: false,
    });

    const { handoffId } = await createHandoffForTenant(tenantId);

    const restoreFetch = setWebhookFetch(async (url) => {
      fetchCalled = true;
      requestedUrl = url;
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ status: 'received' }),
      } as Response;
    });

    try {
      const res = await brokerHandoffService.dispatchHandoff(handoffId, { dryRun: false });
      assert.strictEqual(fetchCalled, true, 'Real fetch was not called for production webhook');
      assert.strictEqual(requestedUrl, 'https://example.com/prod/webhook');
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.status, 'SENT');
      assert.strictEqual(res.dry_run, false);
      assert.ok(res.dispatch_id && res.dispatch_id.length > 0);
    } finally {
      restoreFetch();
    }
  });

  // -------------------------------------------------------------
  // Test 3: Missing configuration → FAILED, NOT MOCK
  // -------------------------------------------------------------
  await runTest('3. Missing configuration → FAILED, NOT MOCK', async () => {
    const tenantId = DEFAULT_TENANT_ID;
    await clearTenantConfigs(tenantId);
    let fetchCalled = false;

    const { lead, handoffId } = await createHandoffForTenant(tenantId);

    const restoreFetch = setWebhookFetch(async () => {
      fetchCalled = true;
      throw new Error('Should not reach network');
    });

    try {
      const res = await brokerHandoffService.dispatchHandoff(handoffId, { dryRun: false });
      assert.strictEqual(fetchCalled, false);
      assert.strictEqual(res.success, false, 'Missing config must fail');
      assert.strictEqual(res.status, 'FAILED', 'Must not downgrade to mock simulation');
      assert.strictEqual(res.error, 'CRM webhook configuration is missing');
      assert.strictEqual(res.retry_eligible, false);

      const dbHandoff = await supabaseDataService.brokerHandoffs.getHandoff({ tenantId }, handoffId);
      assert.strictEqual(dbHandoff?.dispatch_status, 'FAILED');

      const events = await supabaseDataService.leadEvents.getLeadEvents({ tenantId }, lead.id);
      const failedEvt = events.find((e) => e.event_type === 'DISPATCH_FAILED');
      assert.ok(failedEvt, 'Must log DISPATCH_FAILED event');
      assert.strictEqual(failedEvt.event_data?.error, 'CRM webhook configuration is missing');
    } finally {
      restoreFetch();
    }
  });

  // -------------------------------------------------------------
  // Test 4: Disabled configuration → FAILED, NOT MOCK
  // -------------------------------------------------------------
  await runTest('4. Disabled configuration → FAILED, NOT MOCK', async () => {
    const tenantId = DEFAULT_TENANT_ID;
    await clearTenantConfigs(tenantId);
    let fetchCalled = false;

    await createTenantConfig(tenantId, {
      provider_name: 'Disabled Webhook',
      destination_type: 'WEBHOOK',
      endpoint_url: 'https://example.com/webhook',
      is_enabled: false,
      dry_run_mode: false,
    });

    const { handoffId } = await createHandoffForTenant(tenantId);

    const restoreFetch = setWebhookFetch(async () => {
      fetchCalled = true;
      throw new Error('Should not reach network');
    });

    try {
      const res = await brokerHandoffService.dispatchHandoff(handoffId, { dryRun: false });
      assert.strictEqual(fetchCalled, false);
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.status, 'FAILED');
      assert.strictEqual(res.error, 'CRM webhook configuration is disabled');
      assert.strictEqual(res.retry_eligible, false);

      const dbHandoff = await supabaseDataService.brokerHandoffs.getHandoff({ tenantId }, handoffId);
      assert.strictEqual(dbHandoff?.dispatch_status, 'FAILED');
    } finally {
      restoreFetch();
    }
  });

  // -------------------------------------------------------------
  // Test 5: Missing endpoint → FAILED, NOT MOCK
  // -------------------------------------------------------------
  await runTest('5. Missing endpoint → FAILED, NOT MOCK', async () => {
    const tenantId = DEFAULT_TENANT_ID;
    await clearTenantConfigs(tenantId);
    let fetchCalled = false;

    await createTenantConfig(tenantId, {
      provider_name: 'No Endpoint Webhook',
      destination_type: 'WEBHOOK',
      endpoint_url: '',
      is_enabled: true,
      dry_run_mode: false,
    });

    const { handoffId } = await createHandoffForTenant(tenantId);

    const restoreFetch = setWebhookFetch(async () => {
      fetchCalled = true;
      throw new Error('Should not reach network');
    });

    try {
      const res = await brokerHandoffService.dispatchHandoff(handoffId, { dryRun: false });
      assert.strictEqual(fetchCalled, false);
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.status, 'FAILED');
      assert.strictEqual(res.error, 'CRM webhook endpoint is missing');
      assert.strictEqual(res.retry_eligible, false);

      const dbHandoff = await supabaseDataService.brokerHandoffs.getHandoff({ tenantId }, handoffId);
      assert.strictEqual(dbHandoff?.dispatch_status, 'FAILED');
    } finally {
      restoreFetch();
    }
  });

  // -------------------------------------------------------------
  // Test 6: Unsupported destination type → FAILED
  // -------------------------------------------------------------
  await runTest('6. Unsupported destination type → FAILED', async () => {
    const tenantId = DEFAULT_TENANT_ID;
    await clearTenantConfigs(tenantId);
    let fetchCalled = false;

    await createTenantConfig(tenantId, {
      provider_name: 'Legacy REST CRM',
      destination_type: 'API',
      endpoint_url: 'https://example.com/api',
      is_enabled: true,
      dry_run_mode: false,
    });

    const { handoffId } = await createHandoffForTenant(tenantId);

    const restoreFetch = setWebhookFetch(async () => {
      fetchCalled = true;
      throw new Error('Should not reach network');
    });

    try {
      const res = await brokerHandoffService.dispatchHandoff(handoffId, { dryRun: false });
      assert.strictEqual(fetchCalled, false);
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.status, 'FAILED');
      assert.strictEqual(res.error, 'CRM destination type is unsupported');
      assert.strictEqual(res.retry_eligible, false);

      const dbHandoff = await supabaseDataService.brokerHandoffs.getHandoff({ tenantId }, handoffId);
      assert.strictEqual(dbHandoff?.dispatch_status, 'FAILED');
    } finally {
      restoreFetch();
    }
  });

  // -------------------------------------------------------------
  // Test 7: Tenant A configuration cannot be used for Tenant B
  // -------------------------------------------------------------
  await runTest('7. Tenant A configuration cannot be used for Tenant B', async () => {
    const tenantA = TENANT_ALPHA_ID;
    const tenantB = TENANT_BETA_ID;
    await clearTenantConfigs(tenantA);
    await clearTenantConfigs(tenantB);

    // Tenant B has configured webhook
    await createTenantConfig(tenantB, {
      provider_name: 'Tenant B Webhook',
      destination_type: 'WEBHOOK',
      endpoint_url: 'https://example.com/tenant-b-endpoint',
      is_enabled: true,
      dry_run_mode: false,
    });

    // Tenant A has NO configuration
    const { handoffId: handoffA } = await createHandoffForTenant(tenantA);

    const resA = await brokerHandoffService.dispatchHandoff(handoffA, { dryRun: false });

    // Tenant A MUST NOT use Tenant B's config
    assert.strictEqual(resA.success, false);
    assert.strictEqual(resA.status, 'FAILED');
    assert.strictEqual(resA.error, 'CRM webhook configuration is missing');
  });

  // -------------------------------------------------------------
  // Test 8: Successful webhook dispatch persists SENT
  // -------------------------------------------------------------
  await runTest('8. Successful webhook dispatch persists SENT', async () => {
    const tenantId = DEFAULT_TENANT_ID;
    await clearTenantConfigs(tenantId);

    await createTenantConfig(tenantId, {
      provider_name: 'Salesforce Webhook',
      destination_type: 'WEBHOOK',
      endpoint_url: 'https://example.com/webhook',
      is_enabled: true,
      dry_run_mode: false,
    });

    const { lead, handoffId } = await createHandoffForTenant(tenantId);

    const restoreFetch = setWebhookFetch(async () => {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ status: 'success' }),
      } as Response;
    });

    try {
      const res = await brokerHandoffService.dispatchHandoff(handoffId, { dryRun: false });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.status, 'SENT');

      const dbHandoff = await supabaseDataService.brokerHandoffs.getHandoff({ tenantId }, handoffId);
      assert.strictEqual(dbHandoff?.dispatch_status, 'SENT');
      assert.strictEqual(dbHandoff?.handoff_status, 'DISPATCHED');
      assert.strictEqual(dbHandoff?.routing_status, 'ROUTED');

      const events = await supabaseDataService.leadEvents.getLeadEvents({ tenantId }, lead.id);
      const compEvt = events.find((e) => e.event_type === 'DISPATCH_COMPLETED');
      assert.ok(compEvt, 'Must record DISPATCH_COMPLETED event');
    } finally {
      restoreFetch();
    }
  });

  // -------------------------------------------------------------
  // Test 9: Webhook 4xx persists FAILED + retry=false
  // -------------------------------------------------------------
  await runTest('9. Webhook 4xx persists FAILED + retry=false', async () => {
    const tenantId = DEFAULT_TENANT_ID;
    await clearTenantConfigs(tenantId);

    await createTenantConfig(tenantId, {
      provider_name: 'HubSpot Webhook',
      destination_type: 'WEBHOOK',
      endpoint_url: 'https://example.com/webhook',
      is_enabled: true,
      dry_run_mode: false,
    });

    const { lead, handoffId } = await createHandoffForTenant(tenantId);

    const restoreFetch = setWebhookFetch(async () => {
      return {
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        headers: new Headers(),
        text: async () => 'Payload rejected',
      } as Response;
    });

    try {
      const res = await brokerHandoffService.dispatchHandoff(handoffId, { dryRun: false });
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.status, 'FAILED');
      assert.strictEqual(res.retry_eligible, false);

      const dbHandoff = await supabaseDataService.brokerHandoffs.getHandoff({ tenantId }, handoffId);
      assert.strictEqual(dbHandoff?.dispatch_status, 'FAILED');
      assert.strictEqual(dbHandoff?.retry_eligible, false);

      const events = await supabaseDataService.leadEvents.getLeadEvents({ tenantId }, lead.id);
      const failedEvt = events.find((e) => e.event_type === 'DISPATCH_FAILED');
      assert.ok(failedEvt);
      assert.strictEqual(failedEvt.event_data?.retry_eligible, false);
    } finally {
      restoreFetch();
    }
  });

  // -------------------------------------------------------------
  // Test 10: Webhook 5xx persists FAILED + retry=true
  // -------------------------------------------------------------
  await runTest('10. Webhook 5xx persists FAILED + retry=true', async () => {
    const tenantId = DEFAULT_TENANT_ID;
    await clearTenantConfigs(tenantId);

    await createTenantConfig(tenantId, {
      provider_name: 'HubSpot Webhook 5xx',
      destination_type: 'WEBHOOK',
      endpoint_url: 'https://example.com/webhook',
      is_enabled: true,
      dry_run_mode: false,
    });

    const { lead, handoffId } = await createHandoffForTenant(tenantId);

    const restoreFetch = setWebhookFetch(async () => {
      return {
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        headers: new Headers(),
        text: async () => 'Service Unavailable',
      } as Response;
    });

    try {
      const res = await brokerHandoffService.dispatchHandoff(handoffId, { dryRun: false });
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.status, 'FAILED');
      assert.strictEqual(res.retry_eligible, true);

      const dbHandoff = await supabaseDataService.brokerHandoffs.getHandoff({ tenantId }, handoffId);
      assert.strictEqual(dbHandoff?.dispatch_status, 'FAILED');
      assert.strictEqual(dbHandoff?.retry_eligible, true);

      const events = await supabaseDataService.leadEvents.getLeadEvents({ tenantId }, lead.id);
      const failedEvt = events.find((e) => e.event_type === 'DISPATCH_FAILED');
      assert.ok(failedEvt);
      assert.strictEqual(failedEvt.event_data?.retry_eligible, true);
    } finally {
      restoreFetch();
    }
  });

  // -------------------------------------------------------------
  // Test 11: Timeout persists FAILED + retry=true
  // -------------------------------------------------------------
  await runTest('11. Timeout persists FAILED + retry=true', async () => {
    const tenantId = DEFAULT_TENANT_ID;
    await clearTenantConfigs(tenantId);

    await createTenantConfig(tenantId, {
      provider_name: 'Timeout Webhook',
      destination_type: 'WEBHOOK',
      endpoint_url: 'https://example.com/webhook',
      is_enabled: true,
      dry_run_mode: false,
    });

    const { lead, handoffId } = await createHandoffForTenant(tenantId);

    const restoreFetch = setWebhookFetch(async () => {
      const err = new Error('The operation was aborted.');
      err.name = 'AbortError';
      throw err;
    });

    try {
      const res = await brokerHandoffService.dispatchHandoff(handoffId, { dryRun: false });
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.status, 'FAILED');
      assert.strictEqual(res.retry_eligible, true);
      assert.strictEqual(res.error, 'Request timed out after 5000ms');

      const dbHandoff = await supabaseDataService.brokerHandoffs.getHandoff({ tenantId }, handoffId);
      assert.strictEqual(dbHandoff?.dispatch_status, 'FAILED');
      assert.strictEqual(dbHandoff?.retry_eligible, true);
      assert.strictEqual(dbHandoff?.dispatch_error, 'Request timed out after 5000ms');

      const events = await supabaseDataService.leadEvents.getLeadEvents({ tenantId }, lead.id);
      const failedEvt = events.find((e) => e.event_type === 'DISPATCH_FAILED');
      assert.ok(failedEvt);
      assert.strictEqual(failedEvt.event_data?.error, 'Request timed out after 5000ms');
      assert.strictEqual(failedEvt.event_data?.retry_eligible, true);
    } finally {
      restoreFetch();
    }
  });

  // -------------------------------------------------------------
  // Test 12: Existing duplicate dispatch behavior remains intact
  // -------------------------------------------------------------
  await runTest('12. Existing duplicate dispatch behavior remains intact', async () => {
    const tenantId = DEFAULT_TENANT_ID;
    await clearTenantConfigs(tenantId);
    let networkCalls = 0;

    await createTenantConfig(tenantId, {
      provider_name: 'Duplicate Test Webhook',
      destination_type: 'WEBHOOK',
      endpoint_url: 'https://example.com/webhook',
      is_enabled: true,
      dry_run_mode: false,
    });

    const { lead, handoffId } = await createHandoffForTenant(tenantId);

    const restoreFetch = setWebhookFetch(async () => {
      networkCalls++;
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        json: async () => ({ status: 'ok' }),
      } as Response;
    });

    try {
      // First dispatch -> SENT
      const firstRes = await brokerHandoffService.dispatchHandoff(handoffId, { dryRun: false });
      assert.strictEqual(firstRes.status, 'SENT');
      assert.strictEqual(networkCalls, 1);

      // Second dispatch without forceRedispatch -> IGNORED_DUPLICATE
      const secondRes = await brokerHandoffService.dispatchHandoff(handoffId, { dryRun: false, forceRedispatch: false });
      assert.strictEqual(secondRes.status, 'IGNORED_DUPLICATE');
      assert.strictEqual(secondRes.success, true);
      assert.strictEqual(networkCalls, 1, 'Network call must NOT be repeated for duplicate dispatch');

      const events = await supabaseDataService.leadEvents.getLeadEvents({ tenantId }, lead.id);
      const dupEvt = events.find((e) => e.event_type === 'DISPATCH_DUPLICATE');
      assert.ok(dupEvt, 'Must record DISPATCH_DUPLICATE event');
    } finally {
      restoreFetch();
    }
  });

  // -------------------------------------------------------------
  // Test 13: forceRedispatch behavior remains intact
  // -------------------------------------------------------------
  await runTest('13. forceRedispatch behavior remains intact', async () => {
    const tenantId = DEFAULT_TENANT_ID;
    await clearTenantConfigs(tenantId);
    let networkCalls = 0;

    await createTenantConfig(tenantId, {
      provider_name: 'Force Redispatch Webhook',
      destination_type: 'WEBHOOK',
      endpoint_url: 'https://example.com/webhook',
      is_enabled: true,
      dry_run_mode: false,
    });

    const { handoffId } = await createHandoffForTenant(tenantId);

    const restoreFetch = setWebhookFetch(async () => {
      networkCalls++;
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        json: async () => ({ status: 'ok' }),
      } as Response;
    });

    try {
      // First dispatch
      await brokerHandoffService.dispatchHandoff(handoffId, { dryRun: false });
      assert.strictEqual(networkCalls, 1);

      // Redispatch with forceRedispatch = true
      const forcedRes = await brokerHandoffService.dispatchHandoff(handoffId, { dryRun: false, forceRedispatch: true });
      assert.strictEqual(forcedRes.status, 'SENT');
      assert.strictEqual(networkCalls, 2, 'Force redispatch must execute second network call');
    } finally {
      restoreFetch();
    }
  });

  // -------------------------------------------------------------
  // Test 14: Credentials never appear in persisted errors/events
  // -------------------------------------------------------------
  await runTest('14. Credentials never appear in persisted errors/events', async () => {
    const tenantId = DEFAULT_TENANT_ID;
    await clearTenantConfigs(tenantId);
    const rawSecret = 'super-secret-api-token-999';

    await createTenantConfig(tenantId, {
      provider_name: 'Secret Webhook',
      destination_type: 'WEBHOOK',
      endpoint_url: 'https://example.com/webhook',
      is_enabled: true,
      dry_run_mode: false,
      metadata: {
        api_key: rawSecret,
      },
    });

    const { lead, handoffId } = await createHandoffForTenant(tenantId);

    const restoreFetch = setWebhookFetch(async () => {
      throw new Error(`Failed connecting with Bearer ${rawSecret}`);
    });

    try {
      const res = await brokerHandoffService.dispatchHandoff(handoffId, { dryRun: false });
      assert.strictEqual(res.success, false);
      assert.ok(!res.error?.includes(rawSecret), 'Returned error leaked credential');
      assert.ok(res.error?.includes('[REDACTED]'), 'Returned error should contain [REDACTED]');

      const dbHandoff = await supabaseDataService.brokerHandoffs.getHandoff({ tenantId }, handoffId);
      assert.ok(!dbHandoff?.dispatch_error?.includes(rawSecret), 'Persisted dispatch_error leaked credential');

      const events = await supabaseDataService.leadEvents.getLeadEvents({ tenantId }, lead.id);
      const failedEvt = events.find((e) => e.event_type === 'DISPATCH_FAILED');
      assert.ok(!JSON.stringify(failedEvt?.event_data).includes(rawSecret), 'Lead event leaked credential');
    } finally {
      restoreFetch();
    }
  });

  console.log('\n============================================================');
  console.log('PHASE 8B.5.3 TEST SUMMARY');
  console.log('============================================================');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Total  : ${results.length}`);
  console.log(`Passed : ${passed}`);
  console.log(`Failed : ${failed}`);

  if (failed > 0) {
    console.error('\nFailed tests:');
    results.filter((r) => !r.passed).forEach((r) => console.error(` - ${r.name}: ${r.error}`));
    process.exit(1);
  } else {
    console.log('\n🎉 ALL 14 PHASE 8B.5.3 INTEGRATION TESTS PASSED PERFECTLY!');
    process.exit(0);
  }
}

runAllIntegrationTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
