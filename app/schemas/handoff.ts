/**
 * GrowthForge Buyer Intelligence Engine - Phase 5F Broker Handoff & CRM Routing Schema & Types
 *
 * Source of Truth: Formersniper/GF-Buyer-Engine
 * Defines canonical typed structures for sales-ready broker handoff packages,
 * deterministic CRM routing decisions, SLA assignments, readiness states,
 * idempotent dispatch state tracking, and priority queues.
 */

import { BuyerQualificationStatus } from './qualification';
import { LeadTier, ScoreBand, FollowUpUrgency } from './scoring';
import { ProjectMatchBand } from './matching';

export const HANDOFF_SCHEMA_VERSION = '1.0';
export const HANDOFF_RULE_VERSION = '1.0';

export type BrokerHandoffReadiness =
  | 'READY'
  | 'READY_WITH_MISSING_DATA'
  | 'REQUIRES_REVIEW'
  | 'BLOCKED'
  | 'DISPATCHED'
  | 'ACKNOWLEDGED'
  | 'COMPLETED'
  | 'FAILED';

export type BrokerRoutingStatus =
  | 'PENDING'
  | 'ASSIGNED'
  | 'ROUTED'
  | 'REQUIRES_REVIEW'
  | 'BLOCKED';

export type BrokerDispatchStatus =
  | 'PENDING'
  | 'SENT'
  | 'ACKNOWLEDGED'
  | 'FAILED'
  | 'IGNORED_DUPLICATE';

export interface CRMRoutingDecision {
  assigned_role:
    | 'SENIOR_SALES_ADVISOR'
    | 'INBOUND_SALES_SPECIALIST'
    | 'AUTOMATED_NURTURE_WORKFLOW'
    | 'SALES_SUPERVISOR_REVIEW';
  assigned_team:
    | 'SENIOR_SALES'
    | 'INBOUND_SALES'
    | 'NURTURE_AUTOMATION'
    | 'SALES_SUPERVISORS';
  tier: LeadTier;
  sla_minutes: number;
  sla_deadline: string;
  routing_action:
    | 'IMMEDIATE_PHONE_DISPATCH'
    | 'SCHEDULED_CALLBACK'
    | 'NURTURE_DRIP_CAMPAIGN'
    | 'MANUAL_INTELLIGENCE_AUDIT';
  follow_up_urgency: FollowUpUrgency;
  reason_codes: string[];
}

export interface BuyerRequirementHandoff {
  id: string;
  requirement_index: number;
  property_type: string | null;
  configuration: string | null;
  purpose: string | null;
  budget_min: number | null;
  budget_max: number | null;
  currency: string;
  budget_truth_level: string;
  preferred_locations: string[];
  location_truth_level: string;
  timeline: string | null;
  timeline_truth_level: string;
  preferences: string[];
}

export interface ProjectRecommendationHandoff {
  project_id: string;
  project_code: string;
  project_name: string;
  developer_name: string | null;
  city: string | null;
  locality: string | null;
  match_score: number;
  match_band: ProjectMatchBand;
  rank: number;
  key_matches: string[];
  gaps: string[];
  risks: string[];
  buyer_confirmed: boolean; // Frozen Rule: AI recommendation != buyer confirmation
  recommendation_status: 'AI_RECOMMENDED' | 'DETERMINISTIC_RANKING';
}

export interface BrokerHandoffPackage {
  handoff_id: string;
  lead_id: string;
  external_lead_id?: string;
  qualification_id: string | null;
  score_id: string | null;
  extraction_id: string | null;
  transcript_id: string | null;
  call_id: string | null;
  primary_buyer_summary: {
    name: string | null;
    phone: string | null;
    location: string | null;
    contact_status: 'CONTACTABLE' | 'UNREACHABLE' | 'UNKNOWN';
  };
  qualification: {
    status: BuyerQualificationStatus;
    reason_codes: string[];
    blocking_fields: string[];
    follow_up_fields: string[];
  };
  priority: {
    score: number;
    band: ScoreBand;
    tier: LeadTier;
    sla_minutes: number;
    sla_deadline: string;
    urgency: FollowUpUrgency;
  };
  requirements: BuyerRequirementHandoff[];
  project_recommendations: ProjectRecommendationHandoff[];
  missing_information: string[];
  risks: string[];
  recommended_action: string;
  talking_points: string[];
  call_summary: string | null;
  commercial_summary: string;
  recommendation_status: 'AI_RECOMMENDED' | 'DETERMINISTIC_RANKING';
  handoff_status: BrokerHandoffReadiness;
  routing_status: BrokerRoutingStatus;
  routing_decision: CRMRoutingDecision;
  dispatch_channel?: string | null;
  dispatch_status?: BrokerDispatchStatus;
  dispatch_id?: string | null;
  handoff_version: string;
  rule_version: string;
  created_at: string;
  updated_at: string;
}

export interface DbBrokerHandoff {
  id: string; // UUID
  tenant_id?: string; // UUID FK -> tenants.id
  lead_id: string; // UUID FK -> leads.id
  qualification_id: string | null;
  score_id: string | null;
  extraction_id: string | null;
  transcript_id: string | null;
  call_id: string | null;
  handoff_payload: BrokerHandoffPackage;
  handoff_status: BrokerHandoffReadiness;
  routing_status: BrokerRoutingStatus;
  assigned_role: string | null;
  assigned_team: string | null;
  priority_tier: LeadTier;
  sla_minutes: number;
  sla_deadline: string;
  dispatch_channel: string | null;
  dispatch_status: BrokerDispatchStatus;
  dispatch_id: string | null;
  handoff_version: string;
  rule_version: string;
  created_at: string;
  updated_at: string;
}

export interface GenerateHandoffInput {
  leadId: string;
  qualificationId?: string;
  scoreId?: string;
  extractionId?: string;
  forceRegenerate?: boolean;
  ruleVersion?: string;
}

export interface HandoffResult {
  success: boolean;
  action:
    | 'HANDOFF_CREATED'
    | 'EXISTING_HANDOFF'
    | 'HANDOFF_REQUIRES_REVIEW'
    | 'HANDOFF_BLOCKED'
    | 'LEAD_NOT_FOUND'
    | 'HANDOFF_FAILED';
  handoffId?: string;
  handoff?: BrokerHandoffPackage;
  dbRecord?: DbBrokerHandoff;
  error?: string;
}

export interface DispatchResult {
  success: boolean;
  dispatch_id: string;
  channel: string;
  status: BrokerDispatchStatus;
  delivered_at: string;
  dry_run: boolean;
  message?: string;
  error?: string;
}

export interface HandoffQueueItem {
  handoff_id: string;
  lead_id: string;
  external_lead_id: string;
  buyer_name: string;
  phone: string;
  score: number;
  tier: LeadTier;
  sla_deadline: string;
  sla_minutes_remaining: number;
  assigned_role: string;
  assigned_team: string;
  urgency: FollowUpUrgency;
  handoff_status: BrokerHandoffReadiness;
  routing_status: BrokerRoutingStatus;
  dispatch_status: BrokerDispatchStatus;
  primary_requirement: string;
  top_project: string | null;
  missing_information: string[];
  recommended_action: string;
  created_at: string;
}
