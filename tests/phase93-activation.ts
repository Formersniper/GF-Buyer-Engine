/**
 * GrowthForge Buyer Intelligence Engine - Phase 9.3.2 Lead Activation & Atomic Claim Test Matrix
 *
 * SPECIFICATION:
 * - Domain-level Lead Activation Service with atomic mutual-exclusion claim
 * - Enforces: EXACTLY ONE activation claim can succeed among concurrent workers
 * - Zero outbound phone calls dispatched during activation
 * - Zero MOCK_READY records created during activation
 * - Zero pipeline execution records created during activation
 * - Zero Gemini / Scout calls triggered during activation
 * - Deterministic re-evaluation of eligibility and compliance inside the lock boundary
 * - Strict multi-tenant isolation
 */

import { leadActivationService } from '../app/services/calls/leadActivationService';
import { supabaseDataService } from '../app/services/supabase/repositories';
import { callService } from '../app/services/calls/callService';
import { isCallAttempt } from '../app/services/calls/callCompliance';

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

export async function runPhase932Tests() {
  console.log('======================================================');
  console.log('🧪 GROWTHFORGE PHASE 9.3.2 — LEAD ACTIVATION & ATOMIC CLAIM');
  console.log('======================================================\n');

  const tenantA = '00000000-0000-0000-0000-000000000001';
  const tenantB = '00000000-0000-0000-0000-000000000002';

  // Deterministic calling hour: 2026-09-18T10:00:00Z -> 15:30 IST (inside 09:00 - 20:00)
  const insideCallingHours = '2026-09-18T10:00:00.000Z';
  // Outside calling hours: 2026-09-18T02:00:00Z -> 07:30 IST (outside)
  const outsideCallingHours = '2026-09-18T02:00:00.000Z';

  // -------------------------------------------------------------------------
  // 1. RESOLVED first-party inbound eligible lead activates into CALL_PENDING
  // -------------------------------------------------------------------------
  const lead1 = await supabaseDataService.leads.createLead({
    tenant_id: tenantA,
    lead_id: `GF-ACT-01-${Date.now()}`,
    name: 'First Party Inbound Buyer',
    phone: '+919876543210',
    email: 'fp1@example.com',
    source: 'WEB_FORM',
    status: 'RESOLVED',
  });
  // Add permissible consent to profile
  await supabaseDataService.buyerProfiles.upsertBuyerProfile({
    tenant_id: tenantA,
    lead_id: lead1.id,
    metadata: { consent_status: 'PERMISSIBLE' },
  } as any);

  const res1 = await leadActivationService.activateLead({
    tenantId: tenantA,
    leadId: lead1.id,
    actor: 'queue_worker',
    correlationId: 'corr-01',
    evaluatedAt: insideCallingHours,
  });

  assert('TEST-1', 'RESOLVED first-party inbound eligible lead activates into CALL_PENDING',
    res1.activated === true &&
    res1.decision === 'ACTIVATED' &&
    res1.newStatus === 'CALL_PENDING' &&
    typeof res1.claimId === 'string' &&
    res1.claimId.startsWith('claim-')
  );

  // -------------------------------------------------------------------------
  // 2. ENRICHED eligible lead activates into CALL_PENDING
  // -------------------------------------------------------------------------
  const lead2 = await supabaseDataService.leads.createLead({
    tenant_id: tenantA,
    lead_id: `GF-ACT-02-${Date.now()}`,
    name: 'Enriched Buyer',
    phone: '+919876543211',
    email: 'enr2@example.com',
    source: 'CSV_IMPORT',
    status: 'ENRICHED',
  });
  await supabaseDataService.buyerProfiles.upsertBuyerProfile({
    tenant_id: tenantA,
    lead_id: lead2.id,
    metadata: { consent_status: 'EXPLICIT_CONSENT' },
  } as any);

  const res2 = await leadActivationService.activateLead({
    tenantId: tenantA,
    leadId: lead2.id,
    actor: 'human_operator',
    correlationId: 'corr-02',
    evaluatedAt: insideCallingHours,
  });

  assert('TEST-2', 'ENRICHED eligible lead activates into CALL_PENDING',
    res2.activated === true &&
    res2.decision === 'ACTIVATED' &&
    res2.newStatus === 'CALL_PENDING'
  );

  // -------------------------------------------------------------------------
  // 3. Non-first-party RESOLVED lead is rejected (cannot bypass OSINT enrichment)
  // -------------------------------------------------------------------------
  const lead3 = await supabaseDataService.leads.createLead({
    tenant_id: tenantA,
    lead_id: `GF-ACT-03-${Date.now()}`,
    name: 'Cold List Buyer',
    phone: '+919876543212',
    source: 'COLD_LIST',
    status: 'RESOLVED',
  });
  await supabaseDataService.buyerProfiles.upsertBuyerProfile({
    tenant_id: tenantA,
    lead_id: lead3.id,
    metadata: { consent_status: 'PERMISSIBLE' },
  } as any);

  const res3 = await leadActivationService.activateLead({
    tenantId: tenantA,
    leadId: lead3.id,
    evaluatedAt: insideCallingHours,
  });

  assert('TEST-3', 'Non-first-party RESOLVED lead is rejected pending enrichment',
    res3.activated === false &&
    res3.decision === 'NOT_ELIGIBLE' &&
    res3.reasons[0].includes('Must undergo enrichment')
  );

  // -------------------------------------------------------------------------
  // 4. Invalid phone rejected
  // -------------------------------------------------------------------------
  const lead4 = await supabaseDataService.leads.createLead({
    tenant_id: tenantA,
    lead_id: `GF-ACT-04-${Date.now()}`,
    name: 'Invalid Phone Buyer',
    phone: '123',
    source: 'WEB_FORM',
    status: 'RESOLVED',
  });
  await supabaseDataService.buyerProfiles.upsertBuyerProfile({
    tenant_id: tenantA,
    lead_id: lead4.id,
    metadata: { consent_status: 'PERMISSIBLE' },
  } as any);

  const res4 = await leadActivationService.activateLead({
    tenantId: tenantA,
    leadId: lead4.id,
    evaluatedAt: insideCallingHours,
  });

  assert('TEST-4', 'Invalid phone rejected with NOT_ELIGIBLE',
    res4.activated === false &&
    res4.decision === 'NOT_ELIGIBLE' &&
    res4.eligibility?.phone_format_valid === false
  );

  // -------------------------------------------------------------------------
  // 5. Unknown/missing consent requires review
  // -------------------------------------------------------------------------
  const lead5 = await supabaseDataService.leads.createLead({
    tenant_id: tenantA,
    lead_id: `GF-ACT-05-${Date.now()}`,
    name: 'Unknown Consent Buyer',
    phone: '+919876543213',
    source: 'WEB_FORM',
    status: 'RESOLVED',
  });
  // No profile / unknown consent

  const res5 = await leadActivationService.activateLead({
    tenantId: tenantA,
    leadId: lead5.id,
    evaluatedAt: insideCallingHours,
  });

  assert('TEST-5', 'Unknown consent results in REQUIRES_REVIEW and lead status update',
    res5.activated === false &&
    res5.decision === 'REQUIRES_REVIEW' &&
    res5.newStatus === 'REQUIRES_REVIEW'
  );

  // -------------------------------------------------------------------------
  // 6. Explicit opt-out rejected immediately
  // -------------------------------------------------------------------------
  const lead6 = await supabaseDataService.leads.createLead({
    tenant_id: tenantA,
    lead_id: `GF-ACT-06-${Date.now()}`,
    name: 'Opt Out Buyer',
    phone: '+919876543214',
    source: 'WEB_FORM',
    status: 'RESOLVED',
  });
  await supabaseDataService.buyerProfiles.upsertBuyerProfile({
    tenant_id: tenantA,
    lead_id: lead6.id,
    metadata: { consent_status: 'OPT_OUT' },
  } as any);

  const res6 = await leadActivationService.activateLead({
    tenantId: tenantA,
    leadId: lead6.id,
    evaluatedAt: insideCallingHours,
  });

  assert('TEST-6', 'Explicit opt-out results in NOT_ELIGIBLE and routes to NURTURE',
    res6.activated === false &&
    res6.decision === 'NOT_ELIGIBLE' &&
    res6.newStatus === 'NURTURE'
  );

  // -------------------------------------------------------------------------
  // 7. Outside calling window rejected
  // -------------------------------------------------------------------------
  const lead7 = await supabaseDataService.leads.createLead({
    tenant_id: tenantA,
    lead_id: `GF-ACT-07-${Date.now()}`,
    name: 'Night Owl Buyer',
    phone: '+919876543215',
    source: 'WEB_FORM',
    status: 'RESOLVED',
  });
  await supabaseDataService.buyerProfiles.upsertBuyerProfile({
    tenant_id: tenantA,
    lead_id: lead7.id,
    metadata: { consent_status: 'PERMISSIBLE' },
  } as any);

  const res7 = await leadActivationService.activateLead({
    tenantId: tenantA,
    leadId: lead7.id,
    evaluatedAt: outsideCallingHours,
  });

  assert('TEST-7', 'Outside calling window rejected with OUTSIDE_CALLING_HOURS',
    res7.activated === false &&
    res7.decision === 'NOT_ELIGIBLE' &&
    res7.eligibility?.compliance?.decision === 'OUTSIDE_CALLING_HOURS'
  );

  // -------------------------------------------------------------------------
  // 8. Cooldown active rejected
  // -------------------------------------------------------------------------
  const lead8 = await supabaseDataService.leads.createLead({
    tenant_id: tenantA,
    lead_id: `GF-ACT-08-${Date.now()}`,
    name: 'Recently Called Buyer',
    phone: '+919876543216',
    source: 'WEB_FORM',
    status: 'RESOLVED',
  });
  await supabaseDataService.buyerProfiles.upsertBuyerProfile({
    tenant_id: tenantA,
    lead_id: lead8.id,
    metadata: { consent_status: 'PERMISSIBLE' },
  } as any);
  // Simulate call 60 minutes ago
  const oneHourAgo = new Date(Date.parse(insideCallingHours) - 60 * 60 * 1000).toISOString();
  await supabaseDataService.calls.createCall({
    tenant_id: tenantA,
    lead_id: lead8.id,
    provider: 'sarvam',
    status: 'CALLING',
    started_at: oneHourAgo,
    created_at: oneHourAgo,
  } as any);

  const res8 = await leadActivationService.activateLead({
    tenantId: tenantA,
    leadId: lead8.id,
    evaluatedAt: insideCallingHours,
  });

  assert('TEST-8', 'Active cooldown (attempt 1 hour ago) is rejected with COOLDOWN_ACTIVE',
    res8.activated === false &&
    res8.decision === 'NOT_ELIGIBLE' &&
    res8.eligibility?.compliance?.decision === 'COOLDOWN_ACTIVE'
  );

  // -------------------------------------------------------------------------
  // 9. Maximum attempts rejected
  // -------------------------------------------------------------------------
  const lead9 = await supabaseDataService.leads.createLead({
    tenant_id: tenantA,
    lead_id: `GF-ACT-09-${Date.now()}`,
    name: 'Fatigued Buyer',
    phone: '+919876543217',
    source: 'WEB_FORM',
    status: 'RESOLVED',
  });
  await supabaseDataService.buyerProfiles.upsertBuyerProfile({
    tenant_id: tenantA,
    lead_id: lead9.id,
    metadata: { consent_status: 'PERMISSIBLE' },
  } as any);
  // Add 3 past attempts separated by 5 hours each
  for (let i = 1; i <= 3; i++) {
    const pastTime = new Date(Date.parse(insideCallingHours) - (i * 300) * 60 * 1000).toISOString();
    await supabaseDataService.calls.createCall({
      tenant_id: tenantA,
      lead_id: lead9.id,
      provider: 'sarvam',
      status: 'NO_ANSWER',
      started_at: pastTime,
      created_at: pastTime,
    } as any);
  }

  const res9 = await leadActivationService.activateLead({
    tenantId: tenantA,
    leadId: lead9.id,
    evaluatedAt: insideCallingHours,
  });

  assert('TEST-9', 'Max attempts (3) is rejected with MAX_ATTEMPTS_EXCEEDED',
    res9.activated === false &&
    res9.decision === 'NOT_ELIGIBLE' &&
    res9.eligibility?.compliance?.decision === 'MAX_ATTEMPTS_EXCEEDED'
  );

  // -------------------------------------------------------------------------
  // 10. Already CALL_PENDING rejected as ALREADY_CLAIMED
  // -------------------------------------------------------------------------
  const lead10 = await supabaseDataService.leads.createLead({
    tenant_id: tenantA,
    lead_id: `GF-ACT-10-${Date.now()}`,
    name: 'Already Pending Buyer',
    phone: '+919876543218',
    source: 'WEB_FORM',
    status: 'CALL_PENDING',
  });

  const res10 = await leadActivationService.activateLead({
    tenantId: tenantA,
    leadId: lead10.id,
    evaluatedAt: insideCallingHours,
  });

  assert('TEST-10', 'Lead already in CALL_PENDING returns ALREADY_CLAIMED',
    res10.activated === false &&
    res10.decision === 'ALREADY_CLAIMED' &&
    res10.previousStatus === 'CALL_PENDING'
  );

  // -------------------------------------------------------------------------
  // 11. Already CALLING rejected as ALREADY_CLAIMED
  // -------------------------------------------------------------------------
  const lead11 = await supabaseDataService.leads.createLead({
    tenant_id: tenantA,
    lead_id: `GF-ACT-11-${Date.now()}`,
    name: 'Active Call Buyer',
    phone: '+919876543219',
    source: 'WEB_FORM',
    status: 'CALLING',
  });

  const res11 = await leadActivationService.activateLead({
    tenantId: tenantA,
    leadId: lead11.id,
    evaluatedAt: insideCallingHours,
  });

  assert('TEST-11', 'Lead already in CALLING returns ALREADY_CLAIMED',
    res11.activated === false &&
    res11.decision === 'ALREADY_CLAIMED'
  );

  // -------------------------------------------------------------------------
  // 12. Already CONNECTED rejected as ALREADY_CLAIMED
  // -------------------------------------------------------------------------
  const lead12 = await supabaseDataService.leads.createLead({
    tenant_id: tenantA,
    lead_id: `GF-ACT-12-${Date.now()}`,
    name: 'Connected Buyer',
    phone: '+919876543220',
    source: 'WEB_FORM',
    status: 'CONNECTED',
  });

  const res12 = await leadActivationService.activateLead({
    tenantId: tenantA,
    leadId: lead12.id,
    evaluatedAt: insideCallingHours,
  });

  assert('TEST-12', 'Lead already in CONNECTED returns ALREADY_CLAIMED',
    res12.activated === false &&
    res12.decision === 'ALREADY_CLAIMED'
  );

  // -------------------------------------------------------------------------
  // 13. Successful activation creates ZERO calls, zero mock records, zero attempts
  // -------------------------------------------------------------------------
  const lead13 = await supabaseDataService.leads.createLead({
    tenant_id: tenantA,
    lead_id: `GF-ACT-13-${Date.now()}`,
    name: 'Pure Activation Buyer',
    phone: '+919876543221',
    source: 'WEB_FORM',
    status: 'RESOLVED',
  });
  await supabaseDataService.buyerProfiles.upsertBuyerProfile({
    tenant_id: tenantA,
    lead_id: lead13.id,
    metadata: { consent_status: 'PERMISSIBLE' },
  } as any);

  const res13 = await leadActivationService.activateLead({
    tenantId: tenantA,
    leadId: lead13.id,
    evaluatedAt: insideCallingHours,
  });

  const callsAfterActivation = await supabaseDataService.calls.getCallsByLead(lead13.id);
  const attemptsCount = callsAfterActivation.filter(isCallAttempt).length;

  assert('TEST-13', 'Successful activation sets CALL_PENDING with exactly 0 call records and 0 attempts',
    res13.activated === true &&
    callsAfterActivation.length === 0 &&
    attemptsCount === 0
  );

  // -------------------------------------------------------------------------
  // 14. Audit event verification: CALL_ACTIVATION_CLAIMED with safe metadata
  // -------------------------------------------------------------------------
  const events = await supabaseDataService.leadEvents.getLeadEvents(tenantA, lead13.id);
  const claimEvent = events.find((e) => e.event_type === 'CALL_ACTIVATION_CLAIMED');
  const reqEvent = events.find((e) => e.event_type === 'CALL_ACTIVATION_REQUESTED');

  assert('TEST-14', 'Lead events recorded for activation with safe metadata and claim ID',
    claimEvent !== undefined &&
    reqEvent !== undefined &&
    typeof claimEvent.event_data?.claim_id === 'string' &&
    claimEvent.event_data?.new_status === 'CALL_PENDING'
  );

  // -------------------------------------------------------------------------
  // 15. Cross-tenant lead cannot be activated (tenant isolation)
  // -------------------------------------------------------------------------
  const lead15 = await supabaseDataService.leads.createLead(tenantB, {
    tenant_id: tenantB,
    lead_id: `GF-ACT-15-${Date.now()}`,
    name: 'Tenant B Buyer',
    phone: '+919876543222',
    source: 'WEB_FORM',
    status: 'RESOLVED',
  });

  const res15 = await leadActivationService.activateLead({
    tenantId: tenantA, // Requesting Tenant A on Tenant B lead
    leadId: lead15.id,
    evaluatedAt: insideCallingHours,
  });

  assert('TEST-15', 'Cross-tenant activation attempt is rejected with TENANT_MISMATCH',
    res15.activated === false &&
    (res15.decision === 'TENANT_MISMATCH' || res15.decision === 'LEAD_NOT_FOUND')
  );

  // -------------------------------------------------------------------------
  // 16. Existing active resource lock blocks concurrent claim (CONCURRENT_ACTIVATION)
  // -------------------------------------------------------------------------
  const lead16 = await supabaseDataService.leads.createLead({
    tenant_id: tenantA,
    lead_id: `GF-ACT-16-${Date.now()}`,
    name: 'Locked Buyer',
    phone: '+919876543223',
    source: 'WEB_FORM',
    status: 'RESOLVED',
  });
  await supabaseDataService.buyerProfiles.upsertBuyerProfile({
    tenant_id: tenantA,
    lead_id: lead16.id,
    metadata: { consent_status: 'PERMISSIBLE' },
  } as any);

  // Manually hold resource lock for 10 seconds
  await supabaseDataService.security.acquireResourceLock(
    'lead_activation',
    lead16.id,
    tenantA,
    'external-competing-worker',
    10
  );

  const res16 = await leadActivationService.activateLead({
    tenantId: tenantA,
    leadId: lead16.id,
    evaluatedAt: insideCallingHours,
  });

  assert('TEST-16', 'Existing active resource lock causes CONCURRENT_ACTIVATION rejection',
    res16.activated === false &&
    res16.decision === 'CONCURRENT_ACTIVATION'
  );

  // Release external lock
  await supabaseDataService.security.releaseResourceLock(
    'lead_activation',
    lead16.id,
    'external-competing-worker'
  );

  // -------------------------------------------------------------------------
  // 17. Lock is released after activation (can subsequently be acquired)
  // -------------------------------------------------------------------------
  const canAcquireAfterwards = await supabaseDataService.security.acquireResourceLock(
    'lead_activation',
    lead1.id,
    tenantA,
    'test-checker',
    5
  );
  assert('TEST-17', 'Resource lock is released in finally block after completion',
    canAcquireAfterwards === true
  );
  if (canAcquireAfterwards) {
    await supabaseDataService.security.releaseResourceLock('lead_activation', lead1.id, 'test-checker');
  }

  // -------------------------------------------------------------------------
  // 18. CONCURRENCY: Simultaneous Promise.all activations on same lead
  // Exactly ONE succeeds, all other fail deterministically
  // -------------------------------------------------------------------------
  const concurrentLead = await supabaseDataService.leads.createLead({
    tenant_id: tenantA,
    lead_id: `GF-ACT-CONC-${Date.now()}`,
    name: 'Concurrent Race Buyer',
    phone: '+919876543224',
    source: 'WEB_FORM',
    status: 'RESOLVED',
  });
  await supabaseDataService.buyerProfiles.upsertBuyerProfile({
    tenant_id: tenantA,
    lead_id: concurrentLead.id,
    metadata: { consent_status: 'PERMISSIBLE' },
  } as any);

  // Dispatch two workers truly concurrently via Promise.all
  const [workerA, workerB] = await Promise.all([
    leadActivationService.activateLead({
      tenantId: tenantA,
      leadId: concurrentLead.id,
      actor: 'queue_worker',
      correlationId: 'worker-A-race',
      evaluatedAt: insideCallingHours,
    }),
    leadActivationService.activateLead({
      tenantId: tenantA,
      leadId: concurrentLead.id,
      actor: 'human_operator',
      correlationId: 'worker-B-race',
      evaluatedAt: insideCallingHours,
    }),
  ]);

  const successCount = (workerA.activated ? 1 : 0) + (workerB.activated ? 1 : 0);
  const contentionCount = (!workerA.activated ? 1 : 0) + (!workerB.activated ? 1 : 0);

  const winningDecision = workerA.activated ? workerA.decision : workerB.decision;
  const losingDecision = !workerA.activated ? workerA.decision : workerB.decision;

  assert('TEST-18', 'CONCURRENCY TEST: Exactly 1 worker succeeds (ACTIVATED), exactly 1 loses (CONCURRENT_ACTIVATION or ALREADY_CLAIMED)',
    successCount === 1 &&
    contentionCount === 1 &&
    winningDecision === 'ACTIVATED' &&
    (losingDecision === 'CONCURRENT_ACTIVATION' || losingDecision === 'ALREADY_CLAIMED')
  );

  // Verify DB state after concurrent race
  const freshConcurrentLead = await supabaseDataService.leads.getLead(tenantA, concurrentLead.id);
  const concurrentCalls = await supabaseDataService.calls.getCallsByLead(concurrentLead.id);

  assert('TEST-19', 'Concurrency outcome verified: lead in CALL_PENDING with exactly 0 call rows created',
    freshConcurrentLead?.status === 'CALL_PENDING' &&
    concurrentCalls.length === 0
  );

  // -------------------------------------------------------------------------
  // 20. Two distinct tenants activating different leads simultaneously succeed in parallel
  // -------------------------------------------------------------------------
  const leadTenA = await supabaseDataService.leads.createLead({
    tenant_id: tenantA,
    lead_id: `GF-ACT-PAR-A-${Date.now()}`,
    name: 'Parallel Tenant A Buyer',
    phone: '+919876543225',
    source: 'WEB_FORM',
    status: 'RESOLVED',
  });
  await supabaseDataService.buyerProfiles.upsertBuyerProfile({
    tenant_id: tenantA,
    lead_id: leadTenA.id,
    metadata: { consent_status: 'PERMISSIBLE' },
  } as any);

  const leadTenB = await supabaseDataService.leads.createLead(tenantB, {
    tenant_id: tenantB,
    lead_id: `GF-ACT-PAR-B-${Date.now()}`,
    name: 'Parallel Tenant B Buyer',
    phone: '+919876543226',
    source: 'WEB_FORM',
    status: 'RESOLVED',
  });
  await supabaseDataService.buyerProfiles.upsertBuyerProfile(tenantB, {
    tenant_id: tenantB,
    lead_id: leadTenB.id,
    metadata: { consent_status: 'PERMISSIBLE' },
  } as any);

  const [parA, parB] = await Promise.all([
    leadActivationService.activateLead({
      tenantId: tenantA,
      leadId: leadTenA.id,
      evaluatedAt: insideCallingHours,
    }),
    leadActivationService.activateLead({
      tenantId: tenantB,
      leadId: leadTenB.id,
      evaluatedAt: insideCallingHours,
    }),
  ]);

  assert('TEST-20', 'Multi-tenant parallelism: independent tenants activate distinct leads without contention',
    parA.activated === true &&
    parB.activated === true &&
    parA.decision === 'ACTIVATED' &&
    parB.decision === 'ACTIVATED'
  );

  // -------------------------------------------------------------------------
  // 21. CallService startCall() dispatches CALL_PENDING lead without duplicate preparation
  // -------------------------------------------------------------------------
  const startCallResult = await callService.startCall(lead1.id);
  assert('TEST-21', 'CallService.startCall() accepts pre-activated CALL_PENDING lead and advances to CALLING',
    startCallResult.newStatus === 'CALLING' &&
    startCallResult.previousStatus === 'CALL_PENDING' &&
    startCallResult.callResult.initiated === true
  );

  console.log('\n======================================================');
  console.log(`📊 PHASE 9.3.2 TEST RESULTS: ${passCount} PASSED / ${failCount} FAILED`);
  console.log('======================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

// Auto-run if executed directly
if (process.argv[1]?.includes('phase93-activation')) {
  runPhase932Tests().catch((err) => {
    console.error('Test execution error:', err);
    process.exit(1);
  });
}
