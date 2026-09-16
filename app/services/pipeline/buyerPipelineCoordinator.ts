/**
 * GrowthForge Buyer Intelligence Engine - Phase 8B.6.1 Buyer Pipeline Coordinator
 *
 * Source of Truth: Formersniper/GF-Buyer-Engine
 *
 * Coordinates the post-call buyer intelligence pipeline:
 * Stage 1: Transcript availability / ingestion state validation
 * Stage 2: Conversation extraction (Gemini structured extraction)
 * Stage 3: Buyer qualification (Deterministic qualification rules)
 * Stage 4: Buyer scoring (Multi-dimensional scoring, Tiering, SLA)
 * Stage 5: Project / Inventory matching (Catalog fit evaluation)
 * Stage 6: Broker handoff generation (Canonical sales dossier)
 *
 * INVARIANTS:
 * 1. AI inference != buyer confirmation. Truth hierarchy: CONFIRMED > KNOWN > INFERRED > UNKNOWN.
 * 2. Public / Scout intelligence remains INFERRED.
 * 3. Project recommendations remain buyer_confirmed: false and recommendation_status: 'AI_RECOMMENDED'.
 * 4. Strictly idempotent across all stages - duplicate runs do not produce duplicate DB artifacts.
 * 5. Tenant isolation enforced at boundary and passed to all repositories and events.
 * 6. Non-transactional external boundary: deterministic stage ordering, persisted stage outcomes, safe failure states.
 * 7. Broker handoff is generated with dispatch_status PENDING; automatic CRM dispatch is deferred to Phase 8B.6.2.
 */

import { supabaseDataService } from '../supabase/repositories';
import {
  ConversationExtractionService,
  conversationExtractionService as defaultExtractionService,
} from '../gemini/conversationExtractionService';
import {
  BuyerQualificationService,
  buyerQualificationService as defaultQualificationService,
} from '../qualification/buyerQualificationService';
import {
  BuyerScoringService,
  buyerScoringService as defaultScoringService,
} from '../scoring/buyerScoringService';
import {
  ProjectMatchingService,
  projectMatchingService as defaultMatchingService,
} from '../matching/projectMatchingService';
import {
  BrokerHandoffService,
  brokerHandoffService as defaultHandoffService,
} from '../handoff/brokerHandoffService';
import {
  TranscriptIngestionService,
  transcriptIngestionService as defaultTranscriptIngestionService,
} from '../voice/transcriptIngestionService';
import { GeminiExtractionProvider } from '../gemini/geminiExtractionProvider';
import { runWithCorrelationContext, generateUUID } from '../security/correlationContext';
import { WorkflowStateMachine } from '../workflow/stateMachine';
import { CallTranscript, DbBrokerHandoff, Lead } from '../../schemas/database';
import { ConversationExtraction } from '../../schemas/extraction';
import { BuyerQualification } from '../../schemas/qualification';
import { BuyerScoreRecord } from '../../schemas/scoring';
import { ProjectRecommendation } from '../../schemas/matching';
import { BrokerHandoffPackage } from '../../schemas/handoff';
import { logger } from '../security/logger';

export type PipelineStage =
  | 'VALIDATION'
  | 'EXTRACTION'
  | 'QUALIFICATION'
  | 'SCORING'
  | 'MATCHING'
  | 'HANDOFF'
  | 'DISPATCH';

export type StageExecutionStatus = 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'EXISTING';

export interface StageExecutionRecord {
  stage: PipelineStage;
  status: StageExecutionStatus;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  record_id?: string | null;
  action?: string | null;
  error?: string | null;
}

export interface BuyerPipelineInput {
  leadId: string;
  callId?: string;
  transcriptId?: string;
  tenantId?: string;
  correlationId?: string;
  idempotencyKey?: string;
  forceRerun?: boolean;

  // Optional rule & catalog version overrides
  qualificationRuleVersion?: string;
  scoringRuleVersion?: string;
  matchingRuleVersion?: string;
  catalogVersion?: string;
  handoffRuleVersion?: string;

  // Provider override for deterministic test isolation
  geminiProviderOverride?: GeminiExtractionProvider;
}

export interface BuyerPipelineResult {
  success: boolean;
  action: string;
  lead_id: string;
  call_id?: string | null;
  transcript_id?: string | null;
  tenant_id?: string | null;
  correlation_id: string;
  current_stage: PipelineStage;
  stages: Record<PipelineStage, StageExecutionRecord>;

