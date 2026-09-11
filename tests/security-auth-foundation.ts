/**
 * GrowthForge Buyer Intelligence Engine - Phase 8A.1 Authentication Foundation Verification Suite
 *
 * Verifies that:
 * 1. Missing bearer token returns HTTP 401 (AUTH_REQUIRED).
 * 2. Malformed bearer token returns HTTP 401 (INVALID_TOKEN_FORMAT).
 * 3. Invalid JWT returns HTTP 401 (INVALID_TOKEN).
 * 4. Expired JWT returns HTTP 401 (INVALID_TOKEN).
 * 5. Authenticated request context is properly created on req.auth.
 * 6. requireRole denies unauthorized role with HTTP 403 (FORBIDDEN).
 * 7. requireRole accepts permitted role and allows request to proceed.
 * 8. Health endpoint (/api/health) remains publicly accessible (HTTP 200).
 * 9. Auth failure responses do not leak secrets or internal stack traces.
 * 10. x-tenant-id cannot by itself authenticate a request (HTTP 401).
 * 11. API key authentication fails closed in Phase 8A.1 (HTTP 401).
 * 12. Full Express application route protection on createApp().
 */

import {
  requireAuth,
  requireRole,
  optionalAuth,
  JwtAuthenticator,
  ApiKeyAuthenticator,
  setJwtAuthenticator,
  resetJwtAuthenticator,
  setApiKeyAuthenticator,
  resetApiKeyAuthenticator,
} from '../app/middleware/auth';
import { AuthContext, UserRole } from '../app/schemas/auth';
import { createApp } from '../server';
import http from 'http';
import { AddressInfo } from 'net';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: unknown;
}

const results: TestResult[] = [];

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

// Mock JWT Authenticator for deterministic testing
class MockTestJwtAuthenticator implements JwtAuthenticator {
  private validTokens: Map<string, AuthContext> = new Map();
  private expiredTokens: Set<string> = new Set();

  public registerToken(token: string, context: AuthContext): void {
    this.validTokens.set(token, context);
  }

  public registerExpiredToken(token: string): void {
    this.expiredTokens.add(token);
  }

  public async validateJwt(token: string): Promise<AuthContext | null> {
    if (this.expiredTokens.has(token)) {
      return null;
    }
    return this.validTokens.get(token) || null;
  }
}

// Helper to execute mock Express middleware calls
interface MockResponse {
  statusCode: number;
  jsonData: any;
  headersSent: boolean;
  status(code: number): MockResponse;
  json(data: any): MockResponse;
}

function createMockResponse(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    jsonData: null,
    headersSent: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      this.jsonData = data;
      this.headersSent = true;
      return this;
    },
  };
  return res;
}

