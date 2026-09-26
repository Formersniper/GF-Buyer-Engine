/**
 * GrowthForge Buyer Intelligence Engine - Phase 11A Verification Suite
 *
 * SPECIFICATION & INVARIANTS:
 * - Deterministic, auditable canonical consent ingress via POST /api/leads/:leadId/consent.
 * - Strict authentication, role-based authorization (SALES, ADMIN, OWNER), and tenant isolation.
 * - Enforces canonical consent status taxonomy (permissible vs opt-out sets).
 * - UNKNOWN cannot be submitted as a target consent state.
 * - Re-consent after opt-out requires explicit affirmative evidenceReference.
 * - Validates timestamp boundaries (clock skew protection) and non-empty sources.
 * - Persists to public.leads and records structured audit events in public.lead_events.
 * - Fails closed on cross-tenant mutation attempts.
 * - Downstream callEligibility integrates seamlessly with newly established consent.
 */

import http from 'http';
import { AddressInfo } from 'net';
import { createApp } from '../server';
import {
  setJwtAuthenticator,
  resetJwtAuthenticator,
  JwtAuthenticator,
} from '../app/middleware/auth';
import { AuthContext } from '../app/schemas/auth';
import { supabaseDataService } from '../app/services/supabase/repositories';
import { getSupabaseAdminClient, getSupabaseClient } from '../app/services/supabase/client';
import { evaluateCallEligibility } from '../app/services/calls/callEligibility';

