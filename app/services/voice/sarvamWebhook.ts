/**
 * GrowthForge Buyer Intelligence Engine - Sarvam Webhook Handler
 *
 * SPECIFICATION:
 * - Ingests asynchronous status callbacks from Sarvam Voice Agents platform.
 * - Enforces idempotency to prevent duplicate terminal state transitions.
 * - Correlates events via `external_call_id` / `provider_call_id`.
 * - Records appropriate `lead_events` (`CALL_STARTED`, `CALL_CONNECTED`, `CALL_COMPLETED`, `CALL_NO_ANSWER`, `CALL_FAILED`).
 * - Updates Supabase `calls` table and lead workflow state.
 */

import { supabaseDataService } from '../supabase/repositories';
import { WorkflowStatus } from '../../schemas/workflow';

export interface SarvamWebhookEventPayload {
  event_id?: string;
  event_type?: string;
  type?: string;
  call_id?: string;
  attempt_id?: string;
  external_call_id?: string;
  outbound_id?: string;
  id?: string;
  status?: string;
  started_at?: string;
  ended_at?: string;
  duration_seconds?: number;
  duration?: number;
  transcript?: string;
  recording_url?: string;
  failure_reason?: string;
  disconnect_reason?: string;
  variables?: Record<string, unknown>;
  agent_variables?: Record<string, unknown>;
  metadata?: {
    lead_id?: string;
    [key: string]: unknown;
  };
  app_config?: {
    agent_variables?: Record<string, unknown>;
    [key: string]: unknown;
  };
  lead_id?: string;
}

export interface WebhookProcessingOutput {
  success: boolean;
  action: 'IGNORED_DUPLICATE' | 'UPDATED_CALL' | 'TERMINAL_PROCESSED' | 'CALL_NOT_FOUND' | 'ERROR';
  callId?: string;
  leadId?: string;
  newStatus?: string;
  error?: string;
}

// In-memory set for tracking processed event IDs to prevent duplicate webhook delivery execution
const processedEventIds = new Set<string>();

/**
 * Handles incoming Sarvam webhook callbacks.
 */
