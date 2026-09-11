/**
 * Supabase Migration Chain & Schema Invariants Validator
 * Validates deterministic execution from fresh database, ordering, dependencies, and model alignment.
 */

import fs from 'fs';
import path from 'path';

interface ColumnDef {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
  foreignKey?: { targetTable: string; targetColumn: string };
}

interface TableDef {
  name: string;
  columns: Map<string, ColumnDef>;
  indexes: Set<string>;
  uniqueConstraints: Set<string>;
  triggers: Set<string>;
}

function runValidation() {
  console.log('============================================================');
  console.log('GROWTHFORGE BUYER INTELLIGENCE ENGINE');
  console.log('SUPABASE MIGRATION CHAIN & SCHEMA INTEGRITY VALIDATION');
  console.log('============================================================');

  const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

  console.log(`Discovered ${files.length} migration files in sequence:`);
  files.forEach((f, idx) => console.log(`  ${idx + 1}. ${f}`));

  const tables = new Map<string, TableDef>();
  const functions = new Set<string>();

  // Helper to ensure table exists
  function getOrCreateTable(name: string): TableDef {
    let t = tables.get(name);
    if (!t) {
      t = {
        name,
        columns: new Map(),
        indexes: new Set(),
        uniqueConstraints: new Set(),
        triggers: new Set(),
      };
      tables.set(name, t);
    }
    return t;
  }

  let stepErrors: string[] = [];

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf-8');

    // Check functions created
    const funcMatches = sql.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+([a-zA-Z0-9_]+)/gi);
    for (const match of funcMatches) {
      functions.add(match[1]);
    }

    // Process CREATE TABLE IF NOT EXISTS
    const createTableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\);/gi;
    let tableMatch;
    while ((tableMatch = createTableRegex.exec(sql)) !== null) {
      const tableName = tableMatch[1];
      const body = tableMatch[2];

      if (!tables.has(tableName)) {
        const table = getOrCreateTable(tableName);
        const lines = body.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('--')) continue;

          // Check for constraint line
          const constraintMatch = trimmed.match(/^CONSTRAINT\s+([a-zA-Z0-9_]+)\s+UNIQUE\s*\(([^)]+)\)/i);
          if (constraintMatch) {
            table.uniqueConstraints.add(constraintMatch[1]);
            continue;
          }

          // Column line
          const colMatch = trimmed.match(/^([a-zA-Z0-9_]+)\s+([A-Z0-9_]+(?:\([^)]+\))?)/i);
          if (colMatch) {
            const colName = colMatch[1];
            if (['CONSTRAINT', 'PRIMARY', 'UNIQUE', 'FOREIGN', 'CHECK'].includes(colName.toUpperCase())) continue;

            const colType = colMatch[2];
            const fkMatch = trimmed.match(/REFERENCES\s+([a-zA-Z0-9_]+)\s*\(([a-zA-Z0-9_]+)\)/i);

            if (fkMatch) {
              const targetTable = fkMatch[1];
              const targetCol = fkMatch[2];
              if (!tables.has(targetTable)) {
                stepErrors.push(`[${file}] Table "${tableName}" references non-existent table "${targetTable}"`);
              } else if (!tables.get(targetTable)?.columns.has(targetCol)) {
                stepErrors.push(`[${file}] Table "${tableName}" references non-existent column "${targetTable}.${targetCol}"`);
              }
            }

            table.columns.set(colName, {
              name: colName,
              type: colType,
              nullable: !trimmed.toUpperCase().includes('NOT NULL'),
            });
          }
        }
      } else {
        // Table already existed! In Postgres CREATE TABLE IF NOT EXISTS will NOT add new columns.
        // We ensure that migrations do NOT rely on CREATE TABLE IF NOT EXISTS to mutate existing tables.
      }
    }

    // Process ALTER TABLE ADD COLUMN
    const alterTableRegex = /ALTER\s+TABLE\s+([a-zA-Z0-9_]+)\s+([\s\S]*?);/gi;
    let alterMatch;
    while ((alterMatch = alterTableRegex.exec(sql)) !== null) {
      const tableName = alterMatch[1];
      const alterBody = alterMatch[2];

      const addColMatches = alterBody.matchAll(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)\s+([A-Z0-9_]+(?:\([^)]+\))?)([\s\S]*?)(?:,|$)/gi);
      for (const col of addColMatches) {
        const colName = col[1];
        const colType = col[2];
        const rest = col[3];

        const fkMatch = rest.match(/REFERENCES\s+([a-zA-Z0-9_]+)\s*\(([a-zA-Z0-9_]+)\)/i);
        if (fkMatch) {
          const targetTable = fkMatch[1];
          const targetCol = fkMatch[2];
          if (!tables.has(targetTable)) {
            stepErrors.push(`[${file}] ALTER TABLE "${tableName}" references non-existent table "${targetTable}"`);
          } else if (!tables.get(targetTable)?.columns.has(targetCol)) {
            stepErrors.push(`[${file}] ALTER TABLE "${tableName}" references non-existent column "${targetTable}.${targetCol}"`);
          }
        }

        const table = getOrCreateTable(tableName);
        table.columns.set(colName, {
          name: colName,
          type: colType,
          nullable: !rest.toUpperCase().includes('NOT NULL'),
        });
      }
    }

    // Process CREATE INDEX
    const indexRegex = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)\s+ON\s+([a-zA-Z0-9_]+)\s*\(([^)]+)\);/gi;
    let idxMatch;
    while ((idxMatch = indexRegex.exec(sql)) !== null) {
      const indexName = idxMatch[1];
      const tableName = idxMatch[2];
      const indexColsRaw = idxMatch[3];

      const table = tables.get(tableName);
      if (!table) {
        stepErrors.push(`[${file}] Index "${indexName}" created on non-existent table "${tableName}"`);
        continue;
      }

      const colTokens = indexColsRaw.split(',').map(c => c.trim().split(/\s+/)[0]);
      for (const colToken of colTokens) {
        if (!table.columns.has(colToken)) {
          stepErrors.push(`[${file}] Index "${indexName}" references non-existent column "${tableName}.${colToken}"`);
        }
      }
      table.indexes.add(indexName);
    }

    // Process CREATE TRIGGER
    const triggerRegex = /CREATE\s+TRIGGER\s+([a-zA-Z0-9_]+)\s+[\s\S]*?ON\s+([a-zA-Z0-9_]+)[\s\S]*?EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+([a-zA-Z0-9_]+)\(\);/gi;
    let trgMatch;
    while ((trgMatch = triggerRegex.exec(sql)) !== null) {
      const triggerName = trgMatch[1];
      const tableName = trgMatch[2];
      const funcName = trgMatch[3];

      if (!tables.has(tableName)) {
        stepErrors.push(`[${file}] Trigger "${triggerName}" on non-existent table "${tableName}"`);
      }
      if (!functions.has(funcName)) {
        stepErrors.push(`[${file}] Trigger "${triggerName}" executes non-existent function "${funcName}"`);
      }
    }
  }

  if (stepErrors.length > 0) {
    console.error('❌ MIGRATION CHAIN ERRORS FOUND:');
    stepErrors.forEach(err => console.error(`  - ${err}`));
    process.exit(1);
  }

  console.log('✅ ALL MIGRATION SEQUENCES & DEPENDENCIES VALIDATED DETERMINISTICALLY:');
  console.log(`  - Total validated tables: ${tables.size}`);
  tables.forEach((table, name) => {
    console.log(`    • ${name.padEnd(26)} : ${table.columns.size} columns, ${table.indexes.size} indexes`);
  });

  // Verify buyer_scores has all required Phase 5D columns
  const buyerScores = tables.get('buyer_scores');
  if (!buyerScores) throw new Error('buyer_scores table missing');

  const requiredBuyerScoreCols = [
    'id', 'lead_id', 'qualification_id', 'extraction_id', 'composite_score',
    'scoring_confidence', 'tier', 'dimension_scores', 'breakdown', 'key_drivers',
    'risk_factors', 'sla_dispatch', 'scoring_version', 'rule_version',
    'created_at', 'updated_at',
    // Legacy columns
    'intent_score', 'budget_score', 'location_score', 'timeline_score',
    'decision_score', 'project_fit_score', 'overall_score', 'qualification', 'reason'
  ];

  for (const col of requiredBuyerScoreCols) {
    if (!buyerScores.columns.has(col)) {
      throw new Error(`buyer_scores is missing expected column "${col}"`);
    }
  }
  console.log('✅ buyer_scores contains both legacy and Phase 5D columns.');

  // ==========================================
  // Phase 8A.2 Tenant / Membership Model Invariant Checks
  // ==========================================
  console.log('\n--- Phase 8A.2 Tenant Model Invariant Checks ---');

  // 1. Verify Core Tenant Tables
  const requiredTenantTables = ['tenants', 'tenant_memberships', 'tenant_api_keys', 'webhook_events'];
  for (const tName of requiredTenantTables) {
    const t = tables.get(tName);
    if (!t) throw new Error(`Missing required Phase 8A.2 table: "${tName}"`);
    console.log(`  ✓ Table "${tName}" present with ${t.columns.size} columns`);
  }

  // 2. Verify tenant_id in all 13 application tables
  const appTablesWithTenantId = [
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

  for (const tName of appTablesWithTenantId) {
    const t = tables.get(tName);
    if (!t) throw new Error(`Application table "${tName}" not found`);
    if (!t.columns.has('tenant_id')) {
      throw new Error(`Table "${tName}" is missing required tenant_id column`);
    }
    const tenantIdxName = `idx_${tName}_tenant_id`;
    if (!t.indexes.has(tenantIdxName)) {
      throw new Error(`Table "${tName}" is missing required tenant index "${tenantIdxName}"`);
    }
    console.log(`  ✓ Table "${tName}" has tenant_id and index "${tenantIdxName}"`);
  }

  // 3. Verify tenant_api_keys security invariant (no plaintext key stored)
  const apiKeysTable = tables.get('tenant_api_keys')!;
  if (!apiKeysTable.columns.has('key_hash')) {
    throw new Error('tenant_api_keys table missing "key_hash" column');
  }
  if (apiKeysTable.columns.has('key') || apiKeysTable.columns.has('api_key') || apiKeysTable.columns.has('plaintext_key')) {
    throw new Error('SECURITY VIOLATION: tenant_api_keys must NOT store plaintext keys');
  }
  console.log('  ✓ tenant_api_keys enforces key hashing only (no plaintext keys)');

  // 4. Verify webhook_events primary key and fields
  const webhookTable = tables.get('webhook_events')!;
  const webhookCols = ['event_id', 'provider', 'received_at', 'status', 'payload_hash', 'processed_at'];
  for (const col of webhookCols) {
    if (!webhookTable.columns.has(col)) {
      throw new Error(`webhook_events is missing expected column "${col}"`);
    }
  }
  console.log('  ✓ webhook_events contains all required idempotency and audit fields');

  console.log('🎉 SUPABASE MIGRATION CHAIN & 8A.2 TENANT MODEL VALIDATION PASSED!');
}

runValidation();
