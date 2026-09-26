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
import { TenantScope } from '../../schemas/tenant';
import { supabaseDataService } from '../supabase/repositories';
import {
  evaluateCallEligibility,
  CallEligibilityResult,
  CALL_ELIGIBILITY_POLICY_VERSION,
} from './callEligibility';
import {
  evaluateCallCompliance,
  CALL_COMPLIANCE_POLICY_VERSION,
} from './callCompliance';
import {
  evaluateProductionVoiceAuthorization,
  ProductionVoiceAuthorizationResult,
  PRODUCTION_VOICE_AUTHORIZATION_POLICY_VERSION,
} from './productionVoiceAuthorization';
import {
  evaluateVoiceActivationReadiness,
  VoiceActivationReadinessResult,
  VOICE_ACTIVATION_READINESS_POLICY_VERSION,
} from './voiceActivationReadiness';
import {
  evaluateVoiceCostPolicy,
  VoiceCostAssessmentResult,
} from './voiceCostPolicy';
import {
  evaluateVoiceRetryPolicy,
  VoiceRetryEvaluationResult,
} from './voiceRetryPolicy';
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
  tenantId?: string;
  tenantScope?: TenantScope;
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
  tenantId?: string;
  tenantScope?: TenantScope;
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
    const rawMode = (process.env.VOICE_MODE || 'MOCK').split('#')[0].replace(/['"]/g, '').trim().toUpperCase();
    const mode = rawMode === 'REAL' ? 'REAL' : 'MOCK';
    const providerName = (process.env.VOICE_PROVIDER || 'sarvam').split('#')[0].replace(/['"]/g, '').trim().toLowerCase();

    if (mode === 'REAL') {
      if (providerName === 'sarvam' && process.env.SARVAM_API_KEY && process.env.SARVAM_API_KEY.trim() !== '') {
        return sarvamVoiceProvider;
      }
      throw new Error(
        'VOICE_MODE=REAL requires valid Sarvam configuration and SARVAM_API_KEY. Silent fallback to MockVoiceProvider is strictly forbidden.'
      );
    }

    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'MockVoiceProvider is strictly forbidden in production. Configure SARVAM_API_KEY, credentials, and VOICE_MODE=REAL.'
      );
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
    const tenantScope = options?.tenantScope || (options?.tenantId ? { tenantId: options.tenantId } : undefined);
    // 1. Resolve DB Lead record
    let dbLead = tenantScope
      ? await supabaseDataService.leads.getLeadByLeadId(tenantScope, leadIdOrUUID)
      : await supabaseDataService.leads.getLeadByLeadId(leadIdOrUUID);
    if (!dbLead && tenantScope) {
      dbLead = await supabaseDataService.leads.getLead(tenantScope, leadIdOrUUID);
    } else if (!dbLead) {
      dbLead = await supabaseDataService.leads.getLead(leadIdOrUUID);
    }
    if (!dbLead) {
      throw new Error(`Lead not found for ID: ${leadIdOrUUID}`);
    }

    const previousStatus = dbLead.status as WorkflowStatus;
    const effectiveScope: TenantScope = tenantScope || (dbLead.tenant_id ? { tenantId: dbLead.tenant_id } : undefined) || {};

    // 2. Map current canonical lead state
    const canonicalBefore = await supabaseDataService.mapToGFBuyerLead(effectiveScope, dbLead.id);
    if (!canonicalBefore) {
      throw new Error(`Failed to map canonical lead for ID: ${dbLead.id}`);
    }

    const consentStatus = options?.consentOverride || canonicalBefore.provenance.consent_status;
    const actor = options?.actor || 'system';

    // 3. Record CALL_ELIGIBILITY_STARTED event
    await supabaseDataService.leadEvents.appendLeadEvent(effectiveScope, {
      lead_id: dbLead.id,
      event_type: 'CALL_ELIGIBILITY_STARTED',
      event_data: {
        initial_status: previousStatus,
        policy_version: CALL_ELIGIBILITY_POLICY_VERSION,
        evaluated_at: new Date().toISOString(),
        actor,
      },
    });

    // 4. Update workflow status to CALL_ELIGIBILITY if starting from ENRICHED or RESOLVED
    if (previousStatus === 'ENRICHED' || previousStatus === 'RESOLVED') {
      await supabaseDataService.leads.updateLead(effectiveScope, dbLead.id, { status: 'CALL_ELIGIBILITY' });
    }

    // 5. Retrieve existing call history for cooldown and max attempt compliance evaluation
    const callsHistory = await supabaseDataService.calls.getCallsByLead(effectiveScope, dbLead.id);

    // 6. Evaluate deterministic eligibility and compliance policy
    const eligibilityResult = evaluateCallEligibility({
      leadId: dbLead.id,
      tenantId: dbLead.tenant_id,
      status: previousStatus,
      phone: canonicalBefore.identity.phone,
      email: canonicalBefore.identity.email,
      consentStatus: consentStatus,
      source: dbLead.source,
      enrichmentAvailable: true,
      callsHistory,
    });

    // 7. Record CALL_ELIGIBILITY_DECIDED audit event
    await supabaseDataService.leadEvents.appendLeadEvent(effectiveScope, {
      lead_id: dbLead.id,
      event_type: 'CALL_ELIGIBILITY_DECIDED',
      event_data: {
        decision: eligibilityResult.decision,
        reasons: eligibilityResult.reasons,
        policy_version: eligibilityResult.policyVersion,
        evaluated_at: eligibilityResult.evaluatedAt,
        phone_format_valid: eligibilityResult.phone_format_valid,
        consent_state: eligibilityResult.consent_state,
        compliance: eligibilityResult.compliance,
        actor,
      },
    });

    // 8. Transition workflow state based on evaluation
    let targetStatus: WorkflowStatus;
    if (eligibilityResult.decision === 'ELIGIBLE') {
      targetStatus = 'CALL_PENDING';
    } else if (eligibilityResult.decision === 'REQUIRES_REVIEW') {
      targetStatus = 'REQUIRES_REVIEW';
    } else {
      // NOT_ELIGIBLE: if evaluated from ENRICHED or RESOLVED, route to NURTURE; otherwise preserve current failure/raw state
      targetStatus =
        previousStatus === 'ENRICHED' || previousStatus === 'RESOLVED'
          ? 'NURTURE'
          : (previousStatus as WorkflowStatus);
    }

    await supabaseDataService.leads.updateLead(effectiveScope, dbLead.id, { status: targetStatus });

    // 8. If ELIGIBLE, evaluate Production Voice Authorization before MockVoiceProvider
    let mockCallResult: VoiceCallResult | undefined;
    if (eligibilityResult.decision === 'ELIGIBLE') {
      const env = (process.env.NODE_ENV || 'development').toLowerCase();
      const environment = (env === 'production' || env === 'test' ? env : 'development') as 'production' | 'development' | 'test';
      const rawVoiceMode = (process.env.VOICE_MODE || 'MOCK').split('#')[0].replace(/['"]/g, '').trim().toUpperCase();
      const voiceMode = (rawVoiceMode === 'REAL' ? 'REAL' : 'MOCK') as 'REAL' | 'MOCK';
      const productionVoiceEnabled = process.env.VOICE_PRODUCTION_ENABLED === 'true';
      const globalKillSwitchActive = process.env.VOICE_GLOBAL_KILL_SWITCH === 'true';
      const realProviderAllowlist = (process.env.VOICE_REAL_PROVIDER_ALLOWLIST || 'sarvam')
        .split('#')[0]
        .replace(/['"]/g, '')
        .split(',')
        .map((p) => p.trim());

      const authResult = evaluateProductionVoiceAuthorization({
        environment,
        voiceMode,
        provider: 'mock',
        tenantId: dbLead.tenant_id || (effectiveScope as any)?.tenantId || '00000000-0000-0000-0000-000000000001',
        leadId: dbLead.id,
        eligibilityDecision: eligibilityResult.decision,
        productionVoiceEnabled,
        globalKillSwitchActive,
        realProviderAllowlist,
      });

      const readinessResult = evaluateVoiceActivationReadiness({
        environment,
        voiceMode,
        provider: 'mock',
        tenantId: dbLead.tenant_id || (effectiveScope as any)?.tenantId || '00000000-0000-0000-0000-000000000001',
        leadId: dbLead.id,
        eligibilityDecision: eligibilityResult.decision,
        complianceDecision: 'ALLOWED',
        productionVoiceEnabled,
        globalKillSwitchActive,
        rolloutEnabled: process.env.VOICE_ROLLOUT_ENABLED === 'true',
        rolloutPercentage: Number((process.env.VOICE_ROLLOUT_PERCENTAGE || '0').split('#')[0].trim()) || 0,
        realCallsForTenant: 0,
        maxRealCallsPerTenant: Number((process.env.VOICE_MAX_REAL_CALLS_PER_TENANT || '0').split('#')[0].trim()) || 0,
        realCallsGlobal: 0,
        maxRealCallsGlobal: Number((process.env.VOICE_MAX_REAL_CALLS_GLOBAL || '0').split('#')[0].trim()) || 0,
        realProviderAllowlist,
        costCheckPassed: true,
        providerHealthy: true,
      });

      const authorizationSnapshot = {
        authorization_policy_version: authResult.policyVersion,
        readiness_policy_version: readinessResult.policyVersion,
        eligibility_policy_version: CALL_ELIGIBILITY_POLICY_VERSION,
        compliance_policy_version: CALL_COMPLIANCE_POLICY_VERSION,
        authorization_decision: authResult.decision,
        readiness_decision: readinessResult.decision,
        provider: 'mock',
        mode: authResult.mode,
        tenant_scope_verified: true,
      };

      await supabaseDataService.leadEvents.appendLeadEvent(effectiveScope, {
        lead_id: dbLead.id,
        event_type: 'VOICE_AUTHORIZATION_DECIDED',
        event_data: {
          policy_version: authResult.policyVersion,
          decision: authResult.decision,
          reason_codes: authResult.reasonCodes,
          provider: authResult.provider,
          mode: authResult.mode,
          evaluated_at: authResult.evaluatedAt,
          actor,
        },
      });

      await supabaseDataService.leadEvents.appendLeadEvent(effectiveScope, {
        lead_id: dbLead.id,
        event_type: 'VOICE_ACTIVATION_READINESS_DECIDED',
        event_data: {
          policy_version: readinessResult.policyVersion,
          decision: readinessResult.decision,
          reason_codes: readinessResult.reasonCodes,
          provider: readinessResult.provider,
          mode: readinessResult.mode,
          evaluated_at: readinessResult.evaluatedAt,
          authorization_snapshot: authorizationSnapshot,
          actor,
        },
      });

      if (authResult.authorized && readinessResult.ready) {
        mockCallResult = await mockVoiceProvider.initiateCall({
          idempotency_key: options?.idempotencyKey,
          tenant_id: dbLead.tenant_id,
          lead_id: dbLead.id,
          phone_number: canonicalBefore.identity.phone,
          contact_name: canonicalBefore.identity.full_name || 'Valued Buyer',
        });
      }
    }

    // 9. Fetch fresh canonical lead after all updates
    const canonicalAfter = await supabaseDataService.mapToGFBuyerLead(effectiveScope, dbLead.id);
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
    const tenantScope = options?.tenantScope || (options?.tenantId ? { tenantId: options.tenantId } : undefined);
    // 1. Resolve lead
    let dbLead = tenantScope
      ? await supabaseDataService.leads.getLeadByLeadId(tenantScope, leadIdOrUUID)
      : await supabaseDataService.leads.getLeadByLeadId(leadIdOrUUID);
    if (!dbLead && tenantScope) {
      dbLead = await supabaseDataService.leads.getLead(tenantScope, leadIdOrUUID);
    } else if (!dbLead) {
      dbLead = await supabaseDataService.leads.getLead(leadIdOrUUID);
    }
    if (!dbLead) {
      throw new Error(`Lead not found for ID: ${leadIdOrUUID}`);
    }

    const previousStatus = dbLead.status;
    const actor = options?.actor || 'human_operator';
    const effectiveScope: TenantScope = tenantScope || (dbLead.tenant_id ? { tenantId: dbLead.tenant_id } : undefined) || {};

    // If already in CALLING or CONNECTED, return existing active call telemetry idempotently
    if (previousStatus === 'CALLING' || previousStatus === 'CONNECTED') {
      const existingCalls = await supabaseDataService.calls.getCallsByLead(dbLead.id);
      const latestCall = existingCalls[existingCalls.length - 1];
      const updatedCanonical = await supabaseDataService.mapToGFBuyerLead(effectiveScope, dbLead.id);
      return {
        leadId: dbLead.id,
        callResult: {
          callId: latestCall?.id || 'idempotent-active',
          provider: latestCall?.provider || 'sarvam',
          status: (latestCall?.status || previousStatus) as any,
          initiated: true,
          external_call_id: latestCall?.provider_call_id || undefined,
          created_at: latestCall?.created_at || new Date().toISOString(),
        },
        previousStatus,
        newStatus: previousStatus,
        canonicalLead: updatedCanonical || (await supabaseDataService.mapToGFBuyerLead(effectiveScope, dbLead.id))!,
      };
    }

    // Must be in CALL_PENDING (or evaluate if in ENRICHED or RESOLVED)
    if (previousStatus !== 'CALL_PENDING') {
      if (previousStatus === 'ENRICHED' || previousStatus === 'RESOLVED') {
        const elig = await this.evaluateAndPrepareCall(dbLead.id, { actor, tenantScope: effectiveScope });
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
    const canonicalLead = await supabaseDataService.mapToGFBuyerLead(effectiveScope, dbLead.id);
    if (!canonicalLead) {
      throw new Error(`Failed to map canonical lead for ID: ${dbLead.id}`);
    }

    const targetPhone = canonicalLead.identity.phone;
    if (!targetPhone) {
      throw new Error(`Cannot initiate call: phone number is missing on lead ${dbLead.id}`);
    }

    const provider = options?.provider || this.getActiveVoiceProvider();

    // 3. Record CALL_REQUESTED audit event
    await supabaseDataService.leadEvents.appendLeadEvent(effectiveScope, {
      lead_id: dbLead.id,
      event_type: 'CALL_REQUESTED',
      event_data: {
        provider: provider.providerName,
        phone_masked: targetPhone.slice(-4).padStart(targetPhone.length, '*'),
        requested_by: actor,
        timestamp: new Date().toISOString(),
      },
    });

    // 4. Evaluate Call Compliance & Provider Health
    const callsHistory = await supabaseDataService.calls.getCallsByLead(effectiveScope, dbLead.id);
    const compliance = evaluateCallCompliance({
      leadId: dbLead.id,
      tenantId: dbLead.tenant_id,
      callsHistory,
      policyConfig: {
        enforceCallingHours: process.env.NODE_ENV === 'test' ? false : true,
      },
    });
    const complianceDecision = compliance.compliant ? 'ALLOWED' : 'BLOCKED';

    let providerHealthy = true;
    try {
      if (provider.checkHealth) {
        const health = await provider.checkHealth();
        providerHealthy = Boolean(health.configured && health.reachable);
      }
    } catch {
      providerHealthy = false;
    }

    // 5. Evaluate Cost Policy
    const costAssessment = evaluateVoiceCostPolicy({
      tenantId: dbLead.tenant_id,
      leadId: dbLead.id,
    });

    // 6. Evaluate Production Voice Authorization
    const env = (process.env.NODE_ENV || 'development').toLowerCase();
    const rawVoiceMode = (process.env.VOICE_MODE || 'MOCK').split('#')[0].replace(/['"]/g, '').trim().toUpperCase();
    const voiceMode = (rawVoiceMode === 'REAL' ? 'REAL' : 'MOCK') as 'REAL' | 'MOCK';
    const environment = (env === 'production' ? 'production' : (env === 'test' && voiceMode === 'REAL') ? 'production' : env === 'test' ? 'test' : 'development') as 'production' | 'development' | 'test';
    const productionVoiceEnabled = process.env.VOICE_PRODUCTION_ENABLED === 'true';
    const globalKillSwitchActive = process.env.VOICE_GLOBAL_KILL_SWITCH === 'true';
    const realProviderAllowlist = (process.env.VOICE_REAL_PROVIDER_ALLOWLIST || 'sarvam')
      .split('#')[0]
      .replace(/['"]/g, '')
      .split(',')
      .map((p) => p.trim());

    const authResult = evaluateProductionVoiceAuthorization({
      environment,
      voiceMode,
      provider: provider.providerName,
      tenantId: dbLead.tenant_id,
      leadId: dbLead.id,
      eligibilityDecision: 'ELIGIBLE',
      productionVoiceEnabled,
      globalKillSwitchActive,
      realProviderAllowlist,
    });

    // 7. Evaluate Voice Activation Readiness
    const rolloutEnabled = process.env.VOICE_ROLLOUT_ENABLED === 'true';
    const rolloutPercentage = Number((process.env.VOICE_ROLLOUT_PERCENTAGE || '0').split('#')[0].trim()) || 0;
    const maxRealCallsPerTenant = Number((process.env.VOICE_MAX_REAL_CALLS_PER_TENANT || '0').split('#')[0].trim()) || 0;
    const maxRealCallsGlobal = Number((process.env.VOICE_MAX_REAL_CALLS_GLOBAL || '0').split('#')[0].trim()) || 0;

    const readinessResult = evaluateVoiceActivationReadiness({
      environment,
      voiceMode,
      provider: provider.providerName,
      tenantId: dbLead.tenant_id,
      leadId: dbLead.id,
      eligibilityDecision: 'ELIGIBLE',
      complianceDecision,
      productionVoiceEnabled,
      globalKillSwitchActive,
      rolloutEnabled,
      rolloutPercentage,
      realCallsForTenant: 0,
      maxRealCallsPerTenant,
      realCallsGlobal: 0,
      maxRealCallsGlobal,
      realProviderAllowlist,
      costCheckPassed: costAssessment.passed,
      providerHealthy,
    });

    // 8. Construct Safe Authorization Snapshot
    const authorizationSnapshot = {
      authorization_policy_version: authResult.policyVersion,
      readiness_policy_version: readinessResult.policyVersion,
      eligibility_policy_version: CALL_ELIGIBILITY_POLICY_VERSION,
      compliance_policy_version: CALL_COMPLIANCE_POLICY_VERSION,
      authorization_decision: authResult.decision,
      readiness_decision: readinessResult.decision,
      provider: provider.providerName,
      mode: authResult.mode,
      tenant_scope_verified: true,
    };

    // 9. Record Audit Events
    await supabaseDataService.leadEvents.appendLeadEvent(effectiveScope, {
      lead_id: dbLead.id,
      event_type: 'VOICE_AUTHORIZATION_DECIDED',
      event_data: {
        policy_version: authResult.policyVersion,
        decision: authResult.decision,
        reason_codes: authResult.reasonCodes,
        provider: authResult.provider,
        mode: authResult.mode,
        evaluated_at: authResult.evaluatedAt,
        actor,
      },
    });

    await supabaseDataService.leadEvents.appendLeadEvent(effectiveScope, {
      lead_id: dbLead.id,
      event_type: 'VOICE_ACTIVATION_READINESS_DECIDED',
      event_data: {
        policy_version: readinessResult.policyVersion,
        decision: readinessResult.decision,
        reason_codes: readinessResult.reasonCodes,
        provider: readinessResult.provider,
        mode: readinessResult.mode,
        evaluated_at: readinessResult.evaluatedAt,
        authorization_snapshot: authorizationSnapshot,
        actor,
      },
    });

    // 10. Check Authorization & Activation Readiness: ONLY IF both pass may provider execute
    if (!authResult.authorized || !readinessResult.ready) {
      const blockedReasons = Array.from(
        new Set([...authResult.reasonCodes, ...readinessResult.reasonCodes])
      );
      throw new Error(
        `Production voice activation readiness BLOCKED: ${blockedReasons.join(', ')}`
      );
    }

    // 11. Evaluate Retry Policy for Idempotency Key
    const retryEval = evaluateVoiceRetryPolicy({
      tenantId: dbLead.tenant_id,
      leadId: dbLead.id,
      attemptNumber: 0,
    });
    const dispatchIdempotencyKey = options?.idempotencyKey || retryEval.idempotencyKey;

    // 12. Initiate Call via selected VoiceProvider (ONLY reaches here if authorized & ready)
    const callResult = await provider.initiateCall({
      idempotency_key: dispatchIdempotencyKey,
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
      await supabaseDataService.leadEvents.appendLeadEvent(effectiveScope, {
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
      await supabaseDataService.leads.updateLead(effectiveScope, dbLead.id, { status: 'CALLING' });
      newStatus = 'CALLING';
    } else {
      // Mock ready retention
      newStatus = 'CALL_PENDING';
    }

    // 6. Reload updated canonical lead
    const updatedCanonical = await supabaseDataService.mapToGFBuyerLead(effectiveScope, dbLead.id);
    if (!updatedCanonical) {
      throw new Error(`Failed to reload canonical lead after call initiation`);
    }

    const result: StartCallExecutionResult = {
      leadId: dbLead.id,
      callResult,
      previousStatus,
      newStatus,
      canonicalLead: updatedCanonical,
    };

    if (options?.idempotencyKey && dbLead.tenant_id) {
      await supabaseDataService.security.completeIdempotency(dbLead.tenant_id, options.idempotencyKey, 200, result);
    }

    return result;
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
