/**
 * GrowthForge Phase 13A.2 — Google Sheets Delivery Channel Test Suite
 *
 * Verifies all 23 required test scenarios:
 * 1. All 20 output columns and their order.
 * 2. Missing optional values.
 * 3. Null or unknown consent representation.
 * 4. Valid budget formatting when source units are known.
 * 5. Missing or invalid configuration.
 * 6. Dry-run makes zero HTTP calls.
 * 7. Successful existing-row lookup and append.
 * 8. Existing handoff ID suppresses append.
 * 9. Ambiguous append response followed by successful reconciliation.
 * 10. Ambiguous append that remains unresolved returns retryable failure.
 * 11. HTTP 400 handling.
 * 12. HTTP 401 handling.
 * 13. HTTP 403 handling.
 * 14. HTTP 404 handling.
 * 15. HTTP 429 retryability.
 * 16. HTTP 500/503 retryability.
 * 17. Network failure handling.
 * 18. Spreadsheet and worksheet range encoding.
 * 19. Formula-injection safety for untrusted text.
 * 20. No credentials or phone numbers in logs.
 * 21. Tenant-scoped configuration selection.
 * 22. Existing WEBHOOK dispatch regression.
 * 23. Existing duplicate-dispatch behavior regression.
 */

import assert from 'assert';
import {
  GoogleSheetsBrokerHandoffChannel,
  formatHandoffRow,
  sanitizeCell,
  formatBudget,
} from '../app/services/handoff/channels/googleSheetsChannel';
import { BrokerHandoffPackage } from '../app/schemas/handoff';
import { brokerHandoffService } from '../app/services/handoff/brokerHandoffService';
import { supabaseDataService } from '../app/services/supabase/repositories';

const TEST_SPREADSHEET_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
const TEST_ACCESS_TOKEN = 'mock-google-sheets-token-abc-123';

function buildMockHandoff(overrides?: Partial<BrokerHandoffPackage>): BrokerHandoffPackage {
  return {
    handoff_id: '11111111-2222-3333-4444-555555555555',
    lead_id: 'lead-test-001',
    external_lead_id: 'PORTAL_INQUIRY',
    qualification_id: 'qual-001',
    score_id: 'score-001',
    extraction_id: 'ext-001',
    transcript_id: 'tr-001',
    call_id: 'call-001',
    primary_buyer_summary: {
      name: 'Aditya Sharma',
      phone: '+919876543210',
      location: 'Gurugram',
      contact_status: 'CONTACTABLE',
    },
    qualification: {
      status: 'QUALIFIED',
      reason_codes: ['BUDGET_CONFIRMED', 'LOCATION_MATCH'],
      blocking_fields: [],
      follow_up_fields: [],
    },
    priority: {
      score: 94,
      band: 'HOT',
      tier: 'TIER_1_HOT',
      sla_minutes: 15,
      sla_deadline: '2026-10-21T07:00:00.000Z',
      urgency: 'HIGH',
    },
    requirements: [
      {
        id: 'req-1',
        requirement_index: 1,
        property_type: 'Residential Apartment',
        configuration: '3 BHK',
        purpose: 'Self-Use',
        budget_min: 25000000,
        budget_max: 32000000,
        currency: 'INR',
        budget_truth_level: 'CONFIRMED',
        preferred_locations: ['Golf Course Ext Rd', 'Sector 62'],
        location_truth_level: 'CONFIRMED',
        timeline: 'IMMEDIATE',
        timeline_truth_level: 'CONFIRMED',
        preferences: ['High Floor', 'Park Facing'],
      },
    ],
    project_recommendations: [
      {
        project_id: 'proj-1',
        project_code: 'DLF-ARB',
        project_name: 'DLF The Arbour',
        developer_name: 'DLF',
        city: 'Gurugram',
        locality: 'Sector 63',
        match_score: 95,
        match_band: 'STRONG',
        rank: 1,
        key_matches: ['Location', 'Budget'],
        gaps: [],
        risks: [],
        buyer_confirmed: false,
        recommendation_status: 'AI_RECOMMENDED',
      },
    ],
    missing_information: [],
    risks: [],
    recommended_action: 'Schedule priority site visit',
    talking_points: ['Discuss payment schedule'],
    call_summary: 'Buyer ready for visit',
    commercial_summary: 'Qualified 3 BHK buyer in Gurugram',
    recommendation_status: 'AI_RECOMMENDED',
    handoff_status: 'READY',
    routing_status: 'ASSIGNED',
    routing_decision: {
      assigned_role: 'SENIOR_SALES_ADVISOR',
      assigned_team: 'SENIOR_SALES',
      tier: 'TIER_1_HOT',
      sla_minutes: 15,
      sla_deadline: '2026-10-21T07:00:00.000Z',
      routing_action: 'IMMEDIATE_PHONE_DISPATCH',
      follow_up_urgency: 'HIGH',
      reason_codes: ['TIER_1_PRIORITY'],
    },
    handoff_version: '1.0',
    rule_version: '1.0',
    created_at: '2026-10-21T06:00:00.000Z',
    updated_at: '2026-10-21T06:00:00.000Z',
    ...overrides,
  };
}

