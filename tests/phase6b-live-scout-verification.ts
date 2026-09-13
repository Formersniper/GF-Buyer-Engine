/**
 * GrowthForge Phase 6B — Live Scout Enrichment Verification
 *
 * Verifies real Scout OSINT enrichment through the real GrowthForge application path:
 * Test Lead → leadService.triggerEnrichment(testLeadId) → ScoutAdapter → Python Scout
 * → real enrichment execution → normalized result → lead_enrichment persistence
 * → LEAD_ENRICHED event → lead.status = ENRICHED
 */

import { existsSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';

process.env.PYTHONDONTWRITEBYTECODE = '1';

import { supabaseDataService } from '../app/services/supabase/repositories';
import { leadService } from '../app/services/leads/leadService';
import { scoutAdapter } from '../app/services/scout/scoutAdapter';

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

async function runPhase6bLiveScoutSuite(): Promise<void> {
  console.log('============================================================');
  console.log('GROWTHFORGE BUYER INTELLIGENCE ENGINE');
  console.log('PHASE 6B — LIVE SCOUT ENRICHMENT VERIFICATION');
  console.log('============================================================\n');

  const rootDir = process.cwd();
  const scoutDir = resolve(rootDir, 'scout');

  // ------------------------------------------------------------------
  // STEP 1: SCOUT HEALTH & ENVIRONMENT VALIDATION
  // ------------------------------------------------------------------
  console.log('--- STEP 1: SCOUT HEALTH & ENVIRONMENT VALIDATION ---');

  const scoutPyPath = resolve(scoutDir, 'scout.py');
  const reqPath = resolve(scoutDir, 'requirements.txt');
  const appInitPath = resolve(scoutDir, 'app', '__init__.py');

  assert(existsSync(scoutPyPath), '1. scout/scout.py exists');
  assert(existsSync(reqPath), '2. scout/requirements.txt exists');
  assert(existsSync(appInitPath), '3. scout/app/__init__.py exists');

  // Verify Python runtime
  let pyVersion = '';
  try {
    pyVersion = execSync('python3 --version', { encoding: 'utf-8' }).trim();
    assert(pyVersion.startsWith('Python 3'), `4. Python runtime works (${pyVersion})`);
  } catch (err: any) {
    assert(false, '4. Python runtime works', err.message);
  }

  // Verify Python Scout modules import cleanly
  try {
    const importCode = `import sys, os\nsys.path.insert(0, '${scoutDir}')\nfrom app.scrapers.enrichment import LeadEnricher\nenricher = LeadEnricher()\nprint('LEAD_ENRICHER_READY')`;
    const importOutput = execSync(`python3 -c "${importCode.replace(/\n/g, '; ')}"`, { encoding: 'utf-8' });
    assert(importOutput.includes('LEAD_ENRICHER_READY'), '5. Scout modules import & LeadEnricher instantiates');
  } catch (err: any) {
    assert(false, '5. Scout modules import & LeadEnricher instantiates', err.message);
  }

  // Direct LeadEnricher execution test via Python
  let directScoutResult: any = null;
  try {
    const testPyCode = `import sys, json, os\nsys.path.insert(0, '${scoutDir}')\nfrom app.scrapers.enrichment import LeadEnricher\nenricher = LeadEnricher()\nresult = enricher.enrich_lead({'name': 'Ananya Birla', 'location': 'Mumbai'})\nprint(json.dumps(result))`;
    const pyRawOutput = execSync(`python3 -c "${testPyCode.replace(/\n/g, '; ')}"`, { encoding: 'utf-8' });
    directScoutResult = JSON.parse(pyRawOutput.trim());
    assert(
      typeof directScoutResult === 'object' && directScoutResult !== null,
      '6. Scout LeadEnricher returns valid result object'
    );
  } catch (err: any) {
    assert(false, '6. Scout LeadEnricher returns valid result object', err.message);
  }

  // ------------------------------------------------------------------
  // STEP 2: REAL ENRICHMENT THROUGH leadService.triggerEnrichment
  // ------------------------------------------------------------------
  console.log('\n--- STEP 2: REAL ENRICHMENT VIA leadService.triggerEnrichment ---');

  const testLeadIdStr = `GF-P6B-SCOUT-${Date.now()}`;
  const testLead = await supabaseDataService.leads.createLead({
    lead_id: testLeadIdStr,
    name: 'Ananya Birla',
    phone: '+919876543210',
    email: 'ananya.birla@example.com',
    source: 'CSV_IMPORT',
    status: 'RAW',
  });

  assert(Boolean(testLead && testLead.id), `Test lead created with lead_id: ${testLeadIdStr}`);

  // Trigger enrichment through leadService
  console.log('  -> Invoking leadService.triggerEnrichment(testLead.lead_id)...');
  const enrichedLeadResult = await leadService.triggerEnrichment(testLead.lead_id);

  assert(Boolean(enrichedLeadResult), '1. leadService.triggerEnrichment executed without throwing');

  // Verify DB state for lead
  const dbLeadAfter = await supabaseDataService.leads.getLead(testLead.id);
  assert(dbLeadAfter?.status === 'ENRICHED', `9. lead.status updated to ENRICHED (current: ${dbLeadAfter?.status})`);

  // Verify lead_enrichment persistence
  const enrichments = await supabaseDataService.leadEnrichment.getEnrichment(testLead.id);
  assert(enrichments.length > 0, '4. A lead_enrichment record is persisted in DB');

  const primaryEnrichment = enrichments[0];
  if (primaryEnrichment) {
    assert(primaryEnrichment.platform === 'scout', `5. source/platform is "scout" (actual: ${primaryEnrichment.platform})`);
    assert(
      typeof primaryEnrichment.raw_data === 'object' && primaryEnrichment.raw_data !== null,
      '7. Raw data preserved in lead_enrichment record'
    );
    assert(
      typeof primaryEnrichment.enriched_data === 'object' && primaryEnrichment.enriched_data !== null,
      '7. Normalized signals preserved in enriched_data'
    );
  } else {
    assert(false, '5. source/platform is scout', 'No lead_enrichment record found');
    assert(false, '7. Raw data & normalized signals preserved', 'No lead_enrichment record found');
  }

  // Verify LEAD_ENRICHED audit event
  const events = await supabaseDataService.leadEvents.getLeadEvents(testLead.id);
  const enrichmentStartedEvent = events.find((e) => e.event_type === 'LEAD_ENRICHMENT_STARTED');
  const enrichmentCompletedEvent = events.find((e) => e.event_type === 'LEAD_ENRICHED');

  assert(Boolean(enrichmentStartedEvent), 'LEAD_ENRICHMENT_STARTED audit event created');
  assert(Boolean(enrichmentCompletedEvent), '8. LEAD_ENRICHED audit event created');

  if (enrichmentCompletedEvent) {
    const eventData = enrichmentCompletedEvent.event_data as Record<string, any>;
    assert(
      eventData.source === 'scout',
      `5. Audit event source is scout (actual: ${eventData.source})`
    );
    assert(
      eventData.truth_level === 'INFERRED',
      `6. source truth_level remains INFERRED (actual: ${eventData.truth_level})`
    );
  } else {
    assert(false, '6. source truth_level remains INFERRED', 'LEAD_ENRICHED event missing');
  }

  // ------------------------------------------------------------------
  // STEP 3: CONTROLLED FAILURE-PATH TEST
  // ------------------------------------------------------------------
  console.log('\n--- STEP 3: CONTROLLED FAILURE-PATH TEST ---');

  const failureLeadIdStr = `GF-P6B-FAIL-${Date.now()}`;
  const failureLead = await supabaseDataService.leads.createLead({
    lead_id: failureLeadIdStr,
    name: 'Failure Test Buyer',
    phone: '+919999999999',
    source: 'CSV_IMPORT',
    status: 'RAW',
  });

  // Temporarily use an invalid adapter instance to force enrichment error safely
  const originalCheckHealth = scoutAdapter.checkHealth.bind(scoutAdapter);

  try {
    // Override checkHealth to return unavailable error
    (scoutAdapter as any).checkHealth = async () => ({
      available: false,
      latency_ms: 5,
      error_code: 'SCOUT_UNAVAILABLE',
      error_message: 'Simulated Scout failure for testing error handling',
    });

    const failedLeadResult = await leadService.triggerEnrichment(failureLead.lead_id);
    assert(Boolean(failedLeadResult), '1. Failure path executed gracefully without crashing application');

    const dbFailLead = await supabaseDataService.leads.getLead(failureLead.id);
    assert(
      dbFailLead?.status === 'ENRICHMENT_FAILED',
      `2. lead.status set to ENRICHMENT_FAILED (actual: ${dbFailLead?.status})`
    );

    const failEvents = await supabaseDataService.leadEvents.getLeadEvents(failureLead.id);
    const failEvent = failEvents.find((e) => e.event_type === 'LEAD_ENRICHMENT_FAILED');
    assert(Boolean(failEvent), '3. LEAD_ENRICHMENT_FAILED audit event created');

    const failEnrichments = await supabaseDataService.leadEnrichment.getEnrichment(failureLead.id);
    assert(failEnrichments.length === 0, '4. No fabricated enrichment data persisted on failure');
  } catch (err: any) {
    assert(false, 'Controlled failure path', err.message);
  } finally {
    // Restore checkHealth
    (scoutAdapter as any).checkHealth = originalCheckHealth;
  }

  // ------------------------------------------------------------------
  // STEP 4: REGRESSION TEST SUITE EXECUTION
  // ------------------------------------------------------------------
  console.log('\n--- STEP 4: REGRESSION TEST EXECUTION ---');

  // Executing Phase 5F Comprehensive Suite directly verifies all 25 test cases
  // across Phase 4A, 4B, 5A, 5B, 5C, 5D, 5E, and 5F.
  try {
    const regOutput = execSync(`./node_modules/.bin/tsx tests/phase5f-broker-handoff.ts`, {
      encoding: 'utf-8',
      env: { ...process.env, SKIP_INNER_RECURSION: 'true' },
    });
    assert(
      regOutput.includes('ALL 25 PHASE 5F') || regOutput.includes('Passed      : 25') || regOutput.includes('Failed      : 0'),
      'Regression passed: Phase 5F Broker Handoff & CRM Routing (25/25)'
    );
  } catch (err: any) {
    assert(false, 'Regression passed: Phase 5F Broker Handoff & CRM Routing', err.message);
  }

  console.log('\n============================================================');
  console.log(`PHASE 6B SCOUT VERIFICATION SUMMARY`);
  console.log(`Total Checks: ${passedCount + failedCount}`);
  console.log(`Passed      : ${passedCount}`);
  console.log(`Failed      : ${failedCount}`);
  console.log('============================================================\n');

  if (failedCount === 0) {
    console.log('VERDICT: LIVE SCOUT VERIFIED\n');
    process.exit(0);
  } else {
    console.log('VERDICT: LIVE SCOUT NOT VERIFIED\n');
    process.exit(1);
  }
}

runPhase6bLiveScoutSuite().catch((err) => {
  console.error('Fatal error running Phase 6B Scout verification suite:', err);
  console.log('\nVERDICT: LIVE SCOUT NOT VERIFIED\n');
  process.exit(1);
});
