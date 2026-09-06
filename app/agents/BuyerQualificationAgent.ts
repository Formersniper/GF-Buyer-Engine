/**
 * Gemini Agent Interface: BuyerQualificationAgent
 *
 * Responsibilities:
 * Assesses structured buyer facts against qualification criteria (budget realism,
 * timeline credibility, decision-maker status, geographic feasibility).
 * Produces qualification recommendation: HOT (90-100), WARM (70-89), NURTURE (0-69), or DISQUALIFIED.
 */

import { GFBuyerLead, QualificationLevel } from '../schemas/buyerLead';

export interface QualificationCriteriaAssessment {
  criterion: 'budget_fit' | 'timeline' | 'authority' | 'need_clarity' | 'geographic_match';
  status: 'passed' | 'marginal' | 'failed' | 'unknown';
  weight: number;
  score: number; // 0 - 100
  notes: string;
}

export interface BuyerQualificationOutput {
  lead_id: string;
  recommended_qualification: QualificationLevel;
  confidence: number; // 0.0 - 1.0
  criteria_assessments: QualificationCriteriaAssessment[];
  qualification_rationale: string;
  recommended_client_action: string;
  nurture_strategy?: string;
  suggested_touchpoints?: string[];
}

export interface BuyerQualificationAgent {
  readonly agentName: 'BuyerQualificationAgent';
  readonly version: string;

  qualifyBuyer(lead: GFBuyerLead): Promise<BuyerQualificationOutput>;
}
