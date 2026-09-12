/**
 * GrowthForge Security Suite - Phase 8A.9 PII & Secret Redaction in Structured Logging
 *
 * Verifies:
 * 1. Phone number masking (+91 98765 43210 -> +91*****3210)
 * 2. Email address masking (anupam.saini@gmail.com -> a***i@gmail.com)
 * 3. Secret redaction (API keys, JWTs, Bearer tokens, Webhook secrets, Passwords)
 * 4. Transcript content protection (never logged in clear text)
 * 5. Structured logging telemetry format & production log levels
 */

import { maskPhone, maskEmail, maskName, redactSecretsInString, redactPII } from '../app/services/security/piiRedaction';
import { logger, StructuredLogger } from '../app/services/security/logger';
import { runWithCorrelationContext } from '../app/services/security/correlationContext';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${testName}${detail ? ` - ${detail}` : ''}`);
    failed++;
  }
}

async function runTestSuite() {
  console.log('\n======================================================');
  console.log('RUNNING PHASE 8A.9 SECURITY SUITE: PII & SECRET REDACTION');
  console.log('======================================================\n');

  // Test 1: Phone Masking
  console.log('--- 1. Phone Masking Utilities ---');
  const masked1 = maskPhone('+91 98765 43210');
  assert(masked1.endsWith('3210') && masked1.includes('***') && !masked1.includes('98765'), 'Masks Indian +91 phone number preserving trailing 4 digits');

  const masked2 = maskPhone('9876543210');
  assert(masked2.endsWith('3210') && masked2.includes('***') && !masked2.includes('98765'), 'Masks 10-digit phone number');

  const maskedEmpty = maskPhone('');
  assert(maskedEmpty === '', 'Handles empty phone input gracefully');

  // Test 2: Email Masking
  console.log('\n--- 2. Email Masking Utilities ---');
  const maskedEmail1 = maskEmail('anupam.saini@gmail.com');
  assert(maskedEmail1 === 'a***i@gmail.com', 'Masks standard email username preserving first, last, and domain');

  const maskedEmail2 = maskEmail('a@domain.com');
  assert(maskedEmail2.startsWith('a***@domain.com'), 'Masks single-letter email username');

  // Test 3: Name Masking
  console.log('\n--- 3. Name Masking Utilities ---');
  const maskedName1 = maskName('Rajesh Kumar');
  assert(maskedName1.includes('R***') && maskedName1.includes('K***'), 'Masks full name with initials');

  // Test 4: Secret Redaction in Strings
  console.log('\n--- 4. Secret Redaction in Free Text ---');
  const textWithBearer = 'Sending request with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeakThis';
  const sanitizedBearer = redactSecretsInString(textWithBearer);
  assert(!sanitizedBearer.includes('doNotLeakThis') && sanitizedBearer.includes('[REDACTED_TOKEN]'), 'Redacts Bearer tokens in text');

  const textWithApiKey = 'Configured with sk_live_998877665544332211 for production';
  const sanitizedApiKey = redactSecretsInString(textWithApiKey);
  assert(!sanitizedApiKey.includes('998877665544332211') && sanitizedApiKey.includes('[REDACTED_API_KEY]'), 'Redacts API keys in text');

  // Test 5: Deep Object PII Redaction
  console.log('\n--- 5. Deep Object PII Redaction ---');
  const rawPayload = {
    tenant_id: 'tenant-123',
    buyer_name: 'Anupam Saini',
    phone_number: '+91 98765 43210',
    contact_email: 'buyer@example.com',
    api_key: 'sk_live_secretkey1234567890',
    service_role_key: 'sbp_supersecretkey123456',
    password: 'SuperSecretPassword123!',
    webhook_secret: 'whsec_9988776655',
    transcript: 'Hello, my name is Anupam and I am looking for a 3BHK flat in Whitefield for 1.5 Cr.',
    nested: {
      user_phone: '+91 98765 43210',
      auth_token: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.secret',
    },
  };

  const redacted = redactPII(rawPayload);
  assert(redacted.api_key === '[REDACTED_SECRET]', 'Redacts api_key field');
  assert(redacted.service_role_key === '[REDACTED_SECRET]', 'Redacts service_role_key field');
  assert(redacted.password === '[REDACTED_SECRET]', 'Redacts password field');
  assert(redacted.webhook_secret === '[REDACTED_SECRET]', 'Redacts webhook_secret field');
  assert(redacted.phone_number.endsWith('3210') && !redacted.phone_number.includes('98765'), 'Masks phone_number field');
  assert(redacted.contact_email.startsWith('b***') && redacted.contact_email.endsWith('@example.com'), 'Masks contact_email field');
  assert(typeof redacted.transcript === 'string' && redacted.transcript.startsWith('[REDACTED_TRANSCRIPT'), 'Redacts conversational transcript field');
  assert(redacted.nested.auth_token === '[REDACTED_SECRET]', 'Redacts nested auth_token');
  assert(redacted.tenant_id === 'tenant-123', 'Preserves non-sensitive operational identifier tenant_id');

  // Test 6: Centralized Structured Logger Telemetry
  console.log('\n--- 6. Centralized Structured Logger Telemetry ---');
  logger.clearLogBuffer();

  await runWithCorrelationContext(
    {
      requestId: 'req-test-999',
      correlationId: 'corr-test-888',
      tenantId: 'tenant-demo',
      service: 'test-service',
      operation: 'test-op',
    },
    async () => {
      logger.info('Processing buyer verification', {
        data: {
          phone: '+91 98765 43210',
          email: 'test@growthforge.io',
          api_key: 'sk_live_dummy1234567890',
        },
      });
    }
  );

  const logs = logger.getRecentLogs();
  assert(logs.length > 0, 'Logger emits event to buffer');
  const lastLog = logs[logs.length - 1];
  assert(lastLog.request_id === 'req-test-999', 'Logger includes active request_id');
  assert(lastLog.correlation_id === 'corr-test-888', 'Logger includes active correlation_id');
  assert(lastLog.tenant_id === 'tenant-demo', 'Logger includes active tenant_id');
  assert(lastLog.data?.api_key === '[REDACTED_SECRET]', 'Logger data payload is automatically redacted of secrets');
  assert(String(lastLog.data?.phone).endsWith('3210'), 'Logger data payload is automatically masked of phone numbers');

  // Test 7: Production Log Level Safety
  console.log('\n--- 7. Production Log Level Safety ---');
  const testLogger = new StructuredLogger();
  const oldNodeEnv = process.env.NODE_ENV;
  const oldDebugEnv = process.env.ENABLE_DEBUG_LOGS;
  
  process.env.NODE_ENV = 'production';
  process.env.ENABLE_DEBUG_LOGS = 'false';
  process.env.LOG_LEVEL = 'INFO';

  const debugResult = testLogger.debug('Debug message that should be suppressed in production');
  assert(debugResult === null, 'Suppresses DEBUG logs in production by default');

  // Restore env
  process.env.NODE_ENV = oldNodeEnv;
  process.env.ENABLE_DEBUG_LOGS = oldDebugEnv;

  console.log('\n======================================================');
  console.log(`SECURITY PII SUITE SUMMARY: ${passed} passed, ${failed} failed.`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
