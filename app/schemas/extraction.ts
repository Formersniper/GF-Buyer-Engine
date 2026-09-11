/**
 * GrowthForge Buyer Intelligence Engine - Phase 5B Extraction Schemas & Types
 *
 * Source of Truth: Formersniper/GF-Buyer-Engine
 * Defines the strict, typed canonical structures for Gemini-derived structured buyer intelligence.
 */

import { DataTruthLevel } from './truthLevel';

export const EXTRACTION_SCHEMA_VERSION = '1.0';
export const EXTRACTION_PROMPT_VERSION = '1.0';

export type ExtractionStatus =
  | 'EXTRACTION_PENDING'
  | 'EXTRACTION_IN_PROGRESS'
  | 'EXTRACTED'
  | 'EXTRACTION_FAILED'
  | 'EXTRACTION_REQUIRES_REVIEW';

export interface ExtractedField<T> {
  value: T;
  truth_level: DataTruthLevel;
  evidence: string | null;
  source: 'CALL_TRANSCRIPT' | string;
}

export interface ExtractedBudget {
  min: number | null;
  max: number | null;
  currency: string;
  raw_expression?: string | null;
  truth_level: DataTruthLevel;
  evidence: string | null;
}

export interface ExtractedLandArea {
  min?: number | null;
  max?: number | null;
  unit?: 'sq_yd' | 'sq_ft' | 'acres' | 'bigha' | string;
}

export interface ExtractedRequirement {
  property_type: string; // 'residential' | 'farm_house' | 'plot' | 'villa' | 'commercial' | string
  configuration?: string | null; // e.g. '3 BHK', '4 BHK'
  purpose?: 'end_use' | 'investment' | 'rental' | 'mixed' | 'unknown' | string | null;
  land_area?: ExtractedLandArea | null;
  truth_level: DataTruthLevel;
  evidence: string | null;
}

export interface ExtractedBuyerIntelligence {
  interested: ExtractedField<boolean>;
  primary_property_type: ExtractedField<string | null>;
  primary_configuration: ExtractedField<string | null>;
  purpose: ExtractedField<'end_use' | 'investment' | 'rental' | 'mixed' | 'unknown'>;
  budget: ExtractedBudget;
  preferred_locations: ExtractedField<string[]>;
  timeline: ExtractedField<string | null>;
  possession_preference: ExtractedField<'ready_to_move' | 'under_construction' | 'both' | 'unknown'>;
  financing: ExtractedField<string | null>;
  decision_maker: ExtractedField<boolean | null>;
  requirements: ExtractedRequirement[];
  stated_preferences: ExtractedField<string[]>;
  additional_notes: ExtractedField<string | null>;
}

export interface ConversationExtraction {
  id: string; // UUID
  tenant_id?: string; // UUID FK -> tenants.id
  lead_id: string; // UUID FK -> leads.id
  call_id: string; // UUID FK -> calls.id
  transcript_id: string; // UUID FK -> call_transcripts.id
  provider_call_id: string | null;
  interaction_id: string | null;
  model: string;
  prompt_version: string;
  schema_version: string;
  extraction_status: ExtractionStatus;
  extracted_data: ExtractedBuyerIntelligence | null;
  raw_gemini_response: Record<string, unknown> | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExtractionResult {
  success: boolean;
  action: 'EXTRACTED' | 'EXISTING_EXTRACTION' | 'EXTRACTION_FAILED' | 'TRANSCRIPT_NOT_FOUND' | 'EMPTY_TRANSCRIPT';
  extractionId?: string;
  extraction?: ConversationExtraction;
  error?: string;
}
