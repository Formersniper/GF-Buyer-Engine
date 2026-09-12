/**
 * GrowthForge Buyer Intelligence Engine - Sarvam Voice Provider
 *
 * SPECIFICATION:
 * - Implements VoiceProvider / IVoiceProvider contract behind provider-neutral boundary.
 * - Bridges GrowthForge qualification calls to Sarvam Voice Agents.
 * - Preserves server-side secret isolation; never exposes credentials.
 * - Persists normalized call records to Supabase `calls` table.
 * - Handles status mapping and safe health checks.
 */

import { supabaseDataService } from '../supabase/repositories';
import { VoiceCallRequest, VoiceCallResult, VoiceCallStatus, IVoiceProvider, ProviderHealthResult } from './voiceProvider';
import { SarvamClient, sarvamClient } from './sarvamClient';
import { withRetry, withTimeout } from '../errors';
import { buildSarvamSystemPrompt, buildSarvamInitialGreeting } from './sarvamPrompt';
import { SarvamError, SarvamErrorCode } from './sarvamErrors';

export class SarvamVoiceProvider implements IVoiceProvider {
  readonly providerName = 'sarvam';
  private client: SarvamClient;

  constructor(client?: SarvamClient) {
    this.client = client || sarvamClient;
  }

  /**
   * Health Check: Validates configuration and reachability without making outbound calls.
   */
  async checkHealth(): Promise<ProviderHealthResult> {
    const health = await this.client.checkHealth();
    return {
      provider: 'sarvam',
      configured: health.configured,
      reachable: health.reachable,
      agent_configured: health.agentConfigured,
      phone_configured: health.phoneConfigured,
      mode: process.env.VOICE_MODE === 'REAL' ? 'REAL' : 'MOCK',
      reason: health.reason,
    };
  }

  /**
   * Initiates an outbound qualification call via Sarvam Voice Agents.
   */
  async initiateCall(input: VoiceCallRequest): Promise<VoiceCallResult> {
    const now = new Date().toISOString();
    const contactName = input.contact_name || 'Valued Buyer';
    const targetPhone = input.phone_number;

    if (!targetPhone) {
      throw new SarvamError(
        SarvamErrorCode.BAD_REQUEST,
        'Cannot initiate call: Phone number is missing.'
      );
    }
    
    const tenantId = input.tenant_id || null;
    const idempotencyKey = input.idempotency_key || `sv-out-${input.lead_id}`;
    
    // Global Ceiling Protection
    const globalRl = await supabaseDataService.security.checkAndIncrementRateLimit('global_sarvam', 'sarvam_outbound', 60, 200);
    if (!globalRl.allowed) {
      throw new SarvamError(SarvamErrorCode.RATE_LIMITED, 'Global rate limit exceeded for outbound calls');
    }

    // Check Tenant Rate Limit (e.g. max 50 calls per hour per tenant)
    if (tenantId) {
      const rl = await supabaseDataService.security.checkAndIncrementRateLimit(tenantId, 'sarvam_outbound', 3600, 50);
      if (!rl.allowed) {
        throw new SarvamError(SarvamErrorCode.RATE_LIMITED, 'Tenant rate limit exceeded for outbound calls');
      }
    }

    // Acquire Resource Lock to prevent duplicate concurrent dispatches for the same lead
    const lockOwner = idempotencyKey + '-' + Date.now();
    const lockAcquired = await supabaseDataService.security.acquireResourceLock('lead_call', input.lead_id, tenantId, lockOwner, 30);
    if (!lockAcquired) {
      throw new Error('Call dispatch already in progress for this lead');
    }

    try {
      // Idempotency check
      const idempotency = await supabaseDataService.security.acquireIdempotency(tenantId, idempotencyKey, 'sarvam_outbound', 86400);
      if (idempotency.status === 'COMPLETED' && idempotency.response_body) {
        return idempotency.response_body as VoiceCallResult;
      }
      // Since supabase JS timestamp parsing might differ, we just rely on PENDING status
      // In a real system, if it's PENDING and not expired, we'd wait. For now, we throw.
      if (idempotency.status === 'PENDING' && (new Date(idempotency.created_at).getTime() < Date.now() - 100)) {
        throw new Error('Call dispatch is currently pending processing (idempotency conflict)');
      }

      // 1. Dispatch outbound call to Sarvam Client
    // If systemPrompt is not explicitly passed, leave undefined so Sarvam uses the dashboard v2 "Growthforge Sales" Shubh agent configuration
    const outboundResult = await this.client.startOutboundCall({
      toPhoneNumber: targetPhone,
      recipientName: contactName,
      leadId: input.lead_id,
      enquiryType: input.custom_variables?.enquiry_type,
      systemPrompt: input.system_prompt, // Only passed if explicitly requested
      webhookUrl: process.env.APP_URL ? `${process.env.APP_URL}/api/voice/sarvam/webhook` : undefined,
      customVariables: input.custom_variables,
    });

    const externalCallId = outboundResult.externalCallId;
    const mappedStatus = this.mapSarvamStatusToGF(outboundResult.status);

    // 2. Persist call record into Supabase system of record
    const createdCallRecord = await supabaseDataService.calls.createCall({
      lead_id: input.lead_id,
      provider: 'sarvam',
      provider_call_id: externalCallId,
      status: mappedStatus,
      attempt_number: 1,
      started_at: null,
      ended_at: null,
      duration_seconds: 0,
      transcript: null,
      recording_url: null,
      call_outcome: null,
      call_metadata: {
        initiated: true,
        policy_version: 'CALL_ELIGIBILITY_V1',
        contact_name: contactName,
        target_phone_masked: outboundResult.targetPhoneMasked,
        provider_initial_status: outboundResult.status,
      },
    });

    const finalResult: VoiceCallResult = {
      callId: createdCallRecord.id,
      provider: 'sarvam',
      status: mappedStatus as any,
      initiated: true,
      external_call_id: externalCallId,
      created_at: now,
    };
    
    await supabaseDataService.security.completeIdempotency(tenantId, idempotencyKey, 200, finalResult);
    return finalResult;
    
    } catch (err: any) {
      await supabaseDataService.security.failIdempotency(tenantId, idempotencyKey, 500, { error: err.message });
      throw err;
    } finally {
      await supabaseDataService.security.releaseResourceLock('lead_call', input.lead_id, lockOwner);
    }
  }

