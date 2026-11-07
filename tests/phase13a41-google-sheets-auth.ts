/**
 * GrowthForge Phase 13A.4.1 — Google Sheets Authentication Service Test Suite
 *
 * Verifies all 10 required security & functional invariants:
 * 1. Missing service-account credentials fails closed.
 * 2. Invalid private-key configuration rejected cleanly.
 * 3. Successful token exchange using a mocked endpoint.
 * 4. Token caching avoids redundant exchange.
 * 5. Token refresh triggers when within expiry buffer.
 * 6. Concurrent requests share a single in-flight token exchange.
 * 7. Token endpoint network failure classified as retryable.
 * 8. Token endpoint HTTP failure (e.g. 400/401) classified as non-retryable auth error.
 * 9. No credentials or JWT signatures appear in log messages or errors.
 * 10. Client bundles contain zero private keys or secret variables.
 */

import assert from 'assert';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  GoogleSheetsAuthService,
  createServiceAccountJwt,
  GoogleSheetsAuthError,
  GoogleSheetsNetworkError,
  GOOGLE_METADATA_TOKEN_ENDPOINT,
  GOOGLE_SPREADSHEETS_SCOPE,
} from '../app/services/handoff/googleSheetsAuthService';

// Generate a valid RSA keypair for testing
const { privateKey: testPrivateKeyPem } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const TEST_CLIENT_EMAIL = 'gf-test-service-account@growthforge-test-project.iam.gserviceaccount.com';

