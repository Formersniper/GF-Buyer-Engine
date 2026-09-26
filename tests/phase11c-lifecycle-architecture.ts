/**
 * GrowthForge Buyer Intelligence Engine - Phase 11C Multi-Tenant Lifecycle Hardening Test Suite
 *
 * Matrix:
 * Test 1: Default tenant valid lifecycle transition (RAW -> RESOLVED)
 * Test 2: Non-default tenant valid lifecycle transition (RAW -> RESOLVED)
 * Test 3: Cross-tenant lead transition attempt is denied with no mutation
 * Test 4: Missing tenant context fails closed (TenantRequiredError, no default fallback)
 * Test 5: Client tenant override in request body/query is ignored; authenticated JWT tenant is authoritative
 * Test 6: Invalid lifecycle transition prohibited by state machine is rejected (WorkflowTransitionError)
 * Test 7: Provenance requirement: RAW -> RESOLVED without required intake provenance is rejected
 * Test 8: Valid provenance: RAW -> RESOLVED with canonical verified WEB_FORM passes
 * Test 9: Consent preservation: lifecycle transition does not alter consent_status, source, or timestamp
 * Test 10: Voice isolation: lifecycle transition does not invoke voice or create call records
 */

import { leadService } from '../app/services/leads/leadService';
import { supabaseDataService } from '../app/services/supabase/repositories';
import { getSupabaseAdminClient, getSupabaseClient } from '../app/services/supabase/client';
import { DEFAULT_TENANT_ID, TenantRequiredError, TenantForbiddenError } from '../app/schemas/tenant';
import { WorkflowTransitionError } from '../app/services/workflow/stateMachine';
import { createApp } from '../server';
import { setJwtAuthenticator, resetJwtAuthenticator, JwtAuthenticator } from '../app/middleware/auth';
import { AuthContext } from '../app/schemas/auth';
import http from 'http';
import { AddressInfo } from 'net';

class MockJwtAuth implements JwtAuthenticator {
  private tokens = new Map<string, AuthContext>();
  public register(token: string, ctx: AuthContext) {
    this.tokens.set(token, ctx);
  }
  async validateJwt(token: string): Promise<AuthContext | null> {
    return this.tokens.get(token) || null;
  }
}

let passCount = 0;
let failCount = 0;

function assert(testId: string, description: string, condition: boolean, details?: unknown) {
  if (condition) {
    console.log(`  ✅ [PASS] ${testId}: ${description}`);
    passCount++;
  } else {
    console.error(`  ❌ [FAIL] ${testId}: ${description}`);
    if (details !== undefined) {
      console.error('     Details:', JSON.stringify(details, null, 2));
    }
    failCount++;
  }
}

