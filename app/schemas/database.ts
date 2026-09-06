/**
 * GrowthForge Buyer Intelligence Engine - Database Entity Types (Supabase)
 *
 * Source of Truth: Formersniper/GF-Buyer-Engine
 * Direct typed representation of the 9 Supabase PostgreSQL tables.
 */

export interface Lead {
  id: string; // UUID
  lead_id: string; // TEXT UNIQUE (e.g. GF-2026-000001)
  name: string | null;
  phone: string | null;
  email: string | null;
  source: string | null;
  source_reference: string | null;
  status: string; // WorkflowStatus (defaults to 'RAW')
  created_at: string;
  updated_at: string;
}

export interface LeadEnrichment {
  id: string; // UUID
  lead_id: string; // UUID FK -> leads.id
  platform: string | null;
  username: string | null;
  profile_url: string | null;
  full_name: string | null;
  bio: string | null;
  website: string | null;
  company: string | null;
  location: string | null;
  raw_data: Record<string, unknown> | null;
  enriched_data: Record<string, unknown> | null;
  source_confidence: number | null;
  created_at: string;
}

export interface Call {
  id: string; // UUID
  lead_id: string; // UUID FK -> leads.id
  provider: string | null;
  provider_call_id: string | null;
  status: string | null;
  attempt_number: number;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  transcript: string | null;
  recording_url: string | null;
  call_outcome: string | null;
  call_metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface BuyerProfile {
  id: string; // UUID
  lead_id: string; // UUID UNIQUE FK -> leads.id
  property_interest: boolean | null;
  property_type: string | null;
  configuration: string | null;
  purpose: string | null;
  budget_min: number | null;
  budget_max: number | null;
  currency: string;
  preferred_locations: string[] | Record<string, unknown> | null;
  timeline: string | null;
  financing: string | null;
  decision_maker: boolean | null;
  requirements: string[] | Record<string, unknown> | null;
  preferences: string[] | Record<string, unknown> | null;
  qualification_status: string | null;
  intent_score: number | null;
  confidence_score: number | null;
  created_at: string;
  updated_at: string;
}

export interface BuyerPreference {
  id: string; // UUID
  lead_id: string; // UUID FK -> leads.id
  attribute: string;
  value: unknown;
  source: string | null;
  confidence: number | null;
  is_explicit: boolean;
  is_verified: boolean;
  created_at: string;
}

export interface DbProject {
  id: string; // UUID
  project_code: string; // TEXT UNIQUE
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
  project_description: string | null;
  features: string[] | null;
  amenities: string[] | null;
  project_url: string | null;
  status: string; // 'ACTIVE' | 'UPCOMING' | 'SOLD_OUT'
  created_at: string;
  updated_at: string;
}

export interface DbProjectMatch {
  id: string; // UUID
  lead_id: string; // UUID FK -> leads.id
  project_id: string; // UUID FK -> projects.id
  match_score: number | null;
  budget_score: number | null;
  location_score: number | null;
  configuration_score: number | null;
  purpose_score: number | null;
  preference_score: number | null;
  timeline_score: number | null;
  buyer_confirmed: boolean;
  reason: Record<string, unknown> | null;
  created_at: string;
}

// Aliases for compatibility
export type ProjectRow = DbProject;
export type ProjectMatchRow = DbProjectMatch;

export interface BuyerScore {
  id: string; // UUID
  lead_id: string; // UUID FK -> leads.id
  intent_score: number | null;
  budget_score: number | null;
  location_score: number | null;
  timeline_score: number | null;
  decision_score: number | null;
  project_fit_score: number | null;
  overall_score: number | null;
  qualification: string | null;
  reason: Record<string, unknown> | null;
  created_at: string;
}

export interface LeadEvent {
  id: string; // UUID
  lead_id: string; // UUID FK -> leads.id
  event_type: string;
  event_data: Record<string, unknown> | null;
  created_at: string;
}
