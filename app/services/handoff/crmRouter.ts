/**
 * GrowthForge Buyer Intelligence Engine - Phase 5F Deterministic CRM Router
 *
 * Source of Truth: Formersniper/GF-Buyer-Engine
 * Evaluates buyer scoring, qualification, and intelligence state to assign
 * deterministic CRM ownership, team routing, SLA deadlines, and routing action.
 *
 * Strict Constraint: Does NOT use LLM/Gemini for owner assignment.
 */

import { CRMRoutingDecision } from '../../schemas/handoff';
import { BuyerScoreRecord, LeadTier, FollowUpUrgency } from '../../schemas/scoring';
import { BuyerQualification } from '../../schemas/qualification';
import { Lead } from '../../schemas/database';

export class CRMRouter {
  /**
   * Evaluates deterministic routing decision for a buyer.
   */
  public routeLead(
    lead: Lead,
    scoreRecord: BuyerScoreRecord | null,
    qualification: BuyerQualification | null
  ): CRMRoutingDecision {
    const now = new Date();

    // 1. Exception Check: If qualification or score is REQUIRES_REVIEW, route to Tier 4 / Supervisor Review
    const isQualReview = qualification?.qualification_status === 'REQUIRES_REVIEW';
    const isScoreReview = scoreRecord?.score_status === 'REQUIRES_REVIEW';

    if (isQualReview || isScoreReview || !scoreRecord) {
      return {
        assigned_role: 'SALES_SUPERVISOR_REVIEW',
        assigned_team: 'SALES_SUPERVISORS',
        tier: 'TIER_4_REVIEW',
        sla_minutes: 0,
        sla_deadline: now.toISOString(),
        routing_action: 'MANUAL_INTELLIGENCE_AUDIT',
        follow_up_urgency: 'HIGH',
        reason_codes: [
          isQualReview ? 'QUALIFICATION_REQUIRES_REVIEW' : '',
          isScoreReview ? 'SCORE_REQUIRES_REVIEW' : '',
          !scoreRecord ? 'MISSING_BUYER_SCORE' : '',
        ].filter(Boolean),
      };
    }

    // 2. Read authoritative SLA dispatch from Phase 5D score record if present
    const tier = scoreRecord.tier;
    const slaDispatch = scoreRecord.sla_dispatch;

    if (slaDispatch && slaDispatch.assigned_role && typeof slaDispatch.sla_minutes === 'number') {
      let assigned_team: CRMRoutingDecision['assigned_team'] = 'INBOUND_SALES';
      if (slaDispatch.assigned_role === 'SENIOR_SALES_ADVISOR') {
        assigned_team = 'SENIOR_SALES';
      } else if (slaDispatch.assigned_role === 'AUTOMATED_NURTURE_WORKFLOW') {
        assigned_team = 'NURTURE_AUTOMATION';
      } else if (slaDispatch.assigned_role === 'SALES_SUPERVISOR_REVIEW') {
        assigned_team = 'SALES_SUPERVISORS';
      }

      return {
        assigned_role: slaDispatch.assigned_role,
        assigned_team,
        tier: slaDispatch.tier || tier,
        sla_minutes: slaDispatch.sla_minutes,
        sla_deadline: slaDispatch.sla_deadline || new Date(now.getTime() + slaDispatch.sla_minutes * 60000).toISOString(),
        routing_action: slaDispatch.routing_action,
        follow_up_urgency: slaDispatch.follow_up_urgency,
        reason_codes: scoreRecord.reason_codes || [],
      };
    }

    // 3. Fallback deterministic derivation based on score / tier
    const scoreVal = scoreRecord.score ?? scoreRecord.composite_score ?? 0;

    if (tier === 'TIER_1_HOT' || scoreVal >= 90) {
      const slaMinutes = 15;
      return {
        assigned_role: 'SENIOR_SALES_ADVISOR',
        assigned_team: 'SENIOR_SALES',
        tier: 'TIER_1_HOT',
        sla_minutes: slaMinutes,
        sla_deadline: new Date(now.getTime() + slaMinutes * 60000).toISOString(),
        routing_action: 'IMMEDIATE_PHONE_DISPATCH',
        follow_up_urgency: 'CRITICAL',
        reason_codes: scoreRecord.reason_codes || ['HIGH_INTENT_HOT_LEAD'],
      };
    }

    if (tier === 'TIER_2_WARM' || scoreVal >= 70) {
      const slaMinutes = 120;
      return {
        assigned_role: 'INBOUND_SALES_SPECIALIST',
        assigned_team: 'INBOUND_SALES',
        tier: 'TIER_2_WARM',
        sla_minutes: slaMinutes,
        sla_deadline: new Date(now.getTime() + slaMinutes * 60000).toISOString(),
        routing_action: 'SCHEDULED_CALLBACK',
        follow_up_urgency: 'HIGH',
        reason_codes: scoreRecord.reason_codes || ['QUALIFIED_WARM_LEAD'],
      };
    }

    // Tier 3 Nurture (0 - 69)
    const slaMinutes = 1440;
    return {
      assigned_role: 'AUTOMATED_NURTURE_WORKFLOW',
      assigned_team: 'NURTURE_AUTOMATION',
      tier: 'TIER_3_NURTURE',
      sla_minutes: slaMinutes,
      sla_deadline: new Date(now.getTime() + slaMinutes * 60000).toISOString(),
      routing_action: 'NURTURE_DRIP_CAMPAIGN',
      follow_up_urgency: 'LOW',
      reason_codes: scoreRecord.reason_codes || ['NURTURE_CANDIDATE'],
    };
  }
}

export const crmRouter = new CRMRouter();
