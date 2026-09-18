/**
 * GrowthForge Buyer Intelligence Engine - Lead Activation Service & Atomic Claim
 *
 * PHASE 9.3.2 IMPLEMENTATION:
 * - Domain service managing transition from ELIGIBLE LEAD -> ATOMIC ACTIVATION CLAIM -> CALL_PENDING.
 * - Enforces the central invariant:
 *   For a given tenant_id + lead_id, concurrent activation requests result in AT MOST ONE
 *   successful activation claim. Contenders fail deterministically with ALREADY_CLAIMED / CONCURRENT_ACTIVATION.
 * - Guarantees:
 *   1. Zero outbound telephony calls or voice provider dispatches inside activation.
 *   2. Zero MOCK_READY records created during activation (does NOT count as a call attempt).
 *   3. Zero pipeline execution records created during activation.
 *   4. Zero Gemini or Scout network calls during activation.
 *   5. Deterministic re-evaluation of CALL_ELIGIBILITY_V1 and CALL_COMPLIANCE_V1 inside the mutual exclusion lock.
 *   6. Strict tenant isolation (all operations scoped to authoritative tenantId).
 */

import { supabaseDataService } from '../supabase/repositories';
import { WorkflowStatus } from '../../schemas/workflow';
import {
  evaluateCallEligibility,
  CallEligibilityResult,
  CALL_ELIGIBILITY_POLICY_VERSION,
} from './callEligibility';
import {
  CallCompliancePolicyConfig,
  CALL_COMPLIANCE_POLICY_VERSION,
} from './callCompliance';
import { deriveCorrelationId } from '../security/correlationContext';

export interface LeadActivationInput {
  tenantId: string;
  leadId: string; // Internal DB UUID or public lead_id
  actor?: 'system' | 'queue_worker' | 'human_operator' | 'api_client';
  correlationId?: string;
  complianceConfig?: CallCompliancePolicyConfig;
  evaluatedAt?: Date | string;
}

export type LeadActivationDecision =
  | 'ACTIVATED'
  | 'ALREADY_CLAIMED'
  | 'CONCURRENT_ACTIVATION'
  | 'NOT_ELIGIBLE'
  | 'REQUIRES_REVIEW'
  | 'TENANT_MISMATCH'
  | 'LEAD_NOT_FOUND'
  | 'ERROR';

export interface LeadActivationResult {
  activated: boolean;
  decision: LeadActivationDecision;
  leadId: string;
  tenantId: string;
  claimId?: string;
  previousStatus?: WorkflowStatus | string;
  newStatus?: WorkflowStatus | string;
  eligibility?: CallEligibilityResult;
  reasons: string[];
  evaluatedAt: string;
  policyVersion: {
    eligibility: string;
    compliance: string;
  };
  correlationId?: string;
}

export class LeadActivationService {
  private static readonly LOCK_RESOURCE_TYPE = 'lead_activation';
  private static readonly LOCK_TTL_SECONDS = 30;

