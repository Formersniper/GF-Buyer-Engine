/**
 * GrowthForge Buyer Intelligence Engine - Production Configuration Tests (Phase 8A.10)
 *
 * Validates fail-fast configuration enforcement, startup matrices, bounds checks,
 * and rejection of insecure defaults in production.
 */

import {
  validateProductionConfig,
  enforceProductionConfig,
  ProductionConfigError,
  getStartupHealthStatus,
} from '../app/config/productionConfig';

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, message: string): void {
  totalTests++;
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedTests++;
  console.log(`✅ PASS: ${message}`);
}

const VALID_PROD_ENV: Record<string, string> = {
  NODE_ENV: 'production',
  APP_URL: 'https://growthforge.buyerengine.com',
  SUPABASE_URL: 'https://xyzcompany.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.valid-anon-key-with-sufficient-length-12345',
  SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.valid-service-role-key-with-sufficient-length-12345',
  GEMINI_API_KEY: 'AIzaSyAValidGeminiProductionApiKeyForGrowthForgeEngine',
  VOICE_MODE: 'REAL',
  SARVAM_API_KEY: 'sarvam_prod_valid_api_key_77889900112233',
  SARVAM_ORG_ID: '99a074ea-647b-7549-9a87-cb4a09a65faa',
  SARVAM_WORKSPACE_ID: '88a074ea-6481-766d-a3f3-c42aef343735',
  SARVAM_AGENT_ID: 'Growthforge-prod-agent-77a8',
  SARVAM_AGENT_VERSION: '3',
  SARVAM_CONNECTION_ID: '0274b928-7c-cdaf00f5-ff9a',
  SARVAM_AGENT_PHONE_NUMBER: '+18005550199',
  VOICE_WEBHOOK_SECRET: 'super-secret-cryptographic-webhook-token-32bytes',
  LOG_REDACTION_ENABLED: 'true',
  ENABLE_DEBUG_LOGS: 'false',
  LOG_LEVEL: 'INFO',
  CORS_ALLOWED_ORIGINS: 'https://growthforge.buyerengine.com,https://app.growthforge.com',
};

