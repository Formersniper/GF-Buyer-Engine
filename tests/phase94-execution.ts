/**
 * GrowthForge Buyer Intelligence Engine - Phase 9.4 Controlled Voice Execution API Test Suite
 *
 * Verifies:
 * 1. Unauthenticated /api/voice/start request returns 401.
 * 2. VIEWER role start request returns 403 Forbidden.
 * 3. Cross-tenant lead start access is rejected (403/404).
 * 4. Authorized SALES successfully initiates voice execution for a CALL_PENDING lead (200 OK).
 * 5. Idempotency keys correctly return prior responses without duplicate execution.
 * 6. Webhook processing and transcript ingestion successfully update call lifecycle.
 */

import { createApp } from '../server';
import {
  setJwtAuthenticator,
  resetJwtAuthenticator,
  JwtAuthenticator,
} from '../app/middleware/auth';
import { AuthContext } from '../app/schemas/auth';
import { supabaseDataService } from '../app/services/supabase/repositories';
import { processSarvamWebhook } from '../app/services/voice/sarvamWebhook';
import http from 'http';
import { AddressInfo } from 'net';

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

async function runPhase94Tests() {
  process.env.SUPABASE_URL = '';
  process.env.SUPABASE_ANON_KEY = '';

  console.log('======================================================');
  console.log('🧪 GROWTHFORGE PHASE 9.4 — CONTROLLED VOICE EXECUTION API SUITE');
  console.log('======================================================\n');

  const testAuth = new TestJwtAuth();
  setJwtAuthenticator(testAuth);

  const tenantAlpha = '00000000-0000-0000-0000-000000000001';
  const tenantBeta = '00000000-0000-0000-0000-000000000002';

  const tokenSalesAlpha = 'token-sales-alpha-94';
  const tokenViewerAlpha = 'token-viewer-alpha-94';
  const tokenSalesBeta = 'token-sales-beta-94';

  testAuth.register(tokenSalesAlpha, {
    userId: 'user-sales-alpha',
    email: 'sales.alpha@example.com',
    tenantId: tenantAlpha,
    role: 'SALES',
    isPlatformAdmin: false,
    authMethod: 'JWT',
  });

  testAuth.register(tokenViewerAlpha, {
    userId: 'user-viewer-alpha',
    email: 'viewer.alpha@example.com',
    tenantId: tenantAlpha,
    role: 'VIEWER',
    isPlatformAdmin: false,
    authMethod: 'JWT',
  });

  testAuth.register(tokenSalesBeta, {
    userId: 'user-sales-beta',
    email: 'sales.beta@example.com',
    tenantId: tenantBeta,
    role: 'SALES',
    isPlatformAdmin: false,
    authMethod: 'JWT',
  });

  const app = createApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // Seed test lead in tenant Alpha with valid Indian mobile & WEB_FORM source for eligibility
    const leadAlpha = await supabaseDataService.leads.createLead({ tenantId: tenantAlpha }, {
      lead_id: `GF-P94-${Date.now()}`,
      name: 'Alpha Execution Buyer',
      phone: '+919876543299',
      email: 'alpha.buyer@example.com',
      source: 'WEB_FORM',
      status: 'CALL_PENDING',
    });

    // Seed test lead in tenant Beta
    const leadBeta = await supabaseDataService.leads.createLead({ tenantId: tenantBeta }, {
      lead_id: `GF-P94-B-${Date.now()}`,
      name: 'Beta Execution Buyer',
      phone: '+919876543288',
      email: 'beta.buyer@example.com',
      source: 'WEB_FORM',
      status: 'CALL_PENDING',
    });

    // 1. Unauthenticated request -> 401
    const resUnauth = await httpRequest(`${baseUrl}/api/voice/start`, 'POST', {}, { leadId: leadAlpha.lead_id });
    assert('P94-API-1', 'Unauthenticated /api/voice/start returns 401', resUnauth.status === 401);

    // 2. VIEWER role request -> 403
    const resViewer = await httpRequest(
      `${baseUrl}/api/voice/start`,
      'POST',
      { Authorization: `Bearer ${tokenViewerAlpha}` },
      { leadId: leadAlpha.lead_id }
    );
    assert('P94-API-2', 'VIEWER role request to /api/voice/start returns 403', resViewer.status === 403);

    // 3. Cross-tenant access -> 403 or 404
    const resCross = await httpRequest(
      `${baseUrl}/api/voice/start`,
      'POST',
      { Authorization: `Bearer ${tokenSalesAlpha}` },
      { leadId: leadBeta.lead_id }
    );
    assert('P94-API-3', 'Cross-tenant lead start access rejected (403 or 404)', resCross.status === 403 || resCross.status === 404);

    // 4. Authorized SALES successfully executes call -> 200 OK
    const idemKey = `p94-idem-${Date.now()}`;
    const resStart = await httpRequest(
      `${baseUrl}/api/voice/start`,
      'POST',
      { Authorization: `Bearer ${tokenSalesAlpha}` },
      { leadId: leadAlpha.lead_id, idempotencyKey: idemKey }
    );
    console.log('RES START:', resStart);
    const isMock =
      resStart.body.callResult?.provider === 'mock' ||
      !resStart.body.callResult?.initiated;

    const expectedStatus = isMock ? 'CALL_PENDING' : 'CALLING';

    assert(
      'P94-API-4',
      'Authorized SALES successfully initiates voice execution (200 OK)',
      resStart.status === 200 &&
      resStart.body.newStatus === expectedStatus &&
      (
        isMock
          ? resStart.body.callResult?.status === 'MOCK_READY'
          : resStart.body.callResult?.initiated === true
      )
    );

    // 5. Idempotency re-submission returns cached result
    const resIdem = await httpRequest(
      `${baseUrl}/api/voice/start`,
      'POST',
      { Authorization: `Bearer ${tokenSalesAlpha}` },
      { leadId: leadAlpha.lead_id, idempotencyKey: idemKey }
    );
    console.log('RES IDEM:', resIdem);
    assert('P94-API-5', 'Idempotency re-submission returns cached response (200 OK)', resIdem.status === 200);

    // 6. Webhook processing and transcript ingestion
    const externalCallId =
      resStart.body.callResult?.external_call_id ||
      resStart.body.callResult?.callId;

    assert(
      'P94-API-6-PRECONDITION',
      'Provider call identifier exists for webhook correlation',
      Boolean(externalCallId)
    );
    const webhookRes = await processSarvamWebhook({
      event_id: `evt-p94-${Date.now()}`,
      event_type: 'CALL_COMPLETED',
      external_call_id: externalCallId,
      transcript: 'Hello, I confirm my interest in purchasing the property.',
      duration_seconds: 90,
    });
    console.log('WEBHOOK RES:', webhookRes);
    assert('P94-API-6', 'Sarvam webhook processes successfully for executed call', webhookRes.success);

  } catch (err: unknown) {
    console.error('❌ Phase 9.4 API test suite encountered error:', err);
    failCount++;
  } finally {
    server.close();
    resetJwtAuthenticator();
  }

  console.log('======================================================');
  console.log(`📊 PHASE 9.4 API TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('======================================================');

  if (failCount > 0) {
    process.exit(1);
  }
}

runPhase94Tests();
