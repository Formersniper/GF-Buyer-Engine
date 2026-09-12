/**
 * GrowthForge Security Suite - Phase 8A.9 Deep Log Redaction & Edge Cases
 *
 * Verifies:
 * 1. Deeply nested dictionaries and arrays with multiple PII elements.
 * 2. Mixed secret types (Supabase service role, Gemini API keys, Sarvam API keys, Webhook secrets).
 * 3. International phone variations (+91, standard 10 digit, with dashes/spaces).
 * 4. Audit events emission with sanitized data payloads.
 */

import { redactPII, maskPhone, maskEmail } from '../app/services/security/piiRedaction';
import { logger } from '../app/services/security/logger';

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
  console.log('RUNNING PHASE 8A.9 SECURITY SUITE: DEEP LOG REDACTION');
  console.log('======================================================\n');

  // Test 1: Complex Nested Tree with multiple secrets and PII
  console.log('--- 1. Complex Nested Object Redaction ---');
  const complexObject = {
    tenant_id: 't_enterprise_01',
    request_id: 'req_12345',
    leads: [
      {
        lead_id: 'lead_001',
        buyer_name: 'Priya Sharma',
        phone: '+91-98765-43210',
        email: 'priya.sharma@domain.co.in',
        notes: 'Called from +919876543210 regarding 3BHK flat.',
        metadata: {
          auth_token: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.someSecret',
          api_key: 'AIzaSyDemoKey123456789012345678901234',
        },
      },
      {
        lead_id: 'lead_002',
        buyer_name: 'Vikram Singh',
        phone: '9876543210',
        email: 'vikram.singh@company.com',
        transcript: 'Buyer says: "I want to buy a 4BHK penthouse in Gurgaon for 4.5 Crores."',
      },
    ],
  };

  const clean = redactPII(complexObject);

  assert(clean.leads[0].buyer_name.startsWith('P***'), 'Masks buyer name in array');
  assert(clean.leads[0].phone.endsWith('3210') && !clean.leads[0].phone.includes('98765'), 'Masks phone in array item 0');
  assert(clean.leads[0].email === 'p***a@domain.co.in', 'Masks email in array item 0');
  assert(clean.leads[0].metadata.auth_token === '[REDACTED_SECRET]', 'Redacts auth_token in nested object');
  assert(clean.leads[0].metadata.api_key === '[REDACTED_SECRET]', 'Redacts api_key in nested object');
  assert(String(clean.leads[1].transcript).startsWith('[REDACTED_TRANSCRIPT'), 'Redacts transcript in array item 1');
  assert(clean.tenant_id === 't_enterprise_01', 'Preserves tenant_id');

  // Test 2: Audit Event Logging with Redaction
  console.log('\n--- 2. Audit Event Logging with Redaction ---');
  logger.clearLogBuffer();

  logger.logAuditEvent('LEAD_INGESTED', {
    lead_id: 'lead_999',
    phone: '+91 98765 43210',
    email: 'test.buyer@enterprise.com',
    service_role_key: 'sbp_dummy_service_role_secret',
  }, {
    tenant_id: 't_demo',
    correlation_id: 'corr_audit_111',
  });

  const logs = logger.getRecentLogs();
  assert(logs.length === 1, 'Audit log emitted');
  const auditLog = logs[0];
  assert(auditLog.status === 'AUDIT_EMITTED', 'Audit log has status AUDIT_EMITTED');
  assert(auditLog.data?.service_role_key === '[REDACTED_SECRET]', 'Audit log redacts service_role_key');
  assert(String(auditLog.data?.phone).endsWith('3210'), 'Audit log masks phone');
  assert(auditLog.tenant_id === 't_demo', 'Audit log preserves tenant_id');

  // Test 3: Section 13 Explicit Bypass Test Shape
  console.log('\n--- 3. Explicit Section 13 Audit Shape Test ---');
  logger.clearLogBuffer();

  const secretPayload = {
    name: 'Rahul Khanna',
    phone: '+919876543210',
    email: 'rahul.khanna@example.com',
    transcript: 'Hello, I am interested in booking unit 402 with 2 car parks.',
    bearer: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTIzfQ.sample_signature_xyz',
    apiKey: 'AIzaSySecretApiKey123456789012345678',
    serviceRoleKey: 'sbp_secret_service_role_key_9876543210',
    webhookSecret: 'whsec_9876543210abcdef',
    nested: {
      phone: '+91-98765-43210',
      transcript: 'Nested transcript dialogue between agent and user',
      authorization: 'Bearer sample_token_secret_12345',
    },
    array: [
      {
        email: 'array.item@domain.com',
        token: 'eyJhbGciOiJIUzI1NiJ9.sample.sig',
      },
    ],
  };

  logger.info('Processing lead intake webhook payload', {
    service: 'lead-intake',
    operation: 'processWebhook',
    tenant_id: 'tenant_abc_123',
    data: secretPayload as any,
  });

  const emittedLogs = logger.getRecentLogs();
  assert(emittedLogs.length === 1, 'Logger successfully emitted event for Section 13 payload');
  const emittedLogJson = JSON.stringify(emittedLogs[0]);

  // Assert: NONE of the original sensitive values appear in the emitted log record
  const sensitiveValuesToCheck = [
    'Rahul Khanna',
    '+919876543210',
    'rahul.khanna@example.com',
    'Hello, I am interested in booking unit 402 with 2 car parks.',
    'AIzaSySecretApiKey123456789012345678',
    'sbp_secret_service_role_key_9876543210',
    'whsec_9876543210abcdef',
    '+91-98765-43210',
    'Nested transcript dialogue between agent and user',
    'sample_token_secret_12345',
    'array.item@domain.com',
    'sample_signature_xyz',
  ];

  for (const sensitiveVal of sensitiveValuesToCheck) {
    assert(!emittedLogJson.includes(sensitiveVal), `Emitted log does NOT contain original sensitive value: "${sensitiveVal}"`);
  }

  // Test 4: Circular Reference and Log Injection Safety
  console.log('\n--- 4. Circular Reference & Log Injection Safety ---');
  const circularObj: any = {
    title: 'Circular test\r\nFake-Header: injected\n{"spoofed_level": "SECURITY"}',
    nested: {},
  };
  circularObj.nested.self = circularObj;

  logger.warn('Testing circular object & injection: \n\r\tANSI:\x1b[31mRed\x1b[0m', {
    data: circularObj,
  });

  const circularLogs = logger.getRecentLogs();
  const circularLog = circularLogs[circularLogs.length - 1];
  assert(circularLog.message.includes('Testing circular object'), 'Handles log message with control chars safely');
  assert(!circularLog.message.includes('\n') && !circularLog.message.includes('\r'), 'Neutralized newlines in log message');
  assert(circularLog.data?.nested !== undefined, 'Processed object with circular reference');

  console.log('\n======================================================');
  console.log(`SECURITY DEEP REDACTION SUMMARY: ${passed} passed, ${failed} failed.`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
