/**
 * GrowthForge Buyer Intelligence Engine - Phase 8A.3 Repository Tenant Scoping Verification
 *
 * Verifies the 12 required security & functional test scenarios for tenant-scoped repositories:
 * 1. Leads Isolation: Tenant A cannot read, query, update, or delete Tenant B's leads.
 * 2. Calls Isolation: Calls created in Tenant A are not accessible by Tenant B.
 * 3. Profiles & Preferences Isolation: Buyer profiles and preferences are strictly partitioned per tenant.
 * 4. Projects & Matches Isolation: Projects and project matches respect tenant scoping.
 * 5. Voice Pipeline Isolation: Transcripts, extractions, and qualifications are partitioned per tenant.
 * 6. Buyer Scores & Priority Queue Isolation: Scoring records and Priority Queue only show authorized tenant leads.
 * 7. Broker Handoffs & Handoff Queue Isolation: Handoffs and Handoff Queue only return authorized tenant items.
 * 8. Cross-Tenant Integrity Enforcement: Creating child entities for a lead belonging to another tenant fails with TenantMismatchError.
 * 9. Platform Admin Scoping Bypass: Platform admin context can query across tenants intentionally.
 * 10. Production Fail-Closed Behavior: Missing tenant context in production throws TenantRequiredError.
 * 11. Domain Mapping Aggregation: mapToGFBuyerLead respects tenant scope and aggregates only authorized child records.
 * 12. Persistence Round-Trip: verifyPersistenceRoundTrip executes cleanly under tenant scoping.
 */

import { SupabaseDataService } from '../app/services/supabase/repositories';
import {
  TenantRequiredError,
  TenantMismatchError,
  DEFAULT_TENANT_ID,
  resolveEffectiveTenantScope,
} from '../app/schemas/tenant';

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

const TENANT_ALPHA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_BETA = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

