/**
 * GrowthForge Buyer Intelligence Engine - Transcript Ingestion Service (Phase 5A)
 *
 * SPECIFICATION & CANONICAL PIPELINE:
 * - Ingests raw conversational transcripts from Sarvam Voice Agents / Telephony.
 * - Enforces immutable raw evidence preservation (no summarization, translation, or inference).
 * - Preserves structured turn-by-turn transcript (speaker, text, timestamps) when available.
 * - Correlates transcripts deterministically via:
 *     1. provider_call_id / outbound_id -> calls.provider_call_id -> call -> lead_id
 *     2. call_id -> calls.id -> lead_id
 *     3. fallback lead_id -> verified lead's active/latest call
 * - Returns explicit TRANSCRIPT_CORRELATION_FAILED if unresolvable (never attaches to guessed lead).
 * - Enforces strict idempotency: duplicate deliveries return IGNORED_DUPLICATE without duplicate records or audit spam.
 * - Persists to Supabase `call_transcripts` table and records `TRANSCRIPT_INGESTED` in `lead_events`.
 */

import { supabaseDataService } from '../supabase/repositories';
import { CallTranscript, TranscriptTurn } from '../../schemas/database';
import { SarvamWebhookEventPayload } from './sarvamWebhook';

export interface IngestTranscriptInput {
  provider_call_id?: string | null;
  call_id?: string | null;
  lead_id?: string | null;
  interaction_id?: string | null;
  transcript_text?: string | null;
  transcript_turns?: TranscriptTurn[] | Array<{
    speaker?: string;
    role?: string;
    text?: string;
    message?: string;
    content?: string;
    timestamp?: string;
    [key: string]: unknown;
  }> | null;
  language?: string | null;
  duration_seconds?: number | null;
  source?: string;
  source_event_type?: string | null;
  captured_at?: string | null;
}

export interface IngestTranscriptOutput {
  success: boolean;
  action: 'TRANSCRIPT_INGESTED' | 'IGNORED_DUPLICATE' | 'TRANSCRIPT_CORRELATION_FAILED' | 'NO_TRANSCRIPT_DATA' | 'ERROR';
  transcript?: CallTranscript;
  transcriptId?: string;
  callId?: string;
  leadId?: string;
  error?: string;
}

export class TranscriptIngestionService {
  /**
   * Normalizes raw text or heterogeneous turn representations into canonical TranscriptTurn array
   * while preserving exact original wording and language (Hindi/Hinglish/English).
   */
  public normalizeTurns(
    turnsInput?: IngestTranscriptInput['transcript_turns'],
    rawText?: string | null
  ): { turns: TranscriptTurn[]; rawText: string } {
    let canonicalTurns: TranscriptTurn[] = [];

    if (Array.isArray(turnsInput) && turnsInput.length > 0) {
      canonicalTurns = turnsInput.map((t) => {
        const speakerRaw = (t.speaker || t.role || 'unknown').toLowerCase();
        let speaker: 'agent' | 'user' | 'system' | string = 'user';
        if (speakerRaw.includes('agent') || speakerRaw.includes('assistant') || speakerRaw.includes('bot') || speakerRaw === 'ai') {
          speaker = 'agent';
        } else if (speakerRaw.includes('system')) {
          speaker = 'system';
        } else if (speakerRaw.includes('user') || speakerRaw.includes('human') || speakerRaw.includes('caller') || speakerRaw.includes('customer')) {
          speaker = 'user';
        } else {
          speaker = speakerRaw;
        }

        const text = String(t.text || t.message || t.content || '').trim();
        return {
          speaker,
          text,
          timestamp: t.timestamp ? String(t.timestamp) : undefined,
          raw_data: t as Record<string, unknown>,
        };
      }).filter((t) => t.text.length > 0);
    }

    // If turns are missing or empty but rawText is provided with dialogue lines
    if (canonicalTurns.length === 0 && rawText && rawText.trim().length > 0) {
      const lines = rawText.split('\n');
      const parsedFromLines: TranscriptTurn[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Pattern matching like "Agent: ...", "User: ...", "Shubh: ...", "Caller: ..."
        const match = trimmed.match(/^(agent|assistant|shubh|growthforge|system|user|caller|customer|buyer):\s*(.+)$/i);
        if (match) {
          const speakerPrefix = match[1].toLowerCase();
          let speaker: 'agent' | 'user' | 'system' = 'user';
          if (['agent', 'assistant', 'shubh', 'growthforge'].includes(speakerPrefix)) {
            speaker = 'agent';
          } else if (speakerPrefix === 'system') {
            speaker = 'system';
          } else {
            speaker = 'user';
          }

          parsedFromLines.push({
            speaker,
            text: match[2].trim(),
          });
        }
      }

      if (parsedFromLines.length > 0) {
        canonicalTurns = parsedFromLines;
      }
    }

    // Build synthesized or clean rawText
    let constructedRawText = (rawText || '').trim();
    if (!constructedRawText && canonicalTurns.length > 0) {
      constructedRawText = canonicalTurns
        .map((t) => `${t.speaker === 'agent' ? 'Agent' : t.speaker === 'user' ? 'User' : t.speaker}: ${t.text}`)
        .join('\n');
    }

    return {
      turns: canonicalTurns,
      rawText: constructedRawText,
    };
  }

