/**
 * GrowthForge Phase 2B — Scout Runtime & Adapter Verification Test Suite
 *
 * Rules:
 * - Deterministic, non-network verification ONLY.
 * - Zero external scraping, zero requests to social platforms.
 * - Confirms Scout isolation, file completeness, license attribution,
 *   Python AST syntax, adapter boundary, output contract, and data-truth invariants.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { resolve, join } from 'path';
import { execSync } from 'child_process';
import {
  scoutAdapter,
  ScoutPythonAdapter,
  ScoutEnrichmentQuery,
  ScoutErrorCode,
} from '../app/services/scout/scoutAdapter';

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, testName: string, failureDetails?: string): void {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passedCount++;
  } else {
    console.error(`  ❌ FAIL: ${testName}${failureDetails ? ` -> ${failureDetails}` : ''}`);
    failedCount++;
  }
}

async function runScoutVerificationSuite(): Promise<void> {
  console.log('\n======================================================');
  console.log('🔍 GROWTHFORGE PHASE 2B SCOUT VERIFICATION SUITE');
  console.log('======================================================\n');

  const rootDir = process.cwd();
  const scoutDir = resolve(rootDir, 'scout');

  // --- 1. Scout Tree Completeness Check ---
  console.log('--- 1. Scout File Tree Integrity ---');
  const expectedFiles = [
    'scout.py',
    'requirements.txt',
    'README.md',
    'LICENSE',
    '.env.example',
    'proxies.example.txt',
    'app/__init__.py',
    'app/scrapers/__init__.py',
    'app/scrapers/enrichment.py',
    'app/scrapers/github.py',
    'app/scrapers/instagram.py',
    'app/scrapers/linkedin.py',
    'app/scrapers/linktree.py',
    'app/scrapers/pinterest.py',
    'app/scrapers/stealth.py',
    'app/scrapers/tiktok.py',
    'app/scrapers/twitch.py',
    'app/scrapers/utils.py',
    'app/scrapers/youtube.py',
  ];

  for (const relPath of expectedFiles) {
    const fullPath = resolve(scoutDir, relPath);
    assert(existsSync(fullPath), `Expected file exists: /scout/${relPath}`);
  }

  // --- 2. Nested Git & Submodule Verification ---
  console.log('\n--- 2. Git Isolation Verification ---');
  const nestedGitPath = resolve(scoutDir, '.git');
  assert(!existsSync(nestedGitPath), 'Scout is NOT a nested .git repository or submodule');

  // --- 3. License & Attribution Verification ---
  console.log('\n--- 3. License & Upstream Attribution ---');
  const licensePath = resolve(scoutDir, 'LICENSE');
  assert(existsSync(licensePath), 'LICENSE file is present in /scout');
  const licenseText = readFileSync(licensePath, 'utf-8');
  assert(licenseText.includes('MIT License'), 'Preserves MIT License text');
  assert(licenseText.includes('Copyright (c) 2026 Scout'), 'Preserves copyright and license notice');

  // --- 4. Secrets & Credentials Audit ---
  console.log('\n--- 4. Secret & Credential Audit ---');
  const envExamplePath = resolve(scoutDir, '.env.example');
  assert(existsSync(envExamplePath), '.env.example exists');
  const envExampleText = readFileSync(envExamplePath, 'utf-8');
  assert(!envExampleText.includes('sk_') && !envExampleText.includes('ghp_'), 'No active API keys in .env.example');
  
  const proxiesExamplePath = resolve(scoutDir, 'proxies.example.txt');
  assert(existsSync(proxiesExamplePath), 'proxies.example.txt exists');
  const proxiesText = readFileSync(proxiesExamplePath, 'utf-8');
  assert(proxiesText.includes('username:password@'), 'proxies.example.txt contains template placeholders only');

  // --- 5. Python AST Syntax Check ---
  console.log('\n--- 5. Python Syntax & AST Compilation Check ---');
  try {
    const pyScript = "import ast, glob; files = ['scout/scout.py'] + sorted(glob.glob('scout/app/**/*.py', recursive=True)); [ast.parse(open(f, 'r', encoding='utf-8').read(), filename=f) for f in files]; print(f'PARSED_{len(files)}_FILES')";
    const pyResult = execSync(`python3 -c "${pyScript}"`, {
      cwd: rootDir,
      encoding: 'utf-8',
    });
    assert(pyResult.includes('PARSED_14_FILES'), 'All 14 Scout Python source files passed AST syntax compilation');
  } catch (err) {
    assert(false, 'Python AST syntax compilation check', String(err));
  }

  // --- 6. Scout Requirements & Dependencies Check ---
  console.log('\n--- 6. Scout Dependencies Verification ---');
  const reqPath = resolve(scoutDir, 'requirements.txt');
  const reqText = readFileSync(reqPath, 'utf-8');
  const requiredDeps = ['requests', 'httpx', 'dnspython', 'free-proxy', 'rich'];
  for (const dep of requiredDeps) {
    assert(reqText.includes(dep), `requirements.txt specifies dependency: ${dep}`);
  }

  // --- 7. ScoutAdapter Boundary & Health Check ---
  console.log('\n--- 7. ScoutAdapter Boundary & Health Check ---');
  assert(scoutAdapter.adapterName === 'ScoutPythonAdapter', 'ScoutAdapter implements ScoutPythonAdapter contract');
  assert(scoutAdapter.version === '1.0.0', 'ScoutAdapter version is 1.0.0');

  const health = await scoutAdapter.checkHealth();
  assert(health.available === true, 'ScoutAdapter health check reports subsystem available');
  assert(health.error_code === 'SCOUT_SUCCESS', 'Health check returns SCOUT_SUCCESS');
  assert(health.latency_ms >= 0, 'Health check computes latency timing');

  // Test unavailable adapter when pointed to non-existent directory
  const invalidAdapter = new ScoutPythonAdapter('/tmp/non_existent_scout_path');
  const invalidHealth = await invalidAdapter.checkHealth();
  assert(invalidHealth.available === false, 'Detects unavailable subsystem when directory is missing');
  assert(invalidHealth.error_code === 'SCOUT_UNAVAILABLE', 'Returns SCOUT_UNAVAILABLE code on missing path');

  // --- 8. Adapter Output Contract & Data-Truth Invariant ---
  console.log('\n--- 8. Output Contract & Data-Truth Rule ---');
  const testQuery: ScoutEnrichmentQuery = {
    full_name: 'Ananya Birla',
    city: 'Mumbai',
    usernames: {
      linkedin: 'ananya-birla',
      instagram: 'ananyabirla',
    },
  };

  const deterministicFixture = {
    company: 'Suroday Microfinance',
    title: 'Founder & Chairperson',
    location: 'Mumbai, India',
    confidence: 0.92,
    profiles: [
      {
        platform: 'linkedin',
        url: 'https://linkedin.com/in/ananya-birla',
        handle: 'ananya-birla',
        bio: 'Entrepreneur, Philanthropist, Musician',
      },
      {
        platform: 'instagram',
        url: 'https://instagram.com/ananyabirla',
        handle: 'ananyabirla',
        bio: 'Artist & Founder',
      },
    ],
  };

  const normalized = await scoutAdapter.executeDeterministicVerification(testQuery, deterministicFixture);
  
  assert(normalized.source === 'scout', 'Normalized output source is strictly "scout"');
  assert(normalized.status === 'success', 'Normalized output status is "success"');
  assert(normalized.truth_level === 'INFERRED', 'DATA-TRUTH RULE: Output truth_level is strictly INFERRED (never CONFIRMED)');
  assert(normalized.confidence === 0.92, 'Normalized confidence matches fixture payload (0.92)');
  assert(normalized.profiles.length === 2, 'Parsed 2 social presence profiles');
  assert(normalized.profiles[0].platform === 'linkedin', 'Profile 0 platform is linkedin');
  assert(normalized.profiles[1].platform === 'instagram', 'Profile 1 platform is instagram');
  assert(normalized.signals.length >= 3, 'Extracted structured signals for company, title, and location');
  assert(normalized.error_code === 'SCOUT_SUCCESS', 'Returned SCOUT_SUCCESS error code');

  // --- 9. Error Code Discrimination ---
  console.log('\n--- 9. Error Code Discrimination ---');
  const emptyFixtureResult = await scoutAdapter.executeDeterministicVerification(testQuery, {});
  assert(emptyFixtureResult.status === 'not_found', 'Correctly flags empty fixture as not_found');
  assert(emptyFixtureResult.error_code === 'SCOUT_INVALID_OUTPUT', 'Returns SCOUT_INVALID_OUTPUT on empty payload');

  const errorNormalized = scoutAdapter.normalizeOutput(
    testQuery,
    {},
    'error',
    'SCOUT_TIMEOUT',
    'Subprocess execution exceeded timeout threshold'
  );
  assert(errorNormalized.status === 'error', 'Handles error status correctly');
  assert(errorNormalized.error_code === 'SCOUT_TIMEOUT', 'Discriminates SCOUT_TIMEOUT error code');
  assert(errorNormalized.error_message?.includes('timeout') === true, 'Preserves error message context');

  // --- 10. Direct Lead Enrichment Interface ---
  console.log('\n--- 10. Direct enrichLead Interface Verification ---');
  const enrichResult = await scoutAdapter.enrichLead(testQuery);
  assert(enrichResult.status === 'success', 'enrichLead returned success for valid query');
  assert(enrichResult.full_name === 'Ananya Birla', 'enrichLead preserved query full_name');
  assert(enrichResult.location === 'Mumbai', 'enrichLead preserved location');
  assert(enrichResult.error_code === 'SCOUT_SUCCESS', 'enrichLead returned SCOUT_SUCCESS');

  console.log('\n======================================================');
  console.log(`SCOUT TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('======================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runScoutVerificationSuite().catch((err) => {
  console.error('Fatal error running Scout verification suite:', err);
  process.exit(1);
});
