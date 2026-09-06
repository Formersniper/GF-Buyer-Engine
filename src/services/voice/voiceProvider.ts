/**
 * GrowthForge Voice Provider Boundary
 * 
 * FROZEN ARCHITECTURE CONTRACT:
 * - Provider-neutral voice interface.
 * - Do not couple business logic directly to a specific telephony vendor.
 * - Asynchronous execution model: phone call -> conversation -> webhook -> transcript -> call outcome.
 * - Technical calling-eligibility gate before voice provider invocation.
 * - In Phase 1: Defines clean typed interfaces with explicit NotImplemented boundary.
 */

import { CallRecord } from '../../types/buyerLead';

export interface StartCallParams {
  leadId: string;
  phoneNumber: string;
  recipientName: string;
  dynamicVariables?: Record<string, string>;
  maxDurationSeconds?: number;
}

export interface CallStatusResponse {
  callId: string;
  status: 'PENDING' | 'RINGING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'NO_ANSWER' | 'BUSY';
  durationSeconds: number;
  startedAt: string | null;
  endedAt: string | null;
}

export interface WebhookPayload {
  provider: string;
  event: 'call.started' | 'call.answered' | 'call.completed' | 'call.failed';
  callId: string;
  leadId: string;
  durationSeconds?: number;
  transcript?: string;
  recordingUrl?: string;
  timestamp: string;
  rawPayload: Record<string, unknown>;
}

export interface WebhookResult {
  handled: boolean;
  leadId: string;
  status: string;
  transcriptAvailable: boolean;
}

export interface CallingEligibilityCheck {
  isEligible: boolean;
  reason: string;
  consentVerified: boolean;
  attemptsCount: number;
}

export interface IVoiceProvider {
  /**
   * Technical Calling Eligibility Gate
   * Verifies consent status, cooldown periods, and maximum attempt limits
   */
  checkCallingEligibility(leadId: string, consentStatus: string, attempts: number): CallingEligibilityCheck;

  /**
   * Initiates an outbound qualification call
   */
  startCall(params: StartCallParams): Promise<{ callId: string; status: string }>;

  /**
   * Retrieves current call status from the telephony provider
   */
  getCallStatus(callId: string): Promise<CallStatusResponse>;

  /**
   * Processes inbound webhook payload from voice provider
   */
  processWebhook(payload: WebhookPayload): Promise<WebhookResult>;

  /**
   * Fetches raw transcript for a completed call
   */
  getTranscript(callId: string): Promise<string>;

  /**
   * Manually terminates an ongoing call
   */
  endCall(callId: string): Promise<{ success: boolean }>;
}

/**
 * Phase 1 Voice Provider Implementation
 * Explicit NotImplemented Boundary for Phase 1
 */
export class VoiceProvider implements IVoiceProvider {
  private providerName: string;

  constructor(providerName: string = 'generic') {
    this.providerName = providerName;
  }

  checkCallingEligibility(
    _leadId: string, 
    consentStatus: string, 
    attempts: number
  ): CallingEligibilityCheck {
    // Technical gate: Do not treat phone number as blanket authorization
    if (consentStatus !== 'CONSENTED' && consentStatus !== 'EXPLICIT_OPT_IN' && consentStatus !== 'DIRECT_INQUIRY') {
      return {
        isEligible: false,
        reason: 'Call eligibility gate failed: Lacks verified explicit consent or direct inquiry',
        consentVerified: false,
        attemptsCount: attempts,
      };
    }

    if (attempts >= 3) {
      return {
        isEligible: false,
        reason: 'Call eligibility gate failed: Maximum call attempt threshold (3) exceeded',
        consentVerified: true,
        attemptsCount: attempts,
      };
    }

    return {
      isEligible: true,
      reason: 'Eligible for AI qualification voice call',
      consentVerified: true,
      attemptsCount: attempts,
    };
  }

  async startCall(_params: StartCallParams): Promise<{ callId: string; status: string }> {
    throw new Error(
      '[Phase 1 Boundary] VoiceProvider.startCall is scheduled for Phase 3 integration. ' +
      'Live voice calling is not executed in Phase 1.'
    );
  }

  async getCallStatus(_callId: string): Promise<CallStatusResponse> {
    throw new Error(
      '[Phase 1 Boundary] VoiceProvider.getCallStatus is scheduled for Phase 3 integration.'
    );
  }

  async processWebhook(_payload: WebhookPayload): Promise<WebhookResult> {
    throw new Error(
      '[Phase 1 Boundary] VoiceProvider.processWebhook is scheduled for Phase 3 integration.'
    );
  }

  async getTranscript(_callId: string): Promise<string> {
    throw new Error(
      '[Phase 1 Boundary] VoiceProvider.getTranscript is scheduled for Phase 3 integration.'
    );
  }

  async endCall(_callId: string): Promise<{ success: boolean }> {
    throw new Error(
      '[Phase 1 Boundary] VoiceProvider.endCall is scheduled for Phase 3 integration.'
    );
  }
}

export const voiceProvider = new VoiceProvider();
