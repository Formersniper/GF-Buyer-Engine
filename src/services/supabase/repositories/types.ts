/**
 * Database Row Types mapped directly to Section 7: Supabase Database Contract
 */

export interface LeadRow {
  id: string;
  lead_id: string;
  name: string;
  phone: string;
  email: string;
  source: string;
  source_reference: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface LeadEnrichmentRow {
  id: string;
  lead_id: string;
  platform: string;
  username: string | null;
  profile_url: string | null;
  full_name: string | null;
  bio: string | null;
  website: string | null;
  company: string | null;
  location: string | null;
  raw_data: Record<string, unknown>;
  enriched_data: Record<string, unknown>;
  source_confidence: number;
  created_at: string;
}

export interface CallRow {
  id: string;
  lead_id: string;
  provider: string;
  provider_call_id: string;
  status: string;
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

export interface BuyerProfileRow {
  id: string;
  lead_id: string;
  property_interest: boolean;
  property_type: string;
  configuration: string;
  purpose: string;
  budget_min: number | null;
  budget_max: number | null;
  currency: string;
  preferred_locations: string[];
  timeline: string;
  financing: string;
  decision_maker: boolean | null;
  requirements: string[];
  preferences: string[];
  qualification_status: string;
  intent_score: number;
  confidence_score: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectRow {
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
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectMatchRow {
  id: string;
  lead_id: string;
  project_id: string;
  match_score: number;
  budget_score: number;
  location_score: number;
  configuration_score: number;
  purpose_score: number;
  preference_score: number;
  timeline_score: number;
  buyer_confirmed: boolean;
  reason: Record<string, unknown>;
  created_at: string;
}

export interface BuyerScoreRow {
  id: string;
  lead_id: string;
  intent_score: number;
  budget_score: number;
  location_score: number;
  timeline_score: number;
  decision_score: number;
  project_fit_score: number;
  overall_score: number;
  qualification: string;
  reason: Record<string, unknown>;
  created_at: string;
}

export interface LeadEventRow {
  id: string;
  lead_id: string;
  event_type: string;
  event_data: Record<string, unknown>;
  created_at: string;
}
