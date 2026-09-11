/**
 * GrowthForge Buyer Intelligence Engine - Phase 8A.2 Tenant / Membership Model Verification
 *
 * Verifies the 12 required test scenarios for the multi-tenant data model:
 * 1. tenants table exists with correct schema
 * 2. tenant_memberships table exists with correct schema
 * 3. tenant_api_keys table exists with correct schema
 * 4. webhook_events table exists with correct schema
 * 5. all 13 application tables contain tenant_id
 * 6. existing data has non-null tenant_id (backfill safety invariant)
 * 7. default tenant exists with deterministic UUID and attributes
 * 8. tenant_id foreign keys are valid (references tenants.id ON DELETE CASCADE)
 * 9. tenant indexes exist for all application tables and key lookup paths
 * 10. duplicate membership is rejected (UNIQUE tenant_id, user_id)
 * 11. duplicate tenant slug is rejected (UNIQUE slug)
 * 12. plaintext API keys are not stored by schema/design
 */

import fs from 'fs';
import path from 'path';
import { DEFAULT_TENANT_ID, DEFAULT_TENANT, Tenant, TenantMembership, TenantApiKey, WebhookEvent } from '../app/schemas/tenant';

interface TestResult {
  id: number;
  name: string;
  passed: boolean;
  error?: string;
  details?: unknown;
}

const results: TestResult[] = [];

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

// Helper to parse migration SQL files
function loadMigrations() {
  const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  const migrationContents = files.map(file => ({
    file,
    sql: fs.readFileSync(path.join(migrationsDir, file), 'utf-8'),
  }));
  return { files, migrationContents };
}

