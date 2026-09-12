/**
 * GrowthForge Buyer Intelligence Engine - Security Headers & CORS Tests (Phase 8A.10)
 *
 * Verifies that HTTP security headers and CORS restrictions are properly enforced,
 * guarding against clickjacking, MIME sniffing, data leakage, and unapproved origins,
 * while ensuring server-to-server webhook delivery is not broken.
 */

import { securityHeaders, corsMiddleware, resolveAllowedOrigins } from '../app/middleware/securityHeaders';

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, message: string): void {
  totalTests++;
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedTests++;
  console.log(`✅ PASS: ${message}`);
}

function createMockReqRes(options: {
  method?: string;
  headers?: Record<string, string>;
}) {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(options.headers || {})) {
    headers[k.toLowerCase()] = v;
  }

  const req: any = {
    method: options.method || 'GET',
    headers,
  };

  const responseHeaders: Record<string, string> = {};
  let statusCode = 200;
  let ended = false;
  let jsonBody: any = null;

  const res: any = {
    setHeader(key: string, value: string) {
      responseHeaders[key.toLowerCase()] = value;
    },
    getHeader(key: string) {
      return responseHeaders[key.toLowerCase()];
    },
    status(code: number) {
      statusCode = code;
      return res;
    },
    end() {
      ended = true;
    },
    json(body: any) {
      jsonBody = body;
      ended = true;
      return res;
    },
    _getResponseHeaders: () => responseHeaders,
    _getStatusCode: () => statusCode,
    _isEnded: () => ended,
    _getJsonBody: () => jsonBody,
  };

  return { req, res };
}

