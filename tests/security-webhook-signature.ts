import crypto from 'crypto';
import { processSarvamWebhook } from '../app/services/voice/sarvamWebhook';

const originalEnv = process.env.NODE_ENV;
const originalSecret = process.env.VOICE_WEBHOOK_SECRET;

async function runTests() {
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, message: string) {
    if (condition) {
      console.log(`✅ ${message}`);
      passed++;
    } else {
      console.error(`❌ ${message}`);
      failed++;
    }
  }

  const secret = 'super-secret-key';
  process.env.VOICE_WEBHOOK_SECRET = secret;
  process.env.NODE_ENV = 'test'; // Use test so DB RLS fallback works

  const validPayload = {
    call_id: 'test-call',
    event_type: 'call.started',
    status: 'ringing'
  };

  // Test 1: valid signature accepted
  const res1 = await processSarvamWebhook(validPayload, {
    'authorization': `Bearer ${secret}`
  });
  assert(res1.action !== 'ERROR', 'Valid signature accepted');

  // Test 2: missing signature rejected
  const res2 = await processSarvamWebhook(validPayload, {});
  assert(res2.action === 'ERROR' && res2.error === 'Unauthorized', 'Missing signature rejected');

  // Test 3: invalid signature rejected
  const res3 = await processSarvamWebhook(validPayload, {
    'authorization': `Bearer wrong-secret`
  });
  assert(res3.action === 'ERROR' && res3.error === 'Unauthorized', 'Invalid signature rejected');

  // Test 4: production missing secret fails closed
  process.env.NODE_ENV = 'production';
  delete process.env.VOICE_WEBHOOK_SECRET;
  const res4 = await processSarvamWebhook(validPayload, {});
  assert(res4.action === 'ERROR' && res4.error === 'Unauthorized', 'Missing config fails closed');

  console.log(`\nTests passed: ${passed}, failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

runTests().finally(() => {
  process.env.NODE_ENV = originalEnv;
  process.env.VOICE_WEBHOOK_SECRET = originalSecret;
});
