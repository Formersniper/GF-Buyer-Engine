/**
 * GrowthForge Buyer Intelligence Engine - Phase 5D Buyer Scoring & Prioritization Service
 *
 * Source of Truth: Formersniper/GF-Buyer-Engine
 *
 * Coordinates:
 * 1. Qualification & Extraction record retrieval from Supabase
 * 2. Deterministic multi-factor scoring via ScoringRulesEngine
 * 3. 4-tier lead classification (Tier 1 Hot, Tier 2 Warm, Tier 3 Nurture, Tier 4 Review)
 * 4. SLA deadline calculation & Priority queue dispatching
 * 5. Idempotency and versioning (rule_version, scoring_version)
 * 6. Structured persistence in buyer_scores table
 * 7. Audit logging to lead_events (SCORING_STARTED, SCORING_COMPLETED, DISPATCH_SLA_ASSIGNED, SCORING_DUPLICATE)
 */

import { supabaseDataService } from '../supabase/repositories';
import {
  BuyerScoreRecord,
  ScoringResult,
  PriorityQueueItem,
  SCORING_RULE_VERSION,
  SCORING_SCHEMA_VERSION,
} from '../../schemas/scoring';
import { scoringRulesEngine } from './scoringRules';
import { buyerQualificationService } from '../qualification/buyerQualificationService';

export class BuyerScoringService {
  public readonly serviceName = 'BuyerScoringService';

  /**
   * Scores a buyer by qualification ID
   */
  public async scoreQualification(params: {
    qualificationId: string;
    forceRescore?: boolean;
    ruleVersion?: string;
  }): Promise<ScoringResult> {
    const { qualificationId, forceRescore = false, ruleVersion = SCORING_RULE_VERSION } = params;

    try {
      // 1. Check for existing score (Idempotency)
      if (!forceRescore) {
        const existing = await supabaseDataService.buyerScores.getBuyerScoreByQualificationId(
          qualificationId,
          ruleVersion
        );
        if (existing) {
          await supabaseDataService.leadEvents.appendLeadEvent({
            lead_id: existing.lead_id,
            event_type: 'SCORING_DUPLICATE',
            event_data: {
              score_id: existing.id,
              qualification_id: qualificationId,
              composite_score: existing.composite_score,
              tier: existing.tier,
              rule_version: ruleVersion,
            },
          });

          return {
            success: true,
            action: 'EXISTING_SCORE',
            scoreId: existing.id,
            score: existing,
          };
        }
      }

      // 2. Fetch qualification record
      const qualification = await supabaseDataService.qualifications.getQualification(qualificationId);
      if (!qualification) {
        return {
          success: false,
          action: 'QUALIFICATION_NOT_FOUND',
          error: `Qualification record not found for id: ${qualificationId}`,
        };
      }

      // 3. Fetch underlying extraction, lead, and call
      const extraction = await supabaseDataService.extractions.getExtraction(qualification.extraction_id);
      const lead = await supabaseDataService.leads.getLead(qualification.lead_id);
      let call: any = null;
      if (extraction?.call_id) {
        call = await supabaseDataService.calls.getCall(extraction.call_id);
      } else if (qualification.lead_id) {
        const calls = await supabaseDataService.calls.getCallsByLead(qualification.lead_id);
        if (calls && calls.length > 0) {
          call = calls[calls.length - 1];
        }
      }

      // 4. Log scoring started audit event
      await supabaseDataService.leadEvents.appendLeadEvent({
        lead_id: qualification.lead_id,
        event_type: 'SCORING_STARTED',
        event_data: {
          qualification_id: qualification.id,
          extraction_id: qualification.extraction_id,
          lead_id: qualification.lead_id,
          rule_version: ruleVersion,
        },
      });

      // 5. Evaluate deterministic scoring rules
      const evaluated = scoringRulesEngine.evaluate({
        qualification,
        extractedData: extraction?.extracted_data || null,
        lead: lead || null,
        call: call || null,
        qualificationStatus: qualification.qualification_status,
      });

      // 6. Persist buyer score record
      const scoreRecord = await supabaseDataService.buyerScores.createBuyerScoreRecord({
        lead_id: qualification.lead_id,
        qualification_id: qualification.id,
        extraction_id: qualification.extraction_id,
        score: evaluated.score,
        composite_score: evaluated.composite_score,
        total_score: evaluated.total_score,
        scoring_confidence: evaluated.scoring_confidence,
        tier: evaluated.tier,
        score_band: evaluated.score_band,
        score_status: evaluated.score_status,
        dimension_scores: evaluated.dimension_scores,
        components: evaluated.components,
        breakdown: evaluated.breakdown,
        key_drivers: evaluated.key_drivers,
        risk_factors: evaluated.risk_factors,
        reason_codes: evaluated.reason_codes,
        sla_dispatch: evaluated.sla_dispatch,
        project_fit_status: evaluated.project_fit_status,
        scoring_version: SCORING_SCHEMA_VERSION,
        rule_version: ruleVersion,
        calculated_at: evaluated.calculated_at,
      });

      // 7. Update buyer profile intent score and confidence
      if (lead) {
        await supabaseDataService.buyerProfiles.upsertBuyerProfile({
          lead_id: lead.id,
          intent_score: Math.round(evaluated.composite_score),
          confidence_score: evaluated.scoring_confidence,
          qualification_status: qualification.qualification_status,
          currency: 'INR',
        });
      }

      // 8. Log scoring completed audit event
      await supabaseDataService.leadEvents.appendLeadEvent({
        lead_id: qualification.lead_id,
        event_type: 'SCORING_COMPLETED',
        event_data: {
          score_id: scoreRecord.id,
          qualification_id: qualification.id,
          composite_score: evaluated.composite_score,
          tier: evaluated.tier,
          dimension_scores: evaluated.dimension_scores,
          rule_version: ruleVersion,
        },
      });

      // 9. Log SLA dispatch assigned event
      await supabaseDataService.leadEvents.appendLeadEvent({
        lead_id: qualification.lead_id,
        event_type: 'DISPATCH_SLA_ASSIGNED',
        event_data: {
          score_id: scoreRecord.id,
          tier: evaluated.tier,
          assigned_role: evaluated.sla_dispatch.assigned_role,
          sla_minutes: evaluated.sla_dispatch.sla_minutes,
          sla_deadline: evaluated.sla_dispatch.sla_deadline,
          routing_action: evaluated.sla_dispatch.routing_action,
        },
      });

      return {
        success: true,
        action: 'SCORED',
        scoreId: scoreRecord.id,
        score: scoreRecord,
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        action: 'SCORING_FAILED',
        error: errorMsg,
      };
    }
  }

