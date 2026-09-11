/**
 * GrowthForge Buyer Intelligence Engine - Phase 1 Verification Test Suite
 *
 * Tests:
 * 1. Lead ID generation (GF-YYYY-NNNNNN format & stability)
 * 2. Phone normalization (E.164 / +91 country handling, formatting stripping)
 * 3. Email normalization (lowercase conversion, regex validation)
 * 4. CSV validation & parsing (malformed row tolerance, header mapping)
 * 5. Duplicate detection (Phone priority 1, Email priority 2, Ambiguity handling)
 * 6. GF Buyer Lead canonical mapping (normalized tables -> GFBuyerLead object)
 * 7. Workflow state validation
 * 8. End-to-end: CSV Ingestion -> Supabase Repository persistence -> Retrieval
 */

import {
  generateLeadId,
  normalizeName,
  normalizeEmail,
  normalizePhone,
  resolveLead,
  resetLeadIdCounter,
} from '../app/services/leads/leadResolver';
import { parseCSV, ingestCSVLeads } from '../app/services/leads/csvIngestion';
import { supabaseDataService } from '../app/services/supabase/repositories';
import { WorkflowStateMachine } from '../app/services/workflow/stateMachine';

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, testName: string, details?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passedCount++;
  } else {
    console.error(`  ❌ FAIL: ${testName} ${details ? `(${details})` : ''}`);
    failedCount++;
  }
}

