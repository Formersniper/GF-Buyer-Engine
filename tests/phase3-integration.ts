/**
 * GrowthForge Buyer Intelligence Engine
 * PHASE 3 — LIVE SCOUTADAPTER INTEGRATION TESTS
 *
 * 13 Rigorous Integration Tests verifying:
 * 1. Valid Request / Profile Enrichment
 * 2. Missing Profile Graceful Handling
 * 3. Timeout Handling
 * 4. Execution Error Handling
 * 5. Subsystem Unavailable Handling
 * 6. Dependency Error Handling
 * 7. Invalid Output Handling
 * 8. Normalization Contract Adherence
 * 9. Data-Truth Invariant Verification
 * 10. Supabase lead_enrichment Persistence
 * 11. Supabase lead_events Audit Logging
 * 12. Workflow State Machine Transition Validation
 * 13. End-to-End Pipeline & Controlled Live Test
 */

import { resolve } from 'path';
import { ScoutPythonAdapter, ScoutEnrichmentQuery, scoutAdapter } from '../app/services/scout/scoutAdapter';
import { supabaseDataService } from '../app/services/supabase/repositories';
import { DefaultLeadService } from '../app/services/leads/leadService';
import { WorkflowStateMachine } from '../app/services/workflow/stateMachine';

interface TestResult {
  id: number;
  name: string;
  passed: boolean;
  message?: string;
  error?: string;
}

const results: TestResult[] = [];

function assert(condition: boolean, testId: number, name: string, message: string) {
  if (!condition) {
    results.push({ id: testId, name, passed: false, error: message });
    console.error(`❌ [FAIL] Test ${testId}: ${name} — ${message}`);
  } else {
    results.push({ id: testId, name, passed: true, message });
    console.log(`✅ [PASS] Test ${testId}: ${name}`);
  }
}

