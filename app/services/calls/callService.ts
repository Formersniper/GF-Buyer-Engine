/**
 * GrowthForge Buyer Intelligence Engine - Call Service & Workflow Orchestrator
 *
 * PHASE 4B IMPLEMENTATION:
 * - Executes call eligibility evaluation against canonical GFBuyerLead.
 * - Records CALL_ELIGIBILITY_STARTED and CALL_ELIGIBILITY_DECIDED audit events in Supabase.
 * - Updates lead workflow status deterministically:
 *   - ELIGIBLE -> CALL_PENDING
 *   - NOT_ELIGIBLE -> NURTURE (if from ENRICHED) or retains non-eligible status
 *   - REQUIRES_REVIEW -> REQUIRES_REVIEW
 * - Bridges to provider-neutral VoiceProvider (MockVoiceProvider or SarvamVoiceProvider).
 * - Orchestrates outbound call dispatching with CALL_REQUESTED and CALL_PROVIDER_ACCEPTED events.
 */

import { WorkflowStatus } from '../../schemas/workflow';
import { GFBuyerLead } from '../../schemas/buyerLead';
import { supabaseDataService } from '../supabase/repositories';
import {
  evaluateCallEligibility,
  CallEligibilityResult,
  CALL_ELIGIBILITY_POLICY_VERSION,
} from './callEligibility';
import {
  IVoiceProvider,
  VoiceCallResult,
  VoiceCallStatus,
  ProviderHealthResult,
} from '../voice/voiceProvider';
import { mockVoiceProvider } from '../voice/mockVoiceProvider';
import { sarvamVoiceProvider } from '../voice/sarvamVoiceProvider';

export interface EvaluateCallEligibilityOptions {
  idempotencyKey?: string;
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

export interface StartCallOptions {
  idempotencyKey?: string;
  provider?: IVoiceProvider;
  customVariables?: Record<string, string>;
  actor?: 'system' | 'application_service' | 'human_operator';
  systemPrompt?: string;
}

export interface StartCallExecutionResult {
  leadId: string;
  callResult: VoiceCallResult;
  previousStatus: string;
  newStatus: string;
  canonicalLead: GFBuyerLead;
}

export class CallService {
  /**
   * Resolves the active VoiceProvider based on runtime environment configuration.
   */
  getActiveVoiceProvider(override?: IVoiceProvider): IVoiceProvider {
    if (override) return override;
    const mode = (process.env.VOICE_MODE || (process.env.SARVAM_API_KEY ? 'REAL' : 'MOCK')).toUpperCase();
    const providerName = (process.env.VOICE_PROVIDER || 'sarvam').toLowerCase();

    if (mode === 'REAL' && providerName === 'sarvam' && process.env.SARVAM_API_KEY) {
      return sarvamVoiceProvider;
    }

    return mockVoiceProvider;
  }

  /**
   * Health Check: Retrieves active voice provider configuration & reachability safely.
   */
  async checkVoiceHealth(): Promise<ProviderHealthResult> {
    const provider = this.getActiveVoiceProvider();
    if (provider.checkHealth) {
      return await provider.checkHealth();
    }
    return {
      provider: provider.providerName,
      configured: true,
      reachable: true,
      agent_configured: true,
      phone_configured: true,
      mode: process.env.VOICE_MODE === 'REAL' ? 'REAL' : 'MOCK',
    };
  }

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
        idempotency_key: options?.idempotencyKey,
        tenant_id: dbLead.tenant_id,
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

  /**
   * Dispatches an outbound qualification call for a lead in CALL_PENDING state.
   */
  async startCall(
    leadIdOrUUID: string,
    options?: StartCallOptions
  ): Promise<StartCallExecutionResult> {
    // 1. Resolve lead
    let dbLead = await supabaseDataService.leads.getLeadByLeadId(leadIdOrUUID);
    if (!dbLead) {
      dbLead = await supabaseDataService.leads.getLead(leadIdOrUUID);
    }
    if (!dbLead) {
      throw new Error(`Lead not found for ID: ${leadIdOrUUID}`);
    }

    const previousStatus = dbLead.status;
    const actor = options?.actor || 'human_operator';

    // Must be in CALL_PENDING (or evaluate if in ENRICHED)
    if (previousStatus !== 'CALL_PENDING') {
      if (previousStatus === 'ENRICHED') {
        const elig = await this.evaluateAndPrepareCall(dbLead.id, { actor });
        if (elig.newStatus !== 'CALL_PENDING') {
          throw new Error(
            `Lead is not eligible for call. Current state: ${elig.newStatus}, Decision: ${elig.eligibility.decision}`
          );
        }
      } else {
        throw new Error(
          `Cannot start call: Lead is in status '${previousStatus}', expected 'CALL_PENDING'.`
        );
      }
    }

    // 2. Fetch canonical lead
    const canonicalLead = await supabaseDataService.mapToGFBuyerLead(dbLead.id);
    if (!canonicalLead) {
      throw new Error(`Failed to map canonical lead for ID: ${dbLead.id}`);
    }

    const targetPhone = canonicalLead.identity.phone;
    if (!targetPhone) {
      throw new Error(`Cannot initiate call: phone number is missing on lead ${dbLead.id}`);
    }

    const provider = options?.provider || this.getActiveVoiceProvider();

    // 3. Record CALL_REQUESTED audit event
    await supabaseDataService.leadEvents.appendLeadEvent({
      lead_id: dbLead.id,
      event_type: 'CALL_REQUESTED',
      event_data: {
        provider: provider.providerName,
        phone_masked: targetPhone.slice(-4).padStart(targetPhone.length, '*'),
        requested_by: actor,
        timestamp: new Date().toISOString(),
      },
    });

    // 4. Initiate Call via selected VoiceProvider
    const callResult = await provider.initiateCall({
      idempotency_key: options?.idempotencyKey || `call-out-${dbLead.id}-${previousStatus}`,
      tenant_id: dbLead.tenant_id,
      lead_id: dbLead.id,
      phone_number: targetPhone,
      contact_name: canonicalLead.identity.full_name || 'Valued Buyer',
      custom_variables: options?.customVariables,
      system_prompt: options?.systemPrompt,
    });

    let newStatus: WorkflowStatus = 'CALLING';

    // 5. If call accepted by provider, record CALL_PROVIDER_ACCEPTED and update state
    if (callResult.initiated) {
      await supabaseDataService.leadEvents.appendLeadEvent({
        lead_id: dbLead.id,
        event_type: 'CALL_PROVIDER_ACCEPTED',
        event_data: {
          provider: provider.providerName,
          call_id: callResult.callId,
          external_call_id: callResult.external_call_id,
          initial_provider_status: callResult.status,
          timestamp: new Date().toISOString(),
        },
      });

      await supabaseDataService.leads.updateLead(dbLead.id, { status: 'CALLING' });
      newStatus = 'CALLING';
    } else {
      // Mock ready retention
      newStatus = 'CALL_PENDING';
    }

    // 6. Reload updated canonical lead
    const updatedCanonical = await supabaseDataService.mapToGFBuyerLead(dbLead.id);
    if (!updatedCanonical) {
      throw new Error(`Failed to reload canonical lead after call initiation`);
    }

    return {
      leadId: dbLead.id,
      callResult,
      previousStatus,
      newStatus,
      canonicalLead: updatedCanonical,
    };
  }

  /**
   * Retrieves full status and telemetry for a specific call ID.
   */
  async getCallStatus(callId: string): Promise<VoiceCallStatus> {
    const provider = this.getActiveVoiceProvider();
    return await provider.getCallStatus(callId);
  }
}

export const callService = new CallService();
