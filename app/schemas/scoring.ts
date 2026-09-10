/**
 * GrowthForge Buyer Intelligence Engine - Phase 5D Scoring & Prioritization Schema & Types
 *
 * Source of Truth: Formersniper/GF-Buyer-Engine
 * Defines strict, typed canonical structures for 8-dimension deterministic buyer scoring (0-100),
 * frozen weights (25%, 15%, 15%, 15%, 10%, 10%, 5%, 5%), score bands (HOT, WARM, NURTURE),
 * and SLA dispatch rules.
 */

import { DataTruthLevel } from './truthLevel';
import { BuyerQualificationStatus } from './qualification';

export const SCORING_SCHEMA_VERSION = '1.0';
export const SCORING_RULE_VERSION = '1.0';

export type LeadTier = 'TIER_1_HOT' | 'TIER_2_WARM' | 'TIER_3_NURTURE' | 'TIER_4_REVIEW';

export type ScoreBand = 'HOT' | 'WARM' | 'NURTURE' | 'REVIEW';

export type ScoreStatus = 'CALCULATED' | 'REQUIRES_REVIEW' | 'PENDING';

export type FollowUpUrgency = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type ScoreDimension =
  | 'buyer_intent'
  | 'budget_clarity'
  | 'location_clarity'
  | 'timeline'
  | 'project_fit'
  | 'decision_authority'
  | 'contactability'
  | 'data_freshness'
  // Legacy aliases
  | 'intent_engagement'
  | 'commercial_readiness'
  | 'velocity_urgency'
  | 'requirement_clarity';

export interface ScoreComponent {
  dimension: ScoreDimension;
  max_points: number; // 25, 15, 15, 15, 10, 10, 5, 5
  awarded_points: number;
  state: DataTruthLevel | 'PENDING';
  reason_codes: string[];
  evidence_refs: string[];
  explanation?: string;
  weight?: number;
  raw_score?: number;
  weighted_score?: number;
  confidence?: number;
  truth_level?: DataTruthLevel;
  evidence?: string | null;
}

export type ScoreComponentBreakdown = ScoreComponent;

export interface SLAPriorityDispatch {
  tier: LeadTier;
  sla_minutes: number; // Tier 1 = 15m, Tier 2 = 120m, Tier 3 = 1440m, Tier 4 = 0 (manual review)
  sla_deadline: string; // ISO date-time string
  priority_rank: number; // Relative ordering score (1 = highest urgency)
  assigned_role:
    | 'SENIOR_SALES_ADVISOR'
    | 'INBOUND_SALES_SPECIALIST'
    | 'AUTOMATED_NURTURE_WORKFLOW'
    | 'SALES_SUPERVISOR_REVIEW';
  routing_action:
    | 'IMMEDIATE_PHONE_DISPATCH'
    | 'SCHEDULED_CALLBACK'
    | 'NURTURE_DRIP_CAMPAIGN'
    | 'MANUAL_INTELLIGENCE_AUDIT';
  recommended_action: string;
  talking_points: string[];
  follow_up_urgency: FollowUpUrgency;
  follow_up_fields: string[];
}

export interface BuyerScoreRecord {
  id: string; // UUID
  lead_id: string; // UUID FK -> leads.id
  qualification_id: string | null; // UUID FK -> buyer_qualifications.id
  extraction_id: string | null; // UUID FK -> conversation_extractions.id
  score: number; // 0 - 100
  composite_score: number; // 0 - 100 (alias)
  total_score: number; // 0 - 100 (alias)
  scoring_confidence: number; // 0.0 - 1.0
  tier: LeadTier;
  score_band: ScoreBand;
  score_status: ScoreStatus;
  dimension_scores: {
    buyer_intent: number;
    budget_clarity: number;
    location_clarity: number;
    timeline: number;
    project_fit: number;
    decision_authority: number;
    contactability: number;
    data_freshness: number;
    [key: string]: number;
  };
  components: ScoreComponent[];
  breakdown: ScoreComponentBreakdown[];
  key_drivers: string[];
  risk_factors: string[];
  reason_codes: string[];
  sla_dispatch: SLAPriorityDispatch;
  project_fit_status: 'PENDING' | 'COMPLETED';
  scoring_version: string;
  rule_version: string;
  calculated_at: string;
  created_at: string;
  updated_at: string;
}

export interface ScoringResult {
  success: boolean;
  action:
    | 'SCORED'
    | 'EXISTING_SCORE'
    | 'SCORING_FAILED'
    | 'QUALIFICATION_NOT_FOUND'
    | 'LEAD_NOT_FOUND'
    | 'EXTRACTION_NOT_FOUND';
  scoreId?: string;
  score?: BuyerScoreRecord;
  error?: string;
}

export interface PriorityQueueItem {
  lead_id: string;
  external_lead_id: string;
  buyer_name: string;
  phone: string;
  composite_score: number;
  tier: LeadTier;
  qualification_status: BuyerQualificationStatus;
  sla_deadline: string;
  sla_minutes_remaining: number;
  assigned_role: string;
  follow_up_urgency: FollowUpUrgency;
  preferred_locations: string[];
  property_type: string;
  key_highlights: string[];
  talking_points: string[];
  score_id: string;
  created_at: string;
}