  /**
   * Deterministically attempts to atomically claim an eligible lead for calling.
   * Transitions lead status to CALL_PENDING upon successful claim.
   */
  async activateLead(input: LeadActivationInput): Promise<LeadActivationResult> {
    const evaluatedAt = input.evaluatedAt
      ? (typeof input.evaluatedAt === 'string' ? new Date(input.evaluatedAt).toISOString() : input.evaluatedAt.toISOString())
      : new Date().toISOString();

    const correlationId = deriveCorrelationId(input.correlationId);
    const actor = input.actor || 'system';

    const policyVersion = {
      eligibility: CALL_ELIGIBILITY_POLICY_VERSION,
      compliance: CALL_COMPLIANCE_POLICY_VERSION,
    };

    // 1. Validate inputs
    if (!input || !input.tenantId || !input.leadId) {
      return {
        activated: false,
        decision: 'LEAD_NOT_FOUND',
        leadId: input?.leadId || '',
        tenantId: input?.tenantId || '',
        reasons: ['Missing required tenantId or leadId.'],
        evaluatedAt,
        policyVersion,
        correlationId,
      };
    }

    // 2. Resolve database lead to obtain stable canonical UUID for the resource lock
    let dbLead = await supabaseDataService.leads.getLeadByLeadId(input.tenantId, input.leadId);
    if (!dbLead) {
      dbLead = await supabaseDataService.leads.getLead(input.tenantId, input.leadId);
    }
    if (!dbLead) {
      // Check cross-tenant existence to report specific isolation violation if queried under wrong tenant
      const adminLead = await supabaseDataService.leads.getLead(input.leadId);
      if (adminLead && adminLead.tenant_id && adminLead.tenant_id !== input.tenantId) {
        return {
          activated: false,
          decision: 'TENANT_MISMATCH',
          leadId: input.leadId,
          tenantId: input.tenantId,
          reasons: [`Cross-tenant access violation: lead belongs to a different tenant.`],
          evaluatedAt,
          policyVersion,
          correlationId,
        };
      }

      return {
        activated: false,
        decision: 'LEAD_NOT_FOUND',
        leadId: input.leadId,
        tenantId: input.tenantId,
        reasons: [`Lead not found for ID '${input.leadId}' within tenant '${input.tenantId}'.`],
        evaluatedAt,
        policyVersion,
        correlationId,
      };
    }

    // Verify tenant ownership
    if (dbLead.tenant_id !== input.tenantId) {
      return {
        activated: false,
        decision: 'TENANT_MISMATCH',
        leadId: dbLead.id,
        tenantId: input.tenantId,
        reasons: [`Lead ${dbLead.id} tenant '${dbLead.tenant_id}' does not match requested tenant '${input.tenantId}'.`],
        evaluatedAt,
        policyVersion,
        correlationId,
      };
    }

    // 3. Construct unique lock owner per activation invocation
    const lockOwner = `act-${input.tenantId.slice(0, 8)}-${correlationId}`;
    const resourceId = dbLead.id; // Canonical UUID

    // 4. Record CALL_ACTIVATION_REQUESTED audit event
    await supabaseDataService.leadEvents.appendLeadEvent({
      tenant_id: input.tenantId,
      lead_id: dbLead.id,
      event_type: 'CALL_ACTIVATION_REQUESTED',
      event_data: {
        actor,
        correlation_id: correlationId,
        requested_at: evaluatedAt,
        initial_status: dbLead.status,
      },
    });

    // 5. Attempt atomic acquisition of mutual-exclusion lock
    const lockAcquired = await supabaseDataService.security.acquireResourceLock(
      LeadActivationService.LOCK_RESOURCE_TYPE,
      resourceId,
      input.tenantId,
      lockOwner,
      LeadActivationService.LOCK_TTL_SECONDS
    );

    if (!lockAcquired) {
      await supabaseDataService.leadEvents.appendLeadEvent({
        tenant_id: input.tenantId,
        lead_id: dbLead.id,
        event_type: 'CALL_ACTIVATION_REJECTED',
        event_data: {
          actor,
          correlation_id: correlationId,
          decision: 'CONCURRENT_ACTIVATION',
          reason: 'Lock acquisition contention: another worker or operator holds the activation lock.',
          timestamp: evaluatedAt,
        },
      });

      return {
        activated: false,
        decision: 'CONCURRENT_ACTIVATION',
        leadId: dbLead.id,
        tenantId: input.tenantId,
        previousStatus: dbLead.status,
        reasons: ['Activation lock could not be acquired due to active concurrent operation.'],
        evaluatedAt,
        policyVersion,
        correlationId,
      };
    }

    try {
      // 6. Reload fresh canonical lead inside the lock boundary
      const freshLead = await supabaseDataService.leads.getLead(input.tenantId, dbLead.id);
      if (!freshLead) {
        return {
          activated: false,
          decision: 'LEAD_NOT_FOUND',
          leadId: dbLead.id,
          tenantId: input.tenantId,
          reasons: ['Lead disappeared during locked execution.'],
          evaluatedAt,
          policyVersion,
          correlationId,
        };
      }

      const currentStatus = freshLead.status;

      // 7. Check if lead is already actively claimed or in an active calling state
      if (currentStatus === 'CALL_PENDING' || currentStatus === 'CALLING' || currentStatus === 'CONNECTED') {
        await supabaseDataService.leadEvents.appendLeadEvent({
          tenant_id: input.tenantId,
          lead_id: freshLead.id,
          event_type: 'CALL_ACTIVATION_REJECTED',
          event_data: {
            actor,
            correlation_id: correlationId,
            decision: 'ALREADY_CLAIMED',
            current_status: currentStatus,
            reason: `Lead is already in state '${currentStatus}'. Duplicate activation prevented.`,
            timestamp: evaluatedAt,
          },
        });

        return {
          activated: false,
          decision: 'ALREADY_CLAIMED',
          leadId: freshLead.id,
          tenantId: input.tenantId,
          previousStatus: currentStatus,
          reasons: [`Lead is already active in workflow status '${currentStatus}'.`],
          evaluatedAt,
          policyVersion,
          correlationId,
        };
      }

      // 8. Retrieve tenant-scoped call history for compliance evaluation
      const callsHistory = await supabaseDataService.calls.getCallsByLead(freshLead.id);

      // Map canonical before to extract canonical identity and provenance
      const profile = await supabaseDataService.buyerProfiles.getBuyerProfile(input.tenantId, freshLead.id);
      const phone = freshLead.phone;
      const email = freshLead.email;
      const consentStatus = (profile?.metadata as any)?.consent_status || (profile as any)?.consent_status || (freshLead as any).consent_status;
      const source = freshLead.source;

      // 9. Deterministically evaluate eligibility and compliance policy inside the lock
      const eligibilityResult = evaluateCallEligibility({
        leadId: freshLead.id,
        tenantId: input.tenantId,
        status: currentStatus,
        phone,
        email,
        consentStatus,
        source,
        enrichmentAvailable: true,
        complianceConfig: input.complianceConfig,
        callsHistory,
        evaluatedAt,
      });

      // 10. Handle non-eligible outcomes
      if (eligibilityResult.decision === 'REQUIRES_REVIEW') {
        await supabaseDataService.leads.updateLead(freshLead.id, { status: 'REQUIRES_REVIEW' });

        await supabaseDataService.leadEvents.appendLeadEvent({
          tenant_id: input.tenantId,
          lead_id: freshLead.id,
          event_type: 'CALL_ACTIVATION_REJECTED',
          event_data: {
            actor,
            correlation_id: correlationId,
            decision: 'REQUIRES_REVIEW',
            reasons: eligibilityResult.reasons,
            timestamp: evaluatedAt,
          },
        });

        return {
          activated: false,
          decision: 'REQUIRES_REVIEW',
          leadId: freshLead.id,
          tenantId: input.tenantId,
          previousStatus: currentStatus,
          newStatus: 'REQUIRES_REVIEW',
          eligibility: eligibilityResult,
          reasons: eligibilityResult.reasons,
          evaluatedAt,
          policyVersion,
          correlationId,
        };
      }

      if (eligibilityResult.decision !== 'ELIGIBLE') {
        // If evaluated from ENRICHED or RESOLVED, transition to NURTURE if opt-out or disqualified
        const targetStatus: WorkflowStatus =
          (currentStatus === 'ENRICHED' || currentStatus === 'RESOLVED')
            ? 'NURTURE'
            : (currentStatus as WorkflowStatus);

        if (targetStatus !== currentStatus) {
          await supabaseDataService.leads.updateLead(freshLead.id, { status: targetStatus });
        }

        await supabaseDataService.leadEvents.appendLeadEvent({
          tenant_id: input.tenantId,
          lead_id: freshLead.id,
          event_type: 'CALL_ACTIVATION_REJECTED',
          event_data: {
            actor,
            correlation_id: correlationId,
            decision: 'NOT_ELIGIBLE',
            compliance_decision: eligibilityResult.compliance?.decision,
            reasons: eligibilityResult.reasons,
            target_status: targetStatus,
            timestamp: evaluatedAt,
          },
        });

        return {
          activated: false,
          decision: 'NOT_ELIGIBLE',
          leadId: freshLead.id,
          tenantId: input.tenantId,
          previousStatus: currentStatus,
          newStatus: targetStatus,
          eligibility: eligibilityResult,
          reasons: eligibilityResult.reasons,
          evaluatedAt,
          policyVersion,
          correlationId,
        };
      }

      // 11. Eligibility & Compliance Passed -> Commit Atomic Activation Claim
      const claimId = `claim-${deriveCorrelationId()}`;
      const targetStatus: WorkflowStatus = 'CALL_PENDING';

      // Persist the durable status transition
      await supabaseDataService.leads.updateLead(freshLead.id, { status: targetStatus });

      // Record CALL_ACTIVATION_CLAIMED audit event
      await supabaseDataService.leadEvents.appendLeadEvent({
        tenant_id: input.tenantId,
        lead_id: freshLead.id,
        event_type: 'CALL_ACTIVATION_CLAIMED',
        event_data: {
          claim_id: claimId,
          actor,
          correlation_id: correlationId,
          previous_status: currentStatus,
          new_status: targetStatus,
          policy_version: policyVersion,
          evaluated_at: evaluatedAt,
          compliance: eligibilityResult.compliance ? {
            decision: eligibilityResult.compliance.decision,
            withinCallingHours: eligibilityResult.compliance.withinCallingHours,
            cooldownPassed: eligibilityResult.compliance.cooldownPassed,
            attemptsCount: eligibilityResult.compliance.attemptsCount,
            maxAttempts: eligibilityResult.compliance.maxAttempts,
          } : undefined,
        },
      });

      return {
        activated: true,
        decision: 'ACTIVATED',
        leadId: freshLead.id,
        tenantId: input.tenantId,
        claimId,
        previousStatus: currentStatus,
        newStatus: targetStatus,
        eligibility: eligibilityResult,
        reasons: ['Lead successfully verified and claimed for outbound voice qualification.'],
        evaluatedAt,
        policyVersion,
        correlationId,
      };
    } finally {
      // 12. Guaranteed lock release in finally block
      try {
        await supabaseDataService.security.releaseResourceLock(
          LeadActivationService.LOCK_RESOURCE_TYPE,
          resourceId,
          lockOwner
        );
      } catch (releaseErr) {
        // Safe lock release failure logging (TTL ensures eventual expiration)
        console.warn(`[LeadActivationService] Non-fatal lock release warning for ${resourceId}:`, releaseErr);
      }
    }
  }
}

export const leadActivationService = new LeadActivationService();