  // Stage Artifacts
  transcript?: CallTranscript | null;
  extraction_id?: string | null;
  extraction?: ConversationExtraction | null;
  qualification_id?: string | null;
  qualification?: BuyerQualification | null;
  score_id?: string | null;
  score?: BuyerScoreRecord | null;
  total_matches?: number;
  recommendations?: ProjectRecommendation[];
  handoff_id?: string | null;
  handoff?: BrokerHandoffPackage | null;
  handoffRecord?: DbBrokerHandoff | null;
  dispatch_id?: string | null;
  dispatch_status?: string | null;

  error?: string | null;
}

export interface BuyerPipelineDependencies {
  extractionService?: ConversationExtractionService;
  qualificationService?: BuyerQualificationService;
  scoringService?: BuyerScoringService;
  matchingService?: ProjectMatchingService;
  handoffService?: BrokerHandoffService;
  transcriptIngestionService?: TranscriptIngestionService;
  geminiProviderOverride?: GeminiExtractionProvider;
}

export class BuyerPipelineCoordinator {
  public readonly serviceName = 'BuyerPipelineCoordinator';

  private extractionService: ConversationExtractionService;
  private qualificationService: BuyerQualificationService;
  private scoringService: BuyerScoringService;
  private matchingService: ProjectMatchingService;
  private handoffService: BrokerHandoffService;
  private transcriptIngestionService: TranscriptIngestionService;
  private geminiProviderOverride?: GeminiExtractionProvider;

  constructor(deps: BuyerPipelineDependencies = {}) {
    this.extractionService = deps.extractionService || defaultExtractionService;
    this.qualificationService = deps.qualificationService || defaultQualificationService;
    this.scoringService = deps.scoringService || defaultScoringService;
    this.matchingService = deps.matchingService || defaultMatchingService;
    this.handoffService = deps.handoffService || defaultHandoffService;
    this.transcriptIngestionService = deps.transcriptIngestionService || defaultTranscriptIngestionService;
    this.geminiProviderOverride = deps.geminiProviderOverride;
  }