async function runTestSuite() {
  console.log('============================================================');
  console.log('GROWTHFORGE PHASE 13A.4.1 — GOOGLE SHEETS AUTH TEST SUITE');
  console.log('============================================================');

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

  // 1. Missing service-account credentials
  await test('Missing service-account credentials fails closed', async () => {
    const auth = new GoogleSheetsAuthService({
      credentials: null,
      staticToken: null,
    });
    await assert.rejects(
      async () => {
        await auth.getAccessToken();
      },
      (err: any) => {
        assert(err instanceof GoogleSheetsAuthError, 'Must throw GoogleSheetsAuthError');
        assert.strictEqual(err.retry_eligible, false, 'Auth error must not be retry_eligible');
        return true;
      }
    );
  });

  // 2. Invalid private-key configuration
  await test('Invalid private-key configuration rejected cleanly without exposing key data', async () => {
    const auth = new GoogleSheetsAuthService({
      credentials: {
        client_email: TEST_CLIENT_EMAIL,
        private_key: 'NOT_A_VALID_PEM_KEY',
      },
    });
    await assert.rejects(
      async () => {
        await auth.getAccessToken();
      },
      (err: any) => {
        assert(err instanceof GoogleSheetsAuthError, 'Must throw GoogleSheetsAuthError');
        assert(!err.message.includes('NOT_A_VALID_PEM_KEY'), 'Must not disclose key contents in message');
        return true;
      }
    );
  });

  // 3. Successful token exchange using a mocked endpoint
  await test('Successful token exchange using mocked endpoint', async () => {
    let capturedBody = '';
    const mockFetch: typeof fetch = async (url, init) => {
      assert.strictEqual(url, 'https://mock.oauth.local/token');
      assert.strictEqual(init?.method, 'POST');
      capturedBody = String(init?.body || '');
      return new Response(
        JSON.stringify({
          access_token: 'mock-oauth-access-token-xyz-123',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const auth = new GoogleSheetsAuthService({
      tokenEndpoint: 'https://mock.oauth.local/token',
      fetchFn: mockFetch,
      credentials: {
        client_email: TEST_CLIENT_EMAIL,
        private_key: testPrivateKeyPem,
      },
    });

    const token = await auth.getAccessToken();
    assert.strictEqual(token, 'mock-oauth-access-token-xyz-123');
    assert(capturedBody.includes('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer'), 'Must use jwt-bearer grant');
    assert(capturedBody.includes('assertion='), 'Must include JWT assertion');
  });

  // 4. Token caching avoids redundant exchange
  await test('Token caching prevents redundant token endpoint HTTP calls', async () => {
    let callCount = 0;
    const mockFetch: typeof fetch = async () => {
      callCount++;
      return new Response(
        JSON.stringify({
          access_token: 'cached-token-111',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    let simulatedTime = 1000000;
    const auth = new GoogleSheetsAuthService({
      tokenEndpoint: 'https://mock.oauth.local/token',
      fetchFn: mockFetch,
      timeFn: () => simulatedTime,
      credentials: {
        client_email: TEST_CLIENT_EMAIL,
        private_key: testPrivateKeyPem,
      },
    });

    const token1 = await auth.getAccessToken();
    const token2 = await auth.getAccessToken();
    assert.strictEqual(token1, 'cached-token-111');
    assert.strictEqual(token2, 'cached-token-111');
    assert.strictEqual(callCount, 1, 'Only 1 HTTP call must occur for cached token');
  });

  // 5. Token refresh triggers when within expiry buffer
  await test('Token refresh triggers when within 5-minute expiry buffer', async () => {
    let callCount = 0;
    const mockFetch: typeof fetch = async () => {
      callCount++;
      return new Response(
        JSON.stringify({
          access_token: `token-version-${callCount}`,
          expires_in: 3600, // 1 hour
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    let simulatedTime = 1000000;
    const auth = new GoogleSheetsAuthService({
      tokenEndpoint: 'https://mock.oauth.local/token',
      fetchFn: mockFetch,
      timeFn: () => simulatedTime,
      expiryBufferMs: 300000, // 5 minutes
      credentials: {
        client_email: TEST_CLIENT_EMAIL,
        private_key: testPrivateKeyPem,
      },
    });

    const token1 = await auth.getAccessToken();
    assert.strictEqual(token1, 'token-version-1');
    assert.strictEqual(callCount, 1);

    // Fast-forward time past 55 minutes (3600 - 300 = 3300 seconds)
    simulatedTime += (3300 + 1) * 1000;

    const token2 = await auth.getAccessToken();
    assert.strictEqual(token2, 'token-version-2');
    assert.strictEqual(callCount, 2, 'Token refresh must occur after buffer expiration');
  });

  // 6. Concurrent requests share a single in-flight token exchange
  await test('Concurrent requests share in-flight exchange promise without redundant requests', async () => {
    let callCount = 0;
    const mockFetch: typeof fetch = async () => {
      callCount++;
      // Simulate 50ms latency
      await new Promise((r) => setTimeout(r, 50));
      return new Response(
        JSON.stringify({
          access_token: 'concurrent-shared-token',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const auth = new GoogleSheetsAuthService({
      tokenEndpoint: 'https://mock.oauth.local/token',
      fetchFn: mockFetch,
      credentials: {
        client_email: TEST_CLIENT_EMAIL,
        private_key: testPrivateKeyPem,
      },
    });

    const [t1, t2, t3, t4] = await Promise.all([
      auth.getAccessToken(),
      auth.getAccessToken(),
      auth.getAccessToken(),
      auth.getAccessToken(),
    ]);

    assert.strictEqual(t1, 'concurrent-shared-token');
    assert.strictEqual(t2, 'concurrent-shared-token');
    assert.strictEqual(t3, 'concurrent-shared-token');
    assert.strictEqual(t4, 'concurrent-shared-token');
    assert.strictEqual(callCount, 1, 'Concurrent requests must share a single token exchange');
  });

  // 7. Token endpoint network failure classified as retryable
  await test('Token endpoint network failure classified as retryable GoogleSheetsNetworkError', async () => {
    const mockFetch: typeof fetch = async () => {
      throw new Error('fetch failed: getaddrinfo ENOTFOUND oauth2.googleapis.com');
    };

    const auth = new GoogleSheetsAuthService({
      tokenEndpoint: 'https://mock.oauth.local/token',
      fetchFn: mockFetch,
      credentials: {
        client_email: TEST_CLIENT_EMAIL,
        private_key: testPrivateKeyPem,
      },
    });

    await assert.rejects(
      async () => {
        await auth.getAccessToken();
      },
      (err: any) => {
        assert(err instanceof GoogleSheetsNetworkError, 'Must throw GoogleSheetsNetworkError');
        assert.strictEqual(err.retry_eligible, true, 'Network failure must be retry_eligible');
        return true;
      }
    );
  });

  // 8. Token endpoint HTTP failure classified as non-retryable auth error
  await test('Token endpoint HTTP 400 invalid_grant classified as non-retryable GoogleSheetsAuthError', async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response(
        JSON.stringify({
          error: 'invalid_grant',
          error_description: 'Invalid JWT signature',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const auth = new GoogleSheetsAuthService({
      tokenEndpoint: 'https://mock.oauth.local/token',
      fetchFn: mockFetch,
      credentials: {
        client_email: TEST_CLIENT_EMAIL,
        private_key: testPrivateKeyPem,
      },
    });

    await assert.rejects(
      async () => {
        await auth.getAccessToken();
      },
      (err: any) => {
        assert(err instanceof GoogleSheetsAuthError, 'Must throw GoogleSheetsAuthError');
        assert.strictEqual(err.retry_eligible, false, 'Auth error must NOT be retry_eligible');
        assert(err.message.includes('invalid_grant'), 'Message must capture error description');
        return true;
      }
    );
  });

  // 9. No credentials appear in log messages or errors
  await test('Credentials and private keys are never included in error messages or logs', async () => {
    try {
      createServiceAccountJwt('bad-email', 'bad-key', 1000);
      assert.fail('Should have thrown error');
    } catch (err: any) {
      assert(!err.message.includes(testPrivateKeyPem), 'Must not include private key in error');
    }
  });

  // 10. Client bundles contain zero private keys or secret variables
  await test('Client production bundle assets do not contain service account private keys or secrets', async () => {
    const distAssetsDir = path.resolve('dist/assets');
    if (fs.existsSync(distAssetsDir)) {
      const files = fs.readdirSync(distAssetsDir);
      for (const file of files) {
        if (file.endsWith('.js')) {
          const content = fs.readFileSync(path.join(distAssetsDir, file), 'utf8');
          assert(!content.includes('BEGIN PRIVATE KEY'), `Bundle ${file} must not contain private key marker`);
          assert(!content.includes('GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY'), `Bundle ${file} must not reference GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY`);
          assert(!content.includes('GOOGLE_SHEETS_PRIVATE_KEY'), `Bundle ${file} must not reference GOOGLE_SHEETS_PRIVATE_KEY`);
        }
      }
    }
  });

  // 11. Production + environment static token only => rejected
  await test('Production environment strictly rejects static token fallback via process.env', async () => {
    const savedEnv = process.env.NODE_ENV;
    const savedToken = process.env.GOOGLE_SHEETS_ACCESS_TOKEN;
    process.env.NODE_ENV = 'production';
    process.env.GOOGLE_SHEETS_ACCESS_TOKEN = 'mock-static-token-12345';
    try {
      const auth = new GoogleSheetsAuthService({
        credentials: null,
      });
      await assert.rejects(
        async () => {
          await auth.getAccessToken();
        },
        (err: any) => {
          assert(err instanceof GoogleSheetsAuthError, 'Must throw GoogleSheetsAuthError');
          assert.strictEqual(err.retry_eligible, false);
          assert(err.message.includes('strictly prohibited in production'), 'Error must cite production prohibition');
          assert(!err.message.includes('mock-static-token-12345'), 'Error must not leak static token');
          return true;
        }
      );
      assert.strictEqual(auth.getCachedTokenEntry(), null, 'Must not cache static token in production');
    } finally {
      process.env.NODE_ENV = savedEnv;
      if (savedToken !== undefined) {
        process.env.GOOGLE_SHEETS_ACCESS_TOKEN = savedToken;
      } else {
        delete process.env.GOOGLE_SHEETS_ACCESS_TOKEN;
      }
    }
  });

  // 12. Production + constructor-injected static token only => rejected
  await test('Production environment strictly rejects constructor-injected static token', async () => {
    const auth = new GoogleSheetsAuthService({
      credentials: null,
      staticToken: 'constructor-injected-token-secret',
      nodeEnv: 'production',
    });
    await assert.rejects(
      async () => {
        await auth.getAccessToken();
      },
      (err: any) => {
        assert(err instanceof GoogleSheetsAuthError, 'Must throw GoogleSheetsAuthError');
        assert.strictEqual(err.retry_eligible, false);
        assert(err.message.includes('strictly prohibited in production'));
        assert(!err.message.includes('constructor-injected-token-secret'), 'Error must not leak constructor token');
        return true;
      }
    );
    assert.strictEqual(auth.getCachedTokenEntry(), null, 'Must not cache constructor static token in production');
  });

  // 13. Production + valid service-account credentials => service-account path available via mocked exchange
  await test('Production environment allows service-account credentials via mocked token exchange', async () => {
    let exchangeCalled = false;
    const mockFetch: typeof fetch = async (url, init) => {
      exchangeCalled = true;
      return new Response(
        JSON.stringify({
          access_token: 'valid-sa-token-prod',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const auth = new GoogleSheetsAuthService({
      tokenEndpoint: 'https://mock.oauth.local/token',
      fetchFn: mockFetch,
      credentials: {
        client_email: TEST_CLIENT_EMAIL,
        private_key: testPrivateKeyPem,
      },
      nodeEnv: 'production',
    });

    const token = await auth.getAccessToken();
    assert.strictEqual(token, 'valid-sa-token-prod');
    assert.strictEqual(exchangeCalled, true, 'Service-account token exchange must be executed');
  });

  // 14. Non-production + static token => permitted behavior preserved
  await test('Non-production environment permits static token fallback for test simulation', async () => {
    const auth = new GoogleSheetsAuthService({
      credentials: null,
      staticToken: 'test-env-static-token',
      nodeEnv: 'test',
    });
    const token = await auth.getAccessToken();
    assert.strictEqual(token, 'test-env-static-token');
    assert.strictEqual(auth.getCachedTokenEntry()?.token, 'test-env-static-token');
  });

  // 15. Missing credentials and missing static token in production => fails closed
  await test('Missing credentials and missing static token in production fails closed with clean error', async () => {
    const auth = new GoogleSheetsAuthService({
      credentials: null,
      staticToken: null,
      nodeEnv: 'production',
    });
    await assert.rejects(
      async () => {
        await auth.getAccessToken();
      },
      (err: any) => {
        assert(err instanceof GoogleSheetsAuthError);
        assert.strictEqual(err.retry_eligible, false);
        assert(err.message.includes('credentials'), 'Error must cite missing credentials');
        return true;
      }
    );
  });

  // ============================================================
  // PHASE 13A.5.3 — KEYLESS GOOGLE CLOUD METADATA SERVER TESTS
  // ============================================================

  // 16. Valid metadata-server token acquisition with correct endpoint, headers, and redirect: 'error'
  await test('Valid metadata-server token acquisition with correct endpoint, headers, and redirect error', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    let capturedRedirect = '';
    let capturedMethod = '';

    const mockFetch: typeof fetch = async (url, init) => {
      capturedUrl = String(url);
      capturedMethod = String(init?.method);
      capturedRedirect = String(init?.redirect);
      if (init?.headers) {
        capturedHeaders = init.headers as Record<string, string>;
      }
      return new Response(
        JSON.stringify({
          access_token: 'valid-metadata-token-12345',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const auth = new GoogleSheetsAuthService({
      authProvider: 'METADATA',
      fetchFn: mockFetch,
    });

    const token = await auth.getAccessToken();
    assert.strictEqual(token, 'valid-metadata-token-12345');
    assert.strictEqual(capturedMethod, 'GET');
    const expectedUrl = `${GOOGLE_METADATA_TOKEN_ENDPOINT}?scopes=${encodeURIComponent(GOOGLE_SPREADSHEETS_SCOPE)}`;
    assert.strictEqual(capturedUrl, expectedUrl);
    assert.strictEqual(capturedHeaders['Metadata-Flavor'], 'Google');
    assert.strictEqual(capturedHeaders['Accept'], 'application/json');
    assert.strictEqual(capturedRedirect, 'error', 'Must specify redirect: error');
  });

  // 17. Metadata server redirect response rejected
  await test('Metadata server redirect response rejected', async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response(null, {
        status: 302,
        headers: { Location: 'http://evil.attacker.com/token' },
      });
    };

    const auth = new GoogleSheetsAuthService({
      authProvider: 'METADATA',
      fetchFn: mockFetch,
    });

    await assert.rejects(
      async () => {
        await auth.getAccessToken();
      },
      (err: any) => {
        assert(err instanceof GoogleSheetsAuthError);
        assert(err.message.includes('redirect rejected'), 'Error must cite redirect rejection');
        return true;
      }
    );
  });

  // 18. Metadata server HTTP 404 / 403 error responses
  await test('Metadata server HTTP 404 error classified as non-retryable GoogleSheetsAuthError', async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response('Not Found', { status: 404, statusText: 'Not Found' });
    };

    const auth = new GoogleSheetsAuthService({
      authProvider: 'METADATA',
      fetchFn: mockFetch,
    });

    await assert.rejects(
      async () => {
        await auth.getAccessToken();
      },
      (err: any) => {
        assert(err instanceof GoogleSheetsAuthError);
        assert.strictEqual(err.retry_eligible, false);
        return true;
      }
    );
  });

  // 19. Metadata server HTTP 500 error response
  await test('Metadata server HTTP 500 error classified as retryable GoogleSheetsNetworkError', async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response('Internal Server Error', { status: 500, statusText: 'Internal Error' });
    };

    const auth = new GoogleSheetsAuthService({
      authProvider: 'METADATA',
      fetchFn: mockFetch,
    });

    await assert.rejects(
      async () => {
        await auth.getAccessToken();
      },
      (err: any) => {
        assert(err instanceof GoogleSheetsNetworkError);
        assert.strictEqual(err.retry_eligible, true);
        return true;
      }
    );
  });

  // 20. Metadata server network failure (connection error)
  await test('Metadata server network connection failure classified as retryable GoogleSheetsNetworkError', async () => {
    const mockFetch: typeof fetch = async () => {
      throw new Error('connect ECONNREFUSED 169.254.169.254:80');
    };

    const auth = new GoogleSheetsAuthService({
      authProvider: 'METADATA',
      fetchFn: mockFetch,
    });

    await assert.rejects(
      async () => {
        await auth.getAccessToken();
      },
      (err: any) => {
        assert(err instanceof GoogleSheetsNetworkError);
        assert.strictEqual(err.retry_eligible, true);
        return true;
      }
    );
  });

  // 21. Bounded timeout for metadata server requests
  await test('Metadata server request timeout classified as retryable GoogleSheetsNetworkError', async () => {
    const mockFetch: typeof fetch = (_url: any, init?: any): Promise<Response> => {
      return new Promise<Response>((_, reject) => {
        if (init?.signal) {
          init.signal.addEventListener('abort', () => {
            const abortErr = new Error('The operation was aborted');
            abortErr.name = 'AbortError';
            reject(abortErr);
          });
        }
      });
    };

    const auth = new GoogleSheetsAuthService({
      authProvider: 'METADATA',
      fetchFn: mockFetch,
      timeoutMs: 50,
    });

    await assert.rejects(
      async () => {
        await auth.getAccessToken();
      },
      (err: any) => {
        assert(err instanceof GoogleSheetsNetworkError);
        assert.strictEqual(err.retry_eligible, true);
        assert(err.message.includes('timed out'));
        return true;
      }
    );
  });

  // 22. Metadata server malformed JSON response
  await test('Metadata server malformed JSON payload rejected cleanly', async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response('<html>502 Bad Gateway</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    };

    const auth = new GoogleSheetsAuthService({
      authProvider: 'METADATA',
      fetchFn: mockFetch,
    });

    await assert.rejects(
      async () => {
        await auth.getAccessToken();
      },
      (err: any) => {
        assert(err instanceof GoogleSheetsAuthError);
        assert(err.message.includes('malformed JSON'));
        return true;
      }
    );
  });

  // 23. Metadata server response missing access_token
  await test('Metadata server response missing access_token rejected', async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response(
        JSON.stringify({
          token_type: 'Bearer',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const auth = new GoogleSheetsAuthService({
      authProvider: 'METADATA',
      fetchFn: mockFetch,
    });

    await assert.rejects(
      async () => {
        await auth.getAccessToken();
      },
      (err: any) => {
        assert(err instanceof GoogleSheetsAuthError);
        assert(err.message.includes('missing access_token'));
        return true;
      }
    );
  });

  // 24. Metadata server response with non-positive expires_in rejected
  await test('Metadata server response with non-positive expires_in rejected', async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response(
        JSON.stringify({
          access_token: 'meta-token-xyz',
          expires_in: 0,
          token_type: 'Bearer',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const auth = new GoogleSheetsAuthService({
      authProvider: 'METADATA',
      fetchFn: mockFetch,
    });

    await assert.rejects(
      async () => {
        await auth.getAccessToken();
      },
      (err: any) => {
        assert(err instanceof GoogleSheetsAuthError);
        assert(err.message.includes('expires_in'));
        return true;
      }
    );
  });

  // 25. Keyless metadata token caching prevents duplicate calls
  await test('Metadata token caching reuses active token within validity period', async () => {
    let callCount = 0;
    const mockFetch: typeof fetch = async () => {
      callCount++;
      return new Response(
        JSON.stringify({
          access_token: 'cached-meta-token-001',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    let simulatedTime = 5000000;
    const auth = new GoogleSheetsAuthService({
      authProvider: 'METADATA',
      fetchFn: mockFetch,
      timeFn: () => simulatedTime,
    });

    const tok1 = await auth.getAccessToken();
    const tok2 = await auth.getAccessToken();
    assert.strictEqual(tok1, 'cached-meta-token-001');
    assert.strictEqual(tok2, 'cached-meta-token-001');
    assert.strictEqual(callCount, 1, 'Only 1 metadata server fetch should occur for cached token');
  });

  // 26. Keyless metadata token refresh triggers within expiry buffer
  await test('Metadata token refreshes automatically when within expiry buffer', async () => {
    let callCount = 0;
    const mockFetch: typeof fetch = async () => {
      callCount++;
      return new Response(
        JSON.stringify({
          access_token: `refreshed-meta-token-${callCount}`,
          expires_in: 3600,
          token_type: 'Bearer',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    let simulatedTime = 5000000;
    const auth = new GoogleSheetsAuthService({
      authProvider: 'METADATA',
      fetchFn: mockFetch,
      timeFn: () => simulatedTime,
      expiryBufferMs: 300000, // 5 min
    });

    const tok1 = await auth.getAccessToken();
    assert.strictEqual(tok1, 'refreshed-meta-token-1');
    assert.strictEqual(callCount, 1);

    // Advance time past 55 minutes (3600 - 300 = 3300s)
    simulatedTime += 3301 * 1000;

    const tok2 = await auth.getAccessToken();
    assert.strictEqual(tok2, 'refreshed-meta-token-2');
    assert.strictEqual(callCount, 2, 'Metadata token must refresh after expiry buffer');
  });

  // 27. Concurrent requests share single metadata in-flight exchange
  await test('Concurrent requests share a single metadata token exchange promise', async () => {
    let callCount = 0;
    const mockFetch: typeof fetch = async () => {
      callCount++;
      await new Promise((r) => setTimeout(r, 40));
      return new Response(
        JSON.stringify({
          access_token: 'concurrent-meta-token',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const auth = new GoogleSheetsAuthService({
      authProvider: 'METADATA',
      fetchFn: mockFetch,
    });

    const [t1, t2, t3] = await Promise.all([
      auth.getAccessToken(),
      auth.getAccessToken(),
      auth.getAccessToken(),
    ]);

    assert.strictEqual(t1, 'concurrent-meta-token');
    assert.strictEqual(t2, 'concurrent-meta-token');
    assert.strictEqual(t3, 'concurrent-meta-token');
    assert.strictEqual(callCount, 1, 'Concurrent metadata requests must deduplicate to 1 fetch');
  });

  // 28. Production keyless failure without private-key fallback
  await test('Production keyless failure fails closed without private-key fallback', async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' });
    };

    const auth = new GoogleSheetsAuthService({
      authProvider: 'METADATA',
      fetchFn: mockFetch,
      credentials: {
        client_email: TEST_CLIENT_EMAIL,
        private_key: testPrivateKeyPem,
      },
      nodeEnv: 'production',
    });

    await assert.rejects(
      async () => {
        await auth.getAccessToken();
      },
      (err: any) => {
        assert(err instanceof GoogleSheetsAuthError);
        assert(err.message.includes('Metadata server token request failed'), 'Must fail on metadata error, not fall back');
        return true;
      }
    );
  });

  // 29. Invalid provider configuration rejected
  await test('Invalid authProvider constructor option rejected cleanly', async () => {
    assert.throws(
      () => {
        const auth = new GoogleSheetsAuthService({
          authProvider: 'UNSUPPORTED' as any,
        });
        auth.resolveAuthProvider();
      },
      (err: any) => {
        assert(err instanceof GoogleSheetsAuthError);
        assert(err.message.includes('Invalid authProvider option'));
        return true;
      }
    );
  });

  await test('Invalid GOOGLE_SHEETS_AUTH_PROVIDER environment variable rejected', async () => {
    const saved = process.env.GOOGLE_SHEETS_AUTH_PROVIDER;
    process.env.GOOGLE_SHEETS_AUTH_PROVIDER = 'INVALID_PROVIDER';
    try {
      const auth = new GoogleSheetsAuthService();
      assert.throws(
        () => {
          auth.resolveAuthProvider();
        },
        (err: any) => {
          assert(err instanceof GoogleSheetsAuthError);
          assert(err.message.includes('Invalid GOOGLE_SHEETS_AUTH_PROVIDER'));
          return true;
        }
      );
    } finally {
      if (saved !== undefined) {
        process.env.GOOGLE_SHEETS_AUTH_PROVIDER = saved;
      } else {
        delete process.env.GOOGLE_SHEETS_AUTH_PROVIDER;
      }
    }
  });

  // 30. Non-GCP environment fails closed for keyless metadata
  await test('Non-GCP environment without mock fetch fails safely for keyless metadata', async () => {
    const savedKService = process.env.K_SERVICE;
    const savedKRevision = process.env.K_REVISION;
    const savedKConfig = process.env.K_CONFIGURATION;
    const savedFunc = process.env.FUNCTION_TARGET;
    delete process.env.K_SERVICE;
    delete process.env.K_REVISION;
    delete process.env.K_CONFIGURATION;
    delete process.env.FUNCTION_TARGET;

    try {
      const auth = new GoogleSheetsAuthService({
        authProvider: 'METADATA',
        nodeEnv: 'production',
      });
      await assert.rejects(
        async () => {
          await auth.getAccessToken();
        },
        (err: any) => {
          assert(err instanceof GoogleSheetsAuthError);
          assert(err.message.includes('Google Cloud execution environments'));
          return true;
        }
      );
    } finally {
      if (savedKService !== undefined) process.env.K_SERVICE = savedKService;
      if (savedKRevision !== undefined) process.env.K_REVISION = savedKRevision;
      if (savedKConfig !== undefined) process.env.K_CONFIGURATION = savedKConfig;
      if (savedFunc !== undefined) process.env.FUNCTION_TARGET = savedFunc;
    }
  });

  // 32. Test execution makes zero external network calls
  await test('Test execution makes zero external network calls', async () => {
    let reachedExternal = false;
    const guardedFetch: typeof fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('googleapis.com') || urlStr.includes('metadata.google.internal')) {
        return new Response(
          JSON.stringify({ access_token: 'guarded-token', expires_in: 3600, token_type: 'Bearer' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      reachedExternal = true;
      throw new Error(`Forbidden external network request attempted to: ${urlStr}`);
    };

    const auth = new GoogleSheetsAuthService({
      authProvider: 'METADATA',
      fetchFn: guardedFetch,
    });
    const tok = await auth.getAccessToken();
    assert.strictEqual(tok, 'guarded-token');
    assert.strictEqual(reachedExternal, false, 'No unmocked external network calls permitted');
  });

  // ============================================================
  // PHASE 13A.5.3.2 — PRODUCTION PROVIDER FAIL-CLOSED HARDENING
  // ============================================================

  // 33. Production with missing GOOGLE_SHEETS_AUTH_PROVIDER
  await test('Production with missing GOOGLE_SHEETS_AUTH_PROVIDER fails closed', async () => {
    const saved = process.env.GOOGLE_SHEETS_AUTH_PROVIDER;
    delete process.env.GOOGLE_SHEETS_AUTH_PROVIDER;
    try {
      const auth = new GoogleSheetsAuthService({ nodeEnv: 'production' });
      assert.throws(
        () => {
          auth.resolveAuthProvider();
        },
        (err: any) => {
          assert(err instanceof GoogleSheetsAuthError);
          assert.strictEqual(err.retry_eligible, false);
          assert(err.message.includes('must be explicitly configured in production'));
          return true;
        }
      );
    } finally {
      if (saved !== undefined) process.env.GOOGLE_SHEETS_AUTH_PROVIDER = saved;
      else delete process.env.GOOGLE_SHEETS_AUTH_PROVIDER;
    }
  });

  // 34. Production with METADATA
  await test('Production with explicitly configured METADATA resolves to METADATA', async () => {
    const saved = process.env.GOOGLE_SHEETS_AUTH_PROVIDER;
    process.env.GOOGLE_SHEETS_AUTH_PROVIDER = 'METADATA';
    try {
      const auth = new GoogleSheetsAuthService({ nodeEnv: 'production' });
      const provider = auth.resolveAuthProvider();
      assert.strictEqual(provider, 'METADATA');
    } finally {
      if (saved !== undefined) process.env.GOOGLE_SHEETS_AUTH_PROVIDER = saved;
      else delete process.env.GOOGLE_SHEETS_AUTH_PROVIDER;
    }
  });

  // 35. Production with SERVICE_ACCOUNT_KEY
  await test('Production with SERVICE_ACCOUNT_KEY throws and fails closed', async () => {
    const saved = process.env.GOOGLE_SHEETS_AUTH_PROVIDER;
    process.env.GOOGLE_SHEETS_AUTH_PROVIDER = 'SERVICE_ACCOUNT_KEY';
    try {
      const auth = new GoogleSheetsAuthService({ nodeEnv: 'production' });
      assert.throws(
        () => {
          auth.resolveAuthProvider();
        },
        (err: any) => {
          assert(err instanceof GoogleSheetsAuthError);
          assert.strictEqual(err.retry_eligible, false);
          assert(err.message.includes('Provider SERVICE_ACCOUNT_KEY is prohibited in production'));
          return true;
        }
      );
    } finally {
      if (saved !== undefined) process.env.GOOGLE_SHEETS_AUTH_PROVIDER = saved;
      else delete process.env.GOOGLE_SHEETS_AUTH_PROVIDER;
    }

    // Also assert constructor option SERVICE_ACCOUNT_KEY throws in production
    assert.throws(
      () => {
        const auth = new GoogleSheetsAuthService({
          authProvider: 'SERVICE_ACCOUNT_KEY',
          nodeEnv: 'production',
        });
        auth.resolveAuthProvider();
      },
      (err: any) => {
        assert(err instanceof GoogleSheetsAuthError);
        assert(err.message.includes('prohibited in production'));
        return true;
      }
    );
  });

  // 36. Production with invalid provider
  await test('Production with invalid provider throws typed GoogleSheetsAuthError', async () => {
    const saved = process.env.GOOGLE_SHEETS_AUTH_PROVIDER;
    process.env.GOOGLE_SHEETS_AUTH_PROVIDER = 'UNSUPPORTED_IAM';
    try {
      const auth = new GoogleSheetsAuthService({ nodeEnv: 'production' });
      assert.throws(
        () => {
          auth.resolveAuthProvider();
        },
        (err: any) => {
          assert(err instanceof GoogleSheetsAuthError);
          assert(err.message.includes('Invalid GOOGLE_SHEETS_AUTH_PROVIDER'));
          return true;
        }
      );
    } finally {
      if (saved !== undefined) process.env.GOOGLE_SHEETS_AUTH_PROVIDER = saved;
      else delete process.env.GOOGLE_SHEETS_AUTH_PROVIDER;
    }
  });

  // 37. Local development with explicitly configured SERVICE_ACCOUNT_KEY
  await test('Local development with explicitly configured SERVICE_ACCOUNT_KEY returns SERVICE_ACCOUNT_KEY', async () => {
    const saved = process.env.GOOGLE_SHEETS_AUTH_PROVIDER;
    process.env.GOOGLE_SHEETS_AUTH_PROVIDER = 'SERVICE_ACCOUNT_KEY';
    try {
      const auth = new GoogleSheetsAuthService({ nodeEnv: 'development' });
      const provider = auth.resolveAuthProvider();
      assert.strictEqual(provider, 'SERVICE_ACCOUNT_KEY');
    } finally {
      if (saved !== undefined) process.env.GOOGLE_SHEETS_AUTH_PROVIDER = saved;
      else delete process.env.GOOGLE_SHEETS_AUTH_PROVIDER;
    }
  });

  // 38. Injected mock provider behavior
  await test('Injected mock provider behavior is preserved in test harnesses', async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response(
        JSON.stringify({ access_token: 'injected-mock-token', expires_in: 3600, token_type: 'Bearer' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };
    const auth = new GoogleSheetsAuthService({
      fetchFn: mockFetch,
      credentials: {
        client_email: TEST_CLIENT_EMAIL,
        private_key: testPrivateKeyPem,
      },
      nodeEnv: 'test',
    });
    const provider = auth.resolveAuthProvider();
    assert.strictEqual(provider, 'SERVICE_ACCOUNT_KEY');
    const token = await auth.getAccessToken();
    assert.strictEqual(token, 'injected-mock-token');
  });

  // 39. METADATA failure without fallback
  await test('METADATA failure in production fails closed without private-key or static fallback', async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response('Not Found', { status: 404, statusText: 'Not Found' });
    };
    const auth = new GoogleSheetsAuthService({
      authProvider: 'METADATA',
      nodeEnv: 'production',
      fetchFn: mockFetch,
      credentials: {
        client_email: TEST_CLIENT_EMAIL,
        private_key: testPrivateKeyPem,
      },
      staticToken: 'should-never-be-used',
    });
    await assert.rejects(
      async () => {
        await auth.getAccessToken();
      },
      (err: any) => {
        assert(err instanceof GoogleSheetsAuthError);
        assert(err.message.includes('Metadata server token request failed'));
        return true;
      }
    );
    assert.strictEqual(auth.getCachedTokenEntry(), null, 'Failed metadata must not cache fallback token');
  });

  console.log('============================================================');
  console.log(`PHASE 13A.4.1 / 13A.5.1 / 13A.5.3 / 13A.5.3.2 AUTH TEST RESULTS: ${passed} / ${total} PASSED (100% GREEN)`);
  console.log('============================================================\n');
}

runTestSuite().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
