/**
 * GrowthForge Buyer Intelligence Engine - Call Service & Workflow Orchestrator
 *
 * PHASE 4A IMPLEMENTATION:
 * - Executes call eligibility evaluation against canonical GFBuyerLead.
 * - Records CALL_ELIGIBILITY_STARTED and CALL_ELIGIBILITY_DECIDED audit events in Supabase.
 * - Updates lead workflow status deterministically:
 *   - ELIGIBLE -> CALL_PENDING (and invokes MockVoiceProvider)
 *   - NOT_ELIGIBLE -> NURTURE (if from ENRICHED) or retains non-eligible status
 *   - REQUIRES_REVIEW -> REQUIRES_REVIEW
 * - Proves provider boundary invocation with MockVoiceProvider (initiated = false, MOCK_READY).
 */

import { WorkflowStatus } from '../../schemas/workflow';
import { GFBuyerLead } from '../../schemas/buyerLead';
import { supabaseDataService } from '../supabase/repositories';
import {
  evaluateCallEligibility,
  CallEligibilityResult,
  CALL_ELIGIBILITY_POLICY_VERSION,
} from './callEligibility';
import { mockVoiceProvider, VoiceCallResult } from '../voice/mockVoiceProvider';

export interface EvaluateCallEligibilityOptions {
  consentOverride?: string;
  actor?: 'system' | 'application_service' | 'human_operator';
}

export interface CallEligibilityExecutionResult {
  leadId: string;
  eligibility: CallEligibilityResult;
  previousStatus: WorkflowStatus | string;
  newStatus: WorkflowStatus | string;
  mockCallResult?: VoiceCallResult;
  canonicalLead: GFBuyerLead;
}

export class CallService {
  /**
   * Evaluates call eligibility for a given lead, logs events, transitions workflow status,
   * and prepares mock voice provider handoff if eligible.
   */
  async evaluateAndPrepareCall(
    leadIdOrUUID: string,
    options?: EvaluateCallEligibilityOptions
  ): Promise<CallEligibilityExecutionResult> {
    // 1. Resolve DB Lead record
    let dbLead = await supabaseDataService.leads.getLeadByLeadId(leadIdOrUUID);
    if (!dbLead) {
      dbLead = await supabaseDataService.leads.getLead(leadIdOrUUID);
    }
    if (!dbLead) {
      throw new Error(`Lead not found for ID: ${leadIdOrUUID}`);
    }

    const previousStatus = dbLead.status as WorkflowStatus;

    // 2. Map current canonical lead state
    const canonicalBefore = await supabaseDataService.mapToGFBuyerLead(dbLead.id);
    if (!canonicalBefore) {
      throw new Error(`Failed to map canonical lead for ID: ${dbLead.id}`);
    }

    const consentStatus = options?.consentOverride || canonicalBefore.provenance.consent_status;
    const actor = options?.actor || 'system';

    // 3. Record CALL_ELIGIBILITY_STARTED event
    await supabaseDataService.leadEvents.appendLeadEvent({
      lead_id: dbLead.id,
      event_type: 'CALL_ELIGIBILITY_STARTED',
      event_data: {
        initial_status: previousStatus,
        policy_version: CALL_ELIGIBILITY_POLICY_VERSION,
        evaluated_at: new Date().toISOString(),
        actor,
      },
    });

    // 4. Update workflow status to CALL_ELIGIBILITY if starting from ENRICHED
    if (previousStatus === 'ENRICHED') {
      await supabaseDataService.leads.updateLead(dbLead.id, { status: 'CALL_ELIGIBILITY' });
    }

    // 5. Evaluate deterministic eligibility policy
    const eligibilityResult = evaluateCallEligibility({
      leadId: dbLead.id,
      status: previousStatus,
      phone: canonicalBefore.identity.phone,
      email: canonicalBefore.identity.email,
      consentStatus: consentStatus,
      source: dbLead.source,
      enrichmentAvailable: true,
    });

    // 6. Record CALL_ELIGIBILITY_DECIDED audit event
    await supabaseDataService.leadEvents.appendLeadEvent({
      lead_id: dbLead.id,
      event_type: 'CALL_ELIGIBILITY_DECIDED',
      event_data: {
        decision: eligibilityResult.decision,
        reasons: eligibilityResult.reasons,
        policy_version: eligibilityResult.policyVersion,
        evaluated_at: eligibilityResult.evaluatedAt,
        phone_format_valid: eligibilityResult.phone_format_valid,
        consent_state: eligibilityResult.consent_state,
        actor,
      },
    });

    // 7. Transition workflow state based on evaluation
    let targetStatus: WorkflowStatus;
    if (eligibilityResult.decision === 'ELIGIBLE') {
      targetStatus = 'CALL_PENDING';
    } else if (eligibilityResult.decision === 'REQUIRES_REVIEW') {
      targetStatus = 'REQUIRES_REVIEW';
    } else {
      // NOT_ELIGIBLE: if evaluated from ENRICHED, route to NURTURE; otherwise preserve current failure/raw state
      targetStatus = previousStatus === 'ENRICHED' ? 'NURTURE' : (previousStatus as WorkflowStatus);
    }

    await supabaseDataService.leads.updateLead(dbLead.id, { status: targetStatus });

    // 8. If ELIGIBLE, invoke MockVoiceProvider boundary to prove provider readiness
    let mockCallResult: VoiceCallResult | undefined;
    if (eligibilityResult.decision === 'ELIGIBLE') {
      mockCallResult = await mockVoiceProvider.initiateCall({
        lead_id: dbLead.id,
        phone_number: canonicalBefore.identity.phone,
        contact_name: canonicalBefore.identity.full_name || 'Valued Buyer',
      });
    }

    // 9. Fetch fresh canonical lead after all updates
    const canonicalAfter = await supabaseDataService.mapToGFBuyerLead(dbLead.id);
    if (!canonicalAfter) {
      throw new Error(`Failed to map updated canonical lead for ID: ${dbLead.id}`);
    }

    return {
      leadId: canonicalAfter.lead_id,
      eligibility: eligibilityResult,
      previousStatus,
      newStatus: targetStatus,
      mockCallResult,
      canonicalLead: canonicalAfter,
    };
  }
}

export const callService = new CallService();
