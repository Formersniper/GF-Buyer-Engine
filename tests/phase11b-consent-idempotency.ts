/**
 * GrowthForge Buyer Intelligence Engine - Phase 11B Idempotency Verification Suite
 *
 * SPECIFICATION & INVARIANTS:
 * - Deterministic validation of consent idempotency contract across all dimensions:
 *   Test A: Exact duplicate returns IDEMPOTENT_NOOP with zero DB mutation or new events.
 *   Test B: Equivalent timestamp representations (varying timezone offsets/formats) return IDEMPOTENT_NOOP.
 *   Test C: Genuine timestamp difference executes legitimate update (LEAD_CONSENT_UPDATED).
 *   Test D: Different evidence reference executes legitimate update (LEAD_CONSENT_UPDATED).
 *   Test E: UNKNOWN -> CONFIRMED executes initial consent capture (LEAD_CONSENT_CAPTURED).
 *   Test F: Unauthorized actor (VIEWER) is strictly rejected (403 Forbidden).
 *   Test G: Cross-tenant actor mutation is strictly rejected (403 / 404).
 *   Test H: Historical production leads remain completely unmodified and preserved.
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
import { isSameInstant, normalizeEvidence } from '../app/services/compliance/leadConsentService';

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

export async function runPhase11bConsentIdempotencyTests() {
  console.log('======================================================');
  console.log('🧪 GROWTHFORGE PHASE 11B — CONSENT IDEMPOTENCY HARDENING');
  console.log('======================================================\n');

  const testAuth = new TestJwtAuth();
  setJwtAuthenticator(testAuth);

  const tenantA = '00000000-0000-0000-0000-000000000001';
  const tenantB = '00000000-0000-0000-0000-000000000002';

  const tokenSalesA = 'token-p11b-sales-a';
  const tokenViewerA = 'token-p11b-viewer-a';
  const tokenSalesB = 'token-p11b-sales-b';

  testAuth.register(tokenSalesA, {
    userId: 'user-p11b-sales-a',
    email: 'sales.a.p11b@example.com',
    tenantId: tenantA,
    role: 'SALES',
    isPlatformAdmin: false,
    authMethod: 'JWT',
  });

  testAuth.register(tokenViewerA, {
    userId: 'user-p11b-viewer-a',
    email: 'viewer.a.p11b@example.com',
    tenantId: tenantA,
    role: 'VIEWER',
    isPlatformAdmin: false,
    authMethod: 'JWT',
  });

  testAuth.register(tokenSalesB, {
    userId: 'user-p11b-sales-b',
    email: 'sales.b.p11b@example.com',
    tenantId: tenantB,
    role: 'SALES',
    isPlatformAdmin: false,
    authMethod: 'JWT',
  });

  const app = createApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const createdTestLeadIds: string[] = [];

  try {
    // -------------------------------------------------------------------------
    // Unit helper checks
    // -------------------------------------------------------------------------
    const tsIso = '2026-09-25T07:28:31.190Z';
    const tsPg = '2026-09-25T07:28:31.19+00:00';
    const tsTz = '2026-09-25T12:58:31.190+05:30';
    const tsDiff = '2026-09-25T07:35:00.000Z';

    assert('HELPER-1', 'isSameInstant recognizes ISO and Postgres format as identical', isSameInstant(tsIso, tsPg));
    assert('HELPER-2', 'isSameInstant recognizes different timezone offsets as identical instant', isSameInstant(tsIso, tsTz));
    assert('HELPER-3', 'isSameInstant distinguishes genuinely different timestamps', !isSameInstant(tsIso, tsDiff));
    assert('HELPER-4', 'normalizeEvidence trims and maps whitespace to null', normalizeEvidence('  ') === null && normalizeEvidence('  EVID_123 ') === 'EVID_123');

    // Create single isolated test lead in Tenant A
    const leadRunner = await supabaseDataService.leads.createLead({ tenantId: tenantA }, {
      lead_id: `GF-P11B-RUNNER-${Date.now()}`,
      name: 'P11B Idempotency Runner Lead',
      phone: '+919876543888',
      email: 'p11b-runner@example.com',
      source: 'WEB_FORM',
      status: 'RAW',
    });
    createdTestLeadIds.push(leadRunner.id);

    // -------------------------------------------------------------------------
    // TEST E: UNKNOWN -> CONFIRMED (Initial Legitimate Capture)
    // -------------------------------------------------------------------------
    const baseTimestamp = '2026-09-25T07:28:31.19+00:00';
    const evidenceA = 'EVIDENCE_PROVENANCE_DOC_001';

    const resInitial = await httpRequest(
      `${baseUrl}/api/leads/${leadRunner.id}/consent`,
      'POST',
      { Authorization: `Bearer ${tokenSalesA}` },
      {
        consentStatus: 'CONFIRMED',
        consentSource: 'WEB_FORM_OTP_VERIFIED',
        consentTimestamp: baseTimestamp,
        evidenceReference: evidenceA,
        notes: 'Initial test consent capture',
        correlationId: 'corr-p11b-init',
      }
    );

    assert('TEST-E-1', 'UNKNOWN -> CONFIRMED succeeds with HTTP 200', resInitial.status === 200);
    assert(
      'TEST-E-2',
      'Initial transition produces valid audit event ID (not IDEMPOTENT_NOOP)',
      resInitial.body?.auditEventId && resInitial.body?.auditEventId !== 'IDEMPOTENT_NOOP'
    );
    assert('TEST-E-3', 'Response reports previousConsentStatus as UNKNOWN', resInitial.body?.previousConsentStatus === 'UNKNOWN');
    assert('TEST-E-4', 'Response reports newConsentStatus as CONFIRMED', resInitial.body?.newConsentStatus === 'CONFIRMED');

    // Check DB state after Test E
    const leadAfterE = await supabaseDataService.leads.getLead({ tenantId: tenantA }, leadRunner.id);
    const eventsAfterE = await supabaseDataService.leadEvents.getLeadEvents({ tenantId: tenantA }, leadRunner.id);
    assert(
      'TEST-E-5',
      'DB lead transitioned to CONFIRMED with normalized timestamp and source',
      leadAfterE?.consent_status === 'CONFIRMED' &&
        leadAfterE?.consent_source === 'WEB_FORM_OTP_VERIFIED' &&
        isSameInstant(leadAfterE?.consent_timestamp, baseTimestamp)
    );
    assert('TEST-E-6', 'Exactly 1 audit event created (LEAD_CONSENT_CAPTURED)', eventsAfterE.length === 1 && eventsAfterE[0].event_type === 'LEAD_CONSENT_CAPTURED');

    const initialEventId = eventsAfterE[0].id;
    const initialLeadUpdatedAt = leadAfterE?.updated_at;

    // -------------------------------------------------------------------------
    // TEST A: Exact Duplicate
    // -------------------------------------------------------------------------
    const resExactDup = await httpRequest(
      `${baseUrl}/api/leads/${leadRunner.id}/consent`,
      'POST',
      { Authorization: `Bearer ${tokenSalesA}` },
      {
        consentStatus: 'CONFIRMED',
        consentSource: 'WEB_FORM_OTP_VERIFIED',
        consentTimestamp: baseTimestamp,
        evidenceReference: evidenceA,
        notes: 'Initial test consent capture',
        correlationId: 'corr-p11b-init',
      }
    );

    assert('TEST-A-1', 'Submitting exact duplicate returns HTTP 200', resExactDup.status === 200);
    assert('TEST-A-2', 'Submitting exact duplicate returns auditEventId IDEMPOTENT_NOOP', resExactDup.body?.auditEventId === 'IDEMPOTENT_NOOP');
    assert('TEST-A-3', 'Response preserves evidenceReference and consentStatus', resExactDup.body?.newConsentStatus === 'CONFIRMED' && resExactDup.body?.evidenceReference === evidenceA);

    // Verify DB invariants after Test A
    const leadAfterA = await supabaseDataService.leads.getLead({ tenantId: tenantA }, leadRunner.id);
    const eventsAfterA = await supabaseDataService.leadEvents.getLeadEvents({ tenantId: tenantA }, leadRunner.id);
    assert('TEST-A-4', 'No new audit event created in DB (still exactly 1 event)', eventsAfterA.length === 1 && eventsAfterA[0].id === initialEventId);
    assert('TEST-A-5', 'Lead consent state and source unchanged', leadAfterA?.consent_status === 'CONFIRMED' && leadAfterA?.consent_source === 'WEB_FORM_OTP_VERIFIED');
    assert('TEST-A-6', 'Lead consent timestamp unchanged semantically', isSameInstant(leadAfterA?.consent_timestamp, baseTimestamp));

    // -------------------------------------------------------------------------
    // TEST B: Equivalent Timestamp Representation (The Core Defect Fix)
    // -------------------------------------------------------------------------
    // Represent same instant using standard ISO 8601 with trailing Z and 3-digit milliseconds
    const equivalentIsoTimestamp = new Date(Date.parse(baseTimestamp)).toISOString(); // e.g. 2026-09-25T07:28:31.190Z
    assert('TEST-B-PRE', 'Serialization strings differ despite representing the same instant', equivalentIsoTimestamp !== baseTimestamp);

    const resEquivalentTs = await httpRequest(
      `${baseUrl}/api/leads/${leadRunner.id}/consent`,
      'POST',
      { Authorization: `Bearer ${tokenSalesA}` },
      {
        consentStatus: 'CONFIRMED',
        consentSource: 'WEB_FORM_OTP_VERIFIED',
        consentTimestamp: equivalentIsoTimestamp,
        evidenceReference: evidenceA,
      }
    );

    assert('TEST-B-1', 'Equivalent timestamp returns HTTP 200', resEquivalentTs.status === 200);
    assert('TEST-B-2', 'Equivalent timestamp returns IDEMPOTENT_NOOP', resEquivalentTs.body?.auditEventId === 'IDEMPOTENT_NOOP');

    // Also test with timezone offset representation for the same instant
    const equivalentTzTimestamp = '2026-09-25T12:58:31.190+05:30';
    const resEquivalentTz = await httpRequest(
      `${baseUrl}/api/leads/${leadRunner.id}/consent`,
      'POST',
      { Authorization: `Bearer ${tokenSalesA}` },
      {
        consentStatus: 'CONFIRMED',
        consentSource: 'WEB_FORM_OTP_VERIFIED',
        consentTimestamp: equivalentTzTimestamp,
        evidenceReference: evidenceA,
      }
    );

    assert('TEST-B-3', 'Timezone offset representation of same instant returns IDEMPOTENT_NOOP', resEquivalentTz.body?.auditEventId === 'IDEMPOTENT_NOOP');

    const eventsAfterB = await supabaseDataService.leadEvents.getLeadEvents({ tenantId: tenantA }, leadRunner.id);
    assert('TEST-B-4', 'No new audit event created across equivalent timestamp submissions (still 1 event)', eventsAfterB.length === 1);

    // -------------------------------------------------------------------------
    // TEST C: Genuine Timestamp Difference (Legitimate Consent Update)
    // -------------------------------------------------------------------------
    const genuineNewTimestamp = '2026-09-25T07:30:00.000Z'; // Genuinely different time

    const resNewTs = await httpRequest(
      `${baseUrl}/api/leads/${leadRunner.id}/consent`,
      'POST',
      { Authorization: `Bearer ${tokenSalesA}` },
      {
        consentStatus: 'CONFIRMED',
        consentSource: 'WEB_FORM_OTP_VERIFIED',
        consentTimestamp: genuineNewTimestamp,
        evidenceReference: evidenceA,
        notes: 'Re-verified at a later instant',
      }
    );

    assert('TEST-C-1', 'Genuinely different timestamp succeeds with HTTP 200', resNewTs.status === 200);
    assert('TEST-C-2', 'Genuinely different timestamp is NOT a no-op', resNewTs.body?.auditEventId !== 'IDEMPOTENT_NOOP');

    const eventsAfterC = await supabaseDataService.leadEvents.getLeadEvents({ tenantId: tenantA }, leadRunner.id);
    assert('TEST-C-3', 'Audit event LEAD_CONSENT_UPDATED created for genuine timestamp update', eventsAfterC.length === 2 && eventsAfterC[1].event_type === 'LEAD_CONSENT_UPDATED');

    const leadAfterC = await supabaseDataService.leads.getLead({ tenantId: tenantA }, leadRunner.id);
    assert('TEST-C-4', 'Lead consent timestamp updated in DB to the new instant', isSameInstant(leadAfterC?.consent_timestamp, genuineNewTimestamp));

    // -------------------------------------------------------------------------
    // TEST D: Different Evidence (Legitimate Consent Provenance Update)
    // -------------------------------------------------------------------------
    const differentEvidence = 'EVIDENCE_PROVENANCE_AMENDED_DOC_002';

    const resDiffEvidence = await httpRequest(
      `${baseUrl}/api/leads/${leadRunner.id}/consent`,
      'POST',
      { Authorization: `Bearer ${tokenSalesA}` },
      {
        consentStatus: 'CONFIRMED',
        consentSource: 'WEB_FORM_OTP_VERIFIED',
        consentTimestamp: genuineNewTimestamp, // same timestamp as previous
        evidenceReference: differentEvidence, // materially different evidence
        notes: 'Updated affirmative evidence documentation',
      }
    );

    assert('TEST-D-1', 'Different evidenceReference succeeds with HTTP 200', resDiffEvidence.status === 200);
    assert('TEST-D-2', 'Different evidenceReference is NOT a no-op', resDiffEvidence.body?.auditEventId !== 'IDEMPOTENT_NOOP');

    const eventsAfterD = await supabaseDataService.leadEvents.getLeadEvents({ tenantId: tenantA }, leadRunner.id);
    assert('TEST-D-3', 'Audit event LEAD_CONSENT_UPDATED created for changed evidence', eventsAfterD.length === 3 && eventsAfterD[2].event_type === 'LEAD_CONSENT_UPDATED');
    assert('TEST-D-4', 'Audit event records updated evidence reference', eventsAfterD[2].event_data?.evidence_reference === differentEvidence);

    // Submitting with the new evidence a second time MUST be idempotent!
    const resRepeatNewEvidence = await httpRequest(
      `${baseUrl}/api/leads/${leadRunner.id}/consent`,
      'POST',
      { Authorization: `Bearer ${tokenSalesA}` },
      {
        consentStatus: 'CONFIRMED',
        consentSource: 'WEB_FORM_OTP_VERIFIED',
        consentTimestamp: genuineNewTimestamp,
        evidenceReference: differentEvidence,
      }
    );
    assert('TEST-D-5', 'Re-submitting with matching updated evidence returns IDEMPOTENT_NOOP', resRepeatNewEvidence.body?.auditEventId === 'IDEMPOTENT_NOOP');

    // -------------------------------------------------------------------------
    // TEST F: Unauthorized Actor (VIEWER Role)
    // -------------------------------------------------------------------------
    const resViewer = await httpRequest(
      `${baseUrl}/api/leads/${leadRunner.id}/consent`,
      'POST',
      { Authorization: `Bearer ${tokenViewerA}` },
      {
        consentStatus: 'CONFIRMED',
        consentSource: 'WEB_FORM_OTP_VERIFIED',
        consentTimestamp: genuineNewTimestamp,
      }
    );
    assert('TEST-F-1', 'VIEWER role is rejected with HTTP 403 Forbidden', resViewer.status === 403);

    // -------------------------------------------------------------------------
    // TEST G: Cross-Tenant Actor Mutation Attempt
    // -------------------------------------------------------------------------
    const resCrossTenant = await httpRequest(
      `${baseUrl}/api/leads/${leadRunner.id}/consent`,
      'POST',
      { Authorization: `Bearer ${tokenSalesB}` },
      {
        consentStatus: 'CONFIRMED',
        consentSource: 'WEB_FORM_OTP_VERIFIED',
        consentTimestamp: genuineNewTimestamp,
      }
    );
    assert('TEST-G-1', 'Cross-tenant mutation attempt rejected with 403 or 404', resCrossTenant.status === 403 || resCrossTenant.status === 404);

    // -------------------------------------------------------------------------
    // TEST H: Historical Production Leads Isolation
    // -------------------------------------------------------------------------
    const client = getSupabaseAdminClient() || getSupabaseClient();
    if (client) {
      const { count: totalLeads } = await client.from('leads').select('*', { count: 'exact', head: true });
      const { count: unknownLeads } = await client.from('leads').select('*', { count: 'exact', head: true }).eq('consent_status', 'UNKNOWN');
      const { count: confirmedLeads } = await client.from('leads').select('*', { count: 'exact', head: true }).eq('consent_status', 'CONFIRMED');
      const { data: nonUnknown } = await client.from('leads').select('id, lead_id, consent_status, tenant_id').neq('consent_status', 'UNKNOWN');

      // In production tenant be7e913b-8253-42f4-bf29-132849335947, ONLY 44ebcb9a-94da-49e5-a285-d10ec64eb1d2 is CONFIRMED
      const prodTenantNonUnknown = nonUnknown?.filter(
        (l) => l.tenant_id === 'be7e913b-8253-42f4-bf29-132849335947'
      ) || [];

      assert(
        'TEST-H-1',
        'Production tenant has exactly 1 non-UNKNOWN lead (the designated synthetic test lead)',
        prodTenantNonUnknown.length === 1 && prodTenantNonUnknown[0].id === '44ebcb9a-94da-49e5-a285-d10ec64eb1d2'
      );
      assert(
        'TEST-H-2',
        'Designated synthetic test lead GF-P11B-TEST-001 remains CONFIRMED',
        prodTenantNonUnknown[0]?.consent_status === 'CONFIRMED'
      );
    }

  } finally {
    // Clean up temporary runner test lead from DB and close server
    const client = getSupabaseAdminClient() || getSupabaseClient();
    if (client && createdTestLeadIds.length > 0) {
      await client.from('lead_events').delete().in('lead_id', createdTestLeadIds);
      await client.from('leads').delete().in('id', createdTestLeadIds);
    }

    await new Promise<void>((resolve) => server.close(() => resolve()));
    resetJwtAuthenticator();
  }

  console.log('\n======================================================');
  console.log(`Phase 11B Tests Finished: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('======================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

// Run tests if executed directly
if (process.argv[1]?.endsWith('phase11b-consent-idempotency.ts')) {
  runPhase11bConsentIdempotencyTests().catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
  });
}
