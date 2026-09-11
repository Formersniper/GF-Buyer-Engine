import { processSarvamWebhook } from '../app/services/voice/sarvamWebhook';
import { supabaseDataService } from '../app/services/supabase/repositories';

const originalEnv = process.env.NODE_ENV;
const originalSecret = process.env.VOICE_WEBHOOK_SECRET;

async function runTests() {
  process.env.VOICE_WEBHOOK_SECRET = 'test-secret';
  process.env.NODE_ENV = 'test';
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

  const validHeaders = { 'authorization': `Bearer test-secret` };
  
  // Test 1: unknown provider_call_id rejected
  const res1 = await processSarvamWebhook({
    event_id: 'evt-1',
    outbound_id: 'unknown-call-id',
    status: 'call.started'
  }, validHeaders);
  assert(res1.action === 'CALL_NOT_FOUND', 'Unknown provider_call_id rejected safely');

  // Test 2: missing provider_call_id rejected
  const res2 = await processSarvamWebhook({
    event_id: 'evt-2',
    lead_id: 'some-lead',
    status: 'call.started'
  }, validHeaders);
  assert(res2.action === 'ERROR' && !!res2.error?.includes('missing authoritative'), 'Missing provider_call_id rejected safely');

  // Test 3: Idempotency - Duplicate delivery
  const res3a = await processSarvamWebhook({
    event_id: 'evt-3',
    outbound_id: 'unknown-call-id', // Use unknown so it doesn't try to update a real DB call
    status: 'call.started'
  }, validHeaders);
  
  const res3b = await processSarvamWebhook({
    event_id: 'evt-3',
    outbound_id: 'unknown-call-id',
    status: 'call.started'
  }, validHeaders);
  assert(res3b.action === 'IGNORED_DUPLICATE', 'Duplicate event is idempotent');

  console.log(`\nTests passed: ${passed}, failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

runTests().finally(() => {
  process.env.NODE_ENV = originalEnv;
  process.env.VOICE_WEBHOOK_SECRET = originalSecret;
});