async function runPhase3Tests() {
  console.log('\n======================================================');
  console.log('🚀 RUNNING PHASE 3 — SCOUTADAPTER INTEGRATION TEST SUITE');
  console.log('======================================================\n');

  const leadService = new DefaultLeadService();

  // ---------------------------------------------------------------------------
  // TEST 1: Valid Request / Profile Enrichment
  // ---------------------------------------------------------------------------
  try {
    const validQuery: ScoutEnrichmentQuery = {
      full_name: 'Ananya Sharma',
      email: 'ananya.sharma@techcorp.in',
      phone: '+919876543210',
      location: 'Bengaluru',
    };

    const fixtureOutput = {
      status: 'success',
      full_name: 'Ananya Sharma',
      company: 'TechCorp India Ltd',
      title: 'Principal Architect',
      location: 'Bengaluru',
      bio: 'High-scale distributed systems engineer and angel investor',
      profiles: [
        { platform: 'linkedin', url: 'https://linkedin.com/in/ananyasharma', handle: 'ananyasharma' },
        { platform: 'github', url: 'https://github.com/ananyasharma', handle: 'ananyasharma' },
      ],
      confidence: 0.9,
    };

    const result = await scoutAdapter.enrichLead(validQuery, { fixtureRaw: fixtureOutput });
    assert(
      result.status === 'success' &&
        result.employment?.company === 'TechCorp India Ltd' &&
        result.social_presence?.length === 2 &&
        result.error_code === 'SCOUT_SUCCESS',
      1,
      'Valid Request / Profile Enrichment',
      'Should successfully enrich lead with structured employment and social profiles'
    );
  } catch (err: unknown) {
    assert(false, 1, 'Valid Request / Profile Enrichment', String(err));
  }

  // ---------------------------------------------------------------------------
  // TEST 2: Missing Profile Graceful Handling
  // ---------------------------------------------------------------------------
  try {
    const emptyQuery: ScoutEnrichmentQuery = {
      phone: '+910000000000',
    };

    const notFoundFixture = {
      status: 'not_found',
      full_name: null,
      company: null,
      profiles: [],
      confidence: 0.0,
    };

    const result = await scoutAdapter.enrichLead(emptyQuery, { fixtureRaw: notFoundFixture });
    assert(
      result.status === 'not_found' &&
        (!result.social_presence || result.social_presence.length === 0) &&
        result.error_code === 'SCOUT_SUCCESS',
      2,
      'Missing Profile Graceful Handling',
      'Should handle missing profile without crashing and return not_found status'
    );
  } catch (err: unknown) {
    assert(false, 2, 'Missing Profile Graceful Handling', String(err));
  }

  // ---------------------------------------------------------------------------
  // TEST 3: Timeout Handling
  // ---------------------------------------------------------------------------
  try {
    const hangScript = `
import time
time.sleep(10)
`;
    const result = await scoutAdapter.enrichLead(
      { full_name: 'Timeout Test' },
      { customScript: hangScript, timeoutMs: 300 }
    );

    assert(
      result.status === 'error' && result.error_code === 'SCOUT_TIMEOUT',
      3,
      'Timeout Handling',
      `Should terminate hung subprocess and return SCOUT_TIMEOUT (got: ${result.error_code})`
    );
  } catch (err: unknown) {
    assert(false, 3, 'Timeout Handling', String(err));
  }

  // ---------------------------------------------------------------------------
  // TEST 4: Execution Error Handling
  // ---------------------------------------------------------------------------
  try {
    const errorScript = `
import sys
sys.stderr.write("Fatal exception in scraper execution\\n")
sys.exit(1)
`;
    const result = await scoutAdapter.enrichLead(
      { full_name: 'Error Test' },
      { customScript: errorScript, timeoutMs: 5000 }
    );

    assert(
      result.status === 'error' && result.error_code === 'SCOUT_EXECUTION_ERROR',
      4,
      'Execution Error Handling',
      `Should capture non-zero exit and return SCOUT_EXECUTION_ERROR (got: ${result.error_code})`
    );
  } catch (err: unknown) {
    assert(false, 4, 'Execution Error Handling', String(err));
  }

  // ---------------------------------------------------------------------------
  // TEST 5: Subsystem Unavailable Handling
  // ---------------------------------------------------------------------------
  try {
    const badAdapter = new ScoutPythonAdapter(resolve(process.cwd(), 'non_existent_scout_path'));
    const health = await badAdapter.checkHealth();
    const result = await badAdapter.enrichLead({ full_name: 'Unavailable Test' });

    assert(
      health.available === false &&
        health.error_code === 'SCOUT_UNAVAILABLE' &&
        result.status === 'error' &&
        result.error_code === 'SCOUT_UNAVAILABLE',
      5,
      'Subsystem Unavailable Handling',
      'Should report SCOUT_UNAVAILABLE when scout directory or files are missing'
    );
  } catch (err: unknown) {
    assert(false, 5, 'Subsystem Unavailable Handling', String(err));
  }

  // ---------------------------------------------------------------------------
  // TEST 6: Dependency Error Handling
  // ---------------------------------------------------------------------------
  try {
    const missingDepScript = `
import sys
sys.stderr.write("ModuleNotFoundError: No module named 'fake_package_xyz'\\n")
sys.exit(2)
`;
    const result = await scoutAdapter.enrichLead(
      { full_name: 'Dep Test' },
      { customScript: missingDepScript }
    );

    assert(
      result.status === 'error' && result.error_code === 'SCOUT_DEPENDENCY_ERROR',
      6,
      'Dependency Error Handling',
      `Should detect missing modules and return SCOUT_DEPENDENCY_ERROR (got: ${result.error_code})`
    );
  } catch (err: unknown) {
    assert(false, 6, 'Dependency Error Handling', String(err));
  }

  // ---------------------------------------------------------------------------
  // TEST 7: Invalid Output Handling
  // ---------------------------------------------------------------------------
  try {
    const invalidJsonScript = `
import sys
print("THIS IS NOT JSON OUTPUT AT ALL {broken-json")
sys.exit(0)
`;
    const result = await scoutAdapter.enrichLead(
      { full_name: 'Invalid Output Test' },
      { customScript: invalidJsonScript }
    );

    assert(
      result.status === 'error' && result.error_code === 'SCOUT_INVALID_OUTPUT',
      7,
      'Invalid Output Handling',
      `Should detect unparseable output and return SCOUT_INVALID_OUTPUT (got: ${result.error_code})`
    );
  } catch (err: unknown) {
    assert(false, 7, 'Invalid Output Handling', String(err));
  }

  // ---------------------------------------------------------------------------
  // TEST 8: Normalization Contract Adherence
  // ---------------------------------------------------------------------------
  try {
    const query: ScoutEnrichmentQuery = { full_name: 'Rohan Mehta' };
    const rawData = {
      company: 'InnovateCorp',
      title: 'VP Engineering',
      location: 'Indiranagar, Bengaluru',
      industry: 'Software',
      seniority: 'Executive',
      profiles: [{ platform: 'linkedin', url: 'https://linkedin.com/in/rohanmehta' }],
      confidence: 0.88,
    };

    const normalized = scoutAdapter.normalizeOutput(query, rawData, 'success', 'SCOUT_SUCCESS');

    assert(
      normalized.source === 'scout' &&
        normalized.truth_level === 'INFERRED' &&
        normalized.confidence === 0.88 &&
        normalized.profiles.length === 1 &&
        normalized.signals.some((s) => s.key === 'employment_company' && s.value === 'InnovateCorp') &&
        normalized.signals.some((s) => s.key === 'employment_title' && s.value === 'VP Engineering'),
      8,
      'Normalization Contract Adherence',
      'Normalized output must match the canonical ScoutNormalizedOutput contract'
    );
  } catch (err: unknown) {
    assert(false, 8, 'Normalization Contract Adherence', String(err));
  }

  // ---------------------------------------------------------------------------
  // TEST 9: Data-Truth Invariant Verification
  // ---------------------------------------------------------------------------
  try {
    // Create test lead with confirmed phone and known name
    const timestamp = Date.now();
    const rawLead = {
      full_name: 'Pooja Verma',
      phone: `+9199${timestamp.toString().slice(-8)}`,
      email: `pooja.${timestamp}@example.com`,
      source: 'PORTAL_INQUIRY',
    };

    const ingested = await leadService.ingestRawLead(rawLead);

    // Add enrichment with inferred company and location
    const dbLead = await supabaseDataService.leads.getLeadByLeadId(ingested.lead_id);
    if (!dbLead) throw new Error('Lead missing');

    await supabaseDataService.leadEnrichment.createEnrichment({
      lead_id: dbLead.id,
      platform: 'scout',
      username: 'pverma',
      profile_url: 'https://linkedin.com/in/pverma',
      full_name: 'Pooja Verma, PMP',
      bio: 'Program Director',
      website: null,
      company: 'Global Enterprises Ltd',
      location: 'Whitefield, Bengaluru',
      raw_data: { test: true },
      enriched_data: { inferred_net_worth: 'High' },
      source_confidence: 0.85,
    });

    const canonical = await supabaseDataService.mapToGFBuyerLead(dbLead.id);
    const fields = canonical?.provenance.fields as Record<string, { truth_level?: string; truth?: string }>;

    const phoneTruth = fields.phone?.truth_level || fields.phone?.truth;
    const companyTruth = fields.company?.truth_level || fields.company?.truth;

    assert(
      canonical !== null &&
        phoneTruth === 'KNOWN' &&
        companyTruth === 'INFERRED' &&
        canonical.identity.company === 'Global Enterprises Ltd',
      9,
      'Data-Truth Invariant Verification',
      'Scout enrichment must be marked INFERRED and never overwrite KNOWN or CONFIRMED contact info'
    );
  } catch (err: unknown) {
    assert(false, 9, 'Data-Truth Invariant Verification', String(err));
  }

  // ---------------------------------------------------------------------------
  // TEST 10: Supabase lead_enrichment Persistence
  // ---------------------------------------------------------------------------
  try {
    const timestamp = Date.now();
    const rawLead = {
      full_name: 'Karan Singhal',
      phone: `+9191${timestamp.toString().slice(-8)}`,
      email: `karan.${timestamp}@example.com`,
      source: 'CAMPAIGN_FB',
    };

    const ingested = await leadService.ingestRawLead(rawLead);
    const dbLead = await supabaseDataService.leads.getLeadByLeadId(ingested.lead_id);
    if (!dbLead) throw new Error('Lead missing');

    const createdEnrichment = await supabaseDataService.leadEnrichment.createEnrichment({
      lead_id: dbLead.id,
      platform: 'scout',
      username: 'karansinghal',
      profile_url: 'https://github.com/karansinghal',
      full_name: 'Karan Singhal',
      bio: 'Senior Staff Engineer',
      website: null,
      company: 'NextGen Cloud Systems',
      location: 'Koramangala, Bengaluru',
      raw_data: { source: 'scout_test' },
      enriched_data: { tech_lead: true },
      source_confidence: 0.9,
    });

    const enrichments = await supabaseDataService.leadEnrichment.getEnrichment(dbLead.id);

    assert(
      enrichments.length > 0 &&
        enrichments.some((e) => e.company === 'NextGen Cloud Systems' && e.platform === 'scout'),
      10,
      'Supabase lead_enrichment Persistence',
      'Should persist enrichment record into lead_enrichment repository'
    );
  } catch (err: unknown) {
    assert(false, 10, 'Supabase lead_enrichment Persistence', String(err));
  }

  // ---------------------------------------------------------------------------
  // TEST 11: Supabase lead_events Audit Logging
  // ---------------------------------------------------------------------------
  try {
    const timestamp = Date.now();
    const rawLead = {
      full_name: 'Deepak Nambiar',
      phone: `+9198${timestamp.toString().slice(-8)}`,
      email: `deepak.${timestamp}@example.com`,
      source: 'WEB_FORM',
    };

    const ingested = await leadService.ingestRawLead(rawLead);
    const dbLead = await supabaseDataService.leads.getLeadByLeadId(ingested.lead_id);
    if (!dbLead) throw new Error('Lead missing');

    await supabaseDataService.leadEvents.appendLeadEvent({
      lead_id: dbLead.id,
      event_type: 'LEAD_ENRICHMENT_STARTED',
      event_data: { leadId: dbLead.lead_id },
    });

    await supabaseDataService.leadEvents.appendLeadEvent({
      lead_id: dbLead.id,
      event_type: 'LEAD_ENRICHED',
      event_data: { profiles_found: 2, signals_found: 4, source: 'scout' },
    });

    const events = await supabaseDataService.leadEvents.getLeadEvents(dbLead.id);
    const hasStarted = events.some((e) => e.event_type === 'LEAD_ENRICHMENT_STARTED');
    const hasEnriched = events.some((e) => e.event_type === 'LEAD_ENRICHED');

    assert(
      hasStarted && hasEnriched,
      11,
      'Supabase lead_events Audit Logging',
      'Should log immutable LEAD_ENRICHMENT_STARTED and LEAD_ENRICHED events'
    );
  } catch (err: unknown) {
    assert(false, 11, 'Supabase lead_events Audit Logging', String(err));
  }

  // ---------------------------------------------------------------------------
  // TEST 12: Workflow State Machine Transition Validation
  // ---------------------------------------------------------------------------
  try {
    const timestamp = Date.now();
    const rawLead = {
      full_name: 'Meera Raghavan',
      phone: `+9197${timestamp.toString().slice(-8)}`,
      email: `meera.${timestamp}@example.com`,
    };

    const ingested = await leadService.ingestRawLead(rawLead);
    const dbLead = await supabaseDataService.leads.getLeadByLeadId(ingested.lead_id);
    if (!dbLead) throw new Error('Lead missing');

    // Transition from RAW -> RESOLVED -> ENRICHING -> ENRICHED
    const t1 = await leadService.transitionStatus(ingested.lead_id, 'RESOLVED', 'Lead resolved and deduped');
    const t2 = await leadService.transitionStatus(ingested.lead_id, 'ENRICHING', 'Starting Scout public enrichment');
    const t3 = await leadService.transitionStatus(ingested.lead_id, 'ENRICHED', 'Scout enrichment completed');

    assert(
      t1.workflow.status === 'RESOLVED' &&
        t2.workflow.status === 'ENRICHING' &&
        t3.workflow.status === 'ENRICHED',
      12,
      'Workflow State Machine Transition Validation',
      'Should execute valid workflow transitions through the state machine'
    );
  } catch (err: unknown) {
    assert(false, 12, 'Workflow State Machine Transition Validation', String(err));
  }

  // ---------------------------------------------------------------------------
  // TEST 13: End-to-End Pipeline & Controlled Live Test
  // ---------------------------------------------------------------------------
  try {
    const timestamp = Date.now();
    // Ingest new lead
    const lead = await leadService.ingestRawLead({
      full_name: 'Dr. Siddharth Joshi',
      phone: `+9196${timestamp.toString().slice(-8)}`,
      email: `siddharth.${timestamp}@aiims.edu`,
      source: 'PROMOTIONAL_PORTAL',
    });

    // Execute enrichment via LeadService
    const enrichedLead = await leadService.triggerEnrichment(lead.lead_id);

    // Verify canonical state
    assert(
      enrichedLead !== null &&
        enrichedLead.lead_id === lead.lead_id &&
        (enrichedLead.workflow.status === 'ENRICHED' || enrichedLead.workflow.status === 'ENRICHMENT_FAILED'),
      13,
      'End-to-End Pipeline & Controlled Live Test',
      `Full pipeline executed with lead status ${enrichedLead.workflow.status}`
    );
  } catch (err: unknown) {
    assert(false, 13, 'End-to-End Pipeline & Controlled Live Test', String(err));
  }

  // ---------------------------------------------------------------------------
  // SUMMARY REPORT
  // ---------------------------------------------------------------------------
  console.log('\n======================================================');
  console.log('📊 PHASE 3 TEST RESULTS SUMMARY');
  console.log('======================================================');

  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;

  console.log(`Total Tests : ${total}`);
  console.log(`Passed      : ${passed}`);
  console.log(`Failed      : ${failed}`);

  if (failed > 0) {
    console.error('\n❌ FAILURES:');
    results
      .filter((r) => !r.passed)
      .forEach((r) => console.error(`  - Test ${r.id}: ${r.name} (${r.error})`));
    process.exit(1);
  } else {
    console.log('\n🎉 ALL 13 PHASE 3 INTEGRATION TESTS PASSED PERFECTLY!\n');
  }
}

runPhase3Tests().catch((e) => {
  console.error('Fatal error running tests:', e);
  process.exit(1);
});
