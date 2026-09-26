/**
 * PHASE 11C.1 — VOICE EXECUTION TENANT-MAPPING REPAIR REGRESSION TEST
 *
 * Verifies that:
 * 1. mapToGFBuyerLead with explicit tenant scope resolves the Phase 11B sandbox lead correctly.
 * 2. mapToGFBuyerLead under wrong tenant does NOT succeed (cross-tenant isolation).
 * 3. mapToGFBuyerLead without tenant scope fails closed or returns null (never reveals wrong tenant data).
 * 4. Tenant ID is preserved and not converted to DEFAULT_TENANT_ID.
 * 5. POST /api/voice/start enforces strict tenant propagation from req.auth.tenantId to canonical mapper.
 * 6. Zero external or voice provider dispatches occur during test.
 */

import http from 'http';
import { AddressInfo } from 'net';
import { createApp } from '../server';
import { setJwtAuthenticator, resetJwtAuthenticator, JwtAuthenticator } from '../app/middleware/auth';
import { AuthContext } from '../app/schemas/auth';
import { supabaseDataService } from '../app/services/supabase/repositories';
import { resolveEffectiveTenantScope, TenantRequiredError, DEFAULT_TENANT_ID } from '../app/schemas/tenant';
import { callService } from '../app/services/calls/callService';

const TEST_LEAD_ID = '44ebcb9a-94da-49e5-a285-d10ec64eb1d2';
const TEST_LEAD_CODE = 'GF-P11B-TEST-001';
const CORRECT_TENANT_ID = 'be7e913b-8253-42f4-bf29-132849335947';
const WRONG_TENANT_ID = '00000000-0000-0000-0000-000000000001';
const OTHER_TENANT_ID = '11111111-2222-3333-4444-555555555555';

class TestJwtAuth implements JwtAuthenticator {
  private tokens = new Map<string, AuthContext>();
  public register(token: string, ctx: AuthContext) {
    this.tokens.set(token, ctx);
  }
  async validateJwt(token: string): Promise<AuthContext | null> {
    return this.tokens.get(token) || null;
  }
}

let passed = 0;
let failed = 0;

function assert(code: string, desc: string, condition: boolean, details?: any) {
  if (condition) {
    console.log(`  ✅ [PASS] ${code}: ${desc}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${code}: ${desc}`, details !== undefined ? details : '');
    failed++;
  }
}