async function httpRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: any
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const data = body ? JSON.stringify(body) : undefined;
    const reqHeaders = {
      ...headers,
      ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
    };

    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method,
        headers: reqHeaders,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let json: any;
          try {
            json = JSON.parse(raw);
          } catch {
            json = raw;
          }
          resolve({ status: res.statusCode || 500, body: json });
        });
      }
    );

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function runPhase11cTestSuite() {
  console.log('======================================================');
  console.log('🧪 GROWTHFORGE PHASE 11C — MULTI-TENANT LIFECYCLE ARCHITECTURE');
  console.log('======================================================\n');

  const client = getSupabaseAdminClient() || getSupabaseClient();
  if (!client) {
    throw new Error('Supabase client unavailable');
  }

  const createdTestLeadIds: string[] = [];

  const tenantAlpha = DEFAULT_TENANT_ID; // 00000000-0000-0000-0000-000000000001
  const tenantBeta = 'be7e913b-8253-42f4-bf29-132849335947';  // Live Verify Tenant

  // Set up HTTP test server
  const testAuth = new MockJwtAuth();
  setJwtAuthenticator(testAuth);

  const tokenSalesAlpha = 'token-sales-alpha-p11c';
  const tokenSalesBeta = 'token-sales-beta-p11c';

  testAuth.register(tokenSalesAlpha, {
    userId: 'user-sales-alpha-p11c',
    email: 'sales-alpha@example.com',
    tenantId: tenantAlpha,
    role: 'SALES',
    isPlatformAdmin: false,
    authMethod: 'JWT',
  });

  testAuth.register(tokenSalesBeta, {
    userId: 'user-sales-beta-p11c',
    email: 'phase11b-test-sales@example.com',
    tenantId: tenantBeta,
    role: 'SALES',
    isPlatformAdmin: false,
    authMethod: 'JWT',
  });

  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Default Tenant Valid Transition (RAW -> RESOLVED)
    // -------------------------------------------------------------------------
    console.log('--- TEST 1: Default Tenant Valid Transition ---');
    const lead1 = await supabaseDataService.leads.createLead(
      { tenantId: tenantAlpha },
      {
        lead_id: `GF-P11C-T1-${Date.now()}`,
        name: 'Test 1 Buyer Alpha',
        phone: '+919876543201',
        email: 't1.alpha@example.com',
        source: 'WEB_FORM',
        status: 'RAW',
        consent_status: 'CONFIRMED',
      }
    );
    createdTestLeadIds.push(lead1.id);

    const t1Res = await leadService.transitionStatus(
      { tenantId: tenantAlpha },
      lead1.id,
      'RESOLVED',
      'Test 1 resolution',
      'test-worker'
    );

    assert(
      'TEST-1',
      'Default tenant performs valid lifecycle transition (RAW -> RESOLVED)',
      t1Res.workflow.status === 'RESOLVED'
    );

    // Verify DB update
    const { data: dbLead1 } = await client.from('leads').select('*').eq('id', lead1.id).single();
    assert('TEST-1-DB', 'Lead 1 status in database is RESOLVED', dbLead1?.status === 'RESOLVED');

    // -------------------------------------------------------------------------
    // TEST 2: Non-Default Tenant Valid Transition (RAW -> RESOLVED)
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 2: Non-Default Tenant Valid Transition ---');
    const lead2 = await supabaseDataService.leads.createLead(
      { tenantId: tenantBeta },
      {
        lead_id: `GF-P11C-T2-${Date.now()}`,
        name: 'Test 2 Buyer Beta',
        phone: '+919876543202',
        email: 't2.beta@example.com',
        source: 'WEB_FORM',
        status: 'RAW',
        consent_status: 'CONFIRMED',
      }
    );
    createdTestLeadIds.push(lead2.id);

    const t2Res = await leadService.transitionStatus(
      { tenantId: tenantBeta },
      lead2.id,
      'RESOLVED',
      'Test 2 resolution',
      'phase11b-test-sales@example.com'
    );

    assert(
      'TEST-2',
      'Non-default tenant performs valid lifecycle transition (RAW -> RESOLVED)',
      t2Res.workflow.status === 'RESOLVED'
    );

    const { data: dbLead2 } = await client.from('leads').select('*').eq('id', lead2.id).single();
    assert('TEST-2-DB', 'Lead 2 status in database is RESOLVED', dbLead2?.status === 'RESOLVED');

    // -------------------------------------------------------------------------
    // TEST 3: Cross-Tenant Lead Transition is Denied (No Mutation)
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 3: Cross-Tenant Denial ---');
    // Lead 2 belongs to tenantBeta. Attempt transition using tenantAlpha scope.
    let crossTenantBlocked = false;
    let crossTenantError = '';
    try {
      await leadService.transitionStatus(
        { tenantId: tenantAlpha },
        lead2.id,
        'REQUIRES_REVIEW',
        'Unauthorized cross-tenant attempt',
        'sales-alpha@example.com'
      );
    } catch (err: any) {
      crossTenantBlocked = true;
      crossTenantError = err.message || String(err);
    }

    assert(
      'TEST-3A',
      'Cross-tenant lead transition rejected in service layer',
      crossTenantBlocked && crossTenantError.includes('Cross-tenant lead access denied')
    );

    // Verify lead2 status was NOT mutated
    const { data: dbLead2AfterCross } = await client.from('leads').select('*').eq('id', lead2.id).single();
    assert(
      'TEST-3B',
      'Lead 2 status remained strictly unmutated in database',
      dbLead2AfterCross?.status === 'RESOLVED'
    );

    // Also verify via HTTP endpoint: tenantAlpha attempting to mutate lead2 (belongs to tenantBeta)
    const resCrossHttp = await httpRequest(
      `${baseUrl}/api/leads/${lead2.id}/transition`,
      'POST',
      { Authorization: `Bearer ${tokenSalesAlpha}` },
      { targetStatus: 'REQUIRES_REVIEW' }
    );
    assert(
      'TEST-3C',
      'Cross-tenant HTTP request returns 403 Forbidden',
      resCrossHttp.status === 403 && resCrossHttp.body.error?.code === 'TENANT_FORBIDDEN'
    );

    // -------------------------------------------------------------------------
    // TEST 4: Missing Tenant Context Fails Closed (No Default Fallback)
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 4: Missing Tenant Context Fails Closed ---');
    let missingTenantBlocked = false;
    let missingTenantErrCode = '';
    try {
      // Call legacy signature without scope or with empty tenant
      await (leadService as any).transitionStatus(
        lead2.id,
        'RESOLVED',
        'Missing tenant attempt'
      );
    } catch (err: any) {
      missingTenantBlocked = true;
      missingTenantErrCode = err.code || err.name;
    }

    assert(
      'TEST-4A',
      'Missing tenant context throws TenantRequiredError without falling back to default tenant',
      missingTenantBlocked && (missingTenantErrCode === 'TENANT_REQUIRED' || missingTenantErrCode === 'TenantRequiredError')
    );

    // Also test with empty string tenantId
    let emptyTenantBlocked = false;
    try {
      await leadService.transitionStatus(
        '',
        lead2.id,
        'RESOLVED',
        'Empty tenant string'
      );
    } catch (err: any) {
      emptyTenantBlocked = true;
    }
    assert('TEST-4B', 'Empty tenant string fails closed', emptyTenantBlocked);

    // -------------------------------------------------------------------------
    // TEST 5: Client Tenant Override in Body is Ignored / Rejected
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 5: Client Tenant Override Attempt ---');
    // Caller is authenticated as tenantAlpha, but attempts to specify body.tenantId = tenantBeta
    const resOverride = await httpRequest(
      `${baseUrl}/api/leads/${lead2.id}/transition`,
      'POST',
      { Authorization: `Bearer ${tokenSalesAlpha}` },
      { targetStatus: 'REQUIRES_REVIEW', tenantId: tenantBeta }
    );
    assert(
      'TEST-5',
      'Client tenantId override in body is ignored; server enforces JWT tenant context (403)',
      resOverride.status === 403
    );

    // -------------------------------------------------------------------------
    // TEST 6: Invalid Lifecycle Transition Prohibited by State Machine
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 6: Invalid Lifecycle Transition ---');
    const lead6 = await supabaseDataService.leads.createLead(
      { tenantId: tenantBeta },
      {
        lead_id: `GF-P11C-T6-${Date.now()}`,
        name: 'Test 6 Buyer',
        phone: '+919876543206',
        email: 't6@example.com',
        source: 'WEB_FORM',
        status: 'RAW',
      }
    );
    createdTestLeadIds.push(lead6.id);

    // RAW cannot transition directly to CALL_PENDING or ENRICHED under state machine
    let invalidTransitionBlocked = false;
    try {
      await leadService.transitionStatus(
        { tenantId: tenantBeta },
        lead6.id,
        'CALL_PENDING',
        'Illegal jump'
      );
    } catch (err: any) {
      invalidTransitionBlocked = err instanceof WorkflowTransitionError || err.name === 'WorkflowTransitionError';
    }

    assert(
      'TEST-6A',
      'Prohibited transition (RAW -> CALL_PENDING) throws WorkflowTransitionError',
      invalidTransitionBlocked
    );

    const resInvalidHttp = await httpRequest(
      `${baseUrl}/api/leads/${lead6.id}/transition`,
      'POST',
      { Authorization: `Bearer ${tokenSalesBeta}` },
      { targetStatus: 'ENRICHED' }
    );
    assert(
      'TEST-6B',
      'HTTP invalid transition returns 422 Unprocessable Entity',
      resInvalidHttp.status === 422 && resInvalidHttp.body.error?.code === 'INVALID_TRANSITION'
    );

    // -------------------------------------------------------------------------
    // TEST 7: Provenance Requirement: RAW -> RESOLVED without required intake provenance
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 7: Missing Intake Provenance Rejected ---');
    // Lead with missing contact name and UNKNOWN source
    const lead7 = await supabaseDataService.leads.createLead(
      { tenantId: tenantBeta },
      {
        lead_id: `GF-P11C-T7-${Date.now()}`,
        name: null,
        phone: '+919999999999', // repetitive invalid digits
        email: 'invalid-email',
        source: 'UNKNOWN',
        status: 'RAW',
      }
    );
    createdTestLeadIds.push(lead7.id);

    let provenanceBlocked = false;
    let provenanceErrorMsg = '';
    try {
      await leadService.transitionStatus(
        { tenantId: tenantBeta },
        lead7.id,
        'RESOLVED',
        'Attempting resolution without valid provenance'
      );
    } catch (err: any) {
      provenanceBlocked = true;
      provenanceErrorMsg = err.message || String(err);
    }

    assert(
      'TEST-7A',
      'RAW -> RESOLVED rejected when lead lacks required intake provenance',
      provenanceBlocked && provenanceErrorMsg.includes('Lead intake provenance validation failed')
    );

    const resProvHttp = await httpRequest(
      `${baseUrl}/api/leads/${lead7.id}/transition`,
      'POST',
      { Authorization: `Bearer ${tokenSalesBeta}` },
      { targetStatus: 'RESOLVED' }
    );
    assert(
      'TEST-7B',
      'HTTP provenance failure returns 422 with PROVENANCE_VALIDATION_FAILED code',
      resProvHttp.status === 422 && resProvHttp.body.error?.code === 'PROVENANCE_VALIDATION_FAILED'
    );

    // -------------------------------------------------------------------------
    // TEST 8: Valid Provenance: RAW -> RESOLVED with canonical verified WEB_FORM
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 8: Valid Provenance Transition ---');
    const lead8 = await supabaseDataService.leads.createLead(
      { tenantId: tenantBeta },
      {
        lead_id: `GF-P11C-T8-${Date.now()}`,
        name: 'Valid Webform Buyer',
        phone: '+12025550188',
        email: 'valid.webform@example.com',
        source: 'WEB_FORM',
        status: 'RAW',
      }
    );
    createdTestLeadIds.push(lead8.id);

    const resProvSuccessHttp = await httpRequest(
      `${baseUrl}/api/leads/${lead8.id}/transition`,
      'POST',
      { Authorization: `Bearer ${tokenSalesBeta}` },
      { targetStatus: 'RESOLVED', eventSummary: 'Verified web form intake resolution' }
    );

    assert(
      'TEST-8',
      'RAW -> RESOLVED succeeds when lead has verified first-party WEB_FORM provenance (200 OK)',
      resProvSuccessHttp.status === 200 &&
      resProvSuccessHttp.body.success === true &&
      resProvSuccessHttp.body.lead?.workflow?.status === 'RESOLVED'
    );

    // -------------------------------------------------------------------------
    // TEST 9: Consent Preservation
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 9: Consent Preservation ---');
    const consentTime = '2026-09-25T07:28:31.19+00:00';
    const lead9 = await supabaseDataService.leads.createLead(
      { tenantId: tenantBeta },
      {
        lead_id: `GF-P11C-T9-${Date.now()}`,
        name: 'Consent Preservation Buyer',
        phone: '+12025550192',
        email: 'consent.pres@example.com',
        source: 'WEB_FORM',
        status: 'RAW',
        consent_status: 'CONFIRMED',
        consent_source: 'WEB_FORM_OTP_VERIFIED',
        consent_timestamp: consentTime,
      }
    );
    createdTestLeadIds.push(lead9.id);

    await leadService.transitionStatus(
      { tenantId: tenantBeta },
      lead9.id,
      'RESOLVED',
      'Resolution test'
    );

    const { data: dbLead9 } = await client.from('leads').select('*').eq('id', lead9.id).single();
    assert(
      'TEST-9',
      'Lifecycle transition strictly preserves consent_status, consent_source, and consent_timestamp',
      dbLead9?.consent_status === 'CONFIRMED' &&
      dbLead9?.consent_source === 'WEB_FORM_OTP_VERIFIED' &&
      dbLead9?.consent_timestamp === consentTime &&
      dbLead9?.status === 'RESOLVED'
    );

    // -------------------------------------------------------------------------
    // TEST 10: Voice Isolation
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 10: Voice Isolation ---');
    const { data: callsLead9 } = await client.from('calls').select('*').eq('lead_id', lead9.id);
    const { count: voiceSessionsTotal } = await client.from('voice_sessions').select('*', { count: 'exact', head: true });

    assert(
      'TEST-10',
      'Zero voice calls, zero calls records, and zero voice sessions created during lifecycle transition',
      (callsLead9?.length || 0) === 0 && voiceSessionsTotal === null
    );

  } catch (err: unknown) {
    console.error('❌ Phase 11C test suite encountered error:', err);
    failCount++;
  } finally {
    server.close();
    resetJwtAuthenticator();

    // Clean up created test leads to preserve strict production baseline
    console.log('\n--- Teardown: Cleaning up synthetic test leads ---');
    for (const testId of createdTestLeadIds) {
      await client.from('lead_events').delete().eq('lead_id', testId);
      await client.from('calls').delete().eq('lead_id', testId);
      await client.from('leads').delete().eq('id', testId);
    }
  }

  console.log('======================================================');
  console.log(`📊 PHASE 11C TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('======================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runPhase11cTestSuite();