  /**
   * Main entry point: Executes post-call intelligence pipeline stages in strict deterministic order.
   */
  public async runPipeline(input: BuyerPipelineInput): Promise<BuyerPipelineResult> {
    const correlationId = input.correlationId || generateUUID();
    const startTime = Date.now();

    return runWithCorrelationContext(
      {
        correlationId,
        tenantId: input.tenantId,
        service: this.serviceName,
        operation: 'runPipeline',
      },
      async () => {
        const stages: Record<PipelineStage, StageExecutionRecord> = {
          VALIDATION: this.createEmptyStageRecord('VALIDATION'),
          EXTRACTION: this.createEmptyStageRecord('EXTRACTION'),
          QUALIFICATION: this.createEmptyStageRecord('QUALIFICATION'),
          SCORING: this.createEmptyStageRecord('SCORING'),
          MATCHING: this.createEmptyStageRecord('MATCHING'),
          HANDOFF: this.createEmptyStageRecord('HANDOFF'),
          DISPATCH: this.createEmptyStageRecord('DISPATCH'),
        };

        // ---------------------------------------------------------------------
        // STAGE 1: TRANSCRIPT AVAILABILITY & INGESTION STATE VALIDATION
        // ---------------------------------------------------------------------
        const validationStart = Date.now();
        stages.VALIDATION.started_at = new Date(validationStart).toISOString();

        // 1a. Tenant Isolation Verification
        let lead: Lead | null = null;
        if (input.tenantId) {
          lead = await supabaseDataService.leads.getLead({ tenantId: input.tenantId }, input.leadId);
          if (!lead) {
            // Check if lead exists under another tenant to distinguish not found from isolation violation
            const crossTenantLead = await supabaseDataService.leads.getLead(
              { isPlatformAdmin: true },
              input.leadId
            );
            if (crossTenantLead && crossTenantLead.tenant_id && crossTenantLead.tenant_id !== input.tenantId) {
              const nowIso = new Date().toISOString();
              stages.VALIDATION.completed_at = nowIso;
              stages.VALIDATION.duration_ms = Date.now() - validationStart;
              stages.VALIDATION.status = 'FAILED';
              stages.VALIDATION.action = 'TENANT_ISOLATION_VIOLATION';
              stages.VALIDATION.error = `Tenant isolation violation: Lead ${input.leadId} belongs to tenant ${crossTenantLead.tenant_id}, not ${input.tenantId}`;

              logger.warn('[BuyerPipelineCoordinator] Tenant isolation check failed', {
                service: this.serviceName,
                operation: 'runPipeline',
                status: 'TENANT_ISOLATION_VIOLATION',
                data: { leadId: input.leadId, requestedTenant: input.tenantId, actualTenant: crossTenantLead.tenant_id },
              });

              return this.buildResult({
                success: false,
                action: 'TENANT_ISOLATION_VIOLATION',
                leadId: input.leadId,
                tenantId: input.tenantId,
                correlationId,
                currentStage: 'VALIDATION',
                stages,
                error: stages.VALIDATION.error,
              });
            }

            const nowIso = new Date().toISOString();
            stages.VALIDATION.completed_at = nowIso;
            stages.VALIDATION.duration_ms = Date.now() - validationStart;
            stages.VALIDATION.status = 'FAILED';
            stages.VALIDATION.action = 'LEAD_NOT_FOUND';
            stages.VALIDATION.error = `Lead with ID ${input.leadId} not found under tenant ${input.tenantId}`;

            return this.buildResult({
              success: false,
              action: 'LEAD_NOT_FOUND',
              leadId: input.leadId,
              tenantId: input.tenantId,
              correlationId,
              currentStage: 'VALIDATION',
              stages,
              error: stages.VALIDATION.error,
            });
          }
        } else {
          lead = await supabaseDataService.leads.getLead(input.leadId);
          if (!lead) {
            const nowIso = new Date().toISOString();
            stages.VALIDATION.completed_at = nowIso;
            stages.VALIDATION.duration_ms = Date.now() - validationStart;
            stages.VALIDATION.status = 'FAILED';
            stages.VALIDATION.action = 'LEAD_NOT_FOUND';
            stages.VALIDATION.error = `Lead with ID ${input.leadId} not found`;

            return this.buildResult({
              success: false,
              action: 'LEAD_NOT_FOUND',
              leadId: input.leadId,
              tenantId: undefined,
              correlationId,
              currentStage: 'VALIDATION',
              stages,
              error: stages.VALIDATION.error,
            });
          }
        }

        const resolvedTenantId = input.tenantId || lead.tenant_id || undefined;

        // 1b. Resolve Call and Transcript
        let transcript: CallTranscript | null = null;
        let resolvedCallId: string | null = input.callId || null;

        if (input.transcriptId) {
          transcript = await supabaseDataService.transcripts.getTranscript(input.transcriptId);
        } else if (input.callId) {
          transcript = await supabaseDataService.transcripts.getTranscriptByCallId(input.callId);
        } else {
          // Check calls associated with this lead
          const calls = await supabaseDataService.calls.getCallsByLead(input.leadId);
          if (calls && calls.length > 0) {
            for (let i = calls.length - 1; i >= 0; i--) {
              const t = await supabaseDataService.transcripts.getTranscriptByCallId(calls[i].id);
              if (t) {
                transcript = t;
                resolvedCallId = calls[i].id;
                break;
              }
            }
          }
        }

        if (!transcript) {
          const nowIso = new Date().toISOString();
          stages.VALIDATION.completed_at = nowIso;
          stages.VALIDATION.duration_ms = Date.now() - validationStart;
          stages.VALIDATION.status = 'FAILED';
          stages.VALIDATION.action = 'TRANSCRIPT_NOT_FOUND';
          stages.VALIDATION.error = `No transcript found for lead ${input.leadId} (callId=${input.callId || 'N/A'}, transcriptId=${input.transcriptId || 'N/A'})`;

          await this.logPipelineFailedEvent(lead.id, resolvedTenantId, 'VALIDATION', stages.VALIDATION.error, correlationId, resolvedCallId, null);

          return this.buildResult({
            success: false,
            action: 'TRANSCRIPT_NOT_FOUND',
            leadId: lead.id,
            callId: resolvedCallId,
            tenantId: resolvedTenantId,
            correlationId,
            currentStage: 'VALIDATION',
            stages,
            error: stages.VALIDATION.error,
          });
        }

        if (!resolvedCallId && transcript.call_id) {
          resolvedCallId = transcript.call_id;
        }

        // 1c. Validate Transcript Non-Empty Text
        if (!transcript.transcript_text || transcript.transcript_text.trim().length === 0) {
          const nowIso = new Date().toISOString();
          stages.VALIDATION.completed_at = nowIso;
          stages.VALIDATION.duration_ms = Date.now() - validationStart;
          stages.VALIDATION.status = 'FAILED';
          stages.VALIDATION.action = 'EMPTY_TRANSCRIPT';
          stages.VALIDATION.error = `Transcript record ${transcript.id} contains empty or whitespace-only text`;

          await this.logPipelineFailedEvent(lead.id, resolvedTenantId, 'VALIDATION', stages.VALIDATION.error, correlationId, resolvedCallId, transcript.id);

          return this.buildResult({
            success: false,
            action: 'EMPTY_TRANSCRIPT',
            leadId: lead.id,
            callId: resolvedCallId,
            transcriptId: transcript.id,
            tenantId: resolvedTenantId,
            correlationId,
            currentStage: 'VALIDATION',
            stages,
            transcript,
            error: stages.VALIDATION.error,
          });
        }

        // 1d. Validate Correlation Integrity
        if (transcript.lead_id && transcript.lead_id !== lead.id) {
          const nowIso = new Date().toISOString();
          stages.VALIDATION.completed_at = nowIso;
          stages.VALIDATION.duration_ms = Date.now() - validationStart;
          stages.VALIDATION.status = 'FAILED';
          stages.VALIDATION.action = 'TRANSCRIPT_CORRELATION_MISMATCH';
          stages.VALIDATION.error = `Transcript lead_id (${transcript.lead_id}) does not match target lead (${lead.id})`;

          await this.logPipelineFailedEvent(lead.id, resolvedTenantId, 'VALIDATION', stages.VALIDATION.error, correlationId, resolvedCallId, transcript.id);

          return this.buildResult({
            success: false,
            action: 'TRANSCRIPT_CORRELATION_MISMATCH',
            leadId: lead.id,
            callId: resolvedCallId,
            transcriptId: transcript.id,
            tenantId: resolvedTenantId,
            correlationId,
            currentStage: 'VALIDATION',
            stages,
            transcript,
            error: stages.VALIDATION.error,
          });
        }

        const validationEnd = Date.now();
        stages.VALIDATION.completed_at = new Date(validationEnd).toISOString();
        stages.VALIDATION.duration_ms = validationEnd - validationStart;
        stages.VALIDATION.status = 'SUCCESS';
        stages.VALIDATION.action = 'VALIDATION_PASSED';
        stages.VALIDATION.record_id = transcript.id;

        // Audit Event: PIPELINE_STARTED
        await supabaseDataService.leadEvents.appendLeadEvent(
          resolvedTenantId ? { tenantId: resolvedTenantId } : {},
          {
            lead_id: lead.id,
            event_type: 'PIPELINE_STARTED',
            event_data: {
              call_id: resolvedCallId,
              transcript_id: transcript.id,
              correlation_id: correlationId,
              idempotency_key: input.idempotencyKey || null,
              force_rerun: Boolean(input.forceRerun),
            },
          }
        );

        // ---------------------------------------------------------------------
        // STAGE 2: CONVERSATION EXTRACTION
        // ---------------------------------------------------------------------
        const extractionStart = Date.now();
        stages.EXTRACTION.started_at = new Date(extractionStart).toISOString();

        let extractionResult;
        try {
          extractionResult = await this.extractionService.extractFromTranscript({
            transcriptId: transcript.id,
            callId: resolvedCallId || transcript.call_id || undefined,
            leadId: lead.id,
            forceReextract: input.forceRerun,
            providerOverride: input.geminiProviderOverride || this.geminiProviderOverride,
          });
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          extractionResult = {
            success: false,
            action: 'EXTRACTION_EXCEPTION',
            error: errMsg,
          };
        }

        const extractionEnd = Date.now();
        stages.EXTRACTION.completed_at = new Date(extractionEnd).toISOString();
        stages.EXTRACTION.duration_ms = extractionEnd - extractionStart;

        if (!extractionResult.success || !extractionResult.extractionId) {
          stages.EXTRACTION.status = 'FAILED';
          stages.EXTRACTION.action = extractionResult.action;
          stages.EXTRACTION.error = extractionResult.error || 'Conversation extraction failed';

          await this.logPipelineFailedEvent(lead.id, resolvedTenantId, 'EXTRACTION', stages.EXTRACTION.error, correlationId, resolvedCallId, transcript.id);

          // Update lead status to REQUIRES_REVIEW if valid
          if (WorkflowStateMachine.canTransition(lead.status, 'REQUIRES_REVIEW')) {
            await supabaseDataService.leads.updateLead(
              resolvedTenantId ? { tenantId: resolvedTenantId } : {},
              lead.id,
              { status: 'REQUIRES_REVIEW' }
            );
          }

          return this.buildResult({
            success: false,
            action: extractionResult.action,
            leadId: lead.id,
            callId: resolvedCallId,
            transcriptId: transcript.id,
            tenantId: resolvedTenantId,
            correlationId,
            currentStage: 'EXTRACTION',
            stages,
            transcript,
            error: stages.EXTRACTION.error,
          });
        }

        stages.EXTRACTION.status = extractionResult.action === 'EXISTING_EXTRACTION' ? 'EXISTING' : 'SUCCESS';
        stages.EXTRACTION.action = extractionResult.action;
        stages.EXTRACTION.record_id = extractionResult.extractionId;
        const extractionId = extractionResult.extractionId;
        const extraction = extractionResult.extraction || null;

        // ---------------------------------------------------------------------
        // STAGE 3: BUYER QUALIFICATION
        // ---------------------------------------------------------------------
        const qualificationStart = Date.now();
        stages.QUALIFICATION.started_at = new Date(qualificationStart).toISOString();

        let qualResult;
        try {
          qualResult = await this.qualificationService.qualifyExtraction({
            extractionId,
            forceRequalify: input.forceRerun,
            ruleVersion: input.qualificationRuleVersion,
          });
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          qualResult = {
            success: false,
            action: 'QUALIFICATION_EXCEPTION' as any,
            error: errMsg,
          };
        }

        const qualificationEnd = Date.now();
        stages.QUALIFICATION.completed_at = new Date(qualificationEnd).toISOString();
        stages.QUALIFICATION.duration_ms = qualificationEnd - qualificationStart;

        if (!qualResult.success || !qualResult.qualificationId) {
          stages.QUALIFICATION.status = 'FAILED';
          stages.QUALIFICATION.action = qualResult.action;
          stages.QUALIFICATION.error = qualResult.error || 'Buyer qualification failed';

          await this.logPipelineFailedEvent(lead.id, resolvedTenantId, 'QUALIFICATION', stages.QUALIFICATION.error, correlationId, resolvedCallId, transcript.id);

          return this.buildResult({
            success: false,
            action: qualResult.action,
            leadId: lead.id,
            callId: resolvedCallId,
            transcriptId: transcript.id,
            tenantId: resolvedTenantId,
            correlationId,
            currentStage: 'QUALIFICATION',
            stages,
            transcript,
            extraction_id: extractionId,
            extraction,
            error: stages.QUALIFICATION.error,
          });
        }

        stages.QUALIFICATION.status = qualResult.action === 'EXISTING_QUALIFICATION' ? 'EXISTING' : 'SUCCESS';
        stages.QUALIFICATION.action = qualResult.action;
        stages.QUALIFICATION.record_id = qualResult.qualificationId;
        const qualificationId = qualResult.qualificationId;
        const qualification = qualResult.qualification || null;

        // ---------------------------------------------------------------------
        // STAGE 4: BUYER SCORING
        // ---------------------------------------------------------------------
        const scoringStart = Date.now();
        stages.SCORING.started_at = new Date(scoringStart).toISOString();

        let scoreResult;
        try {
          scoreResult = await this.scoringService.scoreQualification({
            qualificationId,
            forceRescore: input.forceRerun,
            ruleVersion: input.scoringRuleVersion,
          });
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          scoreResult = {
            success: false,
            action: 'SCORING_EXCEPTION',
            error: errMsg,
          };
        }

        const scoringEnd = Date.now();
        stages.SCORING.completed_at = new Date(scoringEnd).toISOString();
        stages.SCORING.duration_ms = scoringEnd - scoringStart;

        if (!scoreResult.success || !scoreResult.scoreId) {
          stages.SCORING.status = 'FAILED';
          stages.SCORING.action = scoreResult.action;
          stages.SCORING.error = scoreResult.error || 'Buyer scoring failed';

          await this.logPipelineFailedEvent(lead.id, resolvedTenantId, 'SCORING', stages.SCORING.error, correlationId, resolvedCallId, transcript.id);

          return this.buildResult({
            success: false,
            action: scoreResult.action,
            leadId: lead.id,
            callId: resolvedCallId,
            transcriptId: transcript.id,
            tenantId: resolvedTenantId,
            correlationId,
            currentStage: 'SCORING',
            stages,
            transcript,
            extraction_id: extractionId,
            extraction,
            qualification_id: qualificationId,
            qualification,
            error: stages.SCORING.error,
          });
        }

        stages.SCORING.status = scoreResult.action === 'EXISTING_SCORE' ? 'EXISTING' : 'SUCCESS';
        stages.SCORING.action = scoreResult.action;
        stages.SCORING.record_id = scoreResult.scoreId;
        const scoreId = scoreResult.scoreId;
        const score = scoreResult.score || null;

        // Advance lead status from QUALIFIED to scored tier if valid
        const postQualLead = await supabaseDataService.leads.getLead(lead.id);
        if (postQualLead && postQualLead.status === 'QUALIFIED') {
          const intermediateStatus =
            score?.score_band === 'HOT' || score?.tier === 'TIER_1_HOT'
              ? 'HOT'
              : score?.score_band === 'WARM' || score?.tier === 'TIER_2_WARM'
              ? 'WARM'
              : score?.score_band === 'NURTURE' || score?.tier === 'TIER_3_NURTURE'
              ? 'NURTURE'
              : 'SCORED';
          if (WorkflowStateMachine.canTransition('QUALIFIED', intermediateStatus)) {
            await supabaseDataService.leads.updateLead(
              resolvedTenantId ? { tenantId: resolvedTenantId } : {},
              lead.id,
              { status: intermediateStatus }
            );
          }
        }

        // ---------------------------------------------------------------------
        // STAGE 5: PROJECT / INVENTORY MATCHING
        // ---------------------------------------------------------------------
        const matchingStart = Date.now();
        stages.MATCHING.started_at = new Date(matchingStart).toISOString();

        let matchingResult;
        try {
          matchingResult = await this.matchingService.matchBuyerRequirements({
            leadId: lead.id,
            qualificationId,
            extractionId,
            forceRematch: input.forceRerun,
            ruleVersion: input.matchingRuleVersion,
            catalogVersion: input.catalogVersion,
          });
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          matchingResult = {
            success: false,
            action: 'MATCHING_EXCEPTION',
            lead_id: lead.id,
            total_recommendations: 0,
            recommendations: [],
            matching_version: '1.0',
            rule_version: '1.0',
            catalog_version: '1.0',
            calculated_at: new Date().toISOString(),
            error: errMsg,
          };
        }

        const matchingEnd = Date.now();
        stages.MATCHING.completed_at = new Date(matchingEnd).toISOString();
        stages.MATCHING.duration_ms = matchingEnd - matchingStart;

        if (!matchingResult.success) {
          stages.MATCHING.status = 'FAILED';
          stages.MATCHING.action = matchingResult.action;
          stages.MATCHING.error = matchingResult.error || 'Project matching failed';

          await this.logPipelineFailedEvent(lead.id, resolvedTenantId, 'MATCHING', stages.MATCHING.error, correlationId, resolvedCallId, transcript.id);

          return this.buildResult({
            success: false,
            action: matchingResult.action,
            leadId: lead.id,
            callId: resolvedCallId,
            transcriptId: transcript.id,
            tenantId: resolvedTenantId,
            correlationId,
            currentStage: 'MATCHING',
            stages,
            transcript,
            extraction_id: extractionId,
            extraction,
            qualification_id: qualificationId,
            qualification,
            score_id: scoreId,
            score,
            error: stages.MATCHING.error,
          });
        }

        stages.MATCHING.status = matchingResult.action === 'EXISTING_MATCHES' ? 'EXISTING' : 'SUCCESS';
        stages.MATCHING.action = matchingResult.action;
        stages.MATCHING.record_id = lead.id;
        const recommendations = matchingResult.recommendations || [];
        const totalMatches = recommendations.length;

        // ---------------------------------------------------------------------
        // STAGE 6: BROKER HANDOFF GENERATION
        // ---------------------------------------------------------------------
        const handoffStart = Date.now();
        stages.HANDOFF.started_at = new Date(handoffStart).toISOString();

        let handoffResult;
        try {
          handoffResult = await this.handoffService.generateHandoff({
            leadId: lead.id,
            qualificationId,
            scoreId,
            extractionId,
            forceRegenerate: input.forceRerun,
            ruleVersion: input.handoffRuleVersion,
          });
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          handoffResult = {
            success: false,
            action: 'HANDOFF_EXCEPTION',
            error: errMsg,
          };
        }

        const handoffEnd = Date.now();
        stages.HANDOFF.completed_at = new Date(handoffEnd).toISOString();
        stages.HANDOFF.duration_ms = handoffEnd - handoffStart;

        if (!handoffResult.success || !handoffResult.handoffId) {
          stages.HANDOFF.status = 'FAILED';
          stages.HANDOFF.action = handoffResult.action;
          stages.HANDOFF.error = handoffResult.error || 'Broker handoff generation failed';

          await this.logPipelineFailedEvent(lead.id, resolvedTenantId, 'HANDOFF', stages.HANDOFF.error, correlationId, resolvedCallId, transcript.id);

          return this.buildResult({
            success: false,
            action: handoffResult.action,
            leadId: lead.id,
            callId: resolvedCallId,
            transcriptId: transcript.id,
            tenantId: resolvedTenantId,
            correlationId,
            currentStage: 'HANDOFF',
            stages,
            transcript,
            extraction_id: extractionId,
            extraction,
            qualification_id: qualificationId,
            qualification,
            score_id: scoreId,
            score,
            total_matches: totalMatches,
            recommendations,
            error: stages.HANDOFF.error,
          });
        }

        stages.HANDOFF.status = handoffResult.action === 'EXISTING_HANDOFF' ? 'EXISTING' : 'SUCCESS';
        stages.HANDOFF.action = handoffResult.action;
        stages.HANDOFF.record_id = handoffResult.handoffId;
        const handoffId = handoffResult.handoffId;
        const handoffPackage = handoffResult.handoff || null;
        const handoffDbRecord = handoffResult.dbRecord || null;

        // Transition Lead Status to HANDOFF if permissible
        const currentLead = await supabaseDataService.leads.getLead(lead.id);
        if (currentLead && WorkflowStateMachine.canTransition(currentLead.status, 'HANDOFF')) {
          await supabaseDataService.leads.updateLead(
            resolvedTenantId ? { tenantId: resolvedTenantId } : {},
            lead.id,
            { status: 'HANDOFF' }
          );
        }

        // ---------------------------------------------------------------------
        // STAGE 7: CRM DISPATCH
        // ---------------------------------------------------------------------
        const dispatchStart = Date.now();
        stages.DISPATCH.started_at = new Date(dispatchStart).toISOString();

        let dispatchResult;
        try {
          dispatchResult = await this.handoffService.dispatchHandoff(handoffId, {
            forceRedispatch: input.forceRerun,
          });
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          dispatchResult = {
            success: false,
            action: 'DISPATCH_EXCEPTION',
            status: 'FAILED',
            dispatch_id: null,
            error: errMsg,
          };
        }

        const dispatchEnd = Date.now();
        stages.DISPATCH.completed_at = new Date(dispatchEnd).toISOString();
        stages.DISPATCH.duration_ms = dispatchEnd - dispatchStart;

        if (!dispatchResult.success) {
          stages.DISPATCH.status = 'FAILED';
          stages.DISPATCH.action = dispatchResult.action || 'FAILED';
          stages.DISPATCH.error = (dispatchResult as any).error || 'Broker CRM dispatch failed';

          // Do not fail the whole pipeline. Log the dispatch failure but consider pipeline 'COMPLETED'.
          // Manual/API recovery remains for dispatch.
          await this.logPipelineFailedEvent(lead.id, resolvedTenantId, 'DISPATCH', stages.DISPATCH.error, correlationId, resolvedCallId, transcript.id);
        } else {
          stages.DISPATCH.status = dispatchResult.action === 'IGNORED_DUPLICATE' ? 'EXISTING' : 'SUCCESS';
          stages.DISPATCH.action = dispatchResult.action || 'SUCCESS';
          stages.DISPATCH.record_id = dispatchResult.dispatch_id;
        }

        // Audit Event: PIPELINE_COMPLETED
        await supabaseDataService.leadEvents.appendLeadEvent(
          resolvedTenantId ? { tenantId: resolvedTenantId } : {},
          {
            lead_id: lead.id,
            event_type: 'PIPELINE_COMPLETED',
            event_data: {
              call_id: resolvedCallId,
              transcript_id: transcript.id,
              extraction_id: extractionId,
              qualification_id: qualificationId,
              score_id: scoreId,
              handoff_id: handoffId,
              total_matches: totalMatches,
              tier: handoffPackage?.priority?.tier || score?.tier || 'UNKNOWN',
              correlation_id: correlationId,
              duration_ms: Date.now() - startTime,
            },
          }
        );

        return this.buildResult({
          success: true,
          action: handoffResult.action === 'EXISTING_HANDOFF' ? 'PIPELINE_EXISTING' : 'PIPELINE_COMPLETED',
          leadId: lead.id,
          callId: resolvedCallId,
          transcriptId: transcript.id,
          tenantId: resolvedTenantId,
          correlationId,
          currentStage: 'DISPATCH',
          stages,
          transcript,
          extraction_id: extractionId,
          extraction,
          qualification_id: qualificationId,
          qualification,
          score_id: scoreId,
          score,
          total_matches: totalMatches,
          recommendations,
          handoff_id: handoffId,
          handoff: handoffPackage,
          handoffRecord: handoffDbRecord,
          dispatch_id: dispatchResult.dispatch_id || null,
          dispatch_status: (dispatchResult as any).status || null,
        });
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Helper Methods
  // ---------------------------------------------------------------------------

  private createEmptyStageRecord(stage: PipelineStage): StageExecutionRecord {
    return {
      stage,
      status: 'SKIPPED',
      started_at: '',
      completed_at: '',
      duration_ms: 0,
      record_id: null,
      action: null,
      error: null,
    };
  }

  private buildResult(params: {
    success: boolean;
    action: string;
    leadId: string;
    callId?: string | null;
    transcriptId?: string | null;
    tenantId?: string | null;
    correlationId: string;
    currentStage: PipelineStage;
    stages: Record<PipelineStage, StageExecutionRecord>;
    transcript?: CallTranscript | null;
    extraction_id?: string | null;
    extraction?: ConversationExtraction | null;
    qualification_id?: string | null;
    qualification?: BuyerQualification | null;
    score_id?: string | null;
    score?: BuyerScoreRecord | null;
    total_matches?: number;
    recommendations?: ProjectRecommendation[];
    handoff_id?: string | null;
    handoff?: BrokerHandoffPackage | null;
    handoffRecord?: DbBrokerHandoff | null;
    dispatch_id?: string | null;
    dispatch_status?: string | null;
    error?: string | null;
  }): BuyerPipelineResult {
    return {
      success: params.success,
      action: params.action,
      lead_id: params.leadId,
      call_id: params.callId || null,
      transcript_id: params.transcriptId || null,
      tenant_id: params.tenantId || null,
      correlation_id: params.correlationId,
      current_stage: params.currentStage,
      stages: params.stages,
      transcript: params.transcript || null,
      extraction_id: params.extraction_id || null,
      extraction: params.extraction || null,
      qualification_id: params.qualification_id || null,
      qualification: params.qualification || null,
      score_id: params.score_id || null,
      score: params.score || null,
      total_matches: params.total_matches ?? 0,
      recommendations: params.recommendations || [],
      handoff_id: params.handoff_id || null,
      handoff: params.handoff || null,
      handoffRecord: params.handoffRecord || null,
      dispatch_id: params.dispatch_id || null,
      dispatch_status: params.dispatch_status || null,
      error: params.error || null,
    };
  }

  private async logPipelineFailedEvent(
    leadId: string,
    tenantId: string | undefined,
    stage: PipelineStage,
    error: string | null,
    correlationId: string,
    callId: string | null,
    transcriptId: string | null
  ): Promise<void> {
    try {
      await supabaseDataService.leadEvents.appendLeadEvent(
        tenantId ? { tenantId } : {},
        {
          lead_id: leadId,
          event_type: 'PIPELINE_FAILED',
          event_data: {
            failed_stage: stage,
            error: error || 'Unknown stage error',
            call_id: callId,
            transcript_id: transcriptId,
            correlation_id: correlationId,
          },
        }
      );
    } catch (logErr) {
      logger.error('[BuyerPipelineCoordinator] Failed to record PIPELINE_FAILED audit event', {
        service: this.serviceName,
        operation: 'logPipelineFailedEvent',
        data: { leadId, stage, error, logError: String(logErr) },
      });
    }
  }
}

export const buyerPipelineCoordinator = new BuyerPipelineCoordinator();
