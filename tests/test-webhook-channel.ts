import assert from 'assert';
import { isPrivateIP, validateEndpointUrl, WebhookBrokerHandoffChannel } from '../app/services/handoff/channels/brokerHandoffChannel';
import { BrokerHandoffPackage } from '../app/schemas/handoff';

const dummyHandoff: BrokerHandoffPackage = {
  handoff_id: 'test-handoff-uuid-12345',
  lead_id: 'test-lead-uuid',
  qualification_id: null,
  score_id: null,
  extraction_id: null,
  transcript_id: null,
  call_id: null,
  primary_buyer_summary: {
    name: 'John Doe',
    phone: '+15550199',
    location: 'New York',
    contact_status: 'CONTACTABLE',
  },
  qualification: {
    status: 'QUALIFIED',
    reason_codes: [],
    blocking_fields: [],
    follow_up_fields: [],
  },
  priority: {
    score: 85,
    band: 'HOT',
    tier: 'TIER_1_HOT',
    sla_minutes: 15,
    sla_deadline: new Date().toISOString(),
    urgency: 'HIGH',
  },
  requirements: [],
  project_recommendations: [],
  missing_information: [],
  risks: [],
  recommended_action: 'Proceed to phone call',
  talking_points: [],
  call_summary: null,
  commercial_summary: 'Ready for handoff',
  recommendation_status: 'DETERMINISTIC_RANKING',
  handoff_status: 'READY',
  routing_status: 'ROUTED',
  routing_decision: {
    assigned_role: 'SENIOR_SALES_ADVISOR',
    assigned_team: 'SENIOR_SALES',
    tier: 'TIER_1_HOT',
    sla_minutes: 15,
    sla_deadline: new Date().toISOString(),
    routing_action: 'IMMEDIATE_PHONE_DISPATCH',
    follow_up_urgency: 'HIGH',
    reason_codes: [],
  },
  handoff_version: '1.0',
  rule_version: '1.0',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

async function runTests() {
  console.log('=====================================================');
  console.log('WEBHOOK BROKER HANDOFF CHANNEL HARDENING TEST SUITE');
  console.log('=====================================================');

  const originalFetch = global.fetch;

  try {
    // -------------------------------------------------------------
    // Test 1: dry-run = zero network
    // -------------------------------------------------------------
    console.log('\nRunning Test 1: dry-run = zero network...');
    let networkTouched = false;
    global.fetch = async () => {
      networkTouched = true;
      throw new Error('Network should not have been reached');
    };

    const dryRunChannel = new WebhookBrokerHandoffChannel('https://api.crm.com/webhook', {
      api_key: 'test-secret-key-12345',
    });
    const dryRunRes = await dryRunChannel.dispatch(dummyHandoff, { dryRun: true });
    assert.strictEqual(networkTouched, false, 'Network was unexpectedly contacted during dry-run');
    assert.strictEqual(dryRunRes.success, true);
    assert.strictEqual(dryRunRes.dry_run, true);
    assert.strictEqual(dryRunRes.status, 'SENT');
    assert.ok(dryRunRes.dispatch_id.startsWith('dry-run-'));
    console.log('✅ Test 1 Passed: dry-run performs zero network calls.');

    // -------------------------------------------------------------
    // Test 2: public HTTPS URL accepted
    // -------------------------------------------------------------
    console.log('\nRunning Test 2: public HTTPS URL accepted...');
    const publicUrlValidation = await validateEndpointUrl('https://example.com/webhook');
    assert.strictEqual(publicUrlValidation.parsedUrl.protocol, 'https:');
    assert.strictEqual(publicUrlValidation.parsedUrl.hostname, 'example.com');
    assert.strictEqual(isPrivateIP(publicUrlValidation.resolvedIp), false);
    console.log('✅ Test 2 Passed: Public HTTPS URL passed pre-flight validation.');

    // -------------------------------------------------------------
    // Test 3: localhost rejected
    // -------------------------------------------------------------
    console.log('\nRunning Test 3: localhost rejected...');
    await assert.rejects(
      validateEndpointUrl('http://localhost/webhook'),
      /SSRF Protection: Private\/Reserved domain rejected/
    );
    await assert.rejects(
      validateEndpointUrl('http://sub.localhost:8080/webhook'),
      /SSRF Protection: Private\/Reserved domain rejected/
    );
    console.log('✅ Test 3 Passed: localhost variants strictly rejected.');

    // -------------------------------------------------------------
    // Test 4: 127.0.0.1 rejected
    // -------------------------------------------------------------
    console.log('\nRunning Test 4: 127.0.0.1 rejected...');
    await assert.rejects(
      validateEndpointUrl('http://127.0.0.1:8080/webhook'),
      /SSRF Protection: Private IP address rejected/
    );
    assert.strictEqual(isPrivateIP('127.0.0.1'), true);
    assert.strictEqual(isPrivateIP('127.1.2.3'), true);
    console.log('✅ Test 4 Passed: 127.0.0.1 loopbacks rejected.');

    // -------------------------------------------------------------
    // Test 5: RFC1918 private IPv4 rejected
    // -------------------------------------------------------------
    console.log('\nRunning Test 5: RFC1918 private IPv4 rejected...');
    assert.strictEqual(isPrivateIP('10.0.0.1'), true);
    assert.strictEqual(isPrivateIP('10.255.255.255'), true);
    assert.strictEqual(isPrivateIP('172.16.0.1'), true);
    assert.strictEqual(isPrivateIP('172.31.255.255'), true);
    assert.strictEqual(isPrivateIP('192.168.0.1'), true);
    assert.strictEqual(isPrivateIP('192.168.1.100'), true);
    await assert.rejects(
      validateEndpointUrl('http://10.0.0.5/api'),
      /SSRF Protection: Private IP address rejected/
    );
    await assert.rejects(
      validateEndpointUrl('http://172.16.20.1/api'),
      /SSRF Protection: Private IP address rejected/
    );
    await assert.rejects(
      validateEndpointUrl('http://192.168.1.50/api'),
      /SSRF Protection: Private IP address rejected/
    );
    console.log('✅ Test 5 Passed: RFC1918 IP addresses rejected.');

    // -------------------------------------------------------------
    // Test 6: private IPv6 rejected
    // -------------------------------------------------------------
    console.log('\nRunning Test 6: private IPv6 rejected...');
    assert.strictEqual(isPrivateIP('::1'), true);
    assert.strictEqual(isPrivateIP('::'), true);
    assert.strictEqual(isPrivateIP('fe80::1'), true);
    assert.strictEqual(isPrivateIP('fc00::1'), true);
    assert.strictEqual(isPrivateIP('fd00::1'), true);
    assert.strictEqual(isPrivateIP('ff02::1'), true);
    await assert.rejects(
      validateEndpointUrl('http://[::1]/webhook'),
      /SSRF Protection: Private IP address rejected/
    );
    console.log('✅ Test 6 Passed: Private IPv6 addresses rejected.');

    // -------------------------------------------------------------
    // Test 7: metadata endpoint rejected
    // -------------------------------------------------------------
    console.log('\nRunning Test 7: metadata endpoint rejected...');
    await assert.rejects(
      validateEndpointUrl('http://169.254.169.254/latest/meta-data'),
      /SSRF Protection: Private IP address rejected/
    );
    await assert.rejects(
      validateEndpointUrl('http://metadata.google.internal/computeMetadata/v1'),
      /SSRF Protection: Private\/Reserved domain rejected/
    );
    await assert.rejects(
      validateEndpointUrl('http://instance-metadata/meta'),
      /SSRF Protection: Private\/Reserved domain rejected/
    );
    console.log('✅ Test 7 Passed: Cloud metadata endpoints rejected.');

    // -------------------------------------------------------------
    // Test 8: redirect rejected
    // -------------------------------------------------------------
    console.log('\nRunning Test 8: redirect rejected...');
    global.fetch = async (_url, init) => {
      assert.strictEqual(init?.redirect, 'error', 'Redirect policy must be error');
      const redirectErr = new TypeError('Failed to fetch: redirect mode is set to error');
      throw redirectErr;
    };
    const redirectChannel = new WebhookBrokerHandoffChannel('https://api.crm.com/webhook');
    const redirectRes = await redirectChannel.dispatch(dummyHandoff, { dryRun: false });
    assert.strictEqual(redirectRes.success, false);
    assert.strictEqual(redirectRes.status, 'FAILED');
    assert.strictEqual(redirectRes.retry_eligible, true);
    console.log('✅ Test 8 Passed: Redirects strictly rejected by redirect: error.');

    // -------------------------------------------------------------
    // Test 9: 2xx -> SENT
    // -------------------------------------------------------------
    console.log('\nRunning Test 9: 2xx -> SENT...');
    global.fetch = async () => {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
      } as Response;
    };
    const successChannel = new WebhookBrokerHandoffChannel('https://api.crm.com/webhook');
    const successRes = await successChannel.dispatch(dummyHandoff, { dryRun: false });
    assert.strictEqual(successRes.success, true);
    assert.strictEqual(successRes.status, 'SENT');
    assert.strictEqual(successRes.dry_run, false);
    console.log('✅ Test 9 Passed: 2xx status mapped to SENT.');

    // -------------------------------------------------------------
    // Test 10: 4xx -> FAILED + retry=false
    // -------------------------------------------------------------
    console.log('\nRunning Test 10: 4xx -> FAILED + retry=false...');
    global.fetch = async () => {
      return {
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
      } as Response;
    };
    const fail4xxChannel = new WebhookBrokerHandoffChannel('https://api.crm.com/webhook');
    const fail4xxRes = await fail4xxChannel.dispatch(dummyHandoff, { dryRun: false });
    assert.strictEqual(fail4xxRes.success, false);
    assert.strictEqual(fail4xxRes.status, 'FAILED');
    assert.strictEqual(fail4xxRes.retry_eligible, false);
    assert.strictEqual(fail4xxRes.error, 'HTTP 422: Unprocessable Entity');
    console.log('✅ Test 10 Passed: 4xx status mapped to FAILED (non-retryable).');

    // -------------------------------------------------------------
    // Test 11: 5xx -> FAILED + retry=true
    // -------------------------------------------------------------
    console.log('\nRunning Test 11: 5xx -> FAILED + retry=true...');
    global.fetch = async () => {
      return {
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      } as Response;
    };
    const fail5xxChannel = new WebhookBrokerHandoffChannel('https://api.crm.com/webhook');
    const fail5xxRes = await fail5xxChannel.dispatch(dummyHandoff, { dryRun: false });
    assert.strictEqual(fail5xxRes.success, false);
    assert.strictEqual(fail5xxRes.status, 'FAILED');
    assert.strictEqual(fail5xxRes.retry_eligible, true);
    assert.strictEqual(fail5xxRes.error, 'HTTP 503: Service Unavailable');
    console.log('✅ Test 11 Passed: 5xx status mapped to FAILED (retry-eligible).');

    // -------------------------------------------------------------
    // Test 12: network failure -> FAILED + retry=true
    // -------------------------------------------------------------
    console.log('\nRunning Test 12: network failure -> FAILED + retry=true...');
    global.fetch = async () => {
      throw new Error('connect ECONNREFUSED 93.184.216.34:443');
    };
    const netFailChannel = new WebhookBrokerHandoffChannel('https://api.crm.com/webhook');
    const netFailRes = await netFailChannel.dispatch(dummyHandoff, { dryRun: false });
    assert.strictEqual(netFailRes.success, false);
    assert.strictEqual(netFailRes.status, 'FAILED');
    assert.strictEqual(netFailRes.retry_eligible, true);
    assert.ok(netFailRes.error?.includes('ECONNREFUSED'));
    console.log('✅ Test 12 Passed: Network socket failure mapped to retryable FAILED.');

    // -------------------------------------------------------------
    // Test 13: timeout -> FAILED + retry=true + exact canonical timeout message
    // -------------------------------------------------------------
    console.log('\nRunning Test 13: timeout -> FAILED + retry=true + exact canonical timeout message...');
    global.fetch = async () => {
      const abortErr = new Error('The operation was aborted.');
      abortErr.name = 'AbortError';
      throw abortErr;
    };
    const timeoutChannel = new WebhookBrokerHandoffChannel('https://api.crm.com/webhook');
    const timeoutRes = await timeoutChannel.dispatch(dummyHandoff, { dryRun: false });
    assert.strictEqual(timeoutRes.success, false);
    assert.strictEqual(timeoutRes.status, 'FAILED');
    assert.strictEqual(timeoutRes.retry_eligible, true);
    assert.strictEqual(timeoutRes.error, 'Request timed out after 5000ms');
    console.log('✅ Test 13 Passed: Timeout strictly normalized to canonical "Request timed out after 5000ms".');

    // -------------------------------------------------------------
    // Test 14: Content-Type cannot be overridden
    // -------------------------------------------------------------
    console.log('\nRunning Test 14: Content-Type cannot be overridden...');
    let capturedHeaders: Record<string, string> = {};
    global.fetch = async (_url, init) => {
      capturedHeaders = (init?.headers || {}) as Record<string, string>;
      return { ok: true, status: 200, statusText: 'OK' } as Response;
    };
    const headerOverrideChannel = new WebhookBrokerHandoffChannel('https://api.crm.com/webhook', {
      headers: {
        'Content-Type': 'text/plain',
        'content-type': 'application/xml',
      },
    });
    await headerOverrideChannel.dispatch(dummyHandoff, { dryRun: false });
    assert.strictEqual(capturedHeaders['Content-Type'], 'application/json');
    assert.strictEqual(capturedHeaders['content-type'], undefined);
    console.log('✅ Test 14 Passed: Content-Type remains application/json invariant.');

    // -------------------------------------------------------------
    // Test 15: Host cannot be overridden
    // -------------------------------------------------------------
    console.log('\nRunning Test 15: Host cannot be overridden...');
    const hostOverrideChannel = new WebhookBrokerHandoffChannel('https://api.crm.com/webhook', {
      headers: {
        Host: 'evil-internal-vault.local',
        host: 'spoofed-host.internal',
      },
    });
    await hostOverrideChannel.dispatch(dummyHandoff, { dryRun: false });
    assert.strictEqual(capturedHeaders['Host'], undefined);
    assert.strictEqual(capturedHeaders['host'], undefined);
    console.log('✅ Test 15 Passed: Host header override forbidden and ignored.');

    // -------------------------------------------------------------
    // Test 16: Content-Length cannot be overridden
    // -------------------------------------------------------------
    console.log('\nRunning Test 16: Content-Length cannot be overridden...');
    const clOverrideChannel = new WebhookBrokerHandoffChannel('https://api.crm.com/webhook', {
      headers: {
        'Content-Length': '0',
        'content-length': '99999',
        Connection: 'close',
        'Proxy-Authorization': 'Basic evil',
      },
    });
    await clOverrideChannel.dispatch(dummyHandoff, { dryRun: false });
    assert.strictEqual(capturedHeaders['Content-Length'], undefined);
    assert.strictEqual(capturedHeaders['content-length'], undefined);
    assert.strictEqual(capturedHeaders['Connection'], undefined);
    assert.strictEqual(capturedHeaders['Proxy-Authorization'], undefined);
    console.log('✅ Test 16 Passed: Content-Length, Connection, and Proxy headers dropped.');

    // -------------------------------------------------------------
    // Test 17: Authorization/API key headers are injected correctly
    // -------------------------------------------------------------
    console.log('\nRunning Test 17: Authorization/API key headers injected correctly...');
    const authChannel = new WebhookBrokerHandoffChannel('https://api.crm.com/webhook', {
      bearer_token: 'auth-test-bearer-token',
      api_key: 'auth-test-api-key',
      webhook_secret: 'auth-test-secret-sig',
      headers: {
        'X-Custom-Client': 'GrowthForge-Client',
      },
    });
    await authChannel.dispatch(dummyHandoff, { dryRun: false });
    assert.strictEqual(capturedHeaders['Authorization'], 'Bearer auth-test-bearer-token');
    assert.strictEqual(capturedHeaders['X-API-Key'], 'auth-test-api-key');
    assert.strictEqual(capturedHeaders['X-Webhook-Secret'], 'auth-test-secret-sig');
    assert.strictEqual(capturedHeaders['X-Custom-Client'], 'GrowthForge-Client');
    console.log('✅ Test 17 Passed: Explicit credentials and safe custom headers injected.');

    // -------------------------------------------------------------
    // Test 18: secrets do not appear in errors/log output
    // -------------------------------------------------------------
    console.log('\nRunning Test 18: secrets do not appear in errors/log output...');
    const secretValue = 'super-secret-password-xyz987';
    global.fetch = async () => {
      throw new Error(`Unauthorized connection with Bearer ${secretValue} and key=${secretValue}`);
    };
    const secretLeakChannel = new WebhookBrokerHandoffChannel('https://api.crm.com/webhook', {
      bearer_token: secretValue,
    });
    const leakResult = await secretLeakChannel.dispatch(dummyHandoff, { dryRun: false });
    assert.strictEqual(leakResult.success, false);
    assert.ok(
      !leakResult.error?.includes(secretValue),
      `Raw secret leaked into dispatch error: ${leakResult.error}`
    );
    assert.ok(
      leakResult.error?.includes('Bearer [REDACTED]') || leakResult.error?.includes('[REDACTED]'),
      `Secret masking failed: ${leakResult.error}`
    );
    console.log('✅ Test 18 Passed: Secrets masked and redacted from error outputs.');

  } finally {
    global.fetch = originalFetch;
  }

  console.log('\n=====================================================');
  console.log('🎉 ALL 18 HARDENING TESTS PASSED WITH 100% COMPLIANCE!');
  console.log('=====================================================');
}

runTests().catch(err => {
  console.error('❌ Test execution failed:', err);
  process.exit(1);
});
