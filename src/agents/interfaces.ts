/**
 * GrowthForge Gemini Agent Service Contracts
 * 
 * FROZEN ARCHITECTURE CONTRACT:
 * - Gemini responsibilities:
 *   1. Buyer Signal Analysis
 *   2. Conversation Extraction
 *   3. Buyer Qualification
 *   4. Buyer Scoring
 *   5. Project Matching
 * - Structured JSON outputs everywhere.
 * - Never invent buyer facts.
 * - Distinguish KNOWN, INFERRED, CONFIRMED, UNKNOWN.
 * - In Phase 1: Defines clean typed interfaces with explicit NotImplemented boundary.
 */

import {
  GFBuyerLead,
  BuyerIdentity,
  BuyingIntent,
  Project,
  ProjectMatch,
  QualificationLevel,
  DataTruthLevel,
  AttributeSource,
} from '../types/buyerLead';
import { LeadEnrichmentRow } from '../services/supabase/repositories/types';

/**
 * 1. BUYER SIGNAL AGENT
 */
export interface BuyerSignalInput {
  leadId: string;
  identity: BuyerIdentity;
  source: string;
  enrichments: LeadEnrichmentRow[];
}

export interface BuyerSignalOutput {
  buyer_candidate: boolean;
  possible_interests: string[];
  public_signals: Array<{
    signal: string;
    source: string;
    confidence: number;
  }>;
  unknown_fields: string[];
  recommended_questions: string[];
  confidence: number;
}

export interface IBuyerSignalAgent {
  analyzeSignals(input: BuyerSignalInput): Promise<BuyerSignalOutput>;
}

/**
 * 2. CONVERSATION EXTRACTION AGENT
 */
export interface ExtractedBuyerFact<T = unknown> {
  attribute: string;
  value: T;
  source: AttributeSource;
  confidence: number;
  is_explicit: boolean; // explicit = stated directly; implicit = inferred from context
  truth_level: DataTruthLevel;
  quote?: string;
}

export interface ConversationExtractionInput {
  leadId: string;
  transcript: string;
  priorContext?: Partial<GFBuyerLead>;
}

export interface ConversationExtractionOutput {
  leadId: string;
  facts: ExtractedBuyerFact[];
  buying_intent_updates: Partial<BuyingIntent>;
  unresolved_ambiguities: string[];
  confidence: number;
}

export interface IConversationExtractionAgent {
  extractFacts(input: ConversationExtractionInput): Promise<ConversationExtractionOutput>;
}

/**
 * 3. BUYER QUALIFICATION AGENT
 */
export interface BuyerQualificationInput {
  lead: GFBuyerLead;
  transcriptSummary?: string;
  enrichments: LeadEnrichmentRow[];
}

export interface BuyerQualificationOutput {
  intent_score: number; // 0 - 100
  qualification: QualificationLevel;
  confidence: number;
  recommended_action: string;
  reason: {
    summary: string;
    buying_readiness: string;
    financial_clarity: string;
    key_drivers: string[];
    risks_or_blockers: string[];
  };
}

export interface IBuyerQualificationAgent {
  qualifyBuyer(input: BuyerQualificationInput): Promise<BuyerQualificationOutput>;
}

/**
 * 4. SCORING AGENT
 * Configurable weights:
 * Buyer Intent 25%, Budget Clarity 15%, Location Clarity 15%, Timeline 15%,
 * Project Fit 10%, Decision Authority 10%, Contactability 5%, Data Freshness 5%
 */
export interface ScoringWeights {
  buyerIntent: number; // 0.25
  budgetClarity: number; // 0.15
  locationClarity: number; // 0.15
  timeline: number; // 0.15
  projectFit: number; // 0.10
  decisionAuthority: number; // 0.10
  contactability: number; // 0.05
  dataFreshness: number; // 0.05
}

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  buyerIntent: 0.25,
  budgetClarity: 0.15,
  locationClarity: 0.15,
  timeline: 0.15,
  projectFit: 0.10,
  decisionAuthority: 0.10,
  contactability: 0.05,
  dataFreshness: 0.05,
};

export interface ScoringInput {
  lead: GFBuyerLead;
  customWeights?: Partial<ScoringWeights>;
}

export interface ScoringOutput {
  overall_score: number; // 0 - 100
  breakdown: {
    buyer_intent_score: number;
    budget_clarity_score: number;
    location_clarity_score: number;
    timeline_score: number;
    project_fit_score: number;
    decision_authority_score: number;
    contactability_score: number;
    data_freshness_score: number;
  };
  qualification: QualificationLevel; // 90-100 = HOT, 70-89 = WARM, 0-69 = NURTURE
  confidence: number;
  reason: {
    summary: string;
    positive_factors: string[];
    negative_factors: string[];
  };
}

export interface IScoringAgent {
  scoreBuyer(input: ScoringInput): Promise<ScoringOutput>;
}

/**
 * 5. PROJECT MATCHING AGENT
 * Configurable match weights:
 * Budget 25%, Location 25%, Configuration 15%, Property Type 10%,
 * Purpose 10%, Timeline 5%, Preferences 5%, Project Attributes 5%
 */
export interface ProjectMatchWeights {
  budget: number; // 0.25
  location: number; // 0.25
  configuration: number; // 0.15
  propertyType: number; // 0.10
  purpose: number; // 0.10
  timeline: number; // 0.05
  preferences: number; // 0.05
  projectAttributes: number; // 0.05
}

export const DEFAULT_PROJECT_MATCH_WEIGHTS: ProjectMatchWeights = {
  budget: 0.25,
  location: 0.25,
  configuration: 0.15,
  propertyType: 0.10,
  purpose: 0.10,
  timeline: 0.05,
  preferences: 0.05,
  projectAttributes: 0.05,
};

export interface ProjectMatchingInput {
  lead: GFBuyerLead;
  projects: Project[];
  topCount?: number;
  weights?: Partial<ProjectMatchWeights>;
}

export interface ProjectMatchingOutput {
  leadId: string;
  top_matches: ProjectMatch[];
  preferred_project: {
    project_id: string | null;
    project_name: string | null;
    confidence: number;
    selection_basis: string;
  };
  confidence: number;
  match_timestamp: string;
}

export interface IProjectMatchingAgent {
  matchProjects(input: ProjectMatchingInput): Promise<ProjectMatchingOutput>;
}
