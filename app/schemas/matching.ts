/**
 * GrowthForge Buyer Intelligence Engine - Phase 5E Project Matching & Recommendations Schema & Types
 *
 * Source of Truth: Formersniper/GF-Buyer-Engine
 * Defines strict canonical structures for 8-dimension deterministic project matching (0-100),
 * frozen weights (25%, 25%, 15%, 10%, 10%, 5%, 5%, 5%), match bands (STRONG, GOOD, POSSIBLE, WEAK),
 * hard constraints, multi-requirement matching, and explainable recommendations.
 */

export const MATCHING_RULE_VERSION = '1.0';
export const MATCHING_SCHEMA_VERSION = '1.0';
export const PROJECT_CATALOG_VERSION = '1.0';

export type ProjectMatchBand = 'STRONG' | 'GOOD' | 'POSSIBLE' | 'WEAK';

export type ProjectMatchState =
  | 'MATCH'
  | 'PARTIAL_MATCH'
  | 'MISMATCH'
  | 'BUDGET_UNKNOWN'
  | 'DATA_INCOMPLETE'
  | 'NEUTRAL';

export type ProjectMatchDimension =
  | 'budget'
  | 'location'
  | 'configuration'
  | 'property_type'
  | 'purpose'
  | 'timeline'
  | 'preferences'
  | 'project_attributes';

export interface ProjectMatchComponent {
  dimension: ProjectMatchDimension;
  max_points: number; // 25, 25, 15, 10, 10, 5, 5, 5
  awarded_points: number;
  match_state: ProjectMatchState;
  reason_codes: string[];
  evidence_refs: string[];
  explanation?: string;
}

export interface ProjectRecommendation {
  id: string; // UUID
  lead_id: string; // UUID FK -> leads.id
  qualification_id?: string | null; // UUID FK -> buyer_qualifications.id
  requirement_id?: string | null; // Requirement identifier or index
  buyer_requirement_id?: string | null; // Alias
  requirement_index?: number;
  requirement_summary?: string;
  project_id: string; // UUID FK -> projects.id
  project_code: string;
  project_name: string;
  developer_name: string | null;
  city: string | null;
  locality: string | null;
  micro_market: string | null;
  property_type: string | null;
  configurations: string[] | null;
  price_min: number | null;
  price_max: number | null;
  possession: string | null;
  match_score: number; // 0 - 100
  match_band: ProjectMatchBand;
  rank: number; // 1, 2, 3...
  dimension_scores: {
    budget: number;
    location: number;
    configuration: number;
    property_type: number;
    purpose: number;
    timeline: number;
    preferences: number;
    project_attributes: number;
    [key: string]: number;
  };
  components: ProjectMatchComponent[];
  key_matches: string[];
  gaps: string[];
  risks: string[];
  buyer_confirmed: boolean; // Frozen Rule: AI recommendation != buyer confirmation (defaults to false)
  project_fit_status: 'CALCULATED' | 'PENDING' | 'INELIGIBLE';
  recommendation_status: 'AI_RECOMMENDED' | 'DETERMINISTIC_RANKING';
  matching_version: string;
  rule_version: string;
  catalog_version: string;
  calculated_at: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectMatchingInput {
  leadId: string;
  qualificationId?: string;
  extractionId?: string;
  ruleVersion?: string;
  catalogVersion?: string;
  forceRematch?: boolean;
}

export interface ProjectMatchingResult {
  success: boolean;
  action:
    | 'MATCHED'
    | 'EXISTING_MATCHES'
    | 'MATCHING_FAILED'
    | 'NO_ACTIVE_PROJECTS'
    | 'LEAD_NOT_FOUND'
    | 'QUALIFICATION_NOT_FOUND';
  lead_id: string;
  qualification_id?: string | null;
  total_recommendations: number;
  recommendations: ProjectRecommendation[];
  matching_version: string;
  rule_version: string;
  catalog_version: string;
  calculated_at: string;
  error?: string;
}

export interface ProjectCatalogFilter {
  city?: string;
  locality?: string;
  micro_market?: string;
  property_type?: string;
  property_types?: string[];
  configuration?: string;
  status?: string;
  min_price?: number;
  max_price?: number;
  limit?: number;
}