  /**
   * Main domain ingestion method. Correlates, deduplicates, persists, and audits call transcripts.
   */
  public async ingestTranscript(input: IngestTranscriptInput): Promise<IngestTranscriptOutput> {
    const { turns, rawText } = this.normalizeTurns(input.transcript_turns, input.transcript_text);

    if (!rawText && turns.length === 0) {
      return {
        success: false,
        action: 'NO_TRANSCRIPT_DATA',
        error: 'No transcript text or structured turns provided in payload.',
      };
    }

    // 1. Correlation: Resolve call and lead records
    const providerCallId = input.provider_call_id || null;
    const directCallId = input.call_id || null;
    const fallbackLeadId = input.lead_id || null;

    let dbCall = providerCallId ? await supabaseDataService.calls.getCallByProviderCallId(providerCallId) : null;
    if (!dbCall && directCallId) {
      dbCall = await supabaseDataService.calls.getCall(directCallId);
    }
    if (!dbCall && fallbackLeadId) {
      const leadCalls = await supabaseDataService.calls.getCallsByLead(fallbackLeadId);
      if (leadCalls && leadCalls.length > 0) {
        dbCall = leadCalls[leadCalls.length - 1];
      }
    }

    if (!dbCall) {
      // Correlation failed: do not guess or attach to arbitrary lead
      return {
        success: false,
        action: 'TRANSCRIPT_CORRELATION_FAILED',
        error: `Could not correlate transcript to an existing call. (provider_call_id: ${providerCallId || 'N/A'}, call_id: ${directCallId || 'N/A'}, lead_id: ${fallbackLeadId || 'N/A'})`,
      };
    }

    const resolvedCallId = dbCall.id;
    const resolvedLeadId = dbCall.lead_id;

    // 2. Idempotency Check: Verify if a transcript is already persisted for this call / provider_call_id
    const existingByCallId = await supabaseDataService.transcripts.getTranscriptByCallId(resolvedCallId);
    if (existingByCallId) {
      return {
        success: true,
        action: 'IGNORED_DUPLICATE',
        transcript: existingByCallId,
        transcriptId: existingByCallId.id,
        callId: resolvedCallId,
        leadId: resolvedLeadId,
      };
    }

    if (providerCallId) {
      const existingByProvider = await supabaseDataService.transcripts.getTranscriptByProviderCallId(providerCallId);
      if (existingByProvider) {
        return {
          success: true,
          action: 'IGNORED_DUPLICATE',
          transcript: existingByProvider,
          transcriptId: existingByProvider.id,
          callId: existingByProvider.call_id,
          leadId: existingByProvider.lead_id,
        };
      }
    }

    // 3. Persist Immutable Transcript Record in Supabase
    const durationSeconds = input.duration_seconds !== undefined && input.duration_seconds !== null
      ? Number(input.duration_seconds)
      : dbCall.duration_seconds || null;

    const transcriptRecord = await supabaseDataService.transcripts.createTranscript({
      lead_id: resolvedLeadId,
      call_id: resolvedCallId,
      provider_call_id: providerCallId || dbCall.provider_call_id || null,
      interaction_id: input.interaction_id || null,
      transcript_text: rawText,
      transcript_turns: turns.length > 0 ? turns : null,
      language: input.language || 'hi-IN',
      duration_seconds: durationSeconds,
      source: input.source || 'sarvam',
      source_event_type: input.source_event_type || 'call.ended',
      ingestion_status: 'INGESTED',
      ingestion_version: 'v1',
      captured_at: input.captured_at || new Date().toISOString(),
    });

    // 4. Update calls table transcript text field for backward compatibility
    await supabaseDataService.calls.updateCall(resolvedCallId, {
      transcript: rawText,
      ...(durationSeconds ? { duration_seconds: durationSeconds } : {}),
    });

    // 5. Append TRANSCRIPT_INGESTED audit event to lead_events
    await supabaseDataService.leadEvents.appendLeadEvent({
      lead_id: resolvedLeadId,
      event_type: 'TRANSCRIPT_INGESTED',
      event_data: {
        transcript_id: transcriptRecord.id,
        call_id: resolvedCallId,
        provider_call_id: providerCallId || dbCall.provider_call_id || null,
        interaction_id: input.interaction_id || null,
        duration_seconds: durationSeconds,
        turns_count: turns.length,
        language: input.language || 'hi-IN',
        source: input.source || 'sarvam',
        timestamp: new Date().toISOString(),
      },
    });

    return {
      success: true,
      action: 'TRANSCRIPT_INGESTED',
      transcript: transcriptRecord,
      transcriptId: transcriptRecord.id,
      callId: resolvedCallId,
      leadId: resolvedLeadId,
    };
  }

