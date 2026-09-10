/**
 * GrowthForge Buyer Intelligence Engine - Phase 5C Qualification Schema & Types
 *
 * Source of Truth: Formersniper/GF-Buyer-Engine
 * Defines the strict, typed canonical structures for deterministic buyer qualification.
 */

import { DataTruthLevel } from './truthLevel';

export const QUALIFICATION_SCHEMA_VERSION = '1.0';
export const QUALIFICATION_RULE_VERSION = '1.0';

export type BuyerQualificationStatus =
  | 'QUALIFIED'
  | 'PARTIALLY_QUALIFIED'
  | 'NURTURE'
  | 'REQUIRES_REVIEW';

export type QualificationReasonCode =
  | 'ACTIVE_INTENT_CONFIRMED'
  | 'ACTIVE_INTENT_DISCONFIRMED'
  | 'ACTIVE_INTENT_UNKNOWN'
  | 'LOCATION_CONFIRMED'
  | 'LOCATION_UNKNOWN'
  | 'REQUIREMENT_CONFIRMED'
  | 'REQUIREMENT_PARTIAL'
  | 'REQUIREMENT_UNKNOWN'
  | 'CONFIGURATION_CONFIRMED'
  | 'CONFIGURATION_UNKNOWN'
  | 'PURPOSE_CONFIRMED'
  | 'PURPOSE_UNKNOWN'
  | 'TIMELINE_CONFIRMED'
  | 'TIMELINE_UNKNOWN'
  | 'TIMELINE_DISTANT'
  | 'BUDGET_CONFIRMED'
  | 'BUDGET_MISSING'
  | 'BUDGET_UNKNOWN'
  | 'FINANCING_CONFIRMED'
  | 'FINANCING_UNKNOWN'
  | 'DECISION_MAKER_CONFIRMED'
  | 'DECISION_MAKER_UNKNOWN'
  | 'MULTI_REQUIREMENT_DETECTED'
  | 'CONTRADICTION_DETECTED'
  | 'EXTRACTION_DATA_INVALID'
  | 'EXTRACTION_MISSING'
  | 'MISSING_CONTACT_INFO';

export type DimensionStatus =
  | 'SATISFIED'
  | 'PARTIALLY_SATISFIED'
  | 'UNRESOLVED'
  | 'CONFLICTED'
  | 'DISQUALIFYING';

export interface DimensionAssessment {
  dimension:
    | 'active_intent'
    | 'property_type'
    | 'configuration'
    | 'location'
    | 'purpose'
    | 'timeline'
    | 'budget'
    | 'financing'
    | 'decision_maker'
    | 'contact_readiness';
  status: DimensionStatus;
  truth_level: DataTruthLevel;
  summary: string;
  evidence: string | null;
}

export interface EvidenceRef {
  field: string;
  text: string;
  truth_level: DataTruthLevel;
}

export interface BuyerQualification {
  id: string; // UUID
  lead_id: string; // UUID FK -> leads.id
  extraction_id: string; // UUID FK -> conversation_extractions.id
  qualification_status: BuyerQualificationStatus;
  reason_codes: QualificationReasonCode[];
  blocking_fields: string[];
  follow_up_fields: string[];
  dimension_assessments: Record<string, DimensionAssessment>;
  evidence_refs: EvidenceRef[];
  qualification_version: string;
  rule_version: string;
  created_at: string;
  updated_at: string;
}

export interface QualificationResult {
  success: boolean;
  action:
    | 'QUALIFIED'
    | 'PARTIALLY_QUALIFIED'
    | 'NURTURE'
    | 'REQUIRES_REVIEW'
    | 'EXISTING_QUALIFICATION'
    | 'QUALIFICATION_FAILED'
    | 'EXTRACTION_NOT_FOUND'
    | 'INVALID_EXTRACTION_DATA';
  qualificationId?: string;
  qualification?: BuyerQualification;
  error?: string;
}
