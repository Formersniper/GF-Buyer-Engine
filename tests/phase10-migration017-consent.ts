/**
 * Phase 10 Verification Matrix: Canonical Lead Consent Contract & Migration 017
 *
 * SPECIFICATION & INVARIANTS:
 * - Deterministic, non-inferred consent tracking across public.leads.
 * - Possession of contact info (phone/email) does NOT constitute consent.
 * - Consent is tracked via consent_status, consent_source, consent_timestamp.
 * - Default status is 'UNKNOWN'; never silently promoted to 'CONFIRMED'.
 * - Strict multi-tenant isolation prevents cross-tenant read or mutation of consent.
 * - Migration 017 strictly confined to public.leads and tenant consent index.
 */

import fs from 'fs';
import path from 'path';
import { Lead } from '../app/schemas/database';
import { supabaseDataService } from '../app/services/supabase/repositories';
import { evaluateCallEligibility } from '../app/services/calls/callEligibility';
import { DEFAULT_TENANT_ID } from '../app/schemas/tenant';

let passCount = 0;
let failCount = 0;

function assert(testId: string, description: string, condition: boolean, details?: unknown) {
  if (condition) {
    console.log(`  ✅ [PASS] ${testId}: ${description}`);
    passCount++;
  } else {
    console.error(`  ❌ [FAIL] ${testId}: ${description}`);
    if (details !== undefined) {
      console.error('     Details:', JSON.stringify(details, null, 2));
    }
    failCount++;
  }
}

