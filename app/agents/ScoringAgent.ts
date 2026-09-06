/**
 * Gemini Agent Interface: ScoringAgent
 *
 * Responsibilities:
 * Calculates a multi-dimensional composite Buyer Intent Score (0 - 100)
 * weighting budget certainty, urgency/timeline, engagement depth, and verified facts.
 */

import { GFBuyerLead } from '../schemas/buyerLead';

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
  score_band: 'HOT' | 'WARM' | 'NURTURE';
  key_drivers: string[];
  risk_factors: string[];
}

export interface ScoringAgent {
  readonly agentName: 'ScoringAgent';
  readonly version: string;

  computeIntentScore(lead: GFBuyerLead): Promise<ScoringOutput>;
}