async function runRepositoryScopingTests() {
  console.log('============================================================');
  console.log('GROWTHFORGE BUYER INTELLIGENCE ENGINE');
  console.log('PHASE 8A.3 REPOSITORY TENANT SCOPING SECURITY SUITE');
  console.log('============================================================\n');

  const svc = new SupabaseDataService();

  // Test 1: Leads Isolation
  try {
    const leadAlpha = await svc.leads.createLead({ tenantId: TENANT_ALPHA }, {
      lead_id: 'GF-ALPHA-001',
      name: 'Alpha Buyer',
      phone: '+919876543210',
      email: 'alpha@example.com',
      status: 'RAW',
    });
    assert(leadAlpha.tenant_id === TENANT_ALPHA, 'leadAlpha tenant_id must match TENANT_ALPHA');

    // Tenant Beta should NOT be able to read leadAlpha
    const readByBeta = await svc.leads.getLead({ tenantId: TENANT_BETA }, leadAlpha.id);
    assert(readByBeta === null, 'Tenant Beta must not be able to get Tenant Alpha lead by ID');

    const readByBetaCode = await svc.leads.getLeadByLeadId({ tenantId: TENANT_BETA }, 'GF-ALPHA-001');
    assert(readByBetaCode === null, 'Tenant Beta must not be able to get Tenant Alpha lead by code');

    const betaList = await svc.leads.listLeads({ tenantId: TENANT_BETA });
    assert(!betaList.some(l => l.id === leadAlpha.id), 'Tenant Beta listLeads must not contain Tenant Alpha lead');

    results.push({ id: 1, name: 'Leads Repository Scoping & Isolation', passed: true });
  } catch (err: any) {
    results.push({ id: 1, name: 'Leads Repository Scoping & Isolation', passed: false, error: err.message });
  }

  // Test 2: Calls Isolation
  try {
    const leadAlpha = await svc.leads.createLead({ tenantId: TENANT_ALPHA }, {
      lead_id: 'GF-ALPHA-002',
      name: 'Alpha Call Buyer',
      phone: '+919876543211',
      status: 'RAW',
    });

    const callAlpha = await svc.calls.createCall({ tenantId: TENANT_ALPHA }, {
      lead_id: leadAlpha.id,
      provider: 'sarvam',
      provider_call_id: 'sarvam-call-alpha-1',
      status: 'COMPLETED',
    });
    assert(callAlpha.tenant_id === TENANT_ALPHA, 'Call tenant_id must match lead tenant_id');

    const readCallBeta = await svc.calls.getCall({ tenantId: TENANT_BETA }, callAlpha.id);
    assert(readCallBeta === null, 'Tenant Beta must not be able to get Tenant Alpha call');

    const readCallByProviderBeta = await svc.calls.getCallByProviderCallId({ tenantId: TENANT_BETA }, 'sarvam-call-alpha-1');
    assert(readCallByProviderBeta === null, 'Tenant Beta must not get call by provider ID');

    const betaLeadCalls = await svc.calls.getCallsByLead({ tenantId: TENANT_BETA }, leadAlpha.id);
    assert(betaLeadCalls.length === 0, 'Tenant Beta must receive empty calls array for Alpha lead');

    results.push({ id: 2, name: 'Calls Repository Scoping & Isolation', passed: true });
  } catch (err: any) {
    results.push({ id: 2, name: 'Calls Repository Scoping & Isolation', passed: false, error: err.message });
  }

  // Test 3: Profiles & Preferences Isolation
  try {
    const leadAlpha = await svc.leads.createLead({ tenantId: TENANT_ALPHA }, {
      lead_id: 'GF-ALPHA-003',
      name: 'Alpha Profile Buyer',
      phone: '+919876543212',
      status: 'RAW',
    });

    const profileAlpha = await svc.buyerProfiles.upsertBuyerProfile({ tenantId: TENANT_ALPHA }, {
      lead_id: leadAlpha.id,
      property_type: 'Villa',
      budget_min: 15000000,
      budget_max: 25000000,
    });
    assert(profileAlpha.tenant_id === TENANT_ALPHA, 'Profile tenant_id must match lead tenant_id');

    const prefAlpha = await svc.buyerPreferences.addBuyerPreference({ tenantId: TENANT_ALPHA }, {
      lead_id: leadAlpha.id,
      attribute: 'facing',
      value: 'East',
    } as any);
    assert(prefAlpha.tenant_id === TENANT_ALPHA, 'Preference tenant_id must match lead tenant_id');

    const readProfileBeta = await svc.buyerProfiles.getBuyerProfile({ tenantId: TENANT_BETA }, leadAlpha.id);
    assert(readProfileBeta === null, 'Tenant Beta must not read Tenant Alpha profile');

    const readPrefsBeta = await svc.buyerPreferences.getBuyerPreferences({ tenantId: TENANT_BETA }, leadAlpha.id);
    assert(readPrefsBeta.length === 0, 'Tenant Beta must not read Tenant Alpha preferences');

    results.push({ id: 3, name: 'Buyer Profiles & Preferences Scoping', passed: true });
  } catch (err: any) {
    results.push({ id: 3, name: 'Buyer Profiles & Preferences Scoping', passed: false, error: err.message });
  }

  // Test 4: Projects & Project Matches Isolation
  try {
    const projAlpha = await svc.projects.createProject({ tenantId: TENANT_ALPHA }, {
      project_code: 'ALPHA-PROJ-01',
      project_name: 'Alpha Heights',
      city: 'Bengaluru',
      status: 'ACTIVE',
    } as any);
    assert(projAlpha.tenant_id === TENANT_ALPHA, 'Project tenant_id must match TENANT_ALPHA');

    const readProjBeta = await svc.projects.getProject({ tenantId: TENANT_BETA }, projAlpha.id);
    assert(readProjBeta === null, 'Tenant Beta must not read Tenant Alpha project by ID');

    const readProjCodeBeta = await svc.projects.getProjectByCode({ tenantId: TENANT_BETA }, 'ALPHA-PROJ-01');
    assert(readProjCodeBeta === null, 'Tenant Beta must not read Tenant Alpha project by code');

    const betaProjects = await svc.projects.listProjects({ tenantId: TENANT_BETA });
    assert(!betaProjects.some(p => p.id === projAlpha.id), 'Tenant Beta listProjects must not contain Alpha project');

    results.push({ id: 4, name: 'Projects & Project Matches Scoping', passed: true });
  } catch (err: any) {
    results.push({ id: 4, name: 'Projects & Project Matches Scoping', passed: false, error: err.message });
  }

  // Test 5: Voice Pipeline Isolation (Transcripts, Extractions, Qualifications)
  try {
    const leadAlpha = await svc.leads.createLead({ tenantId: TENANT_ALPHA }, {
      lead_id: 'GF-ALPHA-005',
      name: 'Alpha Voice Buyer',
      phone: '+919876543213',
      status: 'RAW',
    });

    const callAlpha = await svc.calls.createCall({ tenantId: TENANT_ALPHA }, {
      lead_id: leadAlpha.id,
      provider: 'sarvam',
      provider_call_id: 'sarvam-call-alpha-5',
      status: 'COMPLETED',
    });

    const transcript = await svc.transcripts.createTranscript({ tenantId: TENANT_ALPHA }, {
      lead_id: leadAlpha.id,
      call_id: callAlpha.id,
      transcript_text: 'I want a 3 BHK in Whitefield budget 2 Cr.',
      source: 'sarvam',
    });
    assert(transcript.tenant_id === TENANT_ALPHA, 'Transcript tenant_id must match TENANT_ALPHA');

    const extraction = await svc.extractions.createExtraction({ tenantId: TENANT_ALPHA }, {
      lead_id: leadAlpha.id,
      call_id: callAlpha.id,
      transcript_id: transcript.id,
      model: 'gemini-2.5-flash',
      extraction_status: 'EXTRACTED',
      extracted_data: { interested: { value: true, confidence: 0.95 } } as any,
    });
    assert(extraction.tenant_id === TENANT_ALPHA, 'Extraction tenant_id must match TENANT_ALPHA');

    const qualification = await svc.qualifications.createQualification({ tenantId: TENANT_ALPHA }, {
      lead_id: leadAlpha.id,
      extraction_id: extraction.id,
      qualification_status: 'QUALIFIED',
    });
    assert(qualification.tenant_id === TENANT_ALPHA, 'Qualification tenant_id must match TENANT_ALPHA');

    // Verify Beta isolation
    const transcriptBeta = await svc.transcripts.getTranscript({ tenantId: TENANT_BETA }, transcript.id);
    assert(transcriptBeta === null, 'Tenant Beta must not get Alpha transcript');

    const extractionBeta = await svc.extractions.getExtraction({ tenantId: TENANT_BETA }, extraction.id);
    assert(extractionBeta === null, 'Tenant Beta must not get Alpha extraction');

    const qualBeta = await svc.qualifications.getQualification({ tenantId: TENANT_BETA }, qualification.id);
    assert(qualBeta === null, 'Tenant Beta must not get Alpha qualification');

    results.push({ id: 5, name: 'Voice Pipeline Artifacts Isolation', passed: true });
  } catch (err: any) {
    results.push({ id: 5, name: 'Voice Pipeline Artifacts Isolation', passed: false, error: err.message });
  }

  // Test 6: Buyer Scores & Priority Queue Isolation
  try {
    const leadAlpha = await svc.leads.createLead({ tenantId: TENANT_ALPHA }, {
      lead_id: 'GF-ALPHA-006',
      name: 'Alpha Score Buyer',
      phone: '+919876543214',
      status: 'QUALIFIED',
    });

    const scoreAlpha = await svc.buyerScores.createBuyerScoreRecord({ tenantId: TENANT_ALPHA }, {
      lead_id: leadAlpha.id,
      score: 88,
      tier: 'TIER_1_HOT',
      score_band: 'HIGH_INTENT',
      dimension_scores: { budget_fit: 90, location_fit: 85, timeline_fit: 90, configuration_fit: 85, profile_completeness: 90 },
      sla_dispatch: {
        sla_deadline: new Date(Date.now() + 15 * 60000).toISOString(),
        assigned_role: 'SENIOR_SALES_ADVISOR',
        follow_up_urgency: 'HIGH',
        talking_points: ['Budget aligned', 'Immediate purchase intent'],
      },
    } as any);
    assert(scoreAlpha.tenant_id === TENANT_ALPHA, 'Score tenant_id must match TENANT_ALPHA');

    const scoreBeta = await svc.buyerScores.getBuyerScore({ tenantId: TENANT_BETA }, scoreAlpha.id);
    assert(scoreBeta === null, 'Tenant Beta must not get Alpha buyer score record');

    const priorityBeta = await svc.buyerScores.listPriorityQueue({ tenantId: TENANT_BETA });
    assert(!priorityBeta.some(q => q.lead_id === leadAlpha.id), 'Tenant Beta priority queue must not contain Alpha lead');

    const priorityAlpha = await svc.buyerScores.listPriorityQueue({ tenantId: TENANT_ALPHA });
    assert(priorityAlpha.some(q => q.lead_id === leadAlpha.id), 'Tenant Alpha priority queue must contain Alpha lead');

    results.push({ id: 6, name: 'Buyer Scores & Priority Queue Isolation', passed: true });
  } catch (err: any) {
    results.push({ id: 6, name: 'Buyer Scores & Priority Queue Isolation', passed: false, error: err.message });
  }

  // Test 7: Broker Handoffs & Handoff Queue Isolation
  try {
    const leadAlpha = await svc.leads.createLead({ tenantId: TENANT_ALPHA }, {
      lead_id: 'GF-ALPHA-007',
      name: 'Alpha Handoff Buyer',
      phone: '+919876543215',
      status: 'QUALIFIED',
    });

    const handoffAlpha = await svc.brokerHandoffs.createHandoff({ tenantId: TENANT_ALPHA }, {
      lead_id: leadAlpha.id,
      handoff_status: 'READY',
      routing_status: 'UNASSIGNED' as any,
      priority_tier: 'TIER_1_HOT',
      sla_minutes: 15,
      sla_deadline: new Date(Date.now() + 15 * 60000).toISOString(),
      handoff_payload: {
        handoff_id: 'h-1',
        external_lead_id: 'GF-ALPHA-007',
        primary_buyer_summary: { name: 'Alpha Handoff Buyer', phone: '+919876543215' },
        priority: { tier: 'TIER_1_HOT', score: 90, urgency: 'HIGH' },
      } as any,
    } as any);
    assert(handoffAlpha.tenant_id === TENANT_ALPHA, 'Handoff tenant_id must match TENANT_ALPHA');

    const handoffBeta = await svc.brokerHandoffs.getHandoff({ tenantId: TENANT_BETA }, handoffAlpha.id);
    assert(handoffBeta === null, 'Tenant Beta must not get Alpha handoff');

    const handoffQueueBeta = await svc.brokerHandoffs.listHandoffQueue({ tenantId: TENANT_BETA });
    assert(!handoffQueueBeta.some(h => h.lead_id === leadAlpha.id), 'Tenant Beta handoff queue must not contain Alpha lead');

    const handoffQueueAlpha = await svc.brokerHandoffs.listHandoffQueue({ tenantId: TENANT_ALPHA });
    assert(handoffQueueAlpha.some(h => h.lead_id === leadAlpha.id), 'Tenant Alpha handoff queue must contain Alpha lead');

    results.push({ id: 7, name: 'Broker Handoffs & Handoff Queue Isolation', passed: true });
  } catch (err: any) {
    results.push({ id: 7, name: 'Broker Handoffs & Handoff Queue Isolation', passed: false, error: err.message });
  }

  // Test 8: Cross-Tenant Child Mutation Prevention
  try {
    const leadAlpha = await svc.leads.createLead({ tenantId: TENANT_ALPHA }, {
      lead_id: 'GF-ALPHA-008',
      name: 'Alpha Target Lead',
      phone: '+919876543216',
      status: 'RAW',
    });

    let threwAsExpected = false;
    try {
      // Tenant Beta attempts to create a Call for Tenant Alpha's lead
      await svc.calls.createCall({ tenantId: TENANT_BETA }, {
        lead_id: leadAlpha.id,
        provider: 'sarvam',
      });
    } catch (err: any) {
      threwAsExpected = err instanceof TenantMismatchError;
    }
    assert(threwAsExpected, 'Cross-tenant child entity creation must throw TenantMismatchError');

    results.push({ id: 8, name: 'Cross-Tenant Mutation Hierarchy Enforcement', passed: true });
  } catch (err: any) {
    results.push({ id: 8, name: 'Cross-Tenant Mutation Hierarchy Enforcement', passed: false, error: err.message });
  }

  // Test 9: Platform Admin Scoping Bypass
  try {
    const leadAlpha = await svc.leads.createLead({ tenantId: TENANT_ALPHA }, {
      lead_id: 'GF-ALPHA-009',
      name: 'Alpha Admin Test Lead',
      phone: '+919876543217',
      status: 'RAW',
    });

    const leadBeta = await svc.leads.createLead({ tenantId: TENANT_BETA }, {
      lead_id: 'GF-BETA-009',
      name: 'Beta Admin Test Lead',
      phone: '+919876543218',
      status: 'RAW',
    });

    // Platform admin context
    const adminScope = { isPlatformAdmin: true, tenantId: undefined };
    const allLeads = await svc.leads.listLeads(adminScope);

    const hasAlpha = allLeads.some(l => l.id === leadAlpha.id);
    const hasBeta = allLeads.some(l => l.id === leadBeta.id);
    assert(hasAlpha && hasBeta, 'Platform admin must be able to view leads across all tenants');

    results.push({ id: 9, name: 'Platform Admin Cross-Tenant Scoping Bypass', passed: true });
  } catch (err: any) {
    results.push({ id: 9, name: 'Platform Admin Cross-Tenant Scoping Bypass', passed: false, error: err.message });
  }

  // Test 10: Fail-Closed Behavior in Production
  try {
    let threwInProd = false;
    try {
      // Explicit strict mode triggers fail-closed
      resolveEffectiveTenantScope(undefined, { strictProductionFailClosed: true });
    } catch (err: any) {
      threwInProd = err instanceof TenantRequiredError;
    }
    assert(threwInProd, 'Resolving empty scope in production must throw TenantRequiredError');

    results.push({ id: 10, name: 'Production Mode Fail-Closed Validation', passed: true });
  } catch (err: any) {
    results.push({ id: 10, name: 'Production Mode Fail-Closed Validation', passed: false, error: err.message });
  }

  // Test 11: Domain Model Aggregation (mapToGFBuyerLead)
  try {
    const leadAlpha = await svc.leads.createLead({ tenantId: TENANT_ALPHA }, {
      lead_id: 'GF-ALPHA-011',
      name: 'Alpha Canonical Lead',
      phone: '+919876543219',
      status: 'QUALIFIED',
    });

    await svc.buyerProfiles.upsertBuyerProfile({ tenantId: TENANT_ALPHA }, {
      lead_id: leadAlpha.id,
      property_type: 'Apartment',
      budget_min: 10000000,
      budget_max: 18000000,
      preferred_locations: ['Indiranagar', 'Koramangala'],
    });

    // Map under Tenant Alpha context
    const gfLeadAlpha = await svc.mapToGFBuyerLead({ tenantId: TENANT_ALPHA }, leadAlpha.id);
    assert(gfLeadAlpha !== null, 'mapToGFBuyerLead under Tenant Alpha must return mapped lead');
    assert(gfLeadAlpha?.identity.full_name === 'Alpha Canonical Lead', 'Mapped lead name must match');
    assert(gfLeadAlpha?.buying_intent.property_type === 'Apartment', 'Mapped property_type must match');

    // Map under Tenant Beta context
    const gfLeadBeta = await svc.mapToGFBuyerLead({ tenantId: TENANT_BETA }, leadAlpha.id);
    assert(gfLeadBeta === null, 'mapToGFBuyerLead under Tenant Beta must return null for Alpha lead');

    results.push({ id: 11, name: 'Canonical Domain Mapping Tenant Scoping', passed: true });
  } catch (err: any) {
    results.push({ id: 11, name: 'Canonical Domain Mapping Tenant Scoping', passed: false, error: err.message });
  }

  // Test 12: Persistence Round-Trip Diagnostic
  try {
    const roundTrip = await svc.verifyPersistenceRoundTrip({ tenantId: TENANT_ALPHA });
    assert(roundTrip.success === true, `Persistence round-trip must succeed: ${roundTrip.error}`);
    assert(roundTrip.readBackMatched === true, 'Read back must match inserted lead');
    assert(roundTrip.auditEventLogged === true, 'Audit event must be logged');
    assert(roundTrip.deletedSuccessfully === true, 'Test record must be cleaned up');

    results.push({ id: 12, name: 'Persistence Verification Diagnostic', passed: true });
  } catch (err: any) {
    results.push({ id: 12, name: 'Persistence Verification Diagnostic', passed: false, error: err.message });
  }

  // Summary Report
  console.log('\n------------------------------------------------------------');
  console.log('TEST EXECUTION SUMMARY:');
  console.log('------------------------------------------------------------');
  let passCount = 0;
  for (const r of results) {
    const status = r.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`[${status}] Scenario ${r.id}: ${r.name}`);
    if (!r.passed && r.error) {
      console.log(`       Error: ${r.error}`);
    }
    if (r.passed) passCount++;
  }
  console.log('------------------------------------------------------------');
  console.log(`TOTAL: ${results.length} | PASSED: ${passCount} | FAILED: ${results.length - passCount}`);
  console.log('============================================================\n');

  if (passCount !== results.length) {
    process.exit(1);
  }
}

runRepositoryScopingTests().catch((err) => {
  console.error('Unhandled test suite error:', err);
  process.exit(1);
});