async function runProductionConfigTests() {
  console.log('\n============================================================');
  console.log('RUNNING PHASE 8A.10 PRODUCTION CONFIGURATION TEST SUITE');
  console.log('============================================================\n');

  // TEST 1: Full valid production configuration passes
  console.log('--- TEST 1: Valid Production Environment Configuration ---');
  const validRes = validateProductionConfig(VALID_PROD_ENV);
  assert(validRes.valid === true, 'Valid production config must pass validation');
  assert(validRes.errors.length === 0, 'Valid production config must have 0 errors');
  assert(validRes.environment === 'production', 'Environment must be production');

  // TEST 2: Missing APP_URL in production fails
  console.log('\n--- TEST 2: Missing or Invalid APP_URL ---');
  const missingAppUrl = { ...VALID_PROD_ENV };
  delete missingAppUrl.APP_URL;
  const missingAppUrlRes = validateProductionConfig(missingAppUrl);
  assert(missingAppUrlRes.valid === false, 'Missing APP_URL must fail in production');
  assert(
    missingAppUrlRes.errors.some((e) => e.includes('APP_URL is required')),
    'Error message must indicate APP_URL is required'
  );

  // TEST 3: HTTP (insecure) APP_URL in production fails
  const httpAppUrl = { ...VALID_PROD_ENV, APP_URL: 'http://insecure.growthforge.com' };
  const httpAppUrlRes = validateProductionConfig(httpAppUrl);
  assert(httpAppUrlRes.valid === false, 'HTTP APP_URL must fail in production');
  assert(
    httpAppUrlRes.errors.some((e) => e.includes('must use HTTPS protocol')),
    'Error message must require HTTPS protocol'
  );

  // TEST 4: Localhost or growthforge.local APP_URL in production fails
  const localAppUrl = { ...VALID_PROD_ENV, APP_URL: 'https://growthforge.local/api' };
  const localAppUrlRes = validateProductionConfig(localAppUrl);
  assert(localAppUrlRes.valid === false, 'growthforge.local APP_URL must fail in production');

  const localhostAppUrl = { ...VALID_PROD_ENV, APP_URL: 'https://localhost:3000' };
  const localhostAppUrlRes = validateProductionConfig(localhostAppUrl);
  assert(localhostAppUrlRes.valid === false, 'localhost APP_URL must fail in production');

  // TEST 5: Missing Supabase credentials in production fails
  console.log('\n--- TEST 3: Supabase Credentials Validation ---');
  const missingSupabaseUrl = { ...VALID_PROD_ENV };
  delete missingSupabaseUrl.SUPABASE_URL;
  const missingSupabaseUrlRes = validateProductionConfig(missingSupabaseUrl);
  assert(missingSupabaseUrlRes.valid === false, 'Missing SUPABASE_URL must fail in production');

  const placeholderSupabase = { ...VALID_PROD_ENV, SUPABASE_URL: 'https://your-project.supabase.co' };
  const placeholderSupabaseRes = validateProductionConfig(placeholderSupabase);
  assert(placeholderSupabaseRes.valid === false, 'Placeholder SUPABASE_URL must fail in production');

  const missingServiceKey = { ...VALID_PROD_ENV };
  delete missingServiceKey.SUPABASE_SERVICE_ROLE_KEY;
  const missingServiceKeyRes = validateProductionConfig(missingServiceKey);
  assert(missingServiceKeyRes.valid === false, 'Missing SUPABASE_SERVICE_ROLE_KEY must fail in production');

  // TEST 6: Missing Gemini API Key in production fails
  console.log('\n--- TEST 4: Gemini AI Credentials Validation ---');
  const missingGemini = { ...VALID_PROD_ENV };
  delete missingGemini.GEMINI_API_KEY;
  const missingGeminiRes = validateProductionConfig(missingGemini);
  assert(missingGeminiRes.valid === false, 'Missing GEMINI_API_KEY must fail in production');

  // TEST 7: Missing Sarvam Voice credentials in production fails
  console.log('\n--- TEST 5: Sarvam Voice Credentials Validation ---');
  const missingSarvamKey = { ...VALID_PROD_ENV };
  delete missingSarvamKey.SARVAM_API_KEY;
  const missingSarvamKeyRes = validateProductionConfig(missingSarvamKey);
  assert(missingSarvamKeyRes.valid === false, 'Missing SARVAM_API_KEY must fail in production');

  // VOICE_MODE must be REAL
  const mockVoiceMode = { ...VALID_PROD_ENV, VOICE_MODE: 'MOCK' };
  const mockVoiceModeRes = validateProductionConfig(mockVoiceMode);
  assert(mockVoiceModeRes.valid === false, 'VOICE_MODE=MOCK must fail in production');
  assert(
    mockVoiceModeRes.errors.some((e) => e.includes('VOICE_MODE must be "REAL"')),
    'Error message must indicate mock voice is forbidden in production'
  );

  // Development defaults for Sarvam rejected in production
  const defaultAgent = { ...VALID_PROD_ENV, SARVAM_AGENT_ID: 'Growthforge-ae0789e1-56b8' };
  const defaultAgentRes = validateProductionConfig(defaultAgent);
  assert(defaultAgentRes.valid === false, 'Development default SARVAM_AGENT_ID must fail in production');

  const invalidPhone = { ...VALID_PROD_ENV, SARVAM_AGENT_PHONE_NUMBER: 'invalid-phone-format' };
  const invalidPhoneRes = validateProductionConfig(invalidPhone);
  assert(invalidPhoneRes.valid === false, 'Invalid SARVAM_AGENT_PHONE_NUMBER must fail in production');

  // TEST 8: Webhook Secret Validation
  console.log('\n--- TEST 6: Webhook Secret Cryptographic Strength ---');
  const missingWebhook = { ...VALID_PROD_ENV };
  delete missingWebhook.VOICE_WEBHOOK_SECRET;
  const missingWebhookRes = validateProductionConfig(missingWebhook);
  assert(missingWebhookRes.valid === false, 'Missing VOICE_WEBHOOK_SECRET must fail in production');

  const shortWebhook = { ...VALID_PROD_ENV, VOICE_WEBHOOK_SECRET: 'short' };
  const shortWebhookRes = validateProductionConfig(shortWebhook);
  assert(shortWebhookRes.valid === false, 'Short VOICE_WEBHOOK_SECRET (<16 chars) must fail in production');

  // TEST 9: Logging & Redaction Controls
  console.log('\n--- TEST 7: Mandatory Redaction & Debug Log Gating ---');
  const disabledRedaction = { ...VALID_PROD_ENV, LOG_REDACTION_ENABLED: 'false' };
  const disabledRedactionRes = validateProductionConfig(disabledRedaction);
  assert(disabledRedactionRes.valid === false, 'LOG_REDACTION_ENABLED=false must fail in production');

  const enabledDebug = { ...VALID_PROD_ENV, ENABLE_DEBUG_LOGS: 'true' };
  const enabledDebugRes = validateProductionConfig(enabledDebug);
  assert(enabledDebugRes.valid === false, 'ENABLE_DEBUG_LOGS=true must fail in production');

  const debugLogLevel = { ...VALID_PROD_ENV, LOG_LEVEL: 'DEBUG' };
  const debugLogLevelRes = validateProductionConfig(debugLogLevel);
  assert(debugLogLevelRes.valid === false, 'LOG_LEVEL=DEBUG must fail in production');

  // TEST 10: Wildcard CORS in production rejected
  console.log('\n--- TEST 8: CORS Wildcard Restriction ---');
  const wildcardCors = { ...VALID_PROD_ENV, CORS_ALLOWED_ORIGINS: '*' };
  const wildcardCorsRes = validateProductionConfig(wildcardCors);
  assert(wildcardCorsRes.valid === false, 'Wildcard CORS (*) must fail in production');

  // TEST 11: Rate Limiting and Concurrency Bounds
  console.log('\n--- TEST 9: Rate Limit & Concurrency Bounds Checking ---');
  const negativeRateLimit = { ...VALID_PROD_ENV, GLOBAL_REQUESTS_PER_MINUTE: '-50' };
  const negativeRateLimitRes = validateProductionConfig(negativeRateLimit);
  assert(negativeRateLimitRes.valid === false, 'Negative rate limit must fail');

  const nanRateLimit = { ...VALID_PROD_ENV, TENANT_REQUESTS_PER_MINUTE: 'abc' };
  const nanRateLimitRes = validateProductionConfig(nanRateLimit);
  assert(nanRateLimitRes.valid === false, 'NaN rate limit must fail');

  const absurdConcurrency = { ...VALID_PROD_ENV, MAX_ACTIVE_GEMINI_OPERATIONS: '999999999' };
  const absurdConcurrencyRes = validateProductionConfig(absurdConcurrency);
  assert(absurdConcurrencyRes.valid === false, 'Absurd concurrency (>1000) must fail');

  // TEST 12: Development mode with no external credentials passes
  console.log('\n--- TEST 10: Development & Test Permissive Execution ---');
  const devEnv = {
    NODE_ENV: 'development',
  };
  const devRes = validateProductionConfig(devEnv);
  assert(devRes.valid === true, 'Development mode without external credentials must pass');
  assert(devRes.environment === 'development', 'Environment must be development');

  // TEST 13: enforceProductionConfig throws in production when invalid
  console.log('\n--- TEST 11: enforceProductionConfig Fail-Fast Throw ---');
  let threwExpected = false;
  try {
    enforceProductionConfig({ NODE_ENV: 'production' });
  } catch (err: any) {
    threwExpected = err instanceof ProductionConfigError;
  }
  assert(threwExpected, 'enforceProductionConfig must throw ProductionConfigError in production when invalid');

  // TEST 14: Startup Health Diagnostics
  console.log('\n--- TEST 12: Sanitized Startup Health Diagnostics ---');
  const healthProd = getStartupHealthStatus(VALID_PROD_ENV);
  assert(healthProd.status === 'READY', 'Health status must be READY for valid prod env');
  assert(healthProd.checks.supabase === 'READY', 'Supabase check must be READY');
  assert(healthProd.checks.gemini === 'CONFIGURED', 'Gemini check must be CONFIGURED');
  assert(healthProd.checks.sarvam === 'CONFIGURED', 'Sarvam check must be CONFIGURED');
  assert(healthProd.checks.webhook_auth === 'CONFIGURED', 'Webhook auth check must be CONFIGURED');
  assert(healthProd.checks.log_redaction === 'MANDATORY_ACTIVE', 'Log redaction check must be MANDATORY_ACTIVE');
  assert(healthProd.checks.cors === 'RESTRICTED', 'CORS check must be RESTRICTED');

  const healthDev = getStartupHealthStatus({ NODE_ENV: 'development' });
  assert(healthDev.status === 'READY', 'Health status must be READY in development');
  assert(healthDev.checks.gemini === 'MOCK_ALLOWED', 'Gemini check allows mock in development');
  assert(healthDev.checks.cors === 'DEVELOPMENT_PERMISSIVE', 'CORS allows development origins');

  console.log(`\n============================================================`);
  console.log(`PRODUCTION CONFIGURATION TEST RESULTS: ${passedTests}/${totalTests} PASSED`);
  console.log(`============================================================\n`);
}

runProductionConfigTests().catch((err) => {
  console.error('Fatal test failure:', err);
  process.exit(1);
});