export async function processSarvamWebhook(
  payload: SarvamWebhookEventPayload,
  headers?: Record<string, string | string[] | undefined>
): Promise<WebhookProcessingOutput> {
  // 1. Verify webhook authorization / secret if configured
  const webhookSecret = process.env.VOICE_WEBHOOK_SECRET;
  if (webhookSecret && headers) {
    const authHeader = headers['authorization'] || headers['x-sarvam-signature'] || headers['x-webhook-secret'];
    const authValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;

    if (authValue && !authValue.includes(webhookSecret)) {
      return {
        success: false,
        action: 'ERROR',
        error: 'Unauthorized webhook signature/secret.',
      };
    }
  }

  // 2. Extract Event ID and enforce idempotency
  const eventId = payload.event_id || `${payload.call_id || payload.outbound_id || payload.id}-${payload.status || payload.event_type}`;
  if (eventId && processedEventIds.has(eventId)) {
    return {
      success: true,
      action: 'IGNORED_DUPLICATE',
    };
  }

  // 3. Resolve external call ID and fallback lead ID
  const externalCallId =
    payload.outbound_id ||
    payload.call_id ||
    payload.attempt_id ||
    payload.external_call_id ||
    payload.id ||
    (payload.variables?.call_id as string) ||
    (payload.variables?.attempt_id as string);

  const fallbackLeadId =
    payload.metadata?.lead_id ||
    payload.lead_id ||
    (payload.agent_variables?.lead_id as string) ||
    (payload.app_config?.agent_variables?.lead_id as string) ||
    (payload.variables?.lead_id as string);

  if (!externalCallId && !fallbackLeadId) {
    return {
      success: false,
      action: 'ERROR',
      error: 'Webhook payload missing call identifier (outbound_id / call_id) or lead_id metadata.',
    };
  }

  // 4. Find internal call record in Supabase
  let dbCall = externalCallId ? await supabaseDataService.calls.getCallByProviderCallId(externalCallId) : null;
  if (!dbCall && externalCallId) {
    dbCall = await supabaseDataService.calls.getCall(externalCallId);
  }
  if (!dbCall && fallbackLeadId) {
    const leadCalls = await supabaseDataService.calls.getCallsByLead(fallbackLeadId);
    if (leadCalls && leadCalls.length > 0) {
      dbCall = leadCalls[leadCalls.length - 1];
    }
  }

  if (!dbCall) {
    return {
      success: false,
      action: 'CALL_NOT_FOUND',
      error: `No matching call record found for external ID ${externalCallId || 'N/A'} (lead ID ${fallbackLeadId || 'N/A'})`,
    };
  }

  const currentCallStatus = dbCall.status;
  const isAlreadyTerminal =
    currentCallStatus === 'COMPLETED' ||
    currentCallStatus === 'CALL_FAILED' ||
    currentCallStatus === 'NO_ANSWER';

  // 5. Determine new status and mapped event type
  const rawStatus = (payload.status || payload.event_type || payload.type || '').toLowerCase();
  let mappedCallStatus = 'CALLING';
  let mappedWorkflowStatus: WorkflowStatus = 'CALLING';
  let leadEventType: string | null = null;

  if (rawStatus.includes('ringing') || rawStatus.includes('dialing') || rawStatus === 'call.started') {
    mappedCallStatus = 'CALLING';
    mappedWorkflowStatus = 'CALLING';
    leadEventType = 'CALL_STARTED';
  } else if (
    rawStatus.includes('in-progress') ||
    rawStatus.includes('connected') ||
    rawStatus.includes('answered') ||
    rawStatus === 'call.answered'
  ) {
    mappedCallStatus = 'CONNECTED';
    mappedWorkflowStatus = 'CONNECTED';
    leadEventType = 'CALL_CONNECTED';
  } else if (
    rawStatus.includes('completed') ||
    rawStatus.includes('finished') ||
    rawStatus.includes('ended') ||
    rawStatus === 'call.ended'
  ) {
    mappedCallStatus = 'COMPLETED';
    mappedWorkflowStatus = 'QUALIFICATION_IN_PROGRESS';
    leadEventType = 'CALL_COMPLETED';
  } else if (
    rawStatus.includes('no-answer') ||
    rawStatus.includes('busy') ||
    rawStatus.includes('unanswered') ||
    rawStatus.includes('rejected')
  ) {
    mappedCallStatus = 'NO_ANSWER';
    mappedWorkflowStatus = 'NO_ANSWER';
    leadEventType = 'CALL_NO_ANSWER';
  } else if (
    rawStatus.includes('failed') ||
    rawStatus.includes('canceled') ||
    rawStatus.includes('error') ||
    rawStatus === 'call.failed'
  ) {
    mappedCallStatus = 'CALL_FAILED';
    mappedWorkflowStatus = 'CALL_FAILED';
    leadEventType = 'CALL_FAILED';
  }

  // Idempotency: Ignore non-terminal updates if call is already terminal
  if (isAlreadyTerminal && mappedCallStatus !== 'COMPLETED' && mappedCallStatus !== 'CALL_FAILED' && mappedCallStatus !== 'NO_ANSWER') {
    return {
      success: true,
      action: 'IGNORED_DUPLICATE',
      callId: dbCall.id,
      leadId: dbCall.lead_id,
    };
  }

  const durationSeconds = Number(payload.duration_seconds || payload.duration || dbCall.duration_seconds || 0);
  const startedAt = payload.started_at || dbCall.started_at;
  const endedAt = payload.ended_at || (mappedCallStatus === 'COMPLETED' || mappedCallStatus === 'CALL_FAILED' || mappedCallStatus === 'NO_ANSWER' ? new Date().toISOString() : dbCall.ended_at);

  // 6. Update call record in database
  await supabaseDataService.calls.updateCall(dbCall.id, {
    status: mappedCallStatus,
    duration_seconds: durationSeconds,
    started_at: startedAt,
    ended_at: endedAt,
    transcript: payload.transcript || dbCall.transcript,
    recording_url: payload.recording_url || dbCall.recording_url,
    call_outcome: payload.failure_reason || payload.disconnect_reason || (mappedCallStatus === 'COMPLETED' ? 'COMPLETED_SUCCESSFULLY' : mappedCallStatus),
  });

  // 7. Update lead status in Supabase
  await supabaseDataService.leads.updateLead(dbCall.lead_id, { status: mappedWorkflowStatus });

  // 8. Record audit event in Supabase lead_events
  if (leadEventType) {
    await supabaseDataService.leadEvents.appendLeadEvent({
      lead_id: dbCall.lead_id,
      event_type: leadEventType,
      event_data: {
        provider: 'sarvam',
        external_call_id: externalCallId,
        previous_status: currentCallStatus,
        new_status: mappedWorkflowStatus,
        duration_seconds: durationSeconds,
        timestamp: new Date().toISOString(),
      },
    });
  }

  if (eventId) {
    processedEventIds.add(eventId);
  }

  return {
    success: true,
    action: isAlreadyTerminal ? 'TERMINAL_PROCESSED' : 'UPDATED_CALL',
    callId: dbCall.id,
    leadId: dbCall.lead_id,
    newStatus: mappedWorkflowStatus,
  };
}