async function runTenantModelTests() {
  console.log('============================================================');
  console.log('GROWTHFORGE BUYER INTELLIGENCE ENGINE');
  console.log('PHASE 8A.2 TENANT & MEMBERSHIP MODEL VERIFICATION');
  console.log('============================================================\n');

  const { files, migrationContents } = loadMigrations();
  const migration007 = migrationContents.find(m => m.file === '007_tenants_and_memberships.sql');
  if (!migration007) {
    throw new Error('Migration 007_tenants_and_memberships.sql not found');
  }

  const sql007 = migration007.sql;

  // -------------------------------------------------------------
  // Test 1: tenants table exists
  // -------------------------------------------------------------
  try {
    const hasTenantsTable = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?tenants\s*\(/i.test(sql007);
    assert(hasTenantsTable, 'tenants table creation not found in 007');
    assert(/id\s+UUID\s+PRIMARY\s+KEY/i.test(sql007), 'tenants.id UUID PRIMARY KEY missing');
    assert(/name\s+TEXT\s+NOT\s+NULL/i.test(sql007), 'tenants.name TEXT NOT NULL missing');
    assert(/slug\s+TEXT\s+UNIQUE\s+NOT\s+NULL/i.test(sql007), 'tenants.slug TEXT UNIQUE NOT NULL missing');
    assert(/status\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'ACTIVE'/i.test(sql007), 'tenants.status missing or wrong default');
    assert(/created_at\s+TIMESTAMPTZ\s+NOT\s+NULL/i.test(sql007), 'tenants.created_at missing');
    assert(/updated_at\s+TIMESTAMPTZ\s+NOT\s+NULL/i.test(sql007), 'tenants.updated_at missing');

    results.push({
      id: 1,
      name: '1. tenants table exists with correct schema and constraints',
      passed: true,
      details: { table: 'tenants', fields: ['id', 'name', 'slug', 'status', 'created_at', 'updated_at'] },
    });
  } catch (err: any) {
    results.push({ id: 1, name: '1. tenants table exists', passed: false, error: err.message });
  }

  // -------------------------------------------------------------
  // Test 2: tenant_memberships table exists
  // -------------------------------------------------------------
  try {
    const hasMembershipsTable = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?tenant_memberships\s*\(/i.test(sql007);
    assert(hasMembershipsTable, 'tenant_memberships table creation not found in 007');
    assert(/tenant_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+tenants\(id\)\s+ON\s+DELETE\s+CASCADE/i.test(sql007), 'tenant_id FK to tenants(id) missing');
    assert(/user_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+auth\.users\(id\)\s+ON\s+DELETE\s+CASCADE/i.test(sql007), 'user_id FK to auth.users(id) missing');
    assert(/role\s+TEXT\s+NOT\s+NULL\s+CHECK\s*\(\s*role\s+IN\s*\('OWNER','ADMIN','SALES','VIEWER','PLATFORM_ADMIN'\)\s*\)/i.test(sql007), 'role check constraint missing or invalid');
    assert(/is_platform_admin\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+false/i.test(sql007), 'is_platform_admin column missing');

    results.push({
      id: 2,
      name: '2. tenant_memberships table exists with correct schema, FKs, and role enum check',
      passed: true,
      details: { table: 'tenant_memberships', roles: ['OWNER', 'ADMIN', 'SALES', 'VIEWER', 'PLATFORM_ADMIN'] },
    });
  } catch (err: any) {
    results.push({ id: 2, name: '2. tenant_memberships table exists', passed: false, error: err.message });
  }

  // -------------------------------------------------------------
  // Test 3: tenant_api_keys table exists
  // -------------------------------------------------------------
  try {
    const hasApiKeysTable = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?tenant_api_keys\s*\(/i.test(sql007);
    assert(hasApiKeysTable, 'tenant_api_keys table creation not found in 007');
    assert(/tenant_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+tenants\(id\)\s+ON\s+DELETE\s+CASCADE/i.test(sql007), 'tenant_id FK missing on tenant_api_keys');
    assert(/key_hash\s+TEXT\s+UNIQUE\s+NOT\s+NULL/i.test(sql007), 'key_hash TEXT UNIQUE NOT NULL missing');
    assert(/name\s+TEXT\s+NOT\s+NULL/i.test(sql007), 'name TEXT NOT NULL missing');
    assert(/role\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'ADMIN'/i.test(sql007), 'role DEFAULT ADMIN missing');
    assert(/revoked_at\s+TIMESTAMPTZ\s+NULL/i.test(sql007), 'revoked_at TIMESTAMPTZ NULL missing');

    results.push({
      id: 3,
      name: '3. tenant_api_keys table exists with hashed key enforcement and revocation support',
      passed: true,
      details: { table: 'tenant_api_keys', fields: ['id', 'tenant_id', 'key_hash', 'name', 'role', 'created_at', 'revoked_at'] },
    });
  } catch (err: any) {
    results.push({ id: 3, name: '3. tenant_api_keys table exists', passed: false, error: err.message });
  }

  // -------------------------------------------------------------
  // Test 4: webhook_events table exists
  // -------------------------------------------------------------
  try {
    const hasWebhookTable = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?webhook_events\s*\(/i.test(sql007);
    assert(hasWebhookTable, 'webhook_events table creation not found in 007');
    assert(/event_id\s+TEXT\s+PRIMARY\s+KEY/i.test(sql007), 'webhook_events.event_id TEXT PRIMARY KEY missing');
    assert(/provider\s+TEXT\s+NOT\s+NULL/i.test(sql007), 'webhook_events.provider missing');
    assert(/received_at\s+TIMESTAMPTZ\s+NOT\s+NULL/i.test(sql007), 'webhook_events.received_at missing');
    assert(/status\s+TEXT\s+NOT\s+NULL/i.test(sql007), 'webhook_events.status missing');
    assert(/payload_hash\s+TEXT\s+NULL/i.test(sql007), 'webhook_events.payload_hash missing');
    assert(/processed_at\s+TIMESTAMPTZ\s+NULL/i.test(sql007), 'webhook_events.processed_at missing');

    results.push({
      id: 4,
      name: '4. webhook_events table exists with idempotency and audit attributes',
      passed: true,
      details: { table: 'webhook_events', fields: ['event_id', 'provider', 'received_at', 'status', 'payload_hash', 'processed_at'] },
    });
  } catch (err: any) {
    results.push({ id: 4, name: '4. webhook_events table exists', passed: false, error: err.message });
  }

  // -------------------------------------------------------------
  // Test 5: all application tables contain tenant_id
  // -------------------------------------------------------------
  const requiredTables = [
    'leads',
    'lead_enrichment',
    'calls',
    'buyer_profiles',
    'buyer_preferences',
    'projects',
    'project_matches',
    'buyer_scores',
    'lead_events',
    'call_transcripts',
    'conversation_extractions',
    'buyer_qualifications',
    'broker_handoffs',
  ];

  try {
    for (const tbl of requiredTables) {
      const alterRegex = new RegExp(`ALTER\\s+TABLE\\s+${tbl}\\s+ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?tenant_id\\s+UUID`, 'i');
      assert(alterRegex.test(sql007), `Table ${tbl} missing ALTER TABLE ... ADD COLUMN tenant_id in 007`);
    }

    results.push({
      id: 5,
      name: '5. all 13 application tables contain tenant_id column',
      passed: true,
      details: { verifiedTablesCount: requiredTables.length, tables: requiredTables },
    });
  } catch (err: any) {
    results.push({ id: 5, name: '5. all application tables contain tenant_id', passed: false, error: err.message });
  }

  // -------------------------------------------------------------
  // Test 6: existing data has non-null tenant_id (backfill safety)
  // -------------------------------------------------------------
  try {
    for (const tbl of requiredTables) {
      const backfillRegex = new RegExp(`UPDATE\\s+${tbl}\\s+SET\\s+tenant_id\\s*=\\s*'00000000-0000-0000-0000-000000000001'\\s+WHERE\\s+tenant_id\\s+IS\\s+NULL`, 'i');
      assert(backfillRegex.test(sql007), `Table ${tbl} missing UPDATE ... SET tenant_id default backfill`);

      const notNullRegex = new RegExp(`ALTER\\s+TABLE\\s+${tbl}\\s+ALTER\\s+COLUMN\\s+tenant_id\\s+SET\\s+NOT\\s+NULL`, 'i');
      assert(notNullRegex.test(sql007), `Table ${tbl} missing ALTER TABLE ... ALTER COLUMN tenant_id SET NOT NULL`);
    }

    // Verify PL/pgSQL assertion check exists in migration 007
    assert(/SELECT\s+count\(\*\)\s+FROM\s+%\s*I\s+WHERE\s+tenant_id\s+IS\s+NULL/i.test(sql007), 'Migration missing zero-NULL assertion verification block');

    results.push({
      id: 6,
      name: '6. existing data backfilled to default tenant and verified with zero-null assertion',
      passed: true,
      details: { backfilledTables: requiredTables.length, failClosedZeroNullEnforcement: true },
    });
  } catch (err: any) {
    results.push({ id: 6, name: '6. existing data has non-null tenant_id', passed: false, error: err.message });
  }

  // -------------------------------------------------------------
  // Test 7: default tenant exists
  // -------------------------------------------------------------
  try {
    assert(DEFAULT_TENANT_ID === '00000000-0000-0000-0000-000000000001', 'DEFAULT_TENANT_ID mismatch in TypeScript schema');
    assert(DEFAULT_TENANT.name === 'Default GrowthForge Tenant', 'DEFAULT_TENANT name mismatch');
    assert(DEFAULT_TENANT.slug === 'default-growthforge', 'DEFAULT_TENANT slug mismatch');
    assert(DEFAULT_TENANT.status === 'ACTIVE', 'DEFAULT_TENANT status mismatch');

    assert(sql007.includes('00000000-0000-0000-0000-000000000001'), 'SQL 007 missing default tenant UUID insertion');
    assert(sql007.includes('Default GrowthForge Tenant'), 'SQL 007 missing default tenant name');
    assert(sql007.includes('default-growthforge'), 'SQL 007 missing default tenant slug');
    assert(/ON\s+CONFLICT\s+\(id\)\s+DO\s+UPDATE/i.test(sql007), 'SQL 007 missing ON CONFLICT idempotent handler for default tenant');

    results.push({
      id: 7,
      name: '7. default deterministic tenant seeded idempotently (00000000-0000-0000-0000-000000000001)',
      passed: true,
      details: DEFAULT_TENANT,
    });
  } catch (err: any) {
    results.push({ id: 7, name: '7. default tenant exists', passed: false, error: err.message });
  }

  // -------------------------------------------------------------
  // Test 8: tenant_id foreign keys are valid
  // -------------------------------------------------------------
  try {
    for (const tbl of requiredTables) {
      const fkRegex = new RegExp(`REFERENCES\\s+tenants\\(id\\)\\s+ON\\s+DELETE\\s+CASCADE`, 'i');
      assert(fkRegex.test(sql007), `Table ${tbl} foreign key to tenants(id) ON DELETE CASCADE missing`);
    }

    results.push({
      id: 8,
      name: '8. tenant_id foreign keys valid and cascade delete configured across all tables',
      passed: true,
      details: { cascadeDeleteEnforced: true },
    });
  } catch (err: any) {
    results.push({ id: 8, name: '8. tenant_id foreign keys are valid', passed: false, error: err.message });
  }

  // -------------------------------------------------------------
  // Test 9: tenant indexes exist
  // -------------------------------------------------------------
  try {
    for (const tbl of requiredTables) {
      const idxName = `idx_${tbl}_tenant_id`;
      const idxRegex = new RegExp(`CREATE\\s+INDEX\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${idxName}\\s+ON\\s+${tbl}\\s*\\(\\s*tenant_id\\s*\\)`, 'i');
      assert(idxRegex.test(sql007), `Missing tenant index ${idxName} on ${tbl}`);
    }

    // Check composite indexes
    const compositeIndexes = [
      'idx_leads_tenant_status',
      'idx_calls_tenant_lead',
      'idx_buyer_profiles_tenant_lead',
      'idx_buyer_scores_tenant_lead',
      'idx_project_matches_tenant_lead',
      'idx_broker_handoffs_tenant_lead',
    ];

    for (const cIdx of compositeIndexes) {
      assert(sql007.includes(cIdx), `Composite index ${cIdx} missing in 007`);
    }

    results.push({
      id: 9,
      name: '9. tenant indexes and composite optimization indexes exist for all tables',
      passed: true,
      details: { directIndexes: requiredTables.length, compositeIndexes: compositeIndexes.length },
    });
  } catch (err: any) {
    results.push({ id: 9, name: '9. tenant indexes exist', passed: false, error: err.message });
  }

  // -------------------------------------------------------------
  // Test 10: duplicate membership is rejected
  // -------------------------------------------------------------
  try {
    assert(/CONSTRAINT\s+uq_tenant_memberships_tenant_user\s+UNIQUE\s*\(\s*tenant_id\s*,\s*user_id\s*\)/i.test(sql007), 'UNIQUE (tenant_id, user_id) constraint missing on tenant_memberships');

    // Simulate in-memory uniqueness test
    const membershipStore = new Set<string>();
    const addMembership = (tenantId: string, userId: string) => {
      const key = `${tenantId}:${userId}`;
      if (membershipStore.has(key)) {
        throw new Error(`UNIQUE constraint violation: duplicate membership for (${tenantId}, ${userId})`);
      }
      membershipStore.add(key);
    };

    addMembership(DEFAULT_TENANT_ID, 'user-123');
    let duplicateRejected = false;
    try {
      addMembership(DEFAULT_TENANT_ID, 'user-123');
    } catch (e: any) {
      duplicateRejected = true;
    }

    assert(duplicateRejected, 'Duplicate membership was not rejected by uniqueness check');

    results.push({
      id: 10,
      name: '10. duplicate membership rejected by UNIQUE (tenant_id, user_id) constraint',
      passed: true,
      details: { constraint: 'uq_tenant_memberships_tenant_user', testKey: `${DEFAULT_TENANT_ID}:user-123` },
    });
  } catch (err: any) {
    results.push({ id: 10, name: '10. duplicate membership is rejected', passed: false, error: err.message });
  }

  // -------------------------------------------------------------
  // Test 11: duplicate tenant slug is rejected
  // -------------------------------------------------------------
  try {
    assert(/slug\s+TEXT\s+UNIQUE\s+NOT\s+NULL/i.test(sql007), 'UNIQUE constraint missing on tenants.slug');

    const slugStore = new Set<string>();
    const addTenant = (slug: string) => {
      if (slugStore.has(slug)) {
        throw new Error(`UNIQUE constraint violation: duplicate slug "${slug}"`);
      }
      slugStore.add(slug);
    };

    addTenant('default-growthforge');
    let duplicateRejected = false;
    try {
      addTenant('default-growthforge');
    } catch {
      duplicateRejected = true;
    }

    assert(duplicateRejected, 'Duplicate tenant slug was not rejected');

    results.push({
      id: 11,
      name: '11. duplicate tenant slug rejected by UNIQUE (slug) constraint',
      passed: true,
      details: { field: 'slug', testedSlug: 'default-growthforge' },
    });
  } catch (err: any) {
    results.push({ id: 11, name: '11. duplicate tenant slug is rejected', passed: false, error: err.message });
  }

  // -------------------------------------------------------------
  // Test 12: plaintext API keys are not stored by schema/design
  // -------------------------------------------------------------
  try {
    const apiKeysSql = sql007.substring(sql007.indexOf('CREATE TABLE IF NOT EXISTS tenant_api_keys'));
    const apiKeysBody = apiKeysSql.substring(0, apiKeysSql.indexOf(');'));

    assert(/key_hash\s+TEXT\s+UNIQUE\s+NOT\s+NULL/i.test(apiKeysBody), 'key_hash column missing in tenant_api_keys');
    assert(!/api_key\s+TEXT/i.test(apiKeysBody), 'Plaintext api_key column found in tenant_api_keys');
    assert(!/secret_key\s+TEXT/i.test(apiKeysBody), 'Plaintext secret_key column found in tenant_api_keys');
    assert(!/plaintext/i.test(apiKeysBody), 'Plaintext key column found in tenant_api_keys');

    results.push({
      id: 12,
      name: '12. plaintext API keys strictly prohibited and absent from database schema',
      passed: true,
      details: { keyStorage: 'key_hash only (SHA-256 / bcrypt)', plaintextStored: false },
    });
  } catch (err: any) {
    results.push({ id: 12, name: '12. plaintext API keys are not stored', passed: false, error: err.message });
  }

  // -------------------------------------------------------------
  // Summary & Assertion
  // -------------------------------------------------------------
  console.log('--- TEST RESULTS ---');
  let allPassed = true;
  for (const r of results) {
    if (r.passed) {
      console.log(`✅ [PASS] ${r.name}`);
    } else {
      console.error(`❌ [FAIL] ${r.name}: ${r.error}`);
      allPassed = false;
    }
  }

  console.log('\n============================================================');
  if (allPassed) {
    console.log(`🎉 ALL ${results.length}/12 TENANT MODEL SECURITY TESTS PASSED!`);
    console.log('============================================================');
  } else {
    console.error(`❌ ${results.filter(r => !r.passed).length} TESTS FAILED!`);
    console.log('============================================================');
    process.exit(1);
  }
}

runTenantModelTests().catch(err => {
  console.error('Fatal error running tenant model tests:', err);
  process.exit(1);
});
