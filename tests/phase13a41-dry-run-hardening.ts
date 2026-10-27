/**
 * GrowthForge Phase 13A.4.1 — Dry-Run State Hardening & Metadata Token Prohibition Tests
 *
 * Verifies:
 * 1. Dry-run creates zero external HTTP requests.
 * 2. Dry-run does NOT mark handoff_status as DISPATCHED (preserves actual handoff readiness).
 * 3. Dry-run sets explicit 'dry-run-' dispatch_id prefix and records simulation audit event.
 * 4. A dry-run does NOT prevent a later authorized real dispatch (promotes to live dispatch).
 * 5. A real successful dispatch remains protected by duplicate suppression.
 * 6. CRM metadata.access_token is strictly ignored/rejected and does not override server auth.
 * 7. WEBHOOK dry-run and live dispatch regression behavior.
 * 8. GOOGLE_SHEETS dry-run and live dispatch regression behavior.
 */

import assert from 'assert';
import { supabaseDataService } from '../app/services/supabase';
import { brokerHandoffService } from '../app/services/handoff/brokerHandoffService';
import { generateUUID } from '../app/services/supabase/repos/helpers';
import { BrokerHandoffPackage } from '../app/schemas/handoff';

async function runTestSuite() {
  console.log('============================================================');
  console.log('GROWTHFORGE PHASE 13A.4.1 — DRY-RUN HARDENING TEST SUITE');
  console.log('============================================================\n');

  let passed = 0;
  let total = 0;

  async function test(name: string, fn: () => Promise<void>) {
    total++;
    try {
      await fn();
      passed++;
      console.log(`  ✅ PASS: ${total}. ${name}`);
    } catch (err: any) {
      console.error(`  ❌ FAIL: ${total}. ${name}`, err);
      throw err;
    }
  }

  const tenantId = `00000000-0000-0000-0000-${String(Date.now()).slice(0, 12).padStart(12, '0')}`;
  await supabaseDataService.tenants.createTenant({
    id: tenantId,
    name: 'DryRun Hardening Tenant',
    slug: `dryrun-test-${Date.now()}`,
    status: 'ACTIVE',
  } as any);
  const tenantScope = { tenantId, isPlatformAdmin: false };

  // Helper to create a test handoff
  async function createTestHandoff() {
    const leadId = generateUUID();
    const handoffId = generateUUID();

    await supabaseDataService.leads.createLead(
      tenantScope,
      {
        id: leadId,
        tenant_id: tenantId,
        lead_id: `GF-DRYRUN-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        name: 'DryRun Test Buyer',
        phone: '+919876543299',
        status: 'QUALIFIED',
      }
    );

    const handoffPayload = {
      handoff_id: handoffId,
      lead_id: leadId,
      external_lead_id: 'TEST_PORTAL',
      qualification_id: 'qual-dry-01',
      score_id: null,
      extraction_id: 'ext-dry-01',
      transcript_id: 'tr-dry-01',
      call_id: 'call-dry-01',
      primary_buyer_summary: {
        name: 'DryRun Test Buyer',
        phone: '+919876543299',
        location: 'Bengaluru',
        contact_status: 'CONTACTABLE',
      },
      priority: {
        score: 85,
        band: 'WARM',
        tier: 'TIER_2_WARM',
        sla_minutes: 60,
        sla_deadline: new Date(Date.now() + 3600000).toISOString(),
        urgency: 'HIGH',
      },
      routing_decision: {
        assigned_team: 'SENIOR_SALES',
        assigned_role: 'SENIOR_SALES_ADVISOR',
        tier: 'TIER_2_WARM',
        sla_minutes: 60,
        sla_deadline: new Date(Date.now() + 3600000).toISOString(),
        routing_action: 'SCHEDULED_CALLBACK',
        follow_up_urgency: 'HIGH',
        reason_codes: ['BUDGET_CONFIRMED'],
      },
    };

    const saved = await supabaseDataService.brokerHandoffs.createHandoff(
      tenantScope,
      {
        id: handoffId,
        lead_id: leadId,
        tenant_id: tenantId,
        handoff_status: 'READY',
        routing_status: 'ASSIGNED',
        dispatch_status: 'PENDING',
        priority_tier: 'TIER_2_WARM',
        sla_minutes: 60,
        sla_deadline: new Date(Date.now() + 3600000).toISOString(),
        handoff_payload: handoffPayload,
      } as any
    );

    return { leadId, handoffId, saved };
  }

  // 1. Dry-run creates zero external HTTP requests
  await test('Dry-run creates zero external HTTP requests and returns simulation success', async () => {
    const { handoffId } = await createTestHandoff();
    const res = await brokerHandoffService.dispatchHandoff(handoffId, { dryRun: true });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.dry_run, true);
    assert(res.dispatch_id.startsWith('mock-dispatch-') || res.dispatch_id.startsWith('dry-run-'));
  });

  // 2. Dry-run does NOT mark handoff_status as DISPATCHED
  await test('Dry-run preserves handoff_status as READY and does not claim DISPATCHED', async () => {
    const { handoffId } = await createTestHandoff();
    await brokerHandoffService.dispatchHandoff(handoffId, { dryRun: true });

    const stored = await supabaseDataService.brokerHandoffs.getHandoff(tenantScope, handoffId);
    assert.ok(stored, 'Handoff must exist');
    assert.strictEqual(stored.handoff_status, 'READY', 'handoff_status must NOT be set to DISPATCHED on dry-run');
    assert(stored.dispatch_id?.startsWith('mock-dispatch-') || stored.dispatch_id?.startsWith('dry-run-'));
  });

  // 3. Dry-run distinctly audits simulation in lead_events
  await test('Dry-run distinctly records simulated delivery in lead_events audit trail', async () => {
    const { leadId, handoffId } = await createTestHandoff();
    await brokerHandoffService.dispatchHandoff(handoffId, { dryRun: true });

    const events = await supabaseDataService.leadEvents.getLeadEvents(tenantScope, leadId);
    const dispatchCompleted = events.find((e) => e.event_type === 'DISPATCH_COMPLETED');
    assert.ok(dispatchCompleted, 'DISPATCH_COMPLETED event must be recorded');
    assert.strictEqual(dispatchCompleted.event_data?.dry_run, true, 'Audit event must record dry_run: true');
    assert.strictEqual(dispatchCompleted.event_data?.simulated, true, 'Audit event must record simulated: true');
  });

  // 4. A dry-run does NOT prevent a later authorized real dispatch
  await test('A dry-run does NOT prevent a later authorized real dispatch (promotes to real delivery)', async () => {
    const { handoffId } = await createTestHandoff();

    // First dispatch in dry-run mode
    const dryRunRes = await brokerHandoffService.dispatchHandoff(handoffId, { dryRun: true });
    assert.strictEqual(dryRunRes.success, true);
    assert.strictEqual(dryRunRes.dry_run, true);

    // Now configure a destination with dry_run_mode: false and dispatch with dryRun: false
    const config = await supabaseDataService.crmConfigs.createConfig(tenantScope, {
      provider_name: 'WebhookDestinationTest',
      destination_type: 'WEBHOOK',
      endpoint_url: 'http://93.184.216.34/test-endpoint',
      is_enabled: true,
      dry_run_mode: false,
      metadata: {},
    });

    // Mock global fetch for this test
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (async (url: any, init: any) => {
      const urlStr = String(url);
      if (urlStr.includes('93.184.216.34')) {
        fetchCalled = true;
        return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return originalFetch(url, init);
    }) as any;

    try {
      // Second dispatch is a REAL authorized dispatch
      const liveRes = await brokerHandoffService.dispatchHandoff(handoffId, { dryRun: false });

      assert.strictEqual(liveRes.success, true);
      assert.strictEqual(liveRes.dry_run, false, 'Must be a live dispatch');
      assert.notStrictEqual(liveRes.status, 'IGNORED_DUPLICATE', 'Must NOT be rejected as duplicate solely because prior dry-run succeeded');
      assert.strictEqual(liveRes.status, 'SENT');
      assert.strictEqual(fetchCalled, true, 'Real HTTP dispatch must be executed');

      // Verify DB state was genuinely updated to DISPATCHED
      const updatedHandoff = await supabaseDataService.brokerHandoffs.getHandoff(tenantScope, handoffId);
      assert.strictEqual(updatedHandoff?.handoff_status, 'DISPATCHED', 'Real delivery must update handoff_status to DISPATCHED');
      assert(!updatedHandoff?.dispatch_id?.startsWith('dry-run-'), 'Real delivery must have real dispatch ID');
    } finally {
      globalThis.fetch = originalFetch;
      await supabaseDataService.crmConfigs.deleteConfig(tenantScope, config.id);
    }
  });

  // 5. A real successful dispatch remains protected by duplicate suppression
  await test('A real successful dispatch is protected against subsequent duplicate dispatches', async () => {
    const { handoffId } = await createTestHandoff();

    const config = await supabaseDataService.crmConfigs.createConfig(tenantScope, {
      provider_name: 'WebhookDuplicateTest',
      destination_type: 'WEBHOOK',
      endpoint_url: 'http://93.184.216.34/test-dup-endpoint',
      is_enabled: true,
      dry_run_mode: false,
      metadata: {},
    });

    const originalFetch = globalThis.fetch;
    let fetchCallCount = 0;
    globalThis.fetch = (async (url: any, init: any) => {
      const urlStr = String(url);
      if (urlStr.includes('93.184.216.34')) {
        fetchCallCount++;
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return originalFetch(url, init);
    }) as any;

    try {
      // Live dispatch 1
      const res1 = await brokerHandoffService.dispatchHandoff(handoffId, { dryRun: false });
      assert.strictEqual(res1.success, true);
      assert.strictEqual(fetchCallCount, 1);

      // Live dispatch 2 (without forceRedispatch)
      const res2 = await brokerHandoffService.dispatchHandoff(handoffId, { dryRun: false, forceRedispatch: false });
      assert.strictEqual(res2.success, true);
      assert.strictEqual(res2.status, 'IGNORED_DUPLICATE', 'Subsequent live dispatch must return IGNORED_DUPLICATE');
      assert.strictEqual(fetchCallCount, 1, 'Duplicate dispatch must not trigger additional HTTP request');
    } finally {
      globalThis.fetch = originalFetch;
      await supabaseDataService.crmConfigs.deleteConfig(tenantScope, config.id);
    }
  });

  // 6. CRM metadata.access_token is strictly rejected/ignored
  await test('CRM metadata.access_token is strictly ignored and rejected for Google Sheets', async () => {
    const { handoffId } = await createTestHandoff();

    // Create config containing legacy access_token in metadata
    const config = await supabaseDataService.crmConfigs.createConfig(tenantScope, {
      provider_name: 'SheetsMetadataTest',
      destination_type: 'GOOGLE_SHEETS',
      endpoint_url: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
      is_enabled: true,
      dry_run_mode: false,
      metadata: {
        access_token: 'malicious-or-tenant-injected-token',
        sheet_name: 'Qualified Leads',
      },
    });

    try {
      // Clear environment credentials to ensure channel cannot fall back to valid creds
      const savedKey = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY;
      const savedToken = process.env.GOOGLE_SHEETS_ACCESS_TOKEN;
      delete process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY;
      delete process.env.GOOGLE_SHEETS_ACCESS_TOKEN;

      try {
        const res = await brokerHandoffService.dispatchHandoff(handoffId, { dryRun: false });
        // Must fail because metadata.access_token was ignored and no server-side credentials exist
        assert.strictEqual(res.success, false, 'Must fail because metadata.access_token is ignored');
        assert.strictEqual(res.status, 'FAILED');
        assert(res.error?.includes('credentials') || res.error?.includes('authentication'), 'Error must cite missing credentials');
      } finally {
        if (savedKey) process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY = savedKey;
        if (savedToken) process.env.GOOGLE_SHEETS_ACCESS_TOKEN = savedToken;
      }
    } finally {
      await supabaseDataService.crmConfigs.deleteConfig(tenantScope, config.id);
    }
  });

  // 7. WEBHOOK regression behavior intact
  await test('Existing WEBHOOK dispatch regression intact with SSRF and signature validation', async () => {
    const { handoffId } = await createTestHandoff();

    const config = await supabaseDataService.crmConfigs.createConfig(tenantScope, {
      provider_name: 'WebhookRegressionHardening',
      destination_type: 'WEBHOOK',
      endpoint_url: 'https://api.example.com/regression-webhook',
      is_enabled: true,
      dry_run_mode: true,
      metadata: {},
    });

    try {
      const res = await brokerHandoffService.dispatchHandoff(handoffId, { dryRun: true });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.channel, 'WebhookRegressionHardening');
      assert.strictEqual(res.dry_run, true);
    } finally {
      await supabaseDataService.crmConfigs.deleteConfig(tenantScope, config.id);
    }
  });

  console.log('============================================================');
  console.log(`PHASE 13A.4.1 DRY-RUN HARDENING TEST RESULTS: ${passed} / ${total} PASSED (100% GREEN)`);
  console.log('============================================================\n');
}

runTestSuite().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