  /**
   * Scores a buyer by lead ID (automatically resolves or triggers qualification)
   */
  public async scoreLead(params: {
    leadId: string;
    forceRescore?: boolean;
    ruleVersion?: string;
  }): Promise<ScoringResult> {
    const { leadId, forceRescore = false, ruleVersion = SCORING_RULE_VERSION } = params;

    let qualifications = await supabaseDataService.qualifications.getQualificationsByLeadId(leadId);
    
    // If no qualification exists, attempt to qualify lead first
    if (!qualifications || qualifications.length === 0) {
      const qualResult = await buyerQualificationService.qualifyLead({ leadId });
      if (!qualResult.success || !qualResult.qualification) {
        return {
          success: false,
          action: 'QUALIFICATION_NOT_FOUND',
          error: `Could not automatically qualify lead ${leadId}: ${qualResult.error || 'No extraction available'}`,
        };
      }
      qualifications = [qualResult.qualification];
    }

    const latestQualification = qualifications[qualifications.length - 1];

    return this.scoreQualification({
      qualificationId: latestQualification.id,
      forceRescore,
      ruleVersion,
    });
  }

  /**
   * Generates prioritized sales queue for advisors
   */
  public async getPriorityQueue(filter?: {
    tier?: string;
    limit?: number;
  }): Promise<PriorityQueueItem[]> {
    return supabaseDataService.buyerScores.listPriorityQueue(filter);
  }
}

export const buyerScoringService = new BuyerScoringService();