async function runSecurityHeadersAndCorsTests() {
  console.log('\n============================================================');
  console.log('RUNNING PHASE 8A.10 SECURITY HEADERS & CORS TEST SUITE');
  console.log('============================================================\n');

  // TEST 1: Security Headers in Development
  console.log('--- TEST 1: Security Headers in Development ---');
  process.env.NODE_ENV = 'development';
  const secMiddlewareDev = securityHeaders();
  const { req: req1, res: res1 } = createMockReqRes({});
  let nextCalled1 = false;
  secMiddlewareDev(req1, res1, () => {
    nextCalled1 = true;
  });

  assert(nextCalled1, 'next() must be called by securityHeaders middleware');
  assert(res1.getHeader('X-Content-Type-Options') === 'nosniff', 'X-Content-Type-Options must be nosniff');
  assert(
    res1.getHeader('Referrer-Policy') === 'strict-origin-when-cross-origin',
    'Referrer-Policy must be strict-origin-when-cross-origin'
  );
  assert(
    res1.getHeader('Permissions-Policy')?.includes('microphone=(self)'),
    'Permissions-Policy must allow microphone'
  );
  assert(!res1.getHeader('Strict-Transport-Security'), 'HSTS must NOT be set in development');

  // TEST 2: Security Headers in Production
  console.log('\n--- TEST 2: Security Headers in Production ---');
  process.env.NODE_ENV = 'production';
  const secMiddlewareProd = securityHeaders();
  const { req: req2, res: res2 } = createMockReqRes({});
  let nextCalled2 = false;
  secMiddlewareProd(req2, res2, () => {
    nextCalled2 = true;
  });

  assert(nextCalled2, 'next() must be called in production');
  assert(
    res2.getHeader('Strict-Transport-Security') === 'max-age=31536000; includeSubDomains',
    'HSTS must be set in production'
  );
  assert(res2.getHeader('X-Frame-Options') === 'SAMEORIGIN', 'X-Frame-Options must be SAMEORIGIN in production');

  // TEST 3: Origin Resolution
  console.log('\n--- TEST 3: Origin Resolution ---');
  const resolved = resolveAllowedOrigins({
    CORS_ALLOWED_ORIGINS: 'https://buyer.growthforge.com, https://admin.growthforge.com',
    APP_URL: 'https://app.growthforge.com/api',
  });
  assert(resolved.includes('https://buyer.growthforge.com'), 'Must include first configured origin');
  assert(resolved.includes('https://admin.growthforge.com'), 'Must include second configured origin');
  assert(resolved.includes('https://app.growthforge.com'), 'Must include APP_URL origin');

  // TEST 4: CORS Server-to-Server Webhook Pass-through (No Origin Header)
  console.log('\n--- TEST 4: Server-to-Server Request Pass-through ---');
  const prodCors = corsMiddleware({
    isProduction: true,
    allowedOrigins: ['https://buyer.growthforge.com'],
  });

  const { req: webhookReq, res: webhookRes } = createMockReqRes({
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer webhook-token',
    },
  });

  let webhookNextCalled = false;
  prodCors(webhookReq, webhookRes, () => {
    webhookNextCalled = true;
  });

  assert(webhookNextCalled, 'Server-to-server webhook without Origin header must pass through');
  assert(!webhookRes.getHeader('Access-Control-Allow-Origin'), 'No CORS headers should be attached when Origin is absent');

  // TEST 5: Approved Origin in Production
  console.log('\n--- TEST 5: Approved Origin in Production ---');
  const { req: allowedReq, res: allowedRes } = createMockReqRes({
    method: 'GET',
    headers: {
      origin: 'https://buyer.growthforge.com',
    },
  });

  let allowedNext = false;
  prodCors(allowedReq, allowedRes, () => {
    allowedNext = true;
  });

  assert(allowedNext, 'next() must be called for approved origin');
  assert(
    allowedRes.getHeader('Access-Control-Allow-Origin') === 'https://buyer.growthforge.com',
    'Access-Control-Allow-Origin must match approved origin'
  );
  assert(
    allowedRes.getHeader('Access-Control-Allow-Credentials') === 'true',
    'Access-Control-Allow-Credentials must be true'
  );

  // TEST 6: Approved Origin Preflight OPTIONS in Production
  console.log('\n--- TEST 6: Approved Origin Preflight OPTIONS in Production ---');
  const { req: preflightReq, res: preflightRes } = createMockReqRes({
    method: 'OPTIONS',
    headers: {
      origin: 'https://buyer.growthforge.com',
    },
  });

  let preflightNext = false;
  prodCors(preflightReq, preflightRes, () => {
    preflightNext = true;
  });

  assert(!preflightNext, 'next() must NOT be called for preflight response');
  assert(preflightRes._getStatusCode() === 204, 'Preflight status code must be 204');
  assert(preflightRes._isEnded(), 'Preflight response must be ended');

  // TEST 7: Rejected Origin in Production
  console.log('\n--- TEST 7: Rejected Origin in Production ---');
  const { req: rejectedReq, res: rejectedRes } = createMockReqRes({
    method: 'GET',
    headers: {
      origin: 'https://malicious-site.com',
    },
  });

  let rejectedNext = false;
  prodCors(rejectedReq, rejectedRes, () => {
    rejectedNext = true;
  });

  assert(rejectedNext, 'Request proceeds but CORS headers are omitted');
  assert(
    !rejectedRes.getHeader('Access-Control-Allow-Origin'),
    'Access-Control-Allow-Origin must NOT be set for unapproved origin'
  );

  // TEST 8: Rejected Origin Preflight OPTIONS in Production
  console.log('\n--- TEST 8: Rejected Origin Preflight in Production ---');
  const { req: rejPreReq, res: rejPreRes } = createMockReqRes({
    method: 'OPTIONS',
    headers: {
      origin: 'https://malicious-site.com',
    },
  });

  let rejPreNext = false;
  prodCors(rejPreReq, rejPreRes, () => {
    rejPreNext = true;
  });

  assert(!rejPreNext, 'Preflight must not pass to next handlers');
  assert(rejPreRes._getStatusCode() === 403, 'Preflight for unapproved origin must be 403 Forbidden');

  // TEST 9: Development Mode Permissive Localhost
  console.log('\n--- TEST 9: Development Mode Localhost Support ---');
  const devCors = corsMiddleware({
    isProduction: false,
    allowedOrigins: ['https://buyer.growthforge.com'],
  });

  const { req: devLocalReq, res: devLocalRes } = createMockReqRes({
    method: 'GET',
    headers: {
      origin: 'http://localhost:3000',
    },
  });

  let devLocalNext = false;
  devCors(devLocalReq, devLocalRes, () => {
    devLocalNext = true;
  });

  assert(devLocalNext, 'Localhost must be allowed in development');
  assert(
    devLocalRes.getHeader('Access-Control-Allow-Origin') === 'http://localhost:3000',
    'Localhost origin must be allowed in dev'
  );

  console.log(`\n============================================================`);
  console.log(`SECURITY HEADERS & CORS TEST RESULTS: ${passedTests}/${totalTests} PASSED`);
  console.log(`============================================================\n`);
}

runSecurityHeadersAndCorsTests().catch((err) => {
  console.error('Fatal test failure:', err);
  process.exit(1);
});