  /**
   * Retrieves call status and telemetry from local DB and/or Sarvam telemetry.
   */
  async getCallStatus(callId: string): Promise<VoiceCallStatus> {
    let dbCall = await supabaseDataService.calls.getCall(callId);
    if (!dbCall) {
      dbCall = await supabaseDataService.calls.getCallByProviderCallId(callId);
    }

    if (!dbCall) {
      throw new Error(`Call record not found for ID: ${callId}`);
    }

    let status = dbCall.status;
    let duration = dbCall.duration_seconds || 0;
    let startedAt = dbCall.started_at;
    let endedAt = dbCall.ended_at;

    // If call is still in flight and has external call ID, query telemetry
    if (
      (status === 'CALLING' || status === 'CALL_PENDING') &&
      dbCall.provider_call_id &&
      process.env.VOICE_MODE === 'REAL'
    ) {
      try {
        const telemetry = await this.client.getCallTelemetry(dbCall.provider_call_id);
        const mapped = this.mapSarvamStatusToGF(telemetry.status);
        if (mapped !== status) {
          status = mapped;
          duration = telemetry.durationSeconds || duration;
          startedAt = telemetry.startedAt || startedAt;
          endedAt = telemetry.endedAt || endedAt;

          await supabaseDataService.calls.updateCall(dbCall.id, {
            status: mapped,
            duration_seconds: duration,
            started_at: startedAt,
            ended_at: endedAt,
          });
        }
      } catch {
        // Fallback gracefully to DB status
      }
    }

    return {
      callId: dbCall.id,
      leadId: dbCall.lead_id,
      provider: 'sarvam',
      status,
      initiated: true,
      external_call_id: dbCall.provider_call_id,
      started_at: startedAt,
      ended_at: endedAt,
      duration_seconds: duration,
    };
  }

  /**
   * Maps Sarvam platform status values to GrowthForge canonical workflow statuses.
   */
  mapSarvamStatusToGF(sarvamStatus: string): string {
    const s = (sarvamStatus || '').toLowerCase().trim();

    if (s === 'queued' || s === 'initiated' || s === 'pending') {
      return 'CALL_PENDING';
    }
    if (s === 'ringing' || s === 'dialing' || s === 'calling') {
      return 'CALLING';
    }
    if (s === 'in-progress' || s === 'connected' || s === 'active' || s === 'answered') {
      return 'CONNECTED';
    }
    if (s === 'completed' || s === 'ended' || s === 'finished' || s === 'success') {
      return 'COMPLETED';
    }
    if (s === 'no-answer' || s === 'busy' || s === 'unanswered' || s === 'rejected') {
      return 'NO_ANSWER';
    }
    if (s === 'failed' || s === 'canceled' || s === 'error' || s === 'dropped') {
      return 'CALL_FAILED';
    }

    return 'CALLING';
  }
}

export const sarvamVoiceProvider = new SarvamVoiceProvider();
