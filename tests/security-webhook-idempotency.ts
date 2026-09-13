import { processSarvamWebhook } from '../app/services/voice/sarvamWebhook';
import { supabaseDataService } from '../app/services/supabase/repositories';

const originalEnv = process.env.NODE_ENV;
const originalSecret = process.env.VOICE_WEBHOOK_SECRET;

async function runTests() {
  process.env.VOICE_WEBHOOK_SECRET = 'test-secret';
  process.env.NODE_ENV = 'production';
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

  // Without a Supabase client, production should fail closed!
  const savedUrl = process.env.VITE_SUPABASE_URL;
  const savedSbUrl = process.env.SUPABASE_URL;
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_URL;
  const { resetSupabaseClient } = await import('../app/services/supabase/client');
  resetSupabaseClient();

  const validHeaders = { 'authorization': `Bearer test-secret` };
  
  try {
    await processSarvamWebhook({
      event_id: 'test-evt-production-fail',
      outbound_id: 'unknown-call-id',
      status: 'call.started'
    }, validHeaders);
    assert(false, 'Production persistence fell back to memory without failing!');
  } catch (err: any) {
    assert(err.message.includes('requires Supabase database client') || err.message.includes('disabled in production'), 'Production persistence fails closed if no DB client is available');
  } finally {
    if (savedUrl) process.env.VITE_SUPABASE_URL = savedUrl;
    if (savedSbUrl) process.env.SUPABASE_URL = savedSbUrl;
    resetSupabaseClient();
  }

  // To test actual logic without a real DB, we temporarily switch to non-production 
  process.env.NODE_ENV = 'test';

  const res1 = await processSarvamWebhook({
    event_id: 'test-evt-concurrent',
    outbound_id: 'unknown-call-id',
    status: 'call.started'
  }, validHeaders);

  const res2 = await processSarvamWebhook({
    event_id: 'test-evt-concurrent',
    outbound_id: 'unknown-call-id',
    status: 'call.started'
  }, validHeaders);
  
  assert(res1.action !== 'IGNORED_DUPLICATE', 'First event processed normally (or rejected via correlation)');
  assert(res2.action === 'IGNORED_DUPLICATE', 'Second event correctly identified as duplicate');

  console.log(`\nTests passed: ${passed}, failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

runTests().finally(() => {
  process.env.NODE_ENV = originalEnv;
  process.env.VOICE_WEBHOOK_SECRET = originalSecret;
});
