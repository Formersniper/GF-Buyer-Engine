/**
 * Gemini Agent Interface: ScoringAgent
 *
 * Responsibilities:
 * Calculates a multi-dimensional composite Buyer Intent Score (0 - 100)
 * weighting budget certainty, urgency/timeline, engagement depth, and verified facts.
 */

import { GFBuyerLead } from '../schemas/buyerLead';
import { scoringRulesEngine } from '../services/scoring/scoringRules';

export interface ScoreComponentBreakdown {
  dimension: string;
  weight: number;
  raw_score: number; // 0 - 100
  weighted_score: number;
  explanation: string;
}

export interface ScoringOutput {
  lead_id: string;
  composite_intent_score: number; // 0 - 100
  scoring_confidence: number; // 0.0 - 1.0
  breakdown: ScoreComponentBreakdown[];
  score_band: 'HOT' | 'WARM' | 'NURTURE' | 'REVIEW';
  key_drivers: string[];
  risk_factors: string[];
}

export interface ScoringAgent {
  readonly agentName: 'ScoringAgent';
  readonly version: string;

  computeIntentScore(lead: GFBuyerLead): Promise<ScoringOutput>;
}

export class ScoringAgentImpl implements ScoringAgent {
  public readonly agentName = 'ScoringAgent' as const;
  public readonly version = '1.0';

  public async computeIntentScore(lead: GFBuyerLead): Promise<ScoringOutput> {
    const evaluated = scoringRulesEngine.evaluate({
      extractedData: {
        interaction_id: 'agent-run',
        source_language: 'hinglish',
        buying_intent: {
          interested: lead.buying_intent.interested,
          interested_evidence: 'Historical / conversational profile context',
          property_type: lead.buying_intent.property_type,
          configuration: lead.buying_intent.configuration,
          purpose: lead.buying_intent.purpose,
          budget: {
            min: lead.buying_intent.budget.min,
            max: lead.buying_intent.budget.max,
            currency: lead.buying_intent.budget.currency,
            qualitative_budget: lead.buying_intent.budget.qualitative_budget,
            raw_expression: lead.buying_intent.budget.raw_expression,
          },
          preferred_locations: lead.buying_intent.preferred_locations,
          timeline: lead.buying_intent.timeline,
          financing: lead.buying_intent.financing,
          decision_maker: lead.buying_intent.decision_maker,
        },
        requirements: lead.buying_intent.requirements.map((r, idx) => ({
          requirement_id: `req-${idx + 1}`,
          property_type: lead.buying_intent.property_type,
          notes: r,
        })),
        truth_summary: {
          interested: 'CONFIRMED',
          property_type: 'CONFIRMED',
          configuration: 'CONFIRMED',
          locations: 'CONFIRMED',
          purpose: 'CONFIRMED',
          timeline: 'CONFIRMED',
          budget: lead.buying_intent.budget.min ? 'CONFIRMED' : 'UNKNOWN',
          financing: lead.buying_intent.financing ? 'CONFIRMED' : 'UNKNOWN',
          decision_maker: lead.buying_intent.decision_maker !== null ? 'CONFIRMED' : 'UNKNOWN',
        },
      },
    });

    return {
      lead_id: lead.lead_id,
      composite_intent_score: evaluated.composite_score,
      scoring_confidence: evaluated.scoring_confidence,
      breakdown: evaluated.breakdown.map((b) => ({
        dimension: b.dimension,
        weight: b.weight,
        raw_score: b.raw_score,
        weighted_score: b.weighted_score,
        explanation: b.explanation,
      })),
      score_band: evaluated.score_band,
      key_drivers: evaluated.key_drivers,
      risk_factors: evaluated.risk_factors,
    };
  }
}

export const scoringAgent = new ScoringAgentImpl();
