/**
 * GrowthForge Buyer Intelligence Engine
 * Canonical GF Buyer Lead Data Contracts
 * 
 * FROZEN ARCHITECTURE CONTRACT:
 * Do not rename canonical business fields.
 * Every important buyer attribute must distinguish data truth levels:
 * KNOWN | INFERRED | CONFIRMED | UNKNOWN
 */

export type DataTruthLevel = 'KNOWN' | 'INFERRED' | 'CONFIRMED' | 'UNKNOWN';

export type AttributeSource = 
  | 'raw_lead' 
  | 'scout' 
  | 'voice_call' 
  | 'ai_inference' 
  | 'manual';

export interface FieldProvenance<T = unknown> {
  value: T;
  source: AttributeSource;
  truth_level: DataTruthLevel;
  confidence: number; // 0.0 to 1.0
  updated_at: string;
  evidence?: string;
}

export interface BuyerIdentity {
  full_name: string;
  phone: string;
  email: string;
  location: string;
  residence: string;
  profession: string;
  company: string;
}

export interface BuyerBudget {
  min: number | null;
  max: number | null;
  currency: string;
}

export interface BuyingIntent {
  interested: boolean;
  property_type: string;
  configuration: string;
  purpose: string;
  budget: BuyerBudget;
  preferred_locations: string[];
  timeline: string;
  financing: string;
  decision_maker: boolean | null;
  requirements: string[];
  preferences: string[];
}

export interface PreferredProject {
  project_id: string | null;
  project_name: string | null;
  confidence: number;
  selection_basis: string;
}

export interface ProjectIntelligence {
  top_matches: ProjectMatch[];
  preferred_project: PreferredProject;
}

export type QualificationLevel = 'HOT' | 'WARM' | 'NURTURE' | 'UNQUALIFIED' | 'DISQUALIFIED';

export interface LeadIntelligence {
  source: string;
  intent_score: number;
  qualification: QualificationLevel | string;
  confidence: number;
  recommended_action: string;
}

export interface LeadProvenance {
  consent_status: string;
  consent_source: string;
  consent_timestamp: string | null;
  fields: Record<string, FieldProvenance>;
}

export interface LeadWorkflowState {
  status: string;
  last_event: string;
  updated_at: string | null;
}

/**
 * CANONICAL GF BUYER LEAD CONTRACT
 * The unified contract that all agents, repositories, and UI views map into.
 */
export interface GFBuyerLead {
  lead_id: string;
  identity: BuyerIdentity;
  buying_intent: BuyingIntent;
  project_intelligence: ProjectIntelligence;
  lead_intelligence: LeadIntelligence;
  provenance: LeadProvenance;
  workflow: LeadWorkflowState;
}

/**
 * Project Model matching Supabase contract
 */
export interface Project {
  id: string;
  project_code: string;
  project_name: string;
  developer_name: string;
  city: string;
  locality: string;
  micro_market: string;
  property_type: string;
  configurations: string[];
  price_min: number;
  price_max: number;
  possession: string;
  project_description: string;
  features: string[];
  amenities: string[];
  project_url: string;
  status: 'active' | 'upcoming' | 'sold_out';
  created_at: string;
  updated_at: string;
}

/**
 * Project Match Model matching Supabase contract
 */
export interface ProjectMatch {
  id: string;
  lead_id: string;
  project_id: string;
  project_name?: string;
  developer_name?: string;
  locality?: string;
  city?: string;
  price_range_display?: string;
  match_score: number; // 0 - 100
  budget_score: number;
  location_score: number;
  configuration_score: number;
  purpose_score: number;
  preference_score: number;
  timeline_score: number;
  buyer_confirmed: boolean;
  reason: {
    summary: string;
    highlights: string[];
    cautions?: string[];
  };
  created_at: string;
}

/**
 * Call Record matching Supabase contract
 */
export interface CallRecord {
  id: string;
  lead_id: string;
  provider: string;
  provider_call_id: string;
  status: 'PENDING' | 'RINGING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'NO_ANSWER' | 'BUSY';
  attempt_number: number;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  transcript: string | null;
  recording_url: string | null;
  call_outcome: string | null;
  call_metadata: Record<string, unknown>;
  created_at: string;
}

/**
 * Buyer Score matching Supabase contract
 */
export interface BuyerScore {
  id: string;
  lead_id: string;
  intent_score: number;
  budget_score: number;
  location_score: number;
  timeline_score: number;
  decision_score: number;
  project_fit_score: number;
  overall_score: number;
  qualification: QualificationLevel;
  reason: {
    intent_analysis: string;
    strengths: string[];
    risk_factors: string[];
  };
  created_at: string;
}

/**
 * Lead Event matching Supabase contract
 */
export interface LeadEvent {
  id: string;
  lead_id: string;
  event_type: string;
  event_data: Record<string, unknown>;
  created_at: string;
}