async function makeHttpRequest(
  serverUrl: string,
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: any;
  } = {}
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, serverUrl);
    const reqOptions: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    };

    const req = http.request(reqOptions, (res) => {
      let rawData = '';
      res.on('data', (chunk) => {
        rawData += chunk;
      });
      res.on('end', () => {
        let parsedBody: any;
        try {
          parsedBody = JSON.parse(rawData);
        } catch {
          parsedBody = rawData;
        }
        resolve({
          status: res.statusCode || 500,
          body: parsedBody,
        });
      });
    });

    req.on('error', (err) => reject(err));

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('====================================================');
  console.log('PHASE 8A.1: AUTHENTICATION FOUNDATION TEST SUITE');
  console.log('====================================================\n');

  const mockJwtAuth = new MockTestJwtAuthenticator();
  setJwtAuthenticator(mockJwtAuth);

  const VALID_SALES_TOKEN = 'valid-sales-token-jwt-123';
  const VALID_ADMIN_TOKEN = 'valid-admin-token-jwt-456';
  const VALID_VIEWER_TOKEN = 'valid-viewer-token-jwt-789';
  const EXPIRED_TOKEN = 'expired-token-jwt-000';

  mockJwtAuth.registerToken(VALID_SALES_TOKEN, {
    userId: 'user-sales-uuid-1',
    email: 'sales@growthforge.ai',
    role: 'SALES',
    isPlatformAdmin: false,
    authMethod: 'JWT',
  });

  mockJwtAuth.registerToken(VALID_ADMIN_TOKEN, {
    userId: 'user-admin-uuid-2',
    email: 'admin@growthforge.ai',
    role: 'ADMIN',
    isPlatformAdmin: false,
    authMethod: 'JWT',
  });

  mockJwtAuth.registerToken(VALID_VIEWER_TOKEN, {
    userId: 'user-viewer-uuid-3',
    email: 'viewer@growthforge.ai',
    role: 'VIEWER',
    isPlatformAdmin: false,
    authMethod: 'JWT',
  });

  mockJwtAuth.registerExpiredToken(EXPIRED_TOKEN);

  // ----------------------------------------------------
  // Test 1: Missing Bearer Token -> 401 AUTH_REQUIRED
  // ----------------------------------------------------
  try {
    const req: any = { headers: {} };
    const res = createMockResponse();
    let nextCalled = false;

    const middleware = requireAuth();
    await middleware(req, res as any, () => {
      nextCalled = true;
    });

    assert(!nextCalled, 'Next must not be called when token is missing');
    assert(res.statusCode === 401, `Expected status 401, got ${res.statusCode}`);
    assert(res.jsonData.success === false, 'Expected success === false');
    assert(res.jsonData.error.code === 'AUTH_REQUIRED', `Expected AUTH_REQUIRED, got ${res.jsonData.error.code}`);

    results.push({ name: '1. Missing Bearer token returns HTTP 401 (AUTH_REQUIRED)', passed: true });
    console.log('✅ 1. Missing Bearer token returns HTTP 401 (AUTH_REQUIRED)');
  } catch (err: any) {
    results.push({ name: '1. Missing Bearer token returns HTTP 401 (AUTH_REQUIRED)', passed: false, error: err.message });
    console.error('❌ 1. Missing Bearer token returns HTTP 401 (AUTH_REQUIRED):', err.message);
  }

  // ----------------------------------------------------
  // Test 2: Malformed Bearer Token -> 401 INVALID_TOKEN_FORMAT
  // ----------------------------------------------------
  try {
    const testCases = [
      'Basic 123456',
      'Bearer',
      'Bearer ',
      'Token abc',
      'bearer',
    ];

    for (const malformedHeader of testCases) {
      const req: any = { headers: { authorization: malformedHeader } };
      const res = createMockResponse();
      let nextCalled = false;

      const middleware = requireAuth();
      await middleware(req, res as any, () => {
        nextCalled = true;
      });

      assert(!nextCalled, `Next must not be called for malformed header: "${malformedHeader}"`);
      assert(res.statusCode === 401, `Expected 401 for "${malformedHeader}", got ${res.statusCode}`);
      assert(res.jsonData.error.code === 'INVALID_TOKEN_FORMAT', `Expected INVALID_TOKEN_FORMAT, got ${res.jsonData.error.code}`);
    }

    results.push({ name: '2. Malformed Bearer token returns HTTP 401 (INVALID_TOKEN_FORMAT)', passed: true });
    console.log('✅ 2. Malformed Bearer token returns HTTP 401 (INVALID_TOKEN_FORMAT)');
  } catch (err: any) {
    results.push({ name: '2. Malformed Bearer token returns HTTP 401 (INVALID_TOKEN_FORMAT)', passed: false, error: err.message });
    console.error('❌ 2. Malformed Bearer token returns HTTP 401 (INVALID_TOKEN_FORMAT):', err.message);
  }

  // ----------------------------------------------------
  // Test 3: Invalid / Unrecognized JWT -> 401 INVALID_TOKEN
  // ----------------------------------------------------
  try {
    const req: any = { headers: { authorization: 'Bearer invalid-unknown-token-999' } };
    const res = createMockResponse();
    let nextCalled = false;

    const middleware = requireAuth();
    await middleware(req, res as any, () => {
      nextCalled = true;
    });

    assert(!nextCalled, 'Next must not be called for invalid JWT');
    assert(res.statusCode === 401, `Expected status 401, got ${res.statusCode}`);
    assert(res.jsonData.error.code === 'INVALID_TOKEN', `Expected INVALID_TOKEN, got ${res.jsonData.error.code}`);

    results.push({ name: '3. Invalid JWT returns HTTP 401 (INVALID_TOKEN)', passed: true });
    console.log('✅ 3. Invalid JWT returns HTTP 401 (INVALID_TOKEN)');
  } catch (err: any) {
    results.push({ name: '3. Invalid JWT returns HTTP 401 (INVALID_TOKEN)', passed: false, error: err.message });
    console.error('❌ 3. Invalid JWT returns HTTP 401 (INVALID_TOKEN):', err.message);
  }

  // ----------------------------------------------------
  // Test 4: Expired JWT -> 401 INVALID_TOKEN
  // ----------------------------------------------------
  try {
    const req: any = { headers: { authorization: `Bearer ${EXPIRED_TOKEN}` } };
    const res = createMockResponse();
    let nextCalled = false;

    const middleware = requireAuth();
    await middleware(req, res as any, () => {
      nextCalled = true;
    });

    assert(!nextCalled, 'Next must not be called for expired JWT');
    assert(res.statusCode === 401, `Expected status 401, got ${res.statusCode}`);
    assert(res.jsonData.error.code === 'INVALID_TOKEN', `Expected INVALID_TOKEN, got ${res.jsonData.error.code}`);

    results.push({ name: '4. Expired JWT returns HTTP 401 (INVALID_TOKEN)', passed: true });
    console.log('✅ 4. Expired JWT returns HTTP 401 (INVALID_TOKEN)');
  } catch (err: any) {
    results.push({ name: '4. Expired JWT returns HTTP 401 (INVALID_TOKEN)', passed: false, error: err.message });
    console.error('❌ 4. Expired JWT returns HTTP 401 (INVALID_TOKEN):', err.message);
  }

  // ----------------------------------------------------
  // Test 5: Authenticated Request Context Creation -> req.auth populated
  // ----------------------------------------------------
  try {
    const req: any = { headers: { authorization: `Bearer ${VALID_SALES_TOKEN}` } };
    const res = createMockResponse();
    let nextCalled = false;

    const middleware = requireAuth();
    await middleware(req, res as any, () => {
      nextCalled = true;
    });

    assert(nextCalled, 'Next must be called when valid token is provided');
    assert(Boolean(req.auth), 'req.auth must be populated');
    assert(req.auth.userId === 'user-sales-uuid-1', `Expected userId 'user-sales-uuid-1', got ${req.auth.userId}`);
    assert(req.auth.email === 'sales@growthforge.ai', `Expected email 'sales@growthforge.ai', got ${req.auth.email}`);
    assert(req.auth.role === 'SALES', `Expected role 'SALES', got ${req.auth.role}`);
    assert(req.auth.isPlatformAdmin === false, 'Expected isPlatformAdmin === false');
    assert(req.auth.authMethod === 'JWT', 'Expected authMethod === JWT');

    results.push({ name: '5. Valid JWT populates typed req.auth context', passed: true });
    console.log('✅ 5. Valid JWT populates typed req.auth context');
  } catch (err: any) {
    results.push({ name: '5. Valid JWT populates typed req.auth context', passed: false, error: err.message });
    console.error('❌ 5. Valid JWT populates typed req.auth context:', err.message);
  }

  // ----------------------------------------------------
  // Test 6: requireRole denies unauthorized role -> 403 FORBIDDEN
  // ----------------------------------------------------
  try {
    const req: any = {
      headers: { authorization: `Bearer ${VALID_VIEWER_TOKEN}` },
      auth: {
        userId: 'user-viewer-uuid-3',
        email: 'viewer@growthforge.ai',
        role: 'VIEWER',
        isPlatformAdmin: false,
        authMethod: 'JWT',
      },
    };
    const res = createMockResponse();
    let nextCalled = false;

    // Route requires SALES, ADMIN, or OWNER
    const roleMiddleware = requireRole('SALES', 'ADMIN', 'OWNER');
    roleMiddleware(req, res as any, () => {
      nextCalled = true;
    });

    assert(!nextCalled, 'Next must not be called when user role is insufficient');
    assert(res.statusCode === 403, `Expected status 403, got ${res.statusCode}`);
    assert(res.jsonData.success === false, 'Expected success === false');
    assert(res.jsonData.error.code === 'FORBIDDEN', `Expected FORBIDDEN, got ${res.jsonData.error.code}`);

    results.push({ name: '6. requireRole denies unauthorized role with HTTP 403 (FORBIDDEN)', passed: true });
    console.log('✅ 6. requireRole denies unauthorized role with HTTP 403 (FORBIDDEN)');
  } catch (err: any) {
    results.push({ name: '6. requireRole denies unauthorized role with HTTP 403 (FORBIDDEN)', passed: false, error: err.message });
    console.error('❌ 6. requireRole denies unauthorized role with HTTP 403 (FORBIDDEN):', err.message);
  }

  // ----------------------------------------------------
  // Test 7: requireRole accepts permitted role -> next() called
  // ----------------------------------------------------
  try {
    const req: any = {
      headers: { authorization: `Bearer ${VALID_SALES_TOKEN}` },
      auth: {
        userId: 'user-sales-uuid-1',
        email: 'sales@growthforge.ai',
        role: 'SALES',
        isPlatformAdmin: false,
        authMethod: 'JWT',
      },
    };
    const res = createMockResponse();
    let nextCalled = false;

    const roleMiddleware = requireRole('SALES', 'ADMIN', 'OWNER');
    roleMiddleware(req, res as any, () => {
      nextCalled = true;
    });

    assert(nextCalled, 'Next must be called when role is permitted');
    assert(res.statusCode === 200, `Expected default status 200, got ${res.statusCode}`);

    results.push({ name: '7. requireRole accepts permitted role and invokes next()', passed: true });
    console.log('✅ 7. requireRole accepts permitted role and invokes next()');
  } catch (err: any) {
    results.push({ name: '7. requireRole accepts permitted role and invokes next()', passed: false, error: err.message });
    console.error('❌ 7. requireRole accepts permitted role and invokes next():', err.message);
  }

  // ----------------------------------------------------
  // Test 8: CRITICAL RULE: x-tenant-id cannot authenticate a request alone
  // ----------------------------------------------------
  try {
    const req: any = {
      headers: {
        'x-tenant-id': '00000000-0000-0000-0000-000000000001',
      },
    };
    const res = createMockResponse();
    let nextCalled = false;

    const middleware = requireAuth();
    await middleware(req, res as any, () => {
      nextCalled = true;
    });

    assert(!nextCalled, 'x-tenant-id alone MUST NEVER authenticate a request');
    assert(res.statusCode === 401, `Expected status 401, got ${res.statusCode}`);
    assert(res.jsonData.error.code === 'AUTH_REQUIRED', `Expected AUTH_REQUIRED, got ${res.jsonData.error.code}`);

    results.push({ name: '8. CRITICAL RULE: x-tenant-id cannot authenticate a request alone', passed: true });
    console.log('✅ 8. CRITICAL RULE: x-tenant-id cannot authenticate a request alone');
  } catch (err: any) {
    results.push({ name: '8. CRITICAL RULE: x-tenant-id cannot authenticate a request alone', passed: false, error: err.message });
    console.error('❌ 8. CRITICAL RULE: x-tenant-id cannot authenticate a request alone:', err.message);
  }

  // ----------------------------------------------------
  // Test 9: Auth failure responses do not leak secrets or internal errors
  // ----------------------------------------------------
  try {
    const req: any = {
      headers: {
        authorization: 'Bearer secret-internal-jwt-key-999',
        'x-api-key': 'secret-api-key-test-value',
      },
    };
    const res = createMockResponse();

    const middleware = requireAuth();
    await middleware(req, res as any, () => {});

    const jsonString = JSON.stringify(res.jsonData);
    assert(!jsonString.includes('secret-internal-jwt-key-999'), 'Response must not contain JWT token content');
    assert(!jsonString.includes('secret-api-key-test-value'), 'Response must not contain API key value');
    assert(!jsonString.includes('stack'), 'Response must not contain stack traces');

    results.push({ name: '9. Auth failures do not leak secrets or stack traces', passed: true });
    console.log('✅ 9. Auth failures do not leak secrets or stack traces');
  } catch (err: any) {
    results.push({ name: '9. Auth failures do not leak secrets or stack traces', passed: false, error: err.message });
    console.error('❌ 9. Auth failures do not leak secrets or stack traces:', err.message);
  }

  // ----------------------------------------------------
  // Test 10: API Key Authenticator fails closed in Phase 8A.1
  // ----------------------------------------------------
  try {
    const req: any = {
      headers: {
        'x-api-key': 'growthforge_test_api_key_123',
      },
    };
    const res = createMockResponse();
    let nextCalled = false;

    const middleware = requireAuth();
    await middleware(req, res as any, () => {
      nextCalled = true;
    });

    assert(!nextCalled, 'API keys must fail closed in Phase 8A.1 before tenant schema exists');
    assert(res.statusCode === 401, `Expected status 401, got ${res.statusCode}`);
    assert(res.jsonData.error.code === 'INVALID_API_KEY', `Expected INVALID_API_KEY, got ${res.jsonData.error.code}`);

    results.push({ name: '10. API key authentication fails closed in Phase 8A.1', passed: true });
    console.log('✅ 10. API key authentication fails closed in Phase 8A.1');
  } catch (err: any) {
    results.push({ name: '10. API key authentication fails closed in Phase 8A.1', passed: false, error: err.message });
    console.error('❌ 10. API key authentication fails closed in Phase 8A.1:', err.message);
  }

  // ----------------------------------------------------
  // Test 11 & 12: Full Express App HTTP Integration Verification
  // ----------------------------------------------------
  let server: http.Server | null = null;
  try {
    const app = createApp();
    server = http.createServer(app);

    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', () => {
        resolve();
      });
    });

    const address = server.address() as AddressInfo;
    const serverUrl = `http://127.0.0.1:${address.port}`;

    // Test 11: Public health endpoint returns 200 without authentication
    const healthRes = await makeHttpRequest(serverUrl, '/api/health');
    assert(healthRes.status === 200, `Expected 200 on /api/health, got ${healthRes.status}`);
    assert(healthRes.body.status === 'ok', 'Expected status === ok');

    results.push({ name: '11. Public health endpoint (/api/health) returns 200 without authentication', passed: true });
    console.log('✅ 11. Public health endpoint (/api/health) returns 200 without authentication');

    // Test 12: Protected endpoint (/api/voice/start-call) returns 401 when unauthenticated
    const unauthCallRes = await makeHttpRequest(serverUrl, '/api/voice/start-call', {
      method: 'POST',
      body: { leadId: 'lead_123' },
    });
    assert(unauthCallRes.status === 401, `Expected 401 on unauthenticated /api/voice/start-call, got ${unauthCallRes.status}`);
    assert(unauthCallRes.body.success === false, 'Expected success === false');
    assert(unauthCallRes.body.error.code === 'AUTH_REQUIRED', `Expected AUTH_REQUIRED, got ${unauthCallRes.body.error.code}`);

    // Test 13: Protected endpoint with viewer token calling sales-only endpoint returns 403 FORBIDDEN
    const forbiddenCallRes = await makeHttpRequest(serverUrl, '/api/voice/start-call', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${VALID_VIEWER_TOKEN}`,
      },
      body: { leadId: 'lead_123' },
    });
    assert(forbiddenCallRes.status === 403, `Expected 403 on viewer role on start-call, got ${forbiddenCallRes.status}`);
    assert(forbiddenCallRes.body.error.code === 'FORBIDDEN', `Expected FORBIDDEN, got ${forbiddenCallRes.body.error.code}`);

    results.push({ name: '12. Express HTTP layer enforces 401 unauthenticated and 403 role restrictions', passed: true });
    console.log('✅ 12. Express HTTP layer enforces 401 unauthenticated and 403 role restrictions');
  } catch (err: any) {
    results.push({ name: '12. Express HTTP layer enforces 401 unauthenticated and 403 role restrictions', passed: false, error: err.message });
    console.error('❌ 12. Express HTTP layer enforces 401 unauthenticated and 403 role restrictions:', err.message);
  } finally {
    if (server) {
      server.close();
    }
    resetJwtAuthenticator();
    resetApiKeyAuthenticator();
  }

  // ----------------------------------------------------
  // SUMMARY
  // ----------------------------------------------------
  console.log('\n====================================================');
  console.log('PHASE 8A.1 AUTHENTICATION TEST SUMMARY');
  console.log('====================================================');

  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;

  console.log(`Total Tests:  ${total}`);
  console.log(`Passed:       ${passed}`);
  console.log(`Failed:       ${failed}`);

  if (failed > 0) {
    console.error('\n❌ SOME AUTHENTICATION TESTS FAILED:');
    for (const r of results.filter((r) => !r.passed)) {
      console.error(`- ${r.name}: ${r.error}`);
    }
    process.exit(1);
  } else {
    console.log('\n🎉 ALL PHASE 8A.1 AUTHENTICATION TESTS PASSED PERFECTLY!');
  }
}

runTests().catch((err) => {
  console.error('Unhandled test suite error:', err);
  process.exit(1);
});
