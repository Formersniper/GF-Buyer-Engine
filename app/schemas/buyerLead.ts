/**
 * GrowthForge Buyer Intelligence Engine - Canonical GF Buyer Lead Schema
 *
 * Source of Truth: Formersniper/GF-Buyer-Engine-Scout
 * Specification: Frozen Architecture Contract
 */

import { WorkflowStatus } from './workflow';
import { ProvenanceFields } from './truthLevel';

export type QualificationLevel = 'HOT' | 'WARM' | 'NURTURE' | 'UNQUALIFIED' | 'DISQUALIFIED' | 'PENDING';

export interface ProjectMatchReason {
  summary: string;
  dimension_scores: {
    budget: number;
    location: number;
    configuration: number;
    property_type: number;
    purpose: number;
    timeline: number;
    preferences: number;
    project_attributes: number;
  };
  highlights: string[];
  caveats?: string[];
}

export interface ProjectMatch {
  id: string;
  project_id: string;
  project_name: string;
  developer_name: string;
  city: string;
  locality: string;
  match_score: number; // 0 - 100
  budget_score: number;
  location_score: number;
  configuration_score: number;
  reason: ProjectMatchReason;
  buyer_confirmed: boolean; // Frozen Rule: AI match != buyer confirmation
  created_at: string;
}

export interface Project {
  id: string;
  project_code: string;
  project_name: string;
  developer_name: string;
  city: string;
  locality: string;
  property_types: string[];
  configurations: string[];
  price_min: number;
  price_max: number;
  possession: string;
  features: string[];
  project_url: string;
  status: 'active' | 'upcoming' | 'sold_out';
  created_at: string;
  updated_at: string;
}

export interface GFBuyerLead {
  lead_id: string;

  identity: {
    full_name: string;
    phone: string;
    email: string;
    location: string;
    residence: string;
    profession: string;
    company: string;
  };

  buying_intent: {
    interested: boolean;
    property_type: string;
    configuration: string;
    purpose: string;

    budget: {
      min: number | null;
      max: number | null;
      currency: string;
      qualitative_budget?: string | null;
      raw_expression?: string | null;
    };

    preferred_locations: string[];

    timeline: string;
    financing: string;
    decision_maker: boolean | null;

    requirements: string[];
    preferences: string[];
  };

  project_intelligence: {
    top_matches: ProjectMatch[];

    preferred_project: {
      project_id: string | null;
      project_name: string | null;
      confidence: number;
      selection_basis: string;
    };
  };

  lead_intelligence: {
    source: string;
    intent_score: number; // 0 - 100
    qualification: string; // 'HOT' | 'WARM' | 'NURTURE' etc.
    confidence: number; // 0.0 - 1.0
    recommended_action: string;
  };

  provenance: {
    consent_status: string;
    consent_source: string;
    consent_timestamp: string | null;
    fields: ProvenanceFields | Record<string, unknown>;
  };

  workflow: {
    status: WorkflowStatus | string;
    last_event: string;
    updated_at: string | null;
  };
}

export interface RawLeadInput {
  full_name?: string;
  phone?: string;
  email?: string;
  source?: string;
  notes?: string;
  campaign?: string;
  external_id?: string;
}
