/**
 * GrowthForge Buyer Intelligence Engine - Phase 8B.1 Test Suite
 * Broker Command Center & Dashboard Verification
 */

import {
  calculateBrokerKPIs,
  getRecommendedActionAndSLA,
  filterAndSortPriorityQueue,
  DashboardFilters,
} from '../src/services/brokerDashboardService';
import { INITIAL_SEEDED_LEADS } from '../src/services/data/seedData';
import { GFBuyerLead } from '../src/types/buyerLead';
import { DbBrokerHandoff } from '../app/schemas/database';
import { supabaseDataService } from '../app/services/supabase/repositories';
import { DEFAULT_TENANT_ID } from '../app/schemas/tenant';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runTest(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`  ✅ PASS: ${name}`);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    results.push({ name, passed: false, error: errMsg });
    console.error(`  ❌ FAIL: ${name}\n     Error: ${errMsg}`);
  }
}

async function runPhase8B1TestSuite() {
  console.log('============================================================');
  console.log('GROWTHFORGE BUYER INTELLIGENCE ENGINE');
  console.log('PHASE 8B.1 — BROKER COMMAND CENTER VERIFICATION');
  console.log('============================================================\n');

  // Test 1: KPI Calculation
  await runTest('1. KPI calculation (HOT, WARM, NEEDS ACTION, PROJECT MATCHED, HANDOFF PENDING)', () => {
    const kpis = calculateBrokerKPIs(INITIAL_SEEDED_LEADS, []);
    assert(kpis.hotCount === 1, `HOT count should be 1, received ${kpis.hotCount}`);
    assert(kpis.warmCount === 2, `WARM count should be 2, received ${kpis.warmCount}`);
    assert(kpis.projectMatchedCount === 3, `Project matched count should be 3, received ${kpis.projectMatchedCount}`);
    assert(kpis.handoffPendingCount === 5, `Handoff pending count should be 5, received ${kpis.handoffPendingCount}`);
    assert(kpis.needsActionCount >= 3, `Needs action count should be >= 3, received ${kpis.needsActionCount}`);
  });

  // Test 2: Recommended Action & SLA Matrix
  await runTest('2. Recommended Action & SLA Matrix mapping for HOT, WARM, NURTURE, REVIEW', () => {
    const hotLead = INITIAL_SEEDED_LEADS[0]; // Rahul Sharma - HOT
    const slaHot = getRecommendedActionAndSLA(hotLead);
    assert(slaHot.action === 'CONTACT NOW', `HOT action should be CONTACT NOW, got ${slaHot.action}`);
    assert(slaHot.slaMinutes === 15, `HOT SLA should be 15m, got ${slaHot.slaMinutes}`);

    const warmLead = INITIAL_SEEDED_LEADS[1]; // Ananya Deshmukh - WARM
    const slaWarm = getRecommendedActionAndSLA(warmLead);
    assert(slaWarm.action === 'SENIOR ADVISOR FOLLOW-UP', `WARM action should be SENIOR ADVISOR FOLLOW-UP, got ${slaWarm.action}`);
    assert(slaWarm.slaMinutes === 120, `WARM SLA should be 120m, got ${slaWarm.slaMinutes}`);

    const nurtureLead = INITIAL_SEEDED_LEADS[3]; // Sunil Gupta - NURTURE
    const slaNurture = getRecommendedActionAndSLA(nurtureLead);
    assert(slaNurture.action === 'NURTURE', `NURTURE action should be NURTURE, got ${slaNurture.action}`);
    assert(slaNurture.slaMinutes === 1440, `NURTURE SLA should be 1440m, got ${slaNurture.slaMinutes}`);
  });

  // Test 3: Deterministic Priority Queue Ordering
  await runTest('3. Priority queue ordering (HOT first -> Score DESC -> Updated DESC -> Lead ID ASC)', () => {
    const sorted = filterAndSortPriorityQueue(INITIAL_SEEDED_LEADS, new Map(), {});
    assert(sorted[0].lead_id === 'GF-2026-000001', 'First lead must be HOT (GF-2026-000001)');
    assert(
      sorted[1].lead_intelligence.qualification === 'WARM',
      'Second lead must be WARM'
    );
    // Score comparison among WARM leads (88 vs 86)
    const idx2 = sorted.findIndex((l) => l.lead_id === 'GF-2026-000003'); // 88
    const idx3 = sorted.findIndex((l) => l.lead_id === 'GF-2026-000002'); // 86
    assert(idx2 < idx3, 'Higher score WARM lead (88) must precede lower score WARM lead (86)');
  });

  // Test 4: Filtering
  await runTest('4. Multi-criteria filtering (Temperature, Property Type, Search Query)', () => {
    const hotFiltered = filterAndSortPriorityQueue(INITIAL_SEEDED_LEADS, new Map(), { temperature: 'HOT' });
    assert(hotFiltered.length === 1, `HOT filter should return 1 lead, got ${hotFiltered.length}`);
    assert(hotFiltered[0].lead_id === 'GF-2026-000001', 'HOT filtered lead ID should be GF-2026-000001');

    const searchFiltered = filterAndSortPriorityQueue(INITIAL_SEEDED_LEADS, new Map(), { searchQuery: 'Deshmukh' });
    assert(searchFiltered.length === 1, 'Search query Deshmukh should return 1 lead');
    assert(searchFiltered[0].identity.full_name.includes('Deshmukh'), 'Filtered name should contain Deshmukh');

    const apartmentFiltered = filterAndSortPriorityQueue(INITIAL_SEEDED_LEADS, new Map(), { propertyType: 'Apartment' });
    assert(apartmentFiltered.length >= 2, 'Apartment filter should return at least 2 leads');
  });

  // Test 5: AI Recommendation vs Buyer Confirmed State
  await runTest('5. AI Recommendation vs Buyer Confirmed state preservation in detail mapping', () => {
    const lead = INITIAL_SEEDED_LEADS[0];
    const topMatches = lead.project_intelligence?.top_matches || [];
    assert(topMatches.length > 0, 'Top matches must exist');
    const match1 = topMatches[0];
    const match2 = topMatches[1];

    assert(match1.buyer_confirmed === true, 'First match has explicitly confirmed buyer state');
    assert(match2.buyer_confirmed === false, 'Second match must remain buyer_confirmed=false (AI Recommendation)');
  });

  // Test 6: Repository Tenant Scoping Isolation
  await runTest('6. Tenant isolation at repository boundary', async () => {
    const leadsDefaultTenant = await supabaseDataService.leads.listLeads(DEFAULT_TENANT_ID);
    assert(Array.isArray(leadsDefaultTenant), 'Repository return must be array');

    const isolatedTenantId = '88888888-8888-8888-8888-888888888888';
    const leadsIsolatedTenant = await supabaseDataService.leads.listLeads(isolatedTenantId);
    assert(leadsIsolatedTenant.length === 0, 'Isolated empty tenant must return 0 leads');
  });

  // Summary
  const passedCount = results.filter((r) => r.passed).length;
  console.log(`\n============================================================`);
  console.log(`PHASE 8B.1 BROKER DASHBOARD TEST RESULTS: ${passedCount}/${results.length} PASSED`);
  console.log(`============================================================`);

  if (passedCount < results.length) {
    process.exit(1);
  }
}

runPhase8B1TestSuite();
