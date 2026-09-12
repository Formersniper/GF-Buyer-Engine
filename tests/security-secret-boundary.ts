/**
 * GrowthForge Buyer Intelligence Engine - Secret Boundary Security Tests (Phase 8A.10)
 *
 * Verifies that server-only secrets cannot be leaked to the frontend via VITE_ prefixes,
 * bundle assets, Supabase client resolver, or error messages.
 */

import fs from 'fs';
import path from 'path';
import { validateProductionConfig } from '../app/config/productionConfig';
import { getSupabaseConfig } from '../app/services/supabase/client';

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

async function runSecretBoundaryTests() {
  console.log('\n============================================================');
  console.log('RUNNING PHASE 8A.10 SECRET BOUNDARY TEST SUITE');
  console.log('============================================================\n');

  // TEST 1: Forbidden VITE_ prefixes are detected and rejected
  console.log('--- TEST 1: Forbidden VITE_* Prefix Enforcement ---');

  const testCases = [
    { key: 'VITE_SUPABASE_SERVICE_ROLE_KEY', val: 'secret-service-role' },
    { key: 'VITE_GEMINI_API_KEY', val: 'secret-gemini-key' },
    { key: 'VITE_SARVAM_API_KEY', val: 'secret-sarvam-key' },
    { key: 'VITE_VOICE_WEBHOOK_SECRET', val: 'secret-webhook-key' },
    { key: 'VITE_CUSTOM_SERVICE_ROLE_KEY', val: 'secret-val' },
    { key: 'VITE_PRIVATE_KEY_PEM', val: 'secret-pem' },
  ];

  for (const tc of testCases) {
    const envWithForbidden = {
      NODE_ENV: 'development',
      [tc.key]: tc.val,
    };
    const res = validateProductionConfig(envWithForbidden);
    assert(res.valid === false, `Environment with ${tc.key} must fail validation`);
    assert(
      res.errors.some((e) => e.includes(tc.key)),
      `Error output must cite ${tc.key}`
    );
  }

  // TEST 2: Permissible public VITE variables are allowed
  console.log('\n--- TEST 2: Safe Public VITE_* Variables Permitted ---');
  const safeViteEnv = {
    NODE_ENV: 'development',
    VITE_SUPABASE_URL: 'https://xyzcompany.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'valid-public-anon-key',
  };
  const safeRes = validateProductionConfig(safeViteEnv);
  assert(safeRes.valid === true, 'Safe public VITE variables must pass validation');

  // TEST 3: Supabase client resolver boundary
  console.log('\n--- TEST 3: Supabase Client Resolver Secret Boundary ---');
  const oldEnv = { ...process.env };
  process.env.SUPABASE_URL = 'https://tenant.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'public-anon-token-client';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'TOP_SECRET_SERVICE_ROLE_KEY_12345';

  const clientConfig = getSupabaseConfig();
  assert(clientConfig.url === 'https://tenant.supabase.co', 'URL must match configured URL');
  assert(clientConfig.key === 'public-anon-token-client', 'Client key must be anon key');
  assert(clientConfig.key !== 'TOP_SECRET_SERVICE_ROLE_KEY_12345', 'Client key must NEVER be service_role key');
  assert(
    !('serviceRoleKey' in (clientConfig as any)),
    'getSupabaseConfig must not return serviceRoleKey property'
  );

  // Restore env
  process.env = oldEnv;

  // TEST 4: Config validation errors never leak secret values
  console.log('\n--- TEST 4: Non-Disclosure in Configuration Error Messages ---');
  const secretKey = 'CRITICAL_SECRET_VALUE_DO_NOT_LEAK_IN_LOGS';
  const badEnv = {
    NODE_ENV: 'production',
    SARVAM_API_KEY: secretKey,
    // deliberate error to trigger message
    APP_URL: 'http://insecure.url',
  };
  const badRes = validateProductionConfig(badEnv);
  const combinedErrors = badRes.errors.join(' ');
  assert(
    !combinedErrors.includes(secretKey),
    'Validation errors must never include secret key contents'
  );

  // TEST 5: Frontend built bundle audit
  console.log('\n--- TEST 5: Frontend Bundle Asset Inspection ---');
  const distAssetsDir = path.join(process.cwd(), 'dist', 'assets');
  if (fs.existsSync(distAssetsDir)) {
    const files = fs.readdirSync(distAssetsDir);
    const jsFiles = files.filter((f) => f.endsWith('.js'));
    assert(jsFiles.length > 0, 'Production bundle JS file exists in dist/assets');

    for (const jsFile of jsFiles) {
      const bundleContent = fs.readFileSync(path.join(distAssetsDir, jsFile), 'utf8');

      // The frontend bundle must not contain real secret API keys or service role tokens
      assert(
        !bundleContent.includes('TOP_SECRET_SERVICE_ROLE_KEY_12345'),
        `Bundle ${jsFile} must not contain secret service role key`
      );
      assert(
        !bundleContent.includes('AIzaSyAValidGeminiProductionApiKey'),
        `Bundle ${jsFile} must not contain Gemini API key`
      );
      assert(
        !bundleContent.includes('sarvam_prod_valid_api_key'),
        `Bundle ${jsFile} must not contain Sarvam API key`
      );
      assert(
        !bundleContent.includes('super-secret-cryptographic-webhook-token'),
        `Bundle ${jsFile} must not contain Webhook secret`
      );
    }
  } else {
    console.log('Notice: dist/assets not yet built; skipping bundle string audit.');
  }

  console.log(`\n============================================================`);
  console.log(`SECRET BOUNDARY TEST RESULTS: ${passedTests}/${totalTests} PASSED`);
  console.log(`============================================================\n`);
}

runSecretBoundaryTests().catch((err) => {
  console.error('Fatal test failure:', err);
  process.exit(1);
});
