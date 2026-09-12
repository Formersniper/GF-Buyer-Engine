/**
 * GrowthForge Buyer Intelligence Engine - Voice Provider Abstraction
 *
 * VOICE RULE:
 * Provider-neutral abstraction for autonomous voice qualification.
 * Implementations (MockVoiceProvider, SarvamVoiceProvider, future VapiVoiceProvider)
 * must adhere strictly to this contract.
 */

export interface VoiceCallRequest {
  lead_id: string;
  phone_number: string;
  contact_name: string;
  call_script_id?: string;
  custom_variables?: Record<string, string>;
  system_prompt?: string;
  idempotency_key?: string;
  tenant_id?: string;
}

export type CallInitiationParams = VoiceCallRequest;

export type CallStatus =
  | 'initiated'
  | 'ringing'
  | 'in-progress'
  | 'connected'
  | 'completed'
  | 'busy'
  | 'no-answer'
  | 'failed'
  | 'canceled'
  | 'MOCK_READY'
  | 'CALL_PENDING'
  | 'CALLING'
  | 'NO_ANSWER'
  | 'CALL_FAILED';

export interface VoiceCallResult {
  callId: string;
  provider: string;
  status: string;
  initiated: boolean;
  external_call_id?: string | null;
  created_at: string;
}

export interface VoiceCallStatus {
  callId: string;
  leadId: string;
  provider: string;
  status: string;
  initiated: boolean;
  external_call_id?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  duration_seconds?: number;
  failure_reason?: string | null;
}

export type CallStatusResponse = VoiceCallStatus;

export interface ProviderHealthResult {
  provider: string;
  configured: boolean;
  reachable: boolean;
  agent_configured: boolean;
  phone_configured: boolean;
  mode: 'REAL' | 'MOCK';
  reason?: string;
}

export interface TranscriptUtterance {
  speaker: 'agent' | 'buyer' | 'system';
  text: string;
  timestamp_ms: number;
  confidence?: number;
}

export interface CallTranscript {
  call_id: string;
  lead_id: string;
  full_text: string;
  utterances: TranscriptUtterance[];
  recorded_at: string;
  audio_recording_url?: string | null;
}

export interface WebhookPayload {
  event_type: 'call.started' | 'call.answered' | 'call.ended' | 'transcript.ready' | 'call.failed' | string;
  call_id: string;
  lead_id: string;
  timestamp: string;
  raw_payload: Record<string, unknown>;
}

export interface WebhookProcessingResult {
  acknowledged: boolean;
  action_taken: string;
  new_workflow_status?: string;
  error?: string;
}

export interface IVoiceProvider {
  readonly providerName: string;

  /**
   * Dispatches an outbound voice qualification call
   */
  initiateCall(input: VoiceCallRequest): Promise<VoiceCallResult>;

  /**
   * Retrieves the current call status and telemetry
   */
  getCallStatus(callId: string): Promise<VoiceCallStatus>;

  /**
   * Health check / probe for provider readiness
   */
  checkHealth?(): Promise<ProviderHealthResult>;
}

export type VoiceProvider = IVoiceProvider;
