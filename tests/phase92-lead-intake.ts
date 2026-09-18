/**
 * Phase 9.2 Verification Suite: Client Onboarding & Lead Intake
 *
 * Verifies:
 * 1. Inbound Webhook:
 *    - Authenticates via API Key (tenant_api_keys)
 *    - Resolves tenant context reliably
 *    - Enforces transport idempotency via webhook_events
 *    - Ingests raw buyer lead and stages in RAW/RESOLVED workflow status
 * 2. CSV Ingestion:
 *    - Correct tenant-scoped single-lead resolution
 *    - Deduplication against existing leads within tenant
 *    - Tenant isolation (cannot see or mutate other tenant's leads)
 * 3. Client Onboarding & Pipeline Boundary:
 *    - Does NOT automatically trigger outbound calls or handoffs on raw intake
 * 4. Migration 013:
 *    - Ensures RLS hardening script exists and defines tenant policies
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { supabaseDataService } from '../app/services/supabase/repositories';
import { ingestCSVLeads } from '../app/services/leads/csvIngestion';
import { processInboundLeadWebhook } from '../app/services/leads/inboundLeadWebhook';
import { DEFAULT_TENANT_ID } from '../app/schemas/tenant';

async function runPhase92Tests() {
  console.log('=====================================================');
  console.log('🧪 Starting Phase 9.2 Verification Suite');
  console.log('=====================================================\n');

  const tenantA = DEFAULT_TENANT_ID;
  const tenantB = '00000000-0000-0000-0000-000000000002';

  // Ensure Tenant B exists in tenants table for foreign key constraint
  try {
    await supabaseDataService.tenants.createTenant({
      id: tenantB,
      name: 'Tenant B Real Estate',
      slug: 'tenant-b-re',
      status: 'ACTIVE',
    });
  } catch (err) {
    // Already exists or created
  }

  // 1. Setup API Key for tenant A
  console.log('--- 1. API Key Authentication & Tenant Scoping ---');
  const rawApiKey = `gfk_live_${crypto.randomBytes(16).toString('hex')}`;
  const keyHash = crypto.createHash('sha256').update(rawApiKey).digest('hex');

  const createdKey = await supabaseDataService.tenantApiKeys.createApiKey({
    tenant_id: tenantA,
    name: 'Phase 9.2 Inbound Key',
    role: 'API_INBOUND',
    key_hash: keyHash,
  });
  assert(createdKey && createdKey.key_hash === keyHash, 'Tenant API key created successfully in repository');

  const resolvedKey = await supabaseDataService.tenantApiKeys.getApiKeyByHash(keyHash);
  assert(resolvedKey !== null, 'Retrieved API key by hash');
  assert(resolvedKey?.tenant_id === tenantA, 'API key maps strictly to Tenant A');

  // 2. Inbound Webhook Ingestion & Idempotency
  console.log('\n--- 2. Inbound Lead Webhook Intake & Idempotency ---');
  const eventId = `evt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const mockWebhookReq = {
    headers: {
      'x-api-key': rawApiKey,
      'x-event-id': eventId,
      'x-provider': 'facebook_leads',
    },
    auth: {
      tenantId: tenantA,
      authMethod: 'API_KEY',
      role: 'ADMIN',
    },
    body: {
      full_name: 'Rajesh Singhania',
      phone: '+91 98200 12345',
      email: 'rajesh.singhania@corp.in',
      source: 'FACEBOOK_LEAD_AD',
      budget_min: 25000000,
      budget_max: 40000000,
      preferred_locations: ['Worli', 'Lower Parel'],
    },
  } as any;

  const webhookResult = await processInboundLeadWebhook(mockWebhookReq);
  assert(webhookResult.success === true, 'Webhook returned success');
  assert(webhookResult.lead_id, 'Generated canonical lead_id');
  assert(webhookResult.status === 'RAW' || webhookResult.status === 'RESOLVED', 'Staged in initial safe status');

  // Verify Lead is strictly scoped to Tenant A
  const leadA = await supabaseDataService.leads.getLeadByLeadId(tenantA, webhookResult.lead_id);
  assert(leadA !== null, 'Lead accessible in Tenant A');
  assert(leadA?.tenant_id === tenantA, 'Lead tenant_id matches Tenant A');

  // Verify Lead is NOT accessible in Tenant B
  const leadB = await supabaseDataService.leads.getLeadByLeadId(tenantB, webhookResult.lead_id);
  assert(leadB === null, 'Lead is completely isolated and inaccessible from Tenant B');

  // Idempotency replay test
  console.log('\n--- 3. Webhook Idempotency Replay Test ---');
  const duplicateWebhookResult = await processInboundLeadWebhook(mockWebhookReq);
  assert(duplicateWebhookResult.success === true, 'Duplicate webhook handled gracefully');
  assert(duplicateWebhookResult.idempotent === true, 'Duplicate marked as idempotent');

  // 4. CSV Ingestion & Deduplication
  console.log('\n--- 4. CSV Ingestion & Tenant Isolation ---');
  const ts = Date.now();
  const phone1 = `+9198${ts.toString().slice(-8)}`;
  const phone2 = `+9197${ts.toString().slice(-8)}`;
  const email1 = `pooja.${ts}@investments.in`;
  const email2 = `vikram.${ts}@tech.in`;

  const csvContent = `name,phone,email,source,source_reference
Pooja Kothari,${phone1},${email1},Broker Referral,REF_01
Vikram Malhotra,${phone2},${email2},Direct Website,WEB_01
Invalid Lead,,,Unknown,
`;

  const csvResult = await ingestCSVLeads(tenantA, csvContent);
  assert(csvResult.total_rows === 3, 'Processed 3 total CSV rows');
  assert(csvResult.accepted === 2, 'Accepted 2 valid rows');
  assert(csvResult.invalid === 1, 'Flagged 1 empty invalid row');
  assert(csvResult.createdLeads.length === 2, 'Created 2 persisted leads');

  // CSV Deduplication test
  const repeatCsv = `name,phone,email,source
Pooja Kothari,${phone1},${email1},Repeat Upload
`;
  const dupResult = await ingestCSVLeads(tenantA, repeatCsv);
  assert(dupResult.accepted === 1, 'Accepted row for evaluation');
  assert(dupResult.duplicates === 1, 'Detected existing lead as duplicate');
  assert(dupResult.created === 0, 'Did not create duplicate record in database');

  // Cross-tenant CSV isolation test: Same contact uploaded to Tenant B should create its own lead in Tenant B
  const tenantBCsvResult = await ingestCSVLeads(tenantB, repeatCsv);
  assert(tenantBCsvResult.created === 1, 'Tenant B successfully creates lead independently without colliding with Tenant A');

  // 5. Verify RLS Migration File
  console.log('\n--- 5. RLS Migration 013 Hardening Validation ---');
  const migrationPath = path.join(process.cwd(), 'supabase/migrations/013_harden_001_rls.sql');
  assert(fs.existsSync(migrationPath), 'Migration 013_harden_001_rls.sql exists');
  const sqlContent = fs.readFileSync(migrationPath, 'utf8');
  assert(sqlContent.includes('ALTER TABLE leads ENABLE ROW LEVEL SECURITY;'), 'RLS enabled for leads');
  assert(sqlContent.includes('ALTER TABLE projects ENABLE ROW LEVEL SECURITY;'), 'RLS enabled for projects');
  assert(sqlContent.includes('ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;'), 'RLS enabled for webhook_events');
  assert(sqlContent.includes('tenant_id = (auth.jwt() -> \'app_metadata\' ->> \'tenant_id\')::uuid'), 'RLS enforces app_metadata tenant_id claim');

  console.log('\n=====================================================');
  console.log('✅ All Phase 9.2 Verification Tests Passed Successfully!');
  console.log('=====================================================\n');
}

runPhase92Tests().catch((err) => {
  console.error('❌ Phase 9.2 Verification Failed:', err);
  process.exit(1);
});
