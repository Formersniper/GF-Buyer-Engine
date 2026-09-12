/**
 * GrowthForge Security Suite - Phase 8A.9 Error Sanitization & Client Protection
 *
 * Verifies:
 * 1. Database errors and SQL details are never exposed to clients.
 * 2. Stack traces are completely stripped from client responses.
 * 3. Secrets (tokens, keys, passwords) are purged from error messages.
 * 4. Error responses conform to standard format: { success: false, error: { code, message, request_id } }.
 */

import { sanitizeClientError, redactSecretsInString } from '../app/services/security/piiRedaction';

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
  console.log('RUNNING PHASE 8A.9 SECURITY SUITE: ERROR SANITIZATION');
  console.log('======================================================\n');

  // Test 1: Stack Trace Protection
  console.log('--- 1. Stack Trace & Internal Structure Protection ---');
  const internalError = new Error('Database connection failed at postgres://user:password123@db.supabase.co:5432/postgres');
  internalError.stack = `Error: Database connection failed
    at executeQuery (/app/services/supabase/repos/leadsRepo.ts:42:15)
    at async createLead (/app/services/supabase/repos/leadsRepo.ts:98:20)`;

  const clientSafe = sanitizeClientError(internalError, 'req-trace-test-123');

  assert(clientSafe.success === false, 'Returns success: false');
  assert(Boolean(clientSafe.error.code), 'Provides structured error code');
  assert(!('stack' in clientSafe.error), 'Guarantees no stack property in client error');
  assert(!JSON.stringify(clientSafe).includes('password123'), 'Redacts connection string password from client output');
  assert(!JSON.stringify(clientSafe).includes('leadsRepo.ts'), 'Never exposes internal file paths to client');
  assert(clientSafe.error.request_id === 'req-trace-test-123', 'Attaches request_id for client correlation');

  // Test 2: Standard Error Code Mappings
  console.log('\n--- 2. Standard Domain Error Code Mappings ---');

  const authErr = sanitizeClientError(new Error('AUTH_REQUIRED: Invalid token provided'));
  assert(authErr.error.code === 'UNAUTHORIZED', 'Maps authentication failure to UNAUTHORIZED');

  const permErr = sanitizeClientError(new Error('FORBIDDEN: INSUFFICIENT_ROLE'));
  assert(permErr.error.code === 'FORBIDDEN', 'Maps permission failure to FORBIDDEN');

  const rateErr = sanitizeClientError(new Error('Rate limit exceeded: 60 req/min'));
  assert(rateErr.error.code === 'RATE_LIMIT_EXCEEDED', 'Maps rate limit failure to RATE_LIMIT_EXCEEDED');

  const conflictErr = sanitizeClientError(new Error('Resource already in progress: LOCKED'));
  assert(conflictErr.error.code === 'CONFLICT', 'Maps concurrent lock conflict to CONFLICT');

  // Test 3: Secret purge in error message text
  console.log('\n--- 3. Secret Purge in Error Messages ---');
  const errorWithSecret = new Error('Invalid authentication header Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.supersecretkey');
  const sanitizedMsg = redactSecretsInString(errorWithSecret.message);
  assert(!sanitizedMsg.includes('supersecretkey') && sanitizedMsg.includes('[REDACTED_TOKEN]'), 'Purges Bearer token from error message');

  // Test 4: Section 14 Comprehensive Error Leak Audit
  console.log('\n--- 4. Section 14 Error Leak Audit ---');
  const compositeError = new Error(
    'Failed to query SELECT * FROM leads WHERE phone = "+919876543210" AND transcript LIKE "%budget 4.5Cr%" at https://xyzcompany.supabase.co/rest/v1 using API Key AIzaSyDemoKey123456789012345678901234. Provider response: {"error": "Invalid token Bearer eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MX0.sig"}'
  );
  compositeError.stack = `Error: Database query failed
    at executeSql (/app/services/supabase/client.ts:55:10)
    at Object.query (/app/services/supabase/repos/leadsRepo.ts:112:18)`;

  const sanitizedClientResponse = sanitizeClientError(compositeError, 'req_sec14_audit');
  const responseStr = JSON.stringify(sanitizedClientResponse);

  assert(!responseStr.includes('AIzaSyDemoKey123456789012345678901234'), 'API key is sanitized');
  assert(!responseStr.includes('eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MX0.sig'), 'Bearer token is sanitized');
  assert(!responseStr.includes('executeSql'), 'Stack trace is not exposed');
  assert(!responseStr.includes('leadsRepo.ts'), 'File path is not exposed');
  assert(sanitizedClientResponse.error.request_id === 'req_sec14_audit', 'Includes request_id');

  console.log('\n======================================================');
  console.log(`SECURITY ERROR SANITIZATION SUMMARY: ${passed} passed, ${failed} failed.`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