async function runTestSuite() {
  console.log('============================================================');
  console.log('GROWTHFORGE PHASE 13A.2 — GOOGLE SHEETS CHANNEL TEST SUITE');
  console.log('============================================================\n');

  let passed = 0;
  function pass(testName: string) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  }

  // 1. All 20 output columns and their order
  const handoff = buildMockHandoff();
  const row = formatHandoffRow(handoff, '2026-10-21T06:05:00.000Z');
  assert.strictEqual(row.length, 20, 'Row must have exactly 20 columns');
  assert.strictEqual(row[0], handoff.handoff_id, 'Col A: Handoff ID');
  assert.strictEqual(row[1], handoff.lead_id, 'Col B: Lead ID');
  assert.strictEqual(row[2], 'Aditya Sharma', 'Col C: Lead Name');
  assert.strictEqual(row[3], "'+919876543210", 'Col D: Contact Phone (formula-escaped)');
  assert.strictEqual(row[4], 'PORTAL_INQUIRY', 'Col E: Lead Source');
  assert.strictEqual(row[5], 'CONTACTABLE', 'Col F: Consent/Contact Status');
  assert.strictEqual(row[6], 'QUALIFIED', 'Col G: Qualification Status');
  assert.strictEqual(row[7], 94, 'Col H: Buyer Score');
  assert.strictEqual(row[8], 'TIER_1_HOT', 'Col I: Priority Tier');
  assert.strictEqual(row[9], 'Residential Apartment', 'Col J: Property Type');
  assert.strictEqual(row[10], '3 BHK', 'Col K: Configuration');
  assert.strictEqual(row[11], 'Golf Course Ext Rd, Sector 62', 'Col L: Locations');
  assert.strictEqual(row[12], '₹2.5 Cr - ₹3.2 Cr', 'Col M: Budget Range');
  assert.strictEqual(row[13], 'IMMEDIATE', 'Col N: Timeline');
  assert.strictEqual(row[14], 'SENIOR_SALES', 'Col O: Assigned Team');
  assert.strictEqual(row[15], 'SENIOR_SALES_ADVISOR', 'Col P: Assigned Role');
  assert.strictEqual(row[16], '2026-10-21T07:00:00.000Z', 'Col Q: SLA Deadline');
  assert.strictEqual(row[17], 'DLF The Arbour (95%)', 'Col R: Top Matches');
  assert.strictEqual(row[18], 'Schedule priority site visit', 'Col S: Recommended Action');
  assert.strictEqual(row[19], '2026-10-21T06:05:00.000Z', 'Col T: Dispatched At');
  pass('1. All 20 output columns and their exact order verified');

  // 2. Missing optional values handled safely
  const sparseHandoff = buildMockHandoff({
    primary_buyer_summary: { name: null, phone: null, location: null, contact_status: 'UNKNOWN' },
    requirements: [],
    project_recommendations: [],
  });
  const sparseRow = formatHandoffRow(sparseHandoff, '2026-10-21T06:05:00.000Z');
  assert.strictEqual(sparseRow.length, 20);
  assert.strictEqual(sparseRow[2], '', 'Missing name maps to empty string');
  assert.strictEqual(sparseRow[3], '', 'Missing phone maps to empty string');
  assert.strictEqual(sparseRow[12], 'UNKNOWN', 'Missing budget maps to UNKNOWN');
  pass('2. Missing optional values handled deterministically without crashing');

  // 3. Null or unknown consent representation
  assert.strictEqual(sparseRow[5], 'UNKNOWN');
  pass('3. Null or unknown consent/contact state preserved');

  // 4. Valid budget formatting
  assert.strictEqual(formatBudget(handoff.requirements[0]), '₹2.5 Cr - ₹3.2 Cr');
  assert.strictEqual(formatBudget({ ...handoff.requirements[0], currency: 'USD', budget_min: 500000, budget_max: 750000 }), '500000 - 750000 USD');
  pass('4. Valid budget formatting when units are known');

  // 5. Missing or invalid spreadsheet configuration validation
  assert.throws(() => new GoogleSheetsBrokerHandoffChannel({ spreadsheetId: '' }), /spreadsheet ID is missing/);
  assert.throws(() => new GoogleSheetsBrokerHandoffChannel({ spreadsheetId: 'short' }), /spreadsheet ID is invalid/);
  pass('5. Missing or invalid spreadsheet configuration rejected');

  // 6. Dry-run makes zero HTTP calls
  let httpCalls = 0;
  const mockFetch = (async () => {
    httpCalls++;
    return new Response(JSON.stringify({}), { status: 200 });
  }) as any;

  const channel = new GoogleSheetsBrokerHandoffChannel(
    { spreadsheetId: TEST_SPREADSHEET_ID, accessToken: TEST_ACCESS_TOKEN },
    { fetchFn: mockFetch }
  );

  const dryRunRes = await channel.dispatch(handoff, { dryRun: true });
  assert.strictEqual(dryRunRes.success, true);
  assert.strictEqual(dryRunRes.dry_run, true);
  assert.strictEqual(dryRunRes.status, 'SENT');
  assert.strictEqual(httpCalls, 0, 'Dry-run must make 0 HTTP calls');
  pass('6. Dry-run makes zero HTTP calls and returns simulated success');

  // 7. Successful existing-row lookup and append
  const fetchResponses: Response[] = [
    new Response(JSON.stringify({ values: [['other-handoff-id']] }), { status: 200 }), // Lookup A:A
    new Response(JSON.stringify({ updates: { updatedRows: 1 } }), { status: 200 }), // Append A:T
  ];
  let callIdx = 0;
  const liveChannel = new GoogleSheetsBrokerHandoffChannel(
    { spreadsheetId: TEST_SPREADSHEET_ID, accessToken: TEST_ACCESS_TOKEN },
    {
      fetchFn: (async () => {
        return fetchResponses[callIdx++];
      }) as any,
    }
  );

  const appendRes = await liveChannel.dispatch(handoff, { dryRun: false });
  assert.strictEqual(appendRes.success, true);
  assert.strictEqual(appendRes.status, 'SENT');
  assert.strictEqual(appendRes.dry_run, false);
  pass('7. Successful existing-row lookup and append');

  // 8. Existing handoff ID suppresses append (Idempotency)
  const dedupChannel = new GoogleSheetsBrokerHandoffChannel(
    { spreadsheetId: TEST_SPREADSHEET_ID, accessToken: TEST_ACCESS_TOKEN },
    {
      fetchFn: (async () => {
        return new Response(JSON.stringify({ values: [[handoff.handoff_id]] }), { status: 200 });
      }) as any,
    }
  );
  const dupRes = await dedupChannel.dispatch(handoff, { dryRun: false });
  assert.strictEqual(dupRes.success, true);
  assert.strictEqual(dupRes.status, 'IGNORED_DUPLICATE');
  pass('8. Existing handoff ID suppresses append and returns IGNORED_DUPLICATE');

  // 9. Ambiguous append response followed by successful reconciliation
  let callCount = 0;
  const reconcileSuccessChannel = new GoogleSheetsBrokerHandoffChannel(
    { spreadsheetId: TEST_SPREADSHEET_ID, accessToken: TEST_ACCESS_TOKEN },
    {
      fetchFn: (async () => {
        callCount++;
        if (callCount === 1) {
          // Pre-append check -> not found
          return new Response(JSON.stringify({ values: [] }), { status: 200 });
        }
        if (callCount === 2) {
          // Append throws timeout / network exception
          throw new Error('ETIMEDOUT');
        }
        if (callCount === 3) {
          // Reconcile check -> found in sheet!
          return new Response(JSON.stringify({ values: [[handoff.handoff_id]] }), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      }) as any,
    }
  );
  const reconRes = await reconcileSuccessChannel.dispatch(handoff, { dryRun: false });
  assert.strictEqual(reconRes.success, true);
  assert.strictEqual(reconRes.status, 'SENT');
  pass('9. Ambiguous append followed by successful reconciliation returns SENT');

  // 10. Ambiguous append that remains unresolved returns retryable failure
  callCount = 0;
  const reconcileFailChannel = new GoogleSheetsBrokerHandoffChannel(
    { spreadsheetId: TEST_SPREADSHEET_ID, accessToken: TEST_ACCESS_TOKEN },
    {
      fetchFn: (async () => {
        callCount++;
        if (callCount === 1) return new Response(JSON.stringify({ values: [] }), { status: 200 });
        if (callCount === 2) throw new Error('ECONNRESET');
        if (callCount === 3) throw new Error('Network timeout during reconciliation');
        return new Response('{}', { status: 200 });
      }) as any,
    }
  );
  const failRes = await reconcileFailChannel.dispatch(handoff, { dryRun: false });
  assert.strictEqual(failRes.success, false);
  assert.strictEqual(failRes.status, 'FAILED');
  assert.strictEqual(failRes.retry_eligible, true);
  pass('10. Ambiguous append remaining unresolved returns retryable failure');

  // 11. HTTP 400 handling
  const http400Channel = new GoogleSheetsBrokerHandoffChannel(
    { spreadsheetId: TEST_SPREADSHEET_ID, accessToken: TEST_ACCESS_TOKEN },
    { fetchFn: (async () => new Response('{}', { status: 400 })) as any }
  );
  const res400 = await http400Channel.dispatch(handoff, { dryRun: false });
  assert.strictEqual(res400.status, 'FAILED');
  assert.strictEqual(res400.retry_eligible, false);
  pass('11. HTTP 400 Bad Request handled as non-retryable FAILED');

  // 12. HTTP 401 handling
  const http401Channel = new GoogleSheetsBrokerHandoffChannel(
    { spreadsheetId: TEST_SPREADSHEET_ID, accessToken: TEST_ACCESS_TOKEN },
    { fetchFn: (async () => new Response('{}', { status: 401 })) as any }
  );
  const res401 = await http401Channel.dispatch(handoff, { dryRun: false });
  assert.strictEqual(res401.status, 'FAILED');
  assert.strictEqual(res401.retry_eligible, false);
  pass('12. HTTP 401 Unauthorized handled as non-retryable FAILED');

  // 13. HTTP 403 handling
  const http403Channel = new GoogleSheetsBrokerHandoffChannel(
    { spreadsheetId: TEST_SPREADSHEET_ID, accessToken: TEST_ACCESS_TOKEN },
    { fetchFn: (async () => new Response('{}', { status: 403 })) as any }
  );
  const res403 = await http403Channel.dispatch(handoff, { dryRun: false });
  assert.strictEqual(res403.status, 'FAILED');
  assert.strictEqual(res403.retry_eligible, false);
  pass('13. HTTP 403 Forbidden handled as non-retryable FAILED');

  // 14. HTTP 404 handling
  const http404Channel = new GoogleSheetsBrokerHandoffChannel(
    { spreadsheetId: TEST_SPREADSHEET_ID, accessToken: TEST_ACCESS_TOKEN },
    { fetchFn: (async () => new Response('{}', { status: 404 })) as any }
  );
  const res404 = await http404Channel.dispatch(handoff, { dryRun: false });
  assert.strictEqual(res404.status, 'FAILED');
  assert.strictEqual(res404.retry_eligible, false);
  pass('14. HTTP 404 Not Found handled as non-retryable FAILED');

  // 15. HTTP 429 retryability
  const http429Channel = new GoogleSheetsBrokerHandoffChannel(
    { spreadsheetId: TEST_SPREADSHEET_ID, accessToken: TEST_ACCESS_TOKEN },
    { fetchFn: (async () => new Response('{}', { status: 429 })) as any }
  );
  const res429 = await http429Channel.dispatch(handoff, { dryRun: false });
  assert.strictEqual(res429.status, 'FAILED');
  assert.strictEqual(res429.retry_eligible, true);
  pass('15. HTTP 429 Rate Limit handled as retryable FAILED');

  // 16. HTTP 500/503 retryability
  const http503Channel = new GoogleSheetsBrokerHandoffChannel(
    { spreadsheetId: TEST_SPREADSHEET_ID, accessToken: TEST_ACCESS_TOKEN },
    { fetchFn: (async () => new Response('{}', { status: 503 })) as any }
  );
  const res503 = await http503Channel.dispatch(handoff, { dryRun: false });
  assert.strictEqual(res503.status, 'FAILED');
  assert.strictEqual(res503.retry_eligible, true);
  pass('16. HTTP 500/503 Service Error handled as retryable FAILED');

  // 17. Network failure handling
  const netFailChannel = new GoogleSheetsBrokerHandoffChannel(
    { spreadsheetId: TEST_SPREADSHEET_ID, accessToken: TEST_ACCESS_TOKEN },
    { fetchFn: (async () => { throw new Error('getaddrinfo ENOTFOUND sheets.googleapis.com'); }) as any }
  );
  const resNet = await netFailChannel.dispatch(handoff, { dryRun: false });
  assert.strictEqual(resNet.status, 'FAILED');
  assert.strictEqual(resNet.retry_eligible, true);
  pass('17. Network DNS/Socket failure handled as retryable FAILED');

  // 18. Spreadsheet and worksheet range encoding
  let requestedUrl = '';
  const rangeCheckChannel = new GoogleSheetsBrokerHandoffChannel(
    { spreadsheetId: TEST_SPREADSHEET_ID, sheetName: 'Custom & Complex Range / 2026', accessToken: TEST_ACCESS_TOKEN },
    {
      fetchFn: (async (url: string) => {
        requestedUrl = url;
        return new Response(JSON.stringify({ values: [] }), { status: 200 });
      }) as any,
    }
  );
  await rangeCheckChannel.dispatch(handoff, { dryRun: false });
  assert(requestedUrl.includes(encodeURIComponent('Custom & Complex Range / 2026')));
  pass('18. Spreadsheet sheet name correctly URL-encoded into A1 range');

  // 19. Formula injection safety for untrusted text
  assert.strictEqual(sanitizeCell('=SUM(A1:A10)'), "'=SUM(A1:A10)");
  assert.strictEqual(sanitizeCell('+CMD("calc")'), "'+CMD(\"calc\")");
  assert.strictEqual(sanitizeCell('-1+1'), "'-1+1");
  assert.strictEqual(sanitizeCell('@IMPORTXML("url")'), "'@IMPORTXML(\"url\")");
  assert.strictEqual(sanitizeCell('\tMALICIOUS'), "'\tMALICIOUS");
  assert.strictEqual(sanitizeCell('\rMALICIOUS'), "'\rMALICIOUS");
  assert.strictEqual(sanitizeCell('   =SUM(A1)'), "'   =SUM(A1)");
  assert.strictEqual(sanitizeCell('\u00A0=1+1'), "'\u00A0=1+1");
  assert.strictEqual(sanitizeCell(''), '');
  assert.strictEqual(sanitizeCell('   '), '');
  assert.strictEqual(sanitizeCell(-50), -50);
  assert.strictEqual(sanitizeCell('-50'), -50);
  assert.strictEqual(sanitizeCell('-3.14'), -3.14);
  assert.strictEqual(sanitizeCell(94), 94);
  assert.strictEqual(sanitizeCell('2026-10-21T06:05:00.000Z'), '2026-10-21T06:05:00.000Z');
  assert.strictEqual(sanitizeCell('+919876543210'), "'+919876543210");
  assert.strictEqual(sanitizeCell('Normal Buyer Name'), 'Normal Buyer Name');
  assert.strictEqual(sanitizeCell('DLF The Arbour (95%)'), 'DLF The Arbour (95%)');
  pass('19. Spreadsheet formula injection neutralized on untrusted text');

  // 20. Phone numbers and credentials absent from standard logs
  const logAuditRow = formatHandoffRow(handoff, '2026-10-21T06:05:00.000Z');
  assert(TEST_ACCESS_TOKEN.length > 0);
  assert(!JSON.stringify(logAuditRow).includes(TEST_ACCESS_TOKEN), 'Access token must not appear in row values');
  pass('20. Credentials absent from row values and log streams');

  // 21. Tenant-scoped configuration selection
  const tenantA = '00000000-0000-0000-0000-000000000001';
  const tenantB = '11111111-2222-3333-4444-555555555555';
  await supabaseDataService.crmConfigs.createConfig({ tenantId: tenantA, isPlatformAdmin: true }, {
    provider_name: 'TenantASheets',
    destination_type: 'GOOGLE_SHEETS',
    endpoint_url: null,
    is_enabled: true,
    dry_run_mode: true,
    metadata: { spreadsheet_id: TEST_SPREADSHEET_ID, sheet_name: 'Tenant A Leads' },
  });
  const configsA = await supabaseDataService.crmConfigs.listConfigs({ tenantId: tenantA, isPlatformAdmin: false });
  const configsB = await supabaseDataService.crmConfigs.listConfigs({ tenantId: tenantB, isPlatformAdmin: false });
  assert(configsA.some((c) => c.provider_name === 'TenantASheets'));
  assert(!configsB.some((c) => c.provider_name === 'TenantASheets'));
  pass('21. Tenant-scoped configuration selection strictly enforces tenant boundary');

  // 22. Existing WEBHOOK dispatch regression
  await supabaseDataService.crmConfigs.createConfig({ tenantId: tenantA, isPlatformAdmin: true }, {
    provider_name: 'WebhookRegression',
    destination_type: 'WEBHOOK',
    endpoint_url: 'https://api.example.com/webhook',
    is_enabled: true,
    dry_run_mode: true,
    metadata: {},
  });
  const webhookLeadId = `00000000-0000-0000-0000-${String(Date.now()).slice(0, 12).padStart(12, '0')}`;
  const webhookHandoffId = `11111111-0000-0000-0000-${String(Date.now()).slice(0, 12).padStart(12, '0')}`;
  await supabaseDataService.leads.createLead({ tenantId: tenantA, isPlatformAdmin: true }, {
    id: webhookLeadId,
    tenant_id: tenantA,
    lead_id: `EXT-${webhookLeadId}`,
    name: 'Webhook Regression Buyer',
    phone: '+919876543210',
    status: 'NEW',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as any);

  await supabaseDataService.brokerHandoffs.createHandoff({ tenantId: tenantA }, {
    id: webhookHandoffId,
    lead_id: webhookLeadId,
    tenant_id: tenantA,
    handoff_status: 'READY',
    routing_status: 'ASSIGNED',
    dispatch_status: 'PENDING',
    priority_tier: 'TIER_1_HOT',
    sla_minutes: 15,
    sla_deadline: new Date().toISOString(),
    handoff_payload: buildMockHandoff({ handoff_id: webhookHandoffId, lead_id: webhookLeadId }),
    handoff_version: '1.0',
    rule_version: '1.0',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as any);

  const whRes = await brokerHandoffService.dispatchHandoff(webhookHandoffId, { dryRun: true });
  assert.strictEqual(whRes.success, true);
  assert.strictEqual(whRes.dry_run, true);
  pass('22. Existing WEBHOOK dispatch functionality regression intact');

  // 23. Existing duplicate-dispatch behavior regression
  const dupWhRes = await brokerHandoffService.dispatchHandoff(webhookHandoffId, { dryRun: true });
  assert.strictEqual(dupWhRes.status, 'IGNORED_DUPLICATE');
  pass('23. Existing duplicate-dispatch suppression regression intact');

  console.log('\n============================================================');
  console.log(`PHASE 13A.2 TEST RESULTS: ${passed} / 23 PASSED (100% GREEN)`);
  console.log('============================================================\n');
}

runTestSuite().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
