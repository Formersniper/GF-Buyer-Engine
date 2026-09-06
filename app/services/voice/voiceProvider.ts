/**
 * GrowthForge Buyer Intelligence Engine - Voice Provider Abstraction
 *
 * VOICE RULE:
 * Provider-neutral abstraction for autonomous voice qualification.
 * Implementations (Twilio, Bland, Retell, Vapi, LiveKit) must adhere to this contract.
 */

export interface CallInitiationParams {
  lead_id: string;
  phone_number: string;
  contact_name: string;
  call_script_id?: string;
  custom_variables?: Record<string, string>;
}

export type CallStatus =
  | 'initiated'
  | 'ringing'
  | 'in-progress'
  | 'completed'
  | 'busy'
  | 'no-answer'
  | 'failed'
  | 'canceled';

export interface CallStatusResponse {
  call_id: string;
  lead_id: string;
  status: CallStatus;
  duration_seconds: number;
  started_at?: string | null;
  ended_at?: string | null;
  failure_reason?: string | null;
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
  event_type: 'call.started' | 'call.answered' | 'call.ended' | 'transcript.ready' | 'call.failed';
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

export interface VoiceProvider {
  readonly providerName: string;

  /**
   * Dispatches an outbound voice qualification call
   */
  startCall(params: CallInitiationParams): Promise<{ call_id: string; status: CallStatus }>;

  /**
   * Retrieves the current call status and telemetry
   */
  getCallStatus(call_id: string): Promise<CallStatusResponse>;

  /**
   * Ingests and processes asynchronous webhook callbacks from voice telephony
   */
  processWebhook(payload: WebhookPayload): Promise<WebhookProcessingResult>;

  /**
   * Retrieves full verbatim transcript of the voice qualification session
   */
  getTranscript(call_id: string): Promise<CallTranscript>;

  /**
   * Explicitly terminates an active call
   */
  endCall(call_id: string): Promise<{ success: boolean; terminated_at: string }>;
}