class TestJwtAuth implements JwtAuthenticator {
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

export async function runPhase11aConsentIngressTests() {
  console.log('======================================================');
  console.log('🧪 GROWTHFORGE PHASE 11A — CANONICAL CONSENT INGRESS');
  console.log('======================================================\n');

  const testAuth = new TestJwtAuth();
  setJwtAuthenticator(testAuth);

  const tenantA = '00000000-0000-0000-0000-000000000001';
  const tenantB = '00000000-0000-0000-0000-000000000002';

  const tokenSalesA = 'token-sales-a';
  const tokenAdminA = 'token-admin-a';
  const tokenOwnerA = 'token-owner-a';
  const tokenViewerA = 'token-viewer-a';
  const tokenSalesB = 'token-sales-b';

  testAuth.register(tokenSalesA, {
    userId: 'user-sales-a',
    email: 'sales.a@example.com',
    tenantId: tenantA,
    role: 'SALES',
    isPlatformAdmin: false,
    authMethod: 'JWT',
  });

  testAuth.register(tokenAdminA, {
    userId: 'user-admin-a',
    email: 'admin.a@example.com',
    tenantId: tenantA,
    role: 'ADMIN',
    isPlatformAdmin: false,
    authMethod: 'JWT',
  });

  testAuth.register(tokenOwnerA, {
    userId: 'user-owner-a',
    email: 'owner.a@example.com',
    tenantId: tenantA,
    role: 'OWNER',
    isPlatformAdmin: false,
    authMethod: 'JWT',
  });

  testAuth.register(tokenViewerA, {
    userId: 'user-viewer-a',
    email: 'viewer.a@example.com',
    tenantId: tenantA,
    role: 'VIEWER',
    isPlatformAdmin: false,
    authMethod: 'JWT',
  });

  testAuth.register(tokenSalesB, {
    userId: 'user-sales-b',
    email: 'sales.b@example.com',
    tenantId: tenantB,
    role: 'SALES',
    isPlatformAdmin: false,
    authMethod: 'JWT',
  });

  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://localhost:${address.port}`;

  try {
    // -------------------------------------------------------------------------
    // Setup isolated test leads
    // -------------------------------------------------------------------------
    const now = new Date().toISOString();
    const leadA = await supabaseDataService.leads.createLead({ tenantId: tenantA }, {
      lead_id: `GF-P11A-A1-${Date.now()}`,
      name: 'Phase 11A Lead A',
      phone: '+919876543211',
      email: 'p11a.a@example.com',
      source: 'WEB_FORM',
      status: 'RAW',
    });

    const leadA2 = await supabaseDataService.leads.createLead({ tenantId: tenantA }, {
      lead_id: `GF-P11A-A2-${Date.now()}`,
      name: 'Phase 11A Lead A2',
      phone: '+919876543212',
      email: 'p11a.a2@example.com',
      source: 'WEB_FORM',
      status: 'RAW',
    });

    const leadB = await supabaseDataService.leads.createLead({ tenantId: tenantB }, {
      lead_id: `GF-P11A-B1-${Date.now()}`,
      name: 'Phase 11A Lead B',
      phone: '+919876543213',
      email: 'p11a.b@example.com',
      source: 'WEB_FORM',
      status: 'RAW',
    });

    // -------------------------------------------------------------------------
    // GROUP 1: AUTHENTICATION & AUTHORIZATION
    // -------------------------------------------------------------------------
    const resUnauth = await httpRequest(
      `${baseUrl}/api/leads/${leadA.id}/consent`,
      'POST',
      {},
      { consentStatus: 'EXPLICIT_CONSENT', consentSource: 'WEB_FORM', consentTimestamp: now }
    );
    assert('AUTH-1', 'Unauthenticated consent request returns 401', resUnauth.status === 401);

    const resViewer = await httpRequest(
      `${baseUrl}/api/leads/${leadA.id}/consent`,
      'POST',
      { Authorization: `Bearer ${tokenViewerA}` },
      { consentStatus: 'EXPLICIT_CONSENT', consentSource: 'WEB_FORM', consentTimestamp: now }
    );
    assert('AUTH-2', 'VIEWER role request returns 403 Forbidden', resViewer.status === 403);

    // -------------------------------------------------------------------------
    // GROUP 2: INPUT VALIDATION
    // -------------------------------------------------------------------------
    const resMissingStatus = await httpRequest(
      `${baseUrl}/api/leads/${leadA.id}/consent`,
      'POST',
      { Authorization: `Bearer ${tokenSalesA}` },
      { consentSource: 'WEB_FORM', consentTimestamp: now }
    );
    assert('VAL-1', 'Missing consentStatus returns 400', resMissingStatus.status === 400);

    const resInvalidStatus = await httpRequest(
      `${baseUrl}/api/leads/${leadA.id}/consent`,
      'POST',
      { Authorization: `Bearer ${tokenSalesA}` },
      { consentStatus: 'MAYBE_SOMETIME', consentSource: 'WEB_FORM', consentTimestamp: now }
    );
    assert('VAL-2', 'Invalid consentStatus returns 400', resInvalidStatus.status === 400);

    const resUnknownTarget = await httpRequest(
      `${baseUrl}/api/leads/${leadA.id}/consent`,
      'POST',
      { Authorization: `Bearer ${tokenSalesA}` },
      { consentStatus: 'UNKNOWN', consentSource: 'WEB_FORM', consentTimestamp: now }
    );
    assert('VAL-3', 'Submitting target status UNKNOWN returns 422', resUnknownTarget.status === 422);

    const resMissingSource = await httpRequest(
      `${baseUrl}/api/leads/${leadA.id}/consent`,
      'POST',
      { Authorization: `Bearer ${tokenSalesA}` },
      { consentStatus: 'EXPLICIT_CONSENT', consentTimestamp: now }
    );
    assert('VAL-4', 'Missing consentSource returns 400', resMissingSource.status === 400);

    const resEmptySource = await httpRequest(
      `${baseUrl}/api/leads/${leadA.id}/consent`,
      'POST',
      { Authorization: `Bearer ${tokenSalesA}` },
      { consentStatus: 'EXPLICIT_CONSENT', consentSource: '  ', consentTimestamp: now }
    );
    assert('VAL-5', 'Whitespace consentSource returns 400', resEmptySource.status === 400);

    const resMissingTimestamp = await httpRequest(
      `${baseUrl}/api/leads/${leadA.id}/consent`,
      'POST',
      { Authorization: `Bearer ${tokenSalesA}` },
      { consentStatus: 'EXPLICIT_CONSENT', consentSource: 'WEB_FORM' }
    );
    assert('VAL-6', 'Missing consentTimestamp returns 400', resMissingTimestamp.status === 400);

    const resInvalidTimestamp = await httpRequest(
      `${baseUrl}/api/leads/${leadA.id}/consent`,
      'POST',
      { Authorization: `Bearer ${tokenSalesA}` },
      { consentStatus: 'EXPLICIT_CONSENT', consentSource: 'WEB_FORM', consentTimestamp: 'not-a-timestamp' }
    );
    assert('VAL-7', 'Unparseable consentTimestamp returns 400', resInvalidTimestamp.status === 400);

    const futureTimestamp = new Date(Date.now() + 3600 * 1000).toISOString();
    const resFutureTimestamp = await httpRequest(
      `${baseUrl}/api/leads/${leadA.id}/consent`,
      'POST',
      { Authorization: `Bearer ${tokenSalesA}` },
      { consentStatus: 'EXPLICIT_CONSENT', consentSource: 'WEB_FORM', consentTimestamp: futureTimestamp }
    );
    assert('VAL-8', 'Future consentTimestamp beyond skew tolerance returns 400', resFutureTimestamp.status === 400);

    const resNonexistentLead = await httpRequest(
      `${baseUrl}/api/leads/00000000-0000-0000-0000-999999999999/consent`,
      'POST',
      { Authorization: `Bearer ${tokenSalesA}` },
      { consentStatus: 'EXPLICIT_CONSENT', consentSource: 'WEB_FORM', consentTimestamp: now }
    );
    assert('VAL-9', 'Nonexistent lead returns 404', resNonexistentLead.status === 404);

    // -------------------------------------------------------------------------
    // GROUP 3: TENANT ISOLATION
    // -------------------------------------------------------------------------
    const resCrossTenant = await httpRequest(
      `${baseUrl}/api/leads/${leadA.id}/consent`,
      'POST',
      { Authorization: `Bearer ${tokenSalesB}` },
      { consentStatus: 'EXPLICIT_CONSENT', consentSource: 'WEB_FORM', consentTimestamp: now }
    );
    assert(
      'TENANT-1',
      'Tenant B attempting to mutate Tenant A lead returns 403 or 404',
      resCrossTenant.status === 403 || resCrossTenant.status === 404,
      { status: resCrossTenant.status }
    );

    const resSpoofedTenant = await httpRequest(
      `${baseUrl}/api/leads/${leadA.id}/consent`,
      'POST',
      { Authorization: `Bearer ${tokenSalesB}`, 'x-tenant-id': tenantA },
      { consentStatus: 'EXPLICIT_CONSENT', consentSource: 'WEB_FORM', consentTimestamp: now }
    );
    assert(
      'TENANT-2',
      'Client-supplied x-tenant-id header cannot bypass authenticated tenant',
      resSpoofedTenant.status === 403 || resSpoofedTenant.status === 404
    );

    // -------------------------------------------------------------------------
    // GROUP 4: STATE TRANSITIONS & PERSISTENCE
    // -------------------------------------------------------------------------
    // UNKNOWN -> EXPLICIT_CONSENT by SALES
    const resSalesConsent = await httpRequest(
      `${baseUrl}/api/leads/${leadA.id}/consent`,
      'POST',
      { Authorization: `Bearer ${tokenSalesA}` },
      {
        consentStatus: 'EXPLICIT_CONSENT',
        consentSource: 'WEB_FORM_OTP_VERIFIED',
        consentTimestamp: now,
        notes: 'Verified inbound submission via phone OTP',
        correlationId: 'corr-001',
      }
    );
    assert('TRANS-1', 'UNKNOWN -> EXPLICIT_CONSENT succeeds with 200', resSalesConsent.status === 200, resSalesConsent.body);
    assert(
      'TRANS-2',
      'Response returns expected metadata',
      resSalesConsent.body?.previousConsentStatus === 'UNKNOWN' &&
        resSalesConsent.body?.newConsentStatus === 'EXPLICIT_CONSENT' &&
        resSalesConsent.body?.consentSource === 'WEB_FORM_OTP_VERIFIED'
    );

    // Verify DB update on leadA
    const refreshedLeadA = await supabaseDataService.leads.getLead({ tenantId: tenantA }, leadA.id);
    assert(
      'PERSIST-1',
      'Lead record in DB is updated with canonical consent fields',
      refreshedLeadA?.consent_status === 'EXPLICIT_CONSENT' &&
        refreshedLeadA?.consent_source === 'WEB_FORM_OTP_VERIFIED' &&
        refreshedLeadA?.consent_timestamp === new Date(Date.parse(now)).toISOString()
    );

    // Verify audit event in lead_events
    const events = await supabaseDataService.leadEvents.getLeadEvents({ tenantId: tenantA }, leadA.id);
    const consentEvent = events.find((e) => e.event_type === 'LEAD_CONSENT_CAPTURED');
    assert(
      'AUDIT-1',
      'LEAD_CONSENT_CAPTURED event is appended to lead_events',
      Boolean(consentEvent),
      { eventsCount: events.length }
    );
    assert(
      'AUDIT-2',
      'Audit event preserves complete provenance and actor info',
      Boolean(
        consentEvent &&
          consentEvent.event_data?.previous_consent_status === 'UNKNOWN' &&
          consentEvent.event_data?.new_consent_status === 'EXPLICIT_CONSENT' &&
          consentEvent.event_data?.actor === 'user-sales-a' &&
          consentEvent.event_data?.actor_role === 'SALES' &&
          consentEvent.event_data?.correlation_id === 'corr-001'
      )
    );

    // Idempotency: re-submit identical consent
    const resIdempotent = await httpRequest(
      `${baseUrl}/api/leads/${leadA.id}/consent`,
      'POST',
      { Authorization: `Bearer ${tokenSalesA}` },
      {
        consentStatus: 'EXPLICIT_CONSENT',
        consentSource: 'WEB_FORM_OTP_VERIFIED',
        consentTimestamp: now,
      }
    );
    assert(
      'IDEMP-1',
      'Submitting identical consent event returns 200 with IDEMPOTENT_NOOP',
      resIdempotent.status === 200 && resIdempotent.body?.auditEventId === 'IDEMPOTENT_NOOP'
    );

    // EXPLICIT_CONSENT -> OPT_OUT
    const optOutTime = new Date().toISOString();
    const resOptOut = await httpRequest(
      `${baseUrl}/api/leads/${leadA.id}/consent`,
      'POST',
      { Authorization: `Bearer ${tokenSalesA}` },
      {
        consentStatus: 'OPT_OUT',
        consentSource: 'CUSTOMER_SMS_STOP',
        consentTimestamp: optOutTime,
        notes: 'Received STOP keyword via SMS',
      }
    );
    assert('TRANS-3', 'EXPLICIT_CONSENT -> OPT_OUT succeeds with 200', resOptOut.status === 200);

    const refreshedLeadAOptOut = await supabaseDataService.leads.getLead({ tenantId: tenantA }, leadA.id);
    assert('PERSIST-2', 'Lead in DB transitioned to OPT_OUT', refreshedLeadAOptOut?.consent_status === 'OPT_OUT');

    // Attempt OPT_OUT -> EXPLICIT_CONSENT WITHOUT evidenceReference (Must Fail 422)
    const resReConsentNoEvidence = await httpRequest(
      `${baseUrl}/api/leads/${leadA.id}/consent`,
      'POST',
      { Authorization: `Bearer ${tokenAdminA}` },
      {
        consentStatus: 'EXPLICIT_CONSENT',
        consentSource: 'AGENT_CALL',
        consentTimestamp: new Date().toISOString(),
      }
    );
    assert(
      'TRANS-4',
      'OPT_OUT -> EXPLICIT_CONSENT without evidenceReference is rejected (422)',
      resReConsentNoEvidence.status === 422
    );

    // OPT_OUT -> EXPLICIT_CONSENT WITH evidenceReference (Must Succeed 200)
    const resReConsentWithEvidence = await httpRequest(
      `${baseUrl}/api/leads/${leadA.id}/consent`,
      'POST',
      { Authorization: `Bearer ${tokenAdminA}` },
      {
        consentStatus: 'EXPLICIT_CONSENT',
        consentSource: 'NEW_PORTAL_SIGNUP',
        consentTimestamp: new Date().toISOString(),
        evidenceReference: 'DOC_AGREEMENT_SIGNED_REF_88192',
        notes: 'Buyer re-subscribed on web portal with verified signature',
      }
    );
    assert(
      'TRANS-5',
      'OPT_OUT -> EXPLICIT_CONSENT with valid evidenceReference succeeds with 200',
      resReConsentWithEvidence.status === 200
    );

    // Can resolve lead by canonical lead_id string as well as UUID
    const resByLeadId = await httpRequest(
      `${baseUrl}/api/leads/${leadA2.lead_id}/consent`,
      'POST',
      { Authorization: `Bearer ${tokenOwnerA}` },
      {
        consentStatus: 'PERMISSIBLE',
        consentSource: 'DIRECT_INBOUND_CALL',
        consentTimestamp: new Date().toISOString(),
      }
    );
    assert('TRANS-6', 'Resolving lead by canonical lead_id string succeeds with 200', resByLeadId.status === 200);

    // -------------------------------------------------------------------------
    // GROUP 5: DOWNSTREAM COMPLIANCE & CALL ELIGIBILITY
    // -------------------------------------------------------------------------
    // 1. Lead with newly established EXPLICIT_CONSENT evaluates to eligible
    const canonicalLeadA = await supabaseDataService.mapToGFBuyerLead(leadA.id);
    assert(
      'COMPL-1',
      'mapToGFBuyerLead accurately projects newly persisted consent to provenance',
      canonicalLeadA?.provenance?.consent_status === 'EXPLICIT_CONSENT'
    );

    // Baseline timestamp within call window (10:00 UTC = 15:30 IST)
    const baselineNow = '2026-09-24T10:00:00.000Z';
    const eligibilityConsented = evaluateCallEligibility({
      leadId: leadA.id,
      tenantId: tenantA,
      phone: leadA.phone,
      source: 'WEB_FORM',
      status: 'RESOLVED',
      consentStatus: canonicalLeadA?.provenance?.consent_status,
      callsHistory: [],
      evaluatedAt: baselineNow,
    });
    assert(
      'COMPL-2',
      'callEligibility permits calling for lead with canonically established EXPLICIT_CONSENT',
      eligibilityConsented.eligible === true && eligibilityConsented.decision === 'ELIGIBLE'
    );

    // 2. Lead with OPT_OUT evaluates to ineligible
    const eligibilityOptOut = evaluateCallEligibility({
      leadId: leadA.id,
      tenantId: tenantA,
      phone: leadA.phone,
      source: 'WEB_FORM',
      status: 'RESOLVED',
      consentStatus: 'OPT_OUT',
      callsHistory: [],
      evaluatedAt: baselineNow,
    });
    assert(
      'COMPL-3',
      'callEligibility strictly blocks calling for OPT_OUT lead',
      eligibilityOptOut.eligible === false && eligibilityOptOut.decision === 'NOT_ELIGIBLE',
      { decision: eligibilityOptOut.decision, reasons: eligibilityOptOut.reasons }
    );

    // -------------------------------------------------------------------------
    // GROUP 6: VOICE ACTIVATION ENDPOINTS REMAIN FAIL-CLOSED FOR UNKNOWN
    // -------------------------------------------------------------------------
    const unverifiedLead = await supabaseDataService.leads.createLead({ tenantId: tenantA }, {
      lead_id: `GF-P11A-UNVERIFIED-${Date.now()}`,
      name: 'Unverified Lead',
      phone: '+919876543299',
      email: 'unverified@example.com',
      source: 'CSV_IMPORT',
      status: 'RAW',
    });

    const resVoiceActivate = await httpRequest(
      `${baseUrl}/api/voice/activate`,
      'POST',
      { Authorization: `Bearer ${tokenSalesA}` },
      { leadId: unverifiedLead.id }
    );
    assert(
      'VOICE-1',
      '/api/voice/activate rejects activation of unconsented (UNKNOWN) lead',
      resVoiceActivate.body?.success === false || resVoiceActivate.status === 422 || resVoiceActivate.body?.decision === 'REJECTED_COMPLIANCE'
    );

  } finally {
    // Clean up created test leads from DB
    const client = getSupabaseAdminClient() || getSupabaseClient();
    if (client) {
      const { data: testLeads } = await client
        .from('leads')
        .select('id')
        .or('lead_id.like.GF-P11A-%');
      if (testLeads && testLeads.length > 0) {
        const ids = testLeads.map((l) => l.id);
        await client.from('lead_events').delete().in('lead_id', ids);
        await client.from('leads').delete().in('id', ids);
      }
    }

    await new Promise<void>((resolve) => server.close(() => resolve()));
    resetJwtAuthenticator();
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log('\n======================================================');
  console.log(`Phase 11A Tests Finished: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('======================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

// Run tests if executed directly
if (process.argv[1]?.endsWith('phase11a-consent-ingress.ts')) {
  runPhase11aConsentIngressTests().catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
  });
}
