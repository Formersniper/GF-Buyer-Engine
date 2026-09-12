/**
 * GrowthForge Security Suite - Phase 8A.9 Correlation & Request Context Tests
 *
 * Verifies:
 * 1. Deterministic generation of correlation_id and request_id.
 * 2. Propagation of correlation context across deep async workflows.
 * 3. Preservation of correlation context when integrating with external webhooks/events.
 * 4. Express correlation middleware header injection and request attachment.
 */

import {
  generateUUID,
  runWithCorrelationContext,
  getCorrelationContext,
  deriveCorrelationId,
} from '../app/services/security/correlationContext';
import { correlationMiddleware } from '../app/middleware/correlation';

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
  console.log('RUNNING PHASE 8A.9 SECURITY SUITE: CORRELATION & CONTEXT');
  console.log('======================================================\n');

  // Test 1: UUID Generation
  console.log('--- 1. UUID Generation ---');
  const uuid1 = generateUUID();
  const uuid2 = generateUUID();
  assert(uuid1 !== uuid2, 'Generates unique UUIDs');
  assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid1), 'Produces valid RFC4122 UUID format');

  // Test 2: Async Correlation Context Propagation
  console.log('\n--- 2. Async Context Propagation ---');
  const testReqId = generateUUID();
  const testCorrId = generateUUID();
  const testTenant = 'tenant-context-abc';

  await runWithCorrelationContext(
    {
      requestId: testReqId,
      correlationId: testCorrId,
      tenantId: testTenant,
      service: 'workflow-runner',
      operation: 'executeLeadPipeline',
    },
    async () => {
      // Step 1: Lead ingestion
      const ctx1 = getCorrelationContext();
      assert(ctx1.requestId === testReqId, 'Maintains requestId in step 1');
      assert(ctx1.correlationId === testCorrId, 'Maintains correlationId in step 1');
      assert(ctx1.tenantId === testTenant, 'Maintains tenantId in step 1');

      // Step 2: Nested async call (simulating Gemini extraction / DB query)
      await new Promise((resolve) => setTimeout(resolve, 50));

      const ctx2 = getCorrelationContext();
      assert(ctx2.requestId === testReqId, 'Maintains requestId across setTimeout boundary');
      assert(ctx2.correlationId === testCorrId, 'Maintains correlationId across setTimeout boundary');
    }
  );

  // Test 3: Correlation Derivation
  console.log('\n--- 3. Correlation ID Derivation ---');
  const customId = 'lead-corr-9999';
  const derivedCustom = deriveCorrelationId(customId);
  assert(derivedCustom === customId, 'Derives explicit correlation ID if provided');

  const generatedCorr = deriveCorrelationId(null);
  assert(Boolean(generatedCorr) && generatedCorr.length > 10, 'Generates fresh correlation ID if omitted');

  // Test 4: Express Middleware Header Propagation
  console.log('\n--- 4. Express Middleware Header Propagation ---');
  const middleware = correlationMiddleware();
  const mockReq: any = {
    headers: {
      'x-request-id': 'incoming-req-1234',
      'x-correlation-id': 'incoming-corr-5678',
    },
    path: '/api/leads/qualify',
    method: 'POST',
  };

  const responseHeaders: Record<string, string> = {};
  const mockRes: any = {
    setHeader: (key: string, val: string) => {
      responseHeaders[key] = val;
    },
  };

  await new Promise<void>((resolve) => {
    middleware(mockReq, mockRes, () => {
      assert(mockReq.requestId === 'incoming-req-1234', 'Sets req.requestId from header');
      assert(mockReq.correlationId === 'incoming-corr-5678', 'Sets req.correlationId from header');
      assert(responseHeaders['X-Request-Id'] === 'incoming-req-1234', 'Sets X-Request-Id response header');
      assert(responseHeaders['X-Correlation-Id'] === 'incoming-corr-5678', 'Sets X-Correlation-Id response header');

      const ambient = getCorrelationContext();
      assert(ambient.requestId === 'incoming-req-1234', 'Ambient context matches request header');
      assert(ambient.correlationId === 'incoming-corr-5678', 'Ambient context matches correlation header');
      resolve();
    });
  });

  // Test 5: Section 15 Concurrency Interleaving Isolation Test
  console.log('\n--- 5. Section 15 Concurrency Interleaving Isolation ---');
  const taskA = runWithCorrelationContext(
    {
      requestId: 'REQ_A',
      correlationId: 'CORR_A',
      tenantId: 'TENANT_A',
      service: 'workflow_A',
    },
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      const ctx = getCorrelationContext();
      assert(ctx.requestId === 'REQ_A', 'Task A retains REQ_A after delay');
      assert(ctx.correlationId === 'CORR_A', 'Task A retains CORR_A after delay');
      assert(ctx.tenantId === 'TENANT_A', 'Task A retains TENANT_A after delay');
      await new Promise((resolve) => setTimeout(resolve, 30));
      const ctxEnd = getCorrelationContext();
      assert(ctxEnd.requestId === 'REQ_A' && ctxEnd.correlationId === 'CORR_A', 'Task A zero cross-contamination at end');
    }
  );

  const taskB = runWithCorrelationContext(
    {
      requestId: 'REQ_B',
      correlationId: 'CORR_B',
      tenantId: 'TENANT_B',
      service: 'workflow_B',
    },
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      const ctx = getCorrelationContext();
      assert(ctx.requestId === 'REQ_B', 'Task B retains REQ_B after delay');
      assert(ctx.correlationId === 'CORR_B', 'Task B retains CORR_B after delay');
      assert(ctx.tenantId === 'TENANT_B', 'Task B retains TENANT_B after delay');
      await new Promise((resolve) => setTimeout(resolve, 40));
      const ctxEnd = getCorrelationContext();
      assert(ctxEnd.requestId === 'REQ_B' && ctxEnd.correlationId === 'CORR_B', 'Task B zero cross-contamination at end');
    }
  );

  await Promise.all([taskA, taskB]);

  console.log('\n======================================================');
  console.log(`SECURITY CORRELATION SUMMARY: ${passed} passed, ${failed} failed.`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
