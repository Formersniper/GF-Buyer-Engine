/**
 * GrowthForge Buyer Intelligence Engine - Phase 5B Conversation Extraction Service
 *
 * Source of Truth: Formersniper/GF-Buyer-Engine
 *
 * Coordinates:
 * 1. Transcript retrieval from Supabase
 * 2. Gemini extraction via GeminiExtractionProvider
 * 3. Strict schema validation & truth-level enforcement
 * 4. Deterministic idempotency & versioning
 * 5. Structured persistence to conversation_extractions table
 * 6. Audit logging to lead_events
 */

import { supabaseDataService } from '../supabase/repositories';
import {
  ConversationExtraction,
  ExtractedBuyerIntelligence,
  ExtractionResult,
  EXTRACTION_PROMPT_VERSION,
  EXTRACTION_SCHEMA_VERSION,
} from '../../schemas/extraction';
import { DataTruthLevel } from '../../schemas/truthLevel';
import {
  getGeminiExtractionProvider,
  GeminiExtractionProvider,
} from './geminiExtractionProvider';

export class ConversationExtractionService {
  public readonly serviceName = 'ConversationExtractionService';

  /**
   * Runtime schema validator for extracted buyer intelligence
   */
  public validateExtractedData(data: unknown): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!data || typeof data !== 'object') {
      return { valid: false, errors: ['Extracted data is not a valid object'] };
    }

    const d = data as Record<string, unknown>;

    // Validate interested
    if (!d.interested || typeof d.interested !== 'object') {
      errors.push('Missing or invalid "interested" field');
    }

    // Validate valid truth levels
    const validTruthLevels: DataTruthLevel[] = ['CONFIRMED', 'INFERRED', 'KNOWN', 'UNKNOWN'];

    const checkTruthField = (fieldName: string, obj: unknown) => {
      if (!obj || typeof obj !== 'object') {
        errors.push(`Missing field "${fieldName}"`);
        return;
      }
      const f = obj as { truth_level?: string; value?: unknown };
      if (!f.truth_level || !validTruthLevels.includes(f.truth_level as DataTruthLevel)) {
        errors.push(`Invalid truth_level "${f.truth_level}" in "${fieldName}"`);
      }
    };

    checkTruthField('interested', d.interested);
    checkTruthField('primary_property_type', d.primary_property_type);
    checkTruthField('primary_configuration', d.primary_configuration);
    checkTruthField('purpose', d.purpose);
    checkTruthField('preferred_locations', d.preferred_locations);
    checkTruthField('timeline', d.timeline);
    checkTruthField('possession_preference', d.possession_preference);
    checkTruthField('financing', d.financing);
    checkTruthField('decision_maker', d.decision_maker);

    // Validate budget
    if (!d.budget || typeof d.budget !== 'object') {
      errors.push('Missing or invalid "budget" object');
    } else {
      const b = d.budget as { truth_level?: string; min?: unknown; max?: unknown };
      if (!b.truth_level || !validTruthLevels.includes(b.truth_level as DataTruthLevel)) {
        errors.push(`Invalid truth_level in budget: "${b.truth_level}"`);
      }
      // Critical Truth Model Rule: If budget is UNKNOWN, min and max must be null
      if (b.truth_level === 'UNKNOWN') {
        if (b.min !== null && b.min !== undefined && typeof b.min === 'number') {
          errors.push('Budget truth_level is UNKNOWN but numeric min is present');
        }
        if (b.max !== null && b.max !== undefined && typeof b.max === 'number') {
          errors.push('Budget truth_level is UNKNOWN but numeric max is present');
        }
      }
    }

    // Validate requirements array
    if (!Array.isArray(d.requirements)) {
      errors.push('Missing or invalid "requirements" array');
    } else {
      d.requirements.forEach((req, idx) => {
        if (!req || typeof req !== 'object') {
          errors.push(`Requirement at index ${idx} is not an object`);
        } else {
          const r = req as { property_type?: string; truth_level?: string };
          if (!r.property_type || typeof r.property_type !== 'string') {
            errors.push(`Requirement at index ${idx} missing property_type`);
          }
          if (!r.truth_level || !validTruthLevels.includes(r.truth_level as DataTruthLevel)) {
            errors.push(`Requirement at index ${idx} has invalid truth_level "${r.truth_level}"`);
          }
        }
      });
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Main entry point: Extracts structured buyer intelligence from a call transcript
   */
  public async extractFromTranscript(params: {
    transcriptId?: string;
    callId?: string;
    leadId?: string;
    forceReextract?: boolean;
    providerOverride?: GeminiExtractionProvider;
  }): Promise<ExtractionResult> {
    let resolvedTranscript: { id: string; lead_id: string; call_id: string; provider_call_id: string | null; interaction_id: string | null; transcript_text: string; transcript_turns: any; language: string | null; duration_seconds: number | null; source: string } | null = null;
    try {
      // 1. Resolve Transcript Record
      if (params.transcriptId) {
        resolvedTranscript = await supabaseDataService.transcripts.getTranscript(params.transcriptId);
      } else if (params.callId) {
        resolvedTranscript = await supabaseDataService.transcripts.getTranscriptByCallId(params.callId);
      }

      if (!resolvedTranscript) {
        return {
          success: false,
          action: 'TRANSCRIPT_NOT_FOUND',
          error: `Transcript not found for transcriptId=${params.transcriptId} or callId=${params.callId}`,
        };
      }

      const transcript = resolvedTranscript;

      // 2. Validate non-empty transcript
      if (!transcript.transcript_text || transcript.transcript_text.trim().length === 0) {
        return {
          success: false,
          action: 'EMPTY_TRANSCRIPT',
          error: `Transcript record ${transcript.id} contains empty or whitespace-only text`,
        };
      }

      const leadId = transcript.lead_id;
      const callId = transcript.call_id;

      // 3. Deterministic Idempotency Check
      if (!params.forceReextract) {
        const existing = await supabaseDataService.extractions.getExtractionByTranscriptId(
          transcript.id,
          EXTRACTION_SCHEMA_VERSION,
          EXTRACTION_PROMPT_VERSION
        );

        if (existing && existing.extraction_status === 'EXTRACTED') {
          // Log duplicate extraction attempt audit event
          await supabaseDataService.leadEvents.appendLeadEvent({
            lead_id: leadId,
            event_type: 'EXTRACTION_DUPLICATE',
            event_data: {
              transcript_id: transcript.id,
              existing_extraction_id: existing.id,
              schema_version: EXTRACTION_SCHEMA_VERSION,
              prompt_version: EXTRACTION_PROMPT_VERSION,
              model: existing.model,
            },
          });

          return {
            success: true,
            action: 'EXISTING_EXTRACTION',
            extractionId: existing.id,
            extraction: existing,
          };
        }
      }

      // 4. Audit: EXTRACTION_STARTED
      await supabaseDataService.leadEvents.appendLeadEvent({
        lead_id: leadId,
        event_type: 'EXTRACTION_STARTED',
        event_data: {
          transcript_id: transcript.id,
          call_id: callId,
          provider_call_id: transcript.provider_call_id,
          schema_version: EXTRACTION_SCHEMA_VERSION,
          prompt_version: EXTRACTION_PROMPT_VERSION,
          source: transcript.source,
        },
      });

      // 5. Execute Extraction via Provider Boundary
      const provider = params.providerOverride || getGeminiExtractionProvider();
      const extractionResponse = await provider.extractBuyerIntelligence({
        transcriptText: transcript.transcript_text,
        transcriptTurns: transcript.transcript_turns || undefined,
        leadId: leadId,
        language: transcript.language || undefined,
      });

      // 6. Schema Validation
      const validation = this.validateExtractedData(extractionResponse.extractedData);
      if (!validation.valid) {
        const validationErrorMsg = `Gemini extraction schema validation failed: ${validation.errors.join('; ')}`;
        
        // Persist failure record for auditability
        const failedRecord = await supabaseDataService.extractions.createExtraction({
          lead_id: leadId,
          call_id: callId,
          transcript_id: transcript.id,
          provider_call_id: transcript.provider_call_id,
          interaction_id: transcript.interaction_id,
          model: extractionResponse.model,
          prompt_version: EXTRACTION_PROMPT_VERSION,
          schema_version: EXTRACTION_SCHEMA_VERSION,
          extraction_status: 'EXTRACTION_FAILED',
          extracted_data: null,
          raw_gemini_response: extractionResponse.rawResponse,
          error_message: validationErrorMsg,
        });

        await supabaseDataService.leadEvents.appendLeadEvent({
          lead_id: leadId,
          event_type: 'EXTRACTION_FAILED',
          event_data: {
            transcript_id: transcript.id,
            error: validationErrorMsg,
            validation_errors: validation.errors,
          },
        });

        return {
          success: false,
          action: 'EXTRACTION_FAILED',
          extractionId: failedRecord.id,
          extraction: failedRecord,
          error: validationErrorMsg,
        };
      }

      // 7. Persist Structured Extraction
      const savedExtraction = await supabaseDataService.extractions.createExtraction({
        lead_id: leadId,
        call_id: callId,
        transcript_id: transcript.id,
        provider_call_id: transcript.provider_call_id,
        interaction_id: transcript.interaction_id,
        model: extractionResponse.model,
        prompt_version: EXTRACTION_PROMPT_VERSION,
        schema_version: EXTRACTION_SCHEMA_VERSION,
        extraction_status: 'EXTRACTED',
        extracted_data: extractionResponse.extractedData,
        raw_gemini_response: extractionResponse.rawResponse,
        error_message: null,
      });

      // 8. Audit: EXTRACTION_COMPLETED
      await supabaseDataService.leadEvents.appendLeadEvent({
        lead_id: leadId,
        event_type: 'EXTRACTION_COMPLETED',
        event_data: {
          extraction_id: savedExtraction.id,
          transcript_id: transcript.id,
          call_id: callId,
          model: extractionResponse.model,
          schema_version: EXTRACTION_SCHEMA_VERSION,
          prompt_version: EXTRACTION_PROMPT_VERSION,
          requirements_count: extractionResponse.extractedData.requirements.length,
          primary_property_type: extractionResponse.extractedData.primary_property_type.value,
          primary_configuration: extractionResponse.extractedData.primary_configuration.value,
          budget_truth: extractionResponse.extractedData.budget.truth_level,
        },
      });

      return {
        success: true,
        action: 'EXTRACTED',
        extractionId: savedExtraction.id,
        extraction: savedExtraction,
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown extraction error';

      const targetLeadId = params.leadId || resolvedTranscript?.lead_id;
      if (targetLeadId) {
        try {
          await supabaseDataService.leadEvents.appendLeadEvent({
            lead_id: targetLeadId,
            event_type: 'EXTRACTION_FAILED',
            event_data: {
              transcript_id: params.transcriptId,
              call_id: params.callId,
              error: errorMsg,
            },
          });
        } catch {
          // ignore event logging failure during error handling
        }
      }

      return {
        success: false,
        action: 'EXTRACTION_FAILED',
        error: errorMsg,
      };
    }
  }

  /**
   * Retrieves an extraction record by callId
   */
  public async getExtractionByCallId(callId: string): Promise<ConversationExtraction | null> {
    return supabaseDataService.extractions.getExtractionByCallId(callId);
  }

  /**
   * Retrieves an extraction record by transcriptId
   */
  public async getExtractionByTranscriptId(
    transcriptId: string,
    schemaVersion?: string,
    promptVersion?: string
  ): Promise<ConversationExtraction | null> {
    return supabaseDataService.extractions.getExtractionByTranscriptId(
      transcriptId,
      schemaVersion,
      promptVersion
    );
  }

  /**
   * Retrieves all extractions for a lead
   */
  public async getExtractionsByLeadId(leadId: string): Promise<ConversationExtraction[]> {
    return supabaseDataService.extractions.getExtractionsByLeadId(leadId);
  }
}

// Global Singleton
export const conversationExtractionService = new ConversationExtractionService();
