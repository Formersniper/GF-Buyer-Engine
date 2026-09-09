/**
 * GrowthForge Buyer Intelligence Engine - Mock Voice Provider (Phase 4A & 4B Regression)
 *
 * SPECIFICATION:
 * - Provider-neutral boundary validation.
 * - Proves that an ELIGIBLE lead can be handed to a voice boundary without real telephony.
 * - MUST NEVER contact external telephony networks.
 * - Always returns `initiated = false` and `status = 'MOCK_READY'`.
 */

import { supabaseDataService } from '../supabase/repositories';
import {
  VoiceCallRequest,
  VoiceCallResult,
  VoiceCallStatus,
  IVoiceProvider,
  ProviderHealthResult,
} from './voiceProvider';

export class MockVoiceProvider implements IVoiceProvider {
  readonly providerName = 'mock';

  /**
   * Safe Mock Health Check
   */
  async checkHealth(): Promise<ProviderHealthResult> {
    return {
      provider: 'mock',
      configured: true,
      reachable: true,
      agent_configured: true,
      phone_configured: true,
      mode: 'MOCK',
    };
  }

  /**
   * Mock handoff - Persists a MOCK_READY call record without initiating any real outbound call.
   */
  async initiateCall(input: VoiceCallRequest): Promise<VoiceCallResult> {
    const callId = `MOCK-CALL-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const now = new Date().toISOString();

    // Persist a non-fabricated, clearly marked mock call entry in the system of record
    await supabaseDataService.calls.createCall({
      lead_id: input.lead_id,
      provider: 'mock',
      provider_call_id: callId,
      status: 'MOCK_READY',
      attempt_number: 1,
      started_at: null,
      ended_at: null,
      duration_seconds: 0,
      transcript: null,
      recording_url: null,
      call_outcome: null,
      call_metadata: {
        initiated: false,
        policy_version: 'CALL_ELIGIBILITY_V1',
        contact_name: input.contact_name,
        target_phone_masked: input.phone_number ? input.phone_number.slice(-4).padStart(input.phone_number.length, '*') : null,
      },
    });

    return {
      callId,
      provider: 'mock',
      status: 'MOCK_READY',
      initiated: false,
      created_at: now,
    };
  }

  async getCallStatus(callId: string): Promise<VoiceCallStatus> {
    const dbCall = await supabaseDataService.calls.getCall(callId);
    return {
      callId,
      leadId: dbCall?.lead_id || '',
      provider: 'mock',
      status: 'MOCK_READY',
      initiated: false,
      started_at: null,
      ended_at: null,
    };
  }
}

export const mockVoiceProvider = new MockVoiceProvider();
export type { VoiceCallRequest, VoiceCallResult, VoiceCallStatus, IVoiceProvider };
