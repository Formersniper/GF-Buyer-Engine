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

import crypto from 'crypto';
import { supabaseDataService } from '../supabase/repositories';
import { WorkflowStatus } from '../../schemas/workflow';
import { transcriptIngestionService } from './transcriptIngestionService';
import { WebhookEvent } from '../../schemas/tenant';

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

/**
 * Handles incoming Sarvam webhook callbacks.
 */
export async function processSarvamWebhook(
  payload: SarvamWebhookEventPayload,
  headers?: Record<string, string | string[] | undefined>
): Promise<WebhookProcessingOutput> {
  // 1. Verify webhook authorization / secret if configured
  const webhookSecret = process.env.VOICE_WEBHOOK_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';

  if (!webhookSecret) {
    if (isProduction) {
      return { success: false, action: 'ERROR', error: 'Unauthorized' };
    }
  } else if (headers) {
    const authHeader = headers['authorization'] || headers['x-sarvam-signature'] || headers['x-webhook-secret'];
    const authValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    
    if (!authValue) {
      return { success: false, action: 'ERROR', error: 'Unauthorized' };
    }

    const token = authValue.startsWith('Bearer ') ? authValue.slice(7).trim() : authValue.trim();
    if (token.length !== webhookSecret.length) {
      return { success: false, action: 'ERROR', error: 'Unauthorized' };
    }

    const isMatch = crypto.timingSafeEqual(Buffer.from(token), Buffer.from(webhookSecret));
    if (!isMatch) {
      return { success: false, action: 'ERROR', error: 'Unauthorized' };
    }
  }

  // 2. Extract Event ID and enforce idempotency via DB
  const rawStatus = (payload.status || payload.event_type || payload.type || '').toLowerCase();
  const eventId = payload.event_id || `${payload.call_id || payload.outbound_id || payload.id}-${rawStatus}`;
  
  if (eventId) {
    const existingEvent = await supabaseDataService.webhookEvents.getEvent(eventId);
    if (existingEvent) {
      return { success: true, action: 'IGNORED_DUPLICATE' };
    }
    
    const newEvent: WebhookEvent = {
      event_id: eventId,
      provider: 'sarvam',
      received_at: new Date().toISOString(),
      status: 'PENDING',
      payload_hash: null,
      processed_at: null
    };

    try {
      await supabaseDataService.webhookEvents.recordEvent(newEvent);
    } catch (err: unknown) {
      // If a concurrent request already inserted this event_id, treat as duplicate
      if (err instanceof Error && err.message.includes('Duplicate webhook event')) {
         return { success: true, action: 'IGNORED_DUPLICATE' };
      }
      throw err;
    }
  }

  // 3. Resolve external call ID. DO NOT fallback to guessing via leadId's latest call
  const externalCallId =
    payload.outbound_id ||
    payload.call_id ||
    payload.attempt_id ||
    payload.external_call_id ||
    payload.id ||
    (payload.variables?.call_id as string) ||
    (payload.variables?.attempt_id as string);

  if (!externalCallId) {
    return {
      success: false,
      action: 'ERROR',
      error: 'Webhook payload missing authoritative provider call identifier',
    };
  }

  // 4. Find internal call record in Supabase
  let dbCall = await supabaseDataService.calls.getCallByProviderCallId(externalCallId);
  if (!dbCall) {
    dbCall = await supabaseDataService.calls.getCall(externalCallId);
  }

  if (!dbCall) {
    return {
      success: false,
      action: 'CALL_NOT_FOUND',
      error: 'No matching call record found for authoritative identifier',
    };
  }

  const currentCallStatus = dbCall.status;
  const isAlreadyTerminal =
    currentCallStatus === 'COMPLETED' ||
    currentCallStatus === 'CALL_FAILED' ||
    currentCallStatus === 'NO_ANSWER';

  // 5. Determine new status and mapped event type
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

  // Idempotency / Ordering: Ignore non-terminal updates if call is already terminal
  if (isAlreadyTerminal && mappedCallStatus !== 'COMPLETED' && mappedCallStatus !== 'CALL_FAILED' && mappedCallStatus !== 'NO_ANSWER') {
    if (eventId) {
      await supabaseDataService.webhookEvents.updateEventStatus(eventId, 'IGNORED_STALE');
    }
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

  // 8. Ingest transcript if present in payload (Phase 5A)
  const hasTranscriptData = Boolean(
    payload.transcript ||
    payload.variables?.transcript ||
    (payload as Record<string, unknown>).transcript_turns ||
    (payload as Record<string, unknown>).messages ||
    (payload as Record<string, unknown>).turns
  );

  if (hasTranscriptData) {
    try {
      await transcriptIngestionService.ingestSarvamTranscript(payload);
    } catch (ingestErr) {
      console.error('[Transcript Ingestion Error] Failed to ingest transcript from webhook payload');
    }
  }

  // 9. Record audit event in Supabase lead_events
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
    await supabaseDataService.webhookEvents.updateEventStatus(eventId, 'COMPLETED');
  }

  return {
    success: true,
    action: isAlreadyTerminal ? 'TERMINAL_PROCESSED' : 'UPDATED_CALL',
    callId: dbCall.id,
    leadId: dbCall.lead_id,
    newStatus: mappedWorkflowStatus,
  };
}