  /**
   * Adapts a Sarvam webhook callback payload into the canonical transcript ingestion pipeline.
   */
  public async ingestSarvamTranscript(payload: SarvamWebhookEventPayload): Promise<IngestTranscriptOutput> {
    const rawTranscript = payload.transcript || (payload.variables?.transcript as string);
    const turnsCandidate = (payload as Record<string, unknown>).transcript_turns ||
      (payload as Record<string, unknown>).messages ||
      (payload as Record<string, unknown>).turns ||
      (payload as Record<string, unknown>).conversation ||
      (payload as Record<string, unknown>).chat_history ||
      (payload as Record<string, unknown>).dialogue;

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

    const interactionId = (payload as Record<string, unknown>).interaction_id as string ||
      (payload as Record<string, unknown>).session_id as string ||
      externalCallId;

    const duration = Number(payload.duration_seconds || payload.duration || 0);
    const language = (payload as Record<string, unknown>).language as string || 'hi-IN';

    return this.ingestTranscript({
      provider_call_id: externalCallId,
      call_id: null,
      lead_id: fallbackLeadId,
      interaction_id: interactionId,
      transcript_text: rawTranscript,
      transcript_turns: Array.isArray(turnsCandidate) ? (turnsCandidate as TranscriptTurn[]) : null,
      language,
      duration_seconds: duration,
      source: 'sarvam',
      source_event_type: payload.event_type || payload.type || payload.status || 'call.ended',
      captured_at: payload.ended_at || new Date().toISOString(),
    });
  }
}

export const transcriptIngestionService = new TranscriptIngestionService();