async function runAllTests() {
  console.log('\n======================================================');
  console.log('🚀 GROWTHFORGE PHASE 1 ARCHITECTURAL TEST SUITE');
  console.log('======================================================\n');

  // Test 1: Lead ID Generation
  console.log('--- 1. Lead ID Generation ---');
  resetLeadIdCounter(1);
  const id1 = generateLeadId(1, 2026);
  const id2 = generateLeadId(2, 2026);
  const id3 = generateLeadId(123456, 2026);
  assert(id1 === 'GF-2026-000001', 'Generates 6-digit padded GF-2026-000001', `got ${id1}`);
  assert(id2 === 'GF-2026-000002', 'Generates sequential GF-2026-000002', `got ${id2}`);
  assert(id3 === 'GF-2026-123456', 'Preserves large sequence number GF-2026-123456', `got ${id3}`);

  // Test 2: Phone Normalization
  console.log('\n--- 2. Phone Normalization ---');
  const p1 = normalizePhone('+91 98200 12345');
  assert(p1.isValid && p1.phone === '+919820012345', 'Normalizes +91 formatted mobile with spaces');

  const p2 = normalizePhone('9820012345');
  assert(p2.isValid && p2.phone === '+919820012345', 'Defaults 10-digit number to +91 country prefix');

  const p3 = normalizePhone('09820012345');
  assert(p3.isValid && p3.phone === '+919820012345', 'Normalizes leading 0 STD style to +91');

  const p4 = normalizePhone('(123) 456-7890');
  assert(p4.isValid && p4.phone === '+911234567890', 'Strips brackets and hyphens');

  const p5 = normalizePhone('invalid_phone');
  assert(!p5.isValid, 'Correctly flags non-numeric string as invalid phone');

  // Test 3: Email Normalization
  console.log('\n--- 3. Email Normalization ---');
  const e1 = normalizeEmail('  Anupam.Saini@Example.COM  ');
  assert(e1.isValid && e1.email === 'anupam.saini@example.com', 'Converts uppercase to lowercase and trims whitespace');

  const e2 = normalizeEmail('invalid-email-format');
  assert(!e2.isValid, 'Flags invalid email without @/domain');

  // Test 4: CSV Validation & Parsing
  console.log('\n--- 4. CSV Validation & Parsing ---');
  const testCSV = `name,phone,email,source
"Rohit Sharma",9876543210,rohit@sharma.in,Meta Ad
"Priya Nair, MD",+91 98111 22334,priya.nair@hospital.org,"Referral Network"`;

  const rows = parseCSV(testCSV);
  assert(rows.length === 2, 'Parsed 2 rows from CSV');
  assert(rows[0].name === 'Rohit Sharma', 'Extracted Rohit Sharma unquoted');
  assert(rows[1].name === 'Priya Nair, MD', 'Preserved quoted name with comma "Priya Nair, MD"');
  assert(rows[1].source === 'Referral Network', 'Preserved quoted source');

  // Test 5: Duplicate Detection & Ambiguity
  console.log('\n--- 5. Duplicate Detection & Ambiguity ---');
  const existingLead = {
    id: 'lead-uuid-001',
    lead_id: 'GF-2026-000001',
    name: 'Siddharth Singhania',
    phone: '+919810199881',
    email: 'siddharth.s@singhania.org',
    source: 'Direct Web Inquiry',
    source_reference: null,
    status: 'RAW',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Exact duplicate on phone
  const resDupPhone = resolveLead(
    { name: 'Siddharth Singhania', phone: '9810199881', email: 'siddharth.alternate@singhania.org' },
    [existingLead]
  );
  assert(resDupPhone.outcome === 'DUPLICATE', 'Identified duplicate via phone match priority 1');
  assert(resDupPhone.leadId === 'GF-2026-000001', 'Preserved existing stable Lead ID on duplicate');

  // Exact duplicate on email
  const resDupEmail = resolveLead(
    { name: 'Siddharth Singhania', phone: '9999988888', email: 'siddharth.s@singhania.org' },
    [existingLead]
  );
  assert(resDupEmail.outcome === 'DUPLICATE', 'Identified duplicate via email match priority 2');

  // Ambiguous conflict: same phone, completely different name
  const resAmbiguous = resolveLead(
    { name: 'Karan Mehra', phone: '+91 98101 99881', email: 'karan@mehra.com' },
    [existingLead]
  );
  assert(resAmbiguous.outcome === 'AMBIGUOUS', 'Flagged conflicting identity as AMBIGUOUS');
  assert(resAmbiguous.workflowStatus === 'REQUIRES_REVIEW', 'Routed ambiguous lead to REQUIRES_REVIEW');
  assert(resAmbiguous.leadId !== existingLead.lead_id, 'Ambiguous lead assigned new unique lead_id instead of reusing conflicting lead_id');

  // New distinct lead
  const resNew = resolveLead(
    { name: 'Vikram Mehta', phone: '9876500000', email: 'vikram@mehta.com' },
    [existingLead]
  );
  assert(resNew.outcome === 'NEW', 'Identified distinct lead as NEW');

  // Test 6: Workflow State Transitions
  console.log('\n--- 6. Workflow State Machine Transitions ---');
  assert(WorkflowStateMachine.canTransition('RAW', 'RESOLVED'), 'Allowed transition: RAW -> RESOLVED');
  assert(WorkflowStateMachine.canTransition('RESOLVED', 'ENRICHING'), 'Allowed transition: RESOLVED -> ENRICHING');
  assert(WorkflowStateMachine.canTransition('QUALIFIED', 'HOT'), 'Allowed transition: QUALIFIED -> HOT');
  assert(WorkflowStateMachine.canTransition('RAW', 'INVALID_CONTACT'), 'Allowed failure transition: RAW -> INVALID_CONTACT');
  assert(!WorkflowStateMachine.canTransition('RAW', 'HANDOFF'), 'Prohibited invalid skip: RAW -> HANDOFF');

  // Test 7: Supabase Ingestion & Canonical GF Buyer Lead Mapping
  console.log('\n--- 7. End-to-End CSV Ingestion & Supabase Persistence ---');
  // Clean up any previous test runs for phone numbers to ensure test idempotency
  const existingLeads = await supabaseDataService.leads.listLeads();
  for (const l of existingLeads) {
    if (l.phone === '+919820155667' || l.phone === '+919811044332') {
      await supabaseDataService.leads.deleteLead(l.id);
    }
  }

  const sampleCSVContent = `name,phone,email,source,source_reference
Ananya Birla,+91 98201 55667,ananya.b@adityabirla.com,Forbes Inquiry,CAMP_UB_01
Vikramaditya Oberoi,98110 44332,v.oberoi@luxuryhotels.in,HNI Brokerage,REF_EXEC_02
Bad Row Missing All,,,Unknown,`;

  const importResult = await ingestCSVLeads(sampleCSVContent);
  assert(importResult.total_rows === 3, 'Processed 3 total CSV rows', `got ${importResult.total_rows}`);
  assert(importResult.accepted === 2, 'Accepted 2 valid rows', `got ${importResult.accepted}`);
  assert(importResult.invalid === 1, 'Flagged 1 invalid empty row', `got ${importResult.invalid}`);
  assert(importResult.createdLeads.length === 2, 'Persisted 2 leads in Supabase repository');

  const createdLead = importResult.createdLeads[0];
  assert(createdLead.lead_id.startsWith('GF-'), 'Generated valid GrowthForge Lead ID', `got ${createdLead.lead_id}`);

  // Canonical mapping check
  const gfLead = await supabaseDataService.mapToGFBuyerLead(createdLead.id);
  assert(gfLead !== null, 'Mapped normalized database records to canonical GF Buyer Lead object');
  assert(gfLead?.identity.full_name === 'Ananya Birla', 'Canonical identity name preserved');
  assert(gfLead?.identity.phone === '+919820155667', 'Canonical normalized phone preserved');
  assert(gfLead?.provenance.fields !== undefined, 'Canonical provenance fields present');
  assert(gfLead?.workflow.status === 'RAW', 'Canonical workflow status set to RAW');

  // Verify lead_events audit trail
  const events = await supabaseDataService.leadEvents.getLeadEvents(createdLead.id);
  assert(events.length > 0, 'Immutable audit event logged in lead_events');
  assert(events[0].event_type === 'LEAD_INGESTED', 'Recorded LEAD_INGESTED event type');

  // Test 8: Deduplication during subsequent CSV ingestion
  console.log('\n--- 8. Re-ingesting Duplicate Lead ---');
  const duplicateCSV = `name,phone,email,source
Ananya Birla,+91 98201 55667,ananya.b@adityabirla.com,Repeat Web Form`;
  const dupImportResult = await ingestCSVLeads(duplicateCSV);
  assert(dupImportResult.duplicates === 1, 'Correctly detected duplicate on second ingestion');
  assert(dupImportResult.created === 0, 'Zero new records created for duplicate');

  // Clean up ingested test leads
  for (const l of importResult.createdLeads) {
    await supabaseDataService.leads.deleteLead(l.id);
  }

  // Test 9: Persistence Round-Trip Diagnostic Verification
  console.log('\n--- 9. Persistence Round-Trip Diagnostic Verification ---');
  const roundTripResult = await supabaseDataService.verifyPersistenceRoundTrip();
  assert(roundTripResult.success, 'Persistence round-trip executed successfully');
  assert(roundTripResult.isLiveSupabase === true, 'Round-trip executed against LIVE_SUPABASE database (not IN_MEMORY)');
  assert(roundTripResult.insertedId !== '', 'Created diagnostic lead in persistence layer');
  assert(roundTripResult.readBackMatched, 'Read-back matched persisted lead identity');
  assert(roundTripResult.auditEventLogged, 'Audit event was verified in event repository');
  assert(roundTripResult.deletedSuccessfully, 'Cleaned up diagnostic record with zero database pollution');

  console.log('\n======================================================');
  console.log(`TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('======================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