export async function runPhase10ConsentTests() {
  console.log('======================================================');
  console.log('🧪 GROWTHFORGE PHASE 10 — CANONICAL LEAD CONSENT & MIGRATION 017');
  console.log('======================================================\n');

  const tenantA = DEFAULT_TENANT_ID;
  const tenantB = '00000000-0000-0000-0000-000000000002';
  const scopeA = { tenantId: tenantA, isPlatformAdmin: false };
  const scopeB = { tenantId: tenantB, isPlatformAdmin: false };

  // Ensure Tenant B exists for scoping
  try {
    await supabaseDataService.tenants.createTenant({
      id: tenantB,
      name: 'Tenant B Real Estate',
      slug: 'tenant-b-re',
      status: 'ACTIVE',
    });
  } catch {
    // Already created
  }

  // Baseline timestamp within call window (10:00 UTC = 15:30 IST)
  const baselineNow = '2026-09-22T10:00:00.000Z';

  // -------------------------------------------------------------------------
  // A. Lead interface accepts consent fields
  // -------------------------------------------------------------------------
  const typeTestRecord: Lead = {
    id: '11111111-1111-1111-1111-111111111111',
    lead_id: 'GF-TYPE-CHECK-001',
    name: 'Type Safety Lead',
    phone: '+919876543210',
    email: 'typesafe@example.com',
    source: 'WEB_FORM',
    source_reference: null,
    status: 'RAW',
    consent_status: 'PERMISSIBLE',
    consent_source: 'WEB_FORM',
    consent_timestamp: baselineNow,
    created_at: baselineNow,
    updated_at: baselineNow,
  };

  assert(
    'TEST-A',
    'Lead interface accepts consent_status, consent_source, and consent_timestamp',
    typeTestRecord.consent_status === 'PERMISSIBLE' &&
      typeTestRecord.consent_source === 'WEB_FORM' &&
      typeTestRecord.consent_timestamp === baselineNow
  );

  // -------------------------------------------------------------------------
  // B, C, D. createLead defaults omitted consent fields
  // -------------------------------------------------------------------------
  const leadDefault = await supabaseDataService.leads.createLead(scopeA, {
    lead_id: `GF-CONSENT-DEF-${Date.now()}`,
    name: 'Omitted Consent Lead',
    phone: '+919876500001',
    email: 'omitted@example.com',
    source: 'CSV_IMPORT',
  });

  assert(
    'TEST-B',
    'createLead defaults omitted consent_status to UNKNOWN',
    leadDefault.consent_status === 'UNKNOWN',
    { consent_status: leadDefault.consent_status }
  );

  assert(
    'TEST-C',
    'createLead defaults omitted consent_source to null',
    leadDefault.consent_source === null,
    { consent_source: leadDefault.consent_source }
  );

  assert(
    'TEST-D',
    'createLead defaults omitted consent_timestamp to null',
    leadDefault.consent_timestamp === null,
    { consent_timestamp: leadDefault.consent_timestamp }
  );

  // -------------------------------------------------------------------------
  // E. createLead preserves explicit PERMISSIBLE and EXPLICIT_CONSENT
  // -------------------------------------------------------------------------
  const leadPermissible = await supabaseDataService.leads.createLead(scopeA, {
    lead_id: `GF-CONSENT-PERM-${Date.now()}`,
    name: 'Permissible Consent Lead',
    phone: '+919876500002',
    email: 'perm@example.com',
    source: 'PORTAL_INQUIRY',
    consent_status: 'PERMISSIBLE',
    consent_source: 'PORTAL_INQUIRY',
    consent_timestamp: baselineNow,
  });

  const leadExplicit = await supabaseDataService.leads.createLead(scopeA, {
    lead_id: `GF-CONSENT-EXP-${Date.now()}`,
    name: 'Explicit Consent Lead',
    phone: '+919876500003',
    email: 'explicit@example.com',
    source: 'DIRECT_INQUIRY',
    consent_status: 'EXPLICIT_CONSENT',
    consent_source: 'DIRECT_INQUIRY',
    consent_timestamp: baselineNow,
  });

  assert(
    'TEST-E1',
    'createLead preserves explicit PERMISSIBLE consent',
    leadPermissible.consent_status === 'PERMISSIBLE' && leadPermissible.consent_source === 'PORTAL_INQUIRY',
    { lead: leadPermissible }
  );

  assert(
    'TEST-E2',
    'createLead preserves explicit EXPLICIT_CONSENT',
    leadExplicit.consent_status === 'EXPLICIT_CONSENT' && leadExplicit.consent_source === 'DIRECT_INQUIRY',
    { lead: leadExplicit }
  );

  // -------------------------------------------------------------------------
  // F. updateLead persists OPT_OUT and DO_NOT_CALL
  // -------------------------------------------------------------------------
  const leadForUpdate = await supabaseDataService.leads.createLead(scopeA, {
    lead_id: `GF-CONSENT-UPD-${Date.now()}`,
    name: 'Update Consent Target',
    phone: '+919876500004',
    email: 'update@example.com',
    consent_status: 'PERMISSIBLE',
  });

  const updatedOptOut = await supabaseDataService.leads.updateLead(scopeA, leadForUpdate.id, {
    consent_status: 'OPT_OUT',
  });

  assert(
    'TEST-F1',
    'updateLead persists OPT_OUT',
    updatedOptOut.consent_status === 'OPT_OUT',
    { consent_status: updatedOptOut.consent_status }
  );

  const updatedDnc = await supabaseDataService.leads.updateLead(scopeA, leadForUpdate.id, {
    consent_status: 'DO_NOT_CALL',
  });

  assert(
    'TEST-F2',
    'updateLead persists DO_NOT_CALL',
    updatedDnc.consent_status === 'DO_NOT_CALL',
    { consent_status: updatedDnc.consent_status }
  );

  // -------------------------------------------------------------------------
  // G. consent_source persists on create and update
  // -------------------------------------------------------------------------
  const leadWithSource = await supabaseDataService.leads.createLead(scopeA, {
    lead_id: `GF-CONSENT-SRC-${Date.now()}`,
    name: 'Consent Source Target',
    phone: '+919876500005',
    consent_source: 'INBOUND_WEBHOOK',
  });

  assert(
    'TEST-G1',
    'consent_source persists on create',
    leadWithSource.consent_source === 'INBOUND_WEBHOOK',
    { consent_source: leadWithSource.consent_source }
  );

  const updatedSource = await supabaseDataService.leads.updateLead(scopeA, leadWithSource.id, {
    consent_source: 'SMS_OPT_IN',
  });

  assert(
    'TEST-G2',
    'consent_source persists on update',
    updatedSource.consent_source === 'SMS_OPT_IN',
    { consent_source: updatedSource.consent_source }
  );

  // -------------------------------------------------------------------------
  // H. consent_timestamp persists on create and update
  // -------------------------------------------------------------------------
  const initialTimestamp = '2026-09-22T08:00:00.000Z';
  const updatedTimestamp = '2026-09-22T14:30:00.000Z';

  const leadWithTimestamp = await supabaseDataService.leads.createLead(scopeA, {
    lead_id: `GF-CONSENT-TS-${Date.now()}`,
    name: 'Consent Timestamp Target',
    phone: '+919876500006',
    consent_timestamp: initialTimestamp,
  });

  assert(
    'TEST-H1',
    'consent_timestamp persists on create',
    leadWithTimestamp.consent_timestamp === initialTimestamp,
    { consent_timestamp: leadWithTimestamp.consent_timestamp }
  );

  const updatedTs = await supabaseDataService.leads.updateLead(scopeA, leadWithTimestamp.id, {
    consent_timestamp: updatedTimestamp,
  });

  assert(
    'TEST-H2',
    'consent_timestamp persists on update',
    updatedTs.consent_timestamp === updatedTimestamp,
    { consent_timestamp: updatedTs.consent_timestamp }
  );

  // -------------------------------------------------------------------------
  // I. getLead preserves persisted consent
  // -------------------------------------------------------------------------
  const fetchedLead = await supabaseDataService.leads.getLead(scopeA, updatedTs.id);
  assert(
    'TEST-I',
    'getLead preserves persisted consent fields',
    fetchedLead !== null &&
      fetchedLead.consent_timestamp === updatedTimestamp &&
      fetchedLead.consent_status === 'UNKNOWN',
    { fetchedLead }
  );

  // -------------------------------------------------------------------------
  // J, K. toGFBuyerLead preserves persisted UNKNOWN and does NOT convert to CONFIRMED
  // -------------------------------------------------------------------------
  const gfLeadUnknown = await supabaseDataService.toGFBuyerLead(scopeA, leadDefault.id);

  assert(
    'TEST-J',
    'toGFBuyerLead preserves persisted UNKNOWN consent_status',
    gfLeadUnknown !== null && gfLeadUnknown.provenance.consent_status === 'UNKNOWN',
    { provenance: gfLeadUnknown?.provenance }
  );

  assert(
    'TEST-K',
    'toGFBuyerLead does NOT convert UNKNOWN to CONFIRMED',
    gfLeadUnknown !== null && gfLeadUnknown.provenance.consent_status !== 'CONFIRMED',
    { provenance: gfLeadUnknown?.provenance }
  );

  // -------------------------------------------------------------------------
  // L. toGFBuyerLead preserves explicit EXPLICIT_CONSENT
  // -------------------------------------------------------------------------
  const gfLeadExplicit = await supabaseDataService.toGFBuyerLead(scopeA, leadExplicit.id);

  assert(
    'TEST-L',
    'toGFBuyerLead preserves explicit EXPLICIT_CONSENT',
    gfLeadExplicit !== null && gfLeadExplicit.provenance.consent_status === 'EXPLICIT_CONSENT',
    { provenance: gfLeadExplicit?.provenance }
  );

  // -------------------------------------------------------------------------
  // M. callEligibility returns REQUIRES_REVIEW for UNKNOWN
  // -------------------------------------------------------------------------
  const eligUnknown = evaluateCallEligibility({
    leadId: leadDefault.id,
    status: 'ENRICHED',
    phone: '+919876543210',
    consentStatus: 'UNKNOWN',
    evaluatedAt: baselineNow,
  });

  assert(
    'TEST-M',
    'callEligibility returns REQUIRES_REVIEW for UNKNOWN consent',
    eligUnknown.decision === 'REQUIRES_REVIEW' && eligUnknown.eligible === false,
    { decision: eligUnknown.decision, reasons: eligUnknown.reasons }
  );

  // -------------------------------------------------------------------------
  // N. callEligibility permits explicit permissible consent when conditions pass
  // -------------------------------------------------------------------------
  const eligPermissible = evaluateCallEligibility({
    leadId: leadPermissible.id,
    status: 'ENRICHED',
    phone: '+919876543210',
    consentStatus: 'PERMISSIBLE',
    evaluatedAt: baselineNow,
  });

  assert(
    'TEST-N',
    'callEligibility permits explicit permissible consent when conditions pass',
    eligPermissible.decision === 'ELIGIBLE' && eligPermissible.eligible === true,
    { decision: eligPermissible.decision, reasons: eligPermissible.reasons }
  );

  // -------------------------------------------------------------------------
  // O. callEligibility blocks OPT_OUT
  // -------------------------------------------------------------------------
  const eligOptOut = evaluateCallEligibility({
    leadId: updatedOptOut.id,
    status: 'ENRICHED',
    phone: '+919876543210',
    consentStatus: 'OPT_OUT',
    evaluatedAt: baselineNow,
  });

  assert(
    'TEST-O',
    'callEligibility blocks OPT_OUT consent',
    eligOptOut.decision === 'NOT_ELIGIBLE' && eligOptOut.eligible === false,
    { decision: eligOptOut.decision, reasons: eligOptOut.reasons }
  );

  // -------------------------------------------------------------------------
  // P. Tenant B cannot read Tenant A consent
  // -------------------------------------------------------------------------
  const crossTenantRead = await supabaseDataService.leads.getLead(scopeB, leadPermissible.id);

  assert(
    'TEST-P',
    'Tenant B cannot read Tenant A consent or lead record',
    crossTenantRead === null,
    { crossTenantRead }
  );

  // -------------------------------------------------------------------------
  // Q. Tenant B cannot mutate Tenant A consent
  // -------------------------------------------------------------------------
  let mutationBlocked = false;
  try {
    await supabaseDataService.leads.updateLead(scopeB, leadPermissible.id, {
      consent_status: 'DO_NOT_CALL',
    });
  } catch {
    mutationBlocked = true;
  }

  // Verify lead in Tenant A remains unmodified
  const tenantALeadCheck = await supabaseDataService.leads.getLead(scopeA, leadPermissible.id);

  assert(
    'TEST-Q',
    'Tenant B cannot mutate Tenant A consent and record remains unmodified',
    mutationBlocked && tenantALeadCheck?.consent_status === 'PERMISSIBLE',
    { mutationBlocked, currentStatus: tenantALeadCheck?.consent_status }
  );

  // -------------------------------------------------------------------------
  // R - X. Migration 017 Validation
  // -------------------------------------------------------------------------
  const migrationPath = path.resolve(
    process.cwd(),
    'supabase/migrations/20260922120000_017_canonical_lead_consent.sql'
  );

  const migrationExists = fs.existsSync(migrationPath);
  assert(
    'TEST-R',
    'Migration 017 exists at exact path supabase/migrations/20260922120000_017_canonical_lead_consent.sql',
    migrationExists
  );

  if (migrationExists) {
    const migrationSql = fs.readFileSync(migrationPath, 'utf8');

    assert(
      'TEST-S',
      "Migration contains consent_status VARCHAR NOT NULL DEFAULT 'UNKNOWN'",
      migrationSql.includes("consent_status VARCHAR NOT NULL DEFAULT 'UNKNOWN'")
    );

    assert(
      'TEST-T',
      'Migration contains consent_source VARCHAR NULL',
      migrationSql.includes('consent_source VARCHAR NULL')
    );

    assert(
      'TEST-U',
      'Migration contains consent_timestamp TIMESTAMPTZ NULL',
      migrationSql.includes('consent_timestamp TIMESTAMPTZ NULL')
    );

    assert(
      'TEST-V',
      'Migration contains idx_leads_tenant_consent ON leads(tenant_id, consent_status)',
      migrationSql.includes('idx_leads_tenant_consent') &&
        migrationSql.includes('leads(tenant_id, consent_status)')
    );

    assert(
      'TEST-W',
      'Migration contains the UNKNOWN backfill statement',
      migrationSql.includes('UPDATE leads') &&
        migrationSql.includes("SET consent_status = 'UNKNOWN'") &&
        migrationSql.includes('WHERE consent_status IS NULL')
    );

    // X. Verify migration is strictly confined to public.leads and intended index
    const tablesMentioned = (migrationSql.match(/TABLE\s+([a-zA-Z0-9_\.]+)/gi) || []).map((s) =>
      s.replace(/TABLE\s+/i, '').trim().toLowerCase()
    );
    const hasOnlyLeadsTable = tablesMentioned.every(
      (t) => t === 'leads' || t === 'public.leads'
    );
    const hasNoPolicies = !/POLICY/i.test(migrationSql);
    const hasNoFunctions = !/FUNCTION/i.test(migrationSql);

    assert(
      'TEST-X',
      'Migration is strictly confined to public.leads and index idx_leads_tenant_consent',
      hasOnlyLeadsTable && hasNoPolicies && hasNoFunctions,
      { tablesMentioned, hasNoPolicies, hasNoFunctions }
    );
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log('\n======================================================');
  console.log(`Phase 10 Tests Finished: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('======================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

// Run tests if executed directly
if (process.argv[1]?.endsWith('phase10-migration017-consent.ts')) {
  runPhase10ConsentTests().catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
  });
}