async function runTests() {
  console.log('======================================================');
  console.log('🧪 GROWTHFORGE PHASE 11C.1 — VOICE TENANT-MAPPING REPAIR');
  console.log('======================================================');

  // ---------------------------------------------------------------------------
  // Case A: Correct Tenant Mapping
  // ---------------------------------------------------------------------------
  console.log('\n--- Case A: Correct Tenant Canonical Mapping ---');
  const mappedCorrect = await supabaseDataService.mapToGFBuyerLead(
    { tenantId: CORRECT_TENANT_ID },
    TEST_LEAD_ID
  );

  assert('CASE-A1', 'Canonical mapping succeeds with correct tenant scope', mappedCorrect !== null);
  assert('CASE-A2', 'Mapped lead has correct lead_code', mappedCorrect?.lead_id === TEST_LEAD_CODE);
  assert('CASE-A3', 'Mapped lead identity has valid phone', mappedCorrect?.identity?.phone === '+12025550199');
  assert('CASE-A4', 'Mapped lead has full contact name', mappedCorrect?.identity?.full_name === 'PHASE11B_TEST_LEAD_001');
  assert('CASE-A5', 'Mapped lead retains CONFIRMED consent status', mappedCorrect?.provenance?.consent_status === 'CONFIRMED');

  // ---------------------------------------------------------------------------
  // Case B: Wrong Tenant Mapping
  // ---------------------------------------------------------------------------
  console.log('\n--- Case B: Wrong Tenant Mapping Blocked ---');
  const mappedWrongDefault = await supabaseDataService.mapToGFBuyerLead(
    { tenantId: WRONG_TENANT_ID },
    TEST_LEAD_ID
  );
  assert('CASE-B1', 'Mapping under DEFAULT_TENANT_ID returns null', mappedWrongDefault === null);

  const mappedWrongOther = await supabaseDataService.mapToGFBuyerLead(
    { tenantId: OTHER_TENANT_ID },
    TEST_LEAD_ID
  );
  assert('CASE-B2', 'Mapping under unrelated tenant returns null', mappedWrongOther === null);

  // ---------------------------------------------------------------------------
  // Case C: Missing Tenant Scope / Fail-Closed
  // ---------------------------------------------------------------------------
  console.log('\n--- Case C: Missing Tenant Scope Behavior ---');
  let threwStrict = false;
  try {
    resolveEffectiveTenantScope(undefined, { strictProductionFailClosed: true });
  } catch (err) {
    if (err instanceof TenantRequiredError) {
      threwStrict = true;
    }
  }
  assert('CASE-C1', 'resolveEffectiveTenantScope throws TenantRequiredError in strict mode when tenant is missing', threwStrict);

  // Calling unscoped mapToGFBuyerLead does not return the sandbox lead
  const mappedUnscoped = await supabaseDataService.mapToGFBuyerLead(TEST_LEAD_ID);
  assert('CASE-C2', 'Unscoped legacy mapToGFBuyerLead returns null (never leaks sandbox lead without tenant scope)', mappedUnscoped === null);

  // ---------------------------------------------------------------------------
  // Case D: Default Tenant Regression
  // ---------------------------------------------------------------------------
  console.log('\n--- Case D: Default Tenant Regression Check ---');
  const resolvedScope = resolveEffectiveTenantScope({ tenantId: CORRECT_TENANT_ID });
  assert(
    'CASE-D1',
    'Sandbox tenantId is preserved and NOT converted to DEFAULT_TENANT_ID',
    resolvedScope.tenantId === CORRECT_TENANT_ID && (resolvedScope.tenantId as string) !== DEFAULT_TENANT_ID
  );

  // ---------------------------------------------------------------------------
  // Case E: POST /api/voice/start Route Tenant Context Propagation
  // ---------------------------------------------------------------------------
  console.log('\n--- Case E: Voice Route Tenant Context Propagation ---');

  const tokenCorrect = 'token-correct-tenant-sales';
  const tokenWrong = 'token-wrong-tenant-sales';

  const testAuth = new TestJwtAuth();
  testAuth.register(tokenCorrect, {
    userId: 'b2f39c38-e60d-438e-ae8b-60b9805d3f16',
    email: 'phase11b-test-sales@example.com',
    tenantId: CORRECT_TENANT_ID,
    role: 'SALES',
    isPlatformAdmin: false,
    authMethod: 'JWT',
  });

  testAuth.register(tokenWrong, {
    userId: 'user-wrong-tenant-sales',
    email: 'wrong-tenant-sales@example.com',
    tenantId: WRONG_TENANT_ID,
    role: 'SALES',
    isPlatformAdmin: false,
    authMethod: 'JWT',
  });

  setJwtAuthenticator(testAuth);

  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 1. Unauthenticated request
    const resNoAuth = await makePostRequest(`${baseUrl}/api/voice/start`, {}, undefined);
    assert('ROUTE-1', 'Unauthenticated request to /api/voice/start returns 401', resNoAuth.status === 401);

    // 2. Wrong tenant request
    const resWrongTenant = await makePostRequest(
      `${baseUrl}/api/voice/start`,
      { leadId: TEST_LEAD_ID },
      tokenWrong
    );
    assert('ROUTE-2', 'Wrong tenant request to /api/voice/start returns 404 (Lead not found within tenant scope)', resWrongTenant.status === 404);

    // 3. Correct tenant request with spy on callService.startCall to prevent actual voice dispatch
    let startCallInvoked = false;
    let startCallLeadId: string | null = null;
    let startCallOptions: any = null;

    const originalStartCall = callService.startCall.bind(callService);
    callService.startCall = async (leadIdOrUUID: string, options?: any) => {
      startCallInvoked = true;
      startCallLeadId = leadIdOrUUID;
      startCallOptions = options;
      // Return synthetic successful result for route verification without dispatching mock provider
      return {
        leadId: leadIdOrUUID,
        callResult: {
          callId: 'test-stub-call',
          provider: 'mock',
          status: 'MOCK_READY' as any,
          initiated: false,
          created_at: new Date().toISOString(),
        },
        previousStatus: 'CALL_PENDING',
        newStatus: 'CALL_PENDING',
        canonicalLead: mappedCorrect!,
      };
    };

    try {
      const resCorrect = await makePostRequest(
        `${baseUrl}/api/voice/start`,
        { leadId: TEST_LEAD_ID },
        tokenCorrect
      );

      assert(
        'ROUTE-3',
        'Correct tenant request maps canonical lead without 422 error',
        resCorrect.status !== 422
      );
      assert(
        'ROUTE-4',
        'callService.startCall was reached with correct leadId',
        startCallInvoked && startCallLeadId === TEST_LEAD_ID
      );
      assert(
        'ROUTE-5',
        'callService.startCall was passed authoritative tenantId',
        startCallOptions?.tenantId === CORRECT_TENANT_ID
      );
    } finally {
      callService.startCall = originalStartCall;
    }
  } finally {
    server.close();
    resetJwtAuthenticator();
  }

  console.log('\n======================================================');
  console.log(`Results: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

function makePostRequest(url: string, body: any, token?: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const parsed = new URL(url);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(payload)),
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: 'POST',
        headers,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 500, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode || 500, body: raw });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
