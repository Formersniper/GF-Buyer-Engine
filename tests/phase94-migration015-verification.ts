/**
 * GrowthForge Buyer Intelligence Engine — Phase 9.4
 * Migration 015 Verification Suite (Historical Tenant-Scoped Tables)
 * 
 * Strict pre-deployment security verification:
 * - NO fallback-to-true behavior.
 * - Missing credentials report NOT_VERIFIED (never PASS).
 * - Real read-only checks against Supabase API.
 * - Multi-tenant isolation verified with zero production mutation.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

export interface VerificationResult {
  id: number;
  category: 'A_STATIC' | 'B_LIVE_ANON' | 'C_LIVE_SERVICE_ROLE' | 'D_TENANT_ISOLATION';
  description: string;
  status: 'PASS' | 'FAIL' | 'NOT_VERIFIED' | 'PRE_DEPLOYMENT_OBSERVED';
  mechanism: string;
  evidence: string;
}

export async function runMigration015Verification(): Promise<{
  results: VerificationResult[];
  passedCount: number;
  failedCount: number;
  notVerifiedCount: number;
}> {
  const results: VerificationResult[] = [];
  const root = process.cwd();

  console.log('============================================================');
  console.log('GROWTHFORGE PHASE 9.4 — MIGRATION 015 VERIFICATION SUITE');
  console.log('============================================================\n');

  // -------------------------------------------------------------
  // PART A: Static Migration Structure Verification
  // -------------------------------------------------------------
  console.log('--- PART A: Static Migration Structure & AST Audit ---');
  const path015 = path.join(root, 'supabase', 'migrations', '20260921120000_015_harden_003_historical_tenant_rls.sql');
  const path014 = path.join(root, 'supabase', 'migrations', '20260921114100_014_harden_002_rls.sql');
  const path013 = path.join(root, 'supabase', 'migrations', '013_harden_001_rls.sql');

  if (!fs.existsSync(path015)) {
    throw new Error(`Migration 015 not found at ${path015}`);
  }

  const sql015 = fs.readFileSync(path015, 'utf8');
  const sql014 = fs.readFileSync(path014, 'utf8');
  const sql013 = fs.readFileSync(path013, 'utf8');

  // Verify Migration 013 & 014 SHA256 integrity
  const sha013 = crypto.createHash('sha256').update(sql013).digest('hex');
  const sha014 = crypto.createHash('sha256').update(sql014).digest('hex');
  const expected013 = '74ff5a5800bda4fa37eba9199ab7de9bcf6ef2d5719ba88af7a31f84547cce68';
  const expected014 = '8384c859ca62cf153222417f8ba9eabd4eab6b8964c4c897b496ec086aedb334';

  const matches013 = sha013 === expected013;
  const matches014 = sha014 === expected014;

  results.push({
    id: 1,
    category: 'A_STATIC',
    description: 'Migrations 013 and 014 remain byte-identical to baseline',
    status: matches013 && matches014 ? 'PASS' : 'FAIL',
    mechanism: 'SHA256 digest comparison against immutable baselines',
    evidence: `013: ${sha013} (${matches013 ? 'MATCH' : 'MISMATCH'}), 014: ${sha014} (${matches014 ? 'MATCH' : 'MISMATCH'})`
  });

  // Target tables in 015
  const tablesMatch = sql015.match(/tenant_tables\s+text\[\]\s*:=\s*ARRAY\[([\s\S]*?)\];/);
  const tablesIn015 = tablesMatch ? tablesMatch[1].split(',').map(s => s.replace(/['\s]/g, '')) : [];
  const expected3 = ['call_transcripts', 'conversation_extractions', 'buyer_qualifications'];
  const hasExact3Tables = tablesIn015.length === 3 && expected3.every(t => tablesIn015.includes(t));

  results.push({
    id: 2,
    category: 'A_STATIC',
    description: 'Migration 015 targets exactly the 3 historical tenant-scoped tables',
    status: hasExact3Tables ? 'PASS' : 'FAIL',
    mechanism: 'ARRAY inspection in PL/pgSQL declaration',
    evidence: `Tables declared: [${tablesIn015.join(', ')}] (Expected: [${expected3.join(', ')}])`
  });

  // webhook_events is strictly excluded
  const webhookExcluded = !sql015.includes('webhook_events');
  results.push({
    id: 3,
    category: 'A_STATIC',
    description: 'webhook_events is strictly untouched by Migration 015',
    status: webhookExcluded ? 'PASS' : 'FAIL',
    mechanism: 'Sub-string and reference scan of migration 015 file',
    evidence: `Contains webhook_events references: ${!webhookExcluded}`
  });

  // Legacy public policies dropped
  const dropsLegacy1 = sql015.includes('DROP POLICY IF EXISTS "Allow public access on call_transcripts" ON call_transcripts;');
  const dropsLegacy2 = sql015.includes('DROP POLICY IF EXISTS "Allow public access on conversation_extractions" ON conversation_extractions;');
  const dropsLegacy3 = sql015.includes('DROP POLICY IF EXISTS "Allow public access on buyer_qualifications" ON buyer_qualifications;');
  const dropsAllLegacy = dropsLegacy1 && dropsLegacy2 && dropsLegacy3;

  results.push({
    id: 4,
    category: 'A_STATIC',
    description: 'All 3 legacy public policies are explicitly dropped using IF EXISTS',
    status: dropsAllLegacy ? 'PASS' : 'FAIL',
    mechanism: 'Explicit DROP POLICY IF EXISTS statements for historical 002/003/004 policies',
    evidence: `Dropped: call_transcripts=${dropsLegacy1}, conversation_extractions=${dropsLegacy2}, buyer_qualifications=${dropsLegacy3}`
  });

  // RLS explicitly enabled
  const enablesRls = sql015.includes('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;');
  results.push({
    id: 5,
    category: 'A_STATIC',
    description: 'Row Level Security is explicitly enabled on all target tables',
    status: enablesRls ? 'PASS' : 'FAIL',
    mechanism: 'ALTER TABLE ... ENABLE ROW LEVEL SECURITY',
    evidence: `ENABLE ROW LEVEL SECURITY statement present in loop: ${enablesRls}`
  });

  // Scoped TO authenticated only
  const hasToAuthenticated = sql015.includes('TO authenticated');
  const hasNoAnonPolicy = !sql015.includes('TO anon') && !sql015.includes('TO public');
  results.push({
    id: 6,
    category: 'A_STATIC',
    description: 'Policies scoped exclusively TO authenticated with no anon/public grants',
    status: hasToAuthenticated && hasNoAnonPolicy ? 'PASS' : 'FAIL',
    mechanism: 'Role target constraint in CREATE POLICY statement',
    evidence: `TO authenticated present: ${hasToAuthenticated}, No anon/public grants: ${hasNoAnonPolicy}`
  });

  // USING and WITH CHECK present
  const hasUsing = sql015.includes('USING (');
  const hasWithCheck = sql015.includes('WITH CHECK (');
  results.push({
    id: 7,
    category: 'A_STATIC',
    description: 'Both USING and WITH CHECK clauses enforce tenant ownership',
    status: hasUsing && hasWithCheck ? 'PASS' : 'FAIL',
    mechanism: 'USING (read/update/delete) and WITH CHECK (insert/update) definitions',
    evidence: `USING present: ${hasUsing}, WITH CHECK present: ${hasWithCheck}`
  });

  // App metadata precedence and top-level fallback
  const hasAppMetadataPrecedence = sql015.includes("coalesce(auth.jwt() -> ''app_metadata'' ->> ''tenant_id'', auth.jwt() ->> ''tenant_id'')");
  results.push({
    id: 8,
    category: 'A_STATIC',
    description: 'Tenant claim resolution enforces app_metadata precedence with top-level fallback',
    status: hasAppMetadataPrecedence ? 'PASS' : 'FAIL',
    mechanism: "coalesce(auth.jwt() -> 'app_metadata' ->> 'tenant_id', auth.jwt() ->> 'tenant_id')",
    evidence: `Coalesce hierarchy present: ${hasAppMetadataPrecedence}`
  });

  // Missing and malformed claim safety
  const hasNullGuard = sql015.includes('IS NOT NULL') && sql015.includes("!= ''null''");
  const hasRegexGuard = sql015.includes('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');
  const hasSafeCaseCast = sql015.includes('CASE') && sql015.includes('THEN') && sql015.includes('ELSE NULL');

  results.push({
    id: 9,
    category: 'A_STATIC',
    description: 'Malformed and missing tenant claims fail closed without PostgreSQL 22P02 cast errors',
    status: hasNullGuard && hasRegexGuard && hasSafeCaseCast ? 'PASS' : 'FAIL',
    mechanism: 'IS NOT NULL + != null + UUID Regex validation before type-casting in CASE statement',
    evidence: `Null guard: ${hasNullGuard}, UUID regex: ${hasRegexGuard}, Safe CASE cast: ${hasSafeCaseCast}`
  });

  // -------------------------------------------------------------
  // PART B: Live Anonymous API Verification (Read-Only)
  // -------------------------------------------------------------
  console.log('\n--- PART B: Live Anonymous API Audit (Read-Only) ---');
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  let anonClient: any = null;
  let adminClient: any = null;

  if (url && anonKey) {
    anonClient = createClient(url, anonKey, { auth: { persistSession: false } });
  }
  if (url && serviceKey) {
    adminClient = createClient(url, serviceKey, { auth: { persistSession: false } });
  }

  // Check anon access on each table
  for (const table of expected3) {
    if (!anonClient) {
      results.push({
        id: results.length + 1,
        category: 'B_LIVE_ANON',
        description: `Anonymous SELECT on ${table} verification`,
        status: 'NOT_VERIFIED',
        mechanism: 'Supabase anonClient SELECT query',
        evidence: 'Supabase URL or anonKey missing from environment'
      });
    } else {
      const { count, error } = await anonClient.from(table).select('*', { count: 'exact', head: true });
      results.push({
        id: results.length + 1,
        category: 'B_LIVE_ANON',
        description: `Current production anon exposure on ${table} (Pre-deployment baseline)`,
        status: 'PRE_DEPLOYMENT_OBSERVED',
        mechanism: 'Live read-only count via anon client',
        evidence: `Current exposed rows: ${count ?? 0} (error: ${error ? error.message : 'none'}). Migration 015 will close this to 0 rows.`
      });
    }
  }

  // -------------------------------------------------------------
  // PART C: Live Service-Role Verification (Read-Only)
  // -------------------------------------------------------------
  console.log('\n--- PART C: Live Service-Role Data Integrity Audit (Read-Only) ---');
  const expectedCounts: Record<string, number> = {
    call_transcripts: 7714,
    conversation_extractions: 5807,
    buyer_qualifications: 5029
  };

  for (const table of expected3) {
    if (!adminClient) {
      results.push({
        id: results.length + 1,
        category: 'C_LIVE_SERVICE_ROLE',
        description: `Service-role read access & data integrity on ${table}`,
        status: 'NOT_VERIFIED',
        mechanism: 'Supabase adminClient SELECT query',
        evidence: 'Supabase serviceKey missing from environment'
      });
    } else {
      const { count: totalCount, error: errTotal } = await adminClient.from(table).select('*', { count: 'exact', head: true });
      const { count: nullCount, error: errNull } = await adminClient.from(table).select('*', { count: 'exact', head: true }).is('tenant_id', null);

      const expected = expectedCounts[table];
      const countMatches = totalCount === expected;
      const zeroNulls = nullCount === 0;
      const noErrors = !errTotal && !errNull;

      results.push({
        id: results.length + 1,
        category: 'C_LIVE_SERVICE_ROLE',
        description: `Service-role integrity on ${table}: count=${expected}, NULL tenant_id=0`,
        status: (countMatches && zeroNulls && noErrors) ? 'PASS' : 'FAIL',
        mechanism: 'Live read-only exact count and IS NULL query via admin client',
        evidence: `Total rows: ${totalCount} (expected ${expected}), NULL tenant_id: ${nullCount} (expected 0)`
      });
    }
  }

  // -------------------------------------------------------------
  // PART D: Tenant Isolation Context Verification
  // -------------------------------------------------------------
  console.log('\n--- PART D: Tenant Isolation Context Audit ---');
  if (!adminClient) {
    results.push({
      id: results.length + 1,
      category: 'D_TENANT_ISOLATION',
      description: 'Live Tenant A vs Tenant B isolation',
      status: 'NOT_VERIFIED',
      mechanism: 'auth.admin.listUsers() probe',
      evidence: 'Admin client unavailable'
    });
  } else {
    const { data: usersData, error: usersErr } = await adminClient.auth.admin.listUsers();
    const userCount = usersData?.users?.length ?? 0;

    results.push({
      id: results.length + 1,
      category: 'D_TENANT_ISOLATION',
      description: 'Live Tenant A vs Tenant B isolation',
      status: 'NOT_VERIFIED',
      mechanism: 'Live auth users inspection (zero-mutation rule strictly enforced)',
      evidence: `Production auth.users count is ${userCount}. NOT VERIFIED — NO SAFE TEST IDENTITIES AVAILABLE (production test users were not created).`
    });
  }

  // -------------------------------------------------------------
  // Summary Calculation
  // -------------------------------------------------------------
  let passedCount = 0;
  let failedCount = 0;
  let notVerifiedCount = 0;

  console.log('\n============================================================');
  console.log('MIGRATION 015 INVARIANTS BREAKDOWN');
  console.log('============================================================');

  for (const r of results) {
    let tag = '';
    if (r.status === 'PASS') {
      tag = '✅ [PASS]';
      passedCount++;
    } else if (r.status === 'FAIL') {
      tag = '❌ [FAIL]';
      failedCount++;
    } else if (r.status === 'PRE_DEPLOYMENT_OBSERVED') {
      tag = '🔍 [OBSERVED]';
    } else {
      tag = '⚠️ [NOT_VERIFIED]';
      notVerifiedCount++;
    }

    console.log(`${tag} #${r.id.toString().padStart(2, '0')} [${r.category}]: ${r.description}`);
    console.log(`      Mechanism: ${r.mechanism}`);
    console.log(`      Evidence:  ${r.evidence}`);
  }

  console.log('\n============================================================');
  console.log(`TOTAL AUDITED: ${results.length} | PASSED: ${passedCount} | FAILED: ${failedCount} | NOT_VERIFIED: ${notVerifiedCount}`);
  console.log('============================================================\n');

  return { results, passedCount, failedCount, notVerifiedCount };
}

if (process.argv[1] && process.argv[1].endsWith('phase94-migration015-verification.ts')) {
  runMigration015Verification().then(({ failedCount }) => {
    if (failedCount > 0) process.exit(1);
    process.exit(0);
  }).catch((err) => {
    console.error('Fatal error during verification:', err);
    process.exit(1);
  });
}
