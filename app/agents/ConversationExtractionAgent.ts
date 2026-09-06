/**
 * Gemini Agent Interface: ConversationExtractionAgent
 *
 * Responsibilities:
 * Parses unstructured voice qualification transcripts into structured buyer intent facts.
 * Adheres strictly to the Epistemic Truth Contract:
 * - Direct spoken affirmations -> CONFIRMED
 * - Inferred nuances -> INFERRED
 * - Verified profile facts -> KNOWN
 * - Unstated attributes -> UNKNOWN
 */

import { CallTranscript } from '../services/voice/voiceProvider';
import { DataTruthLevel } from '../schemas/truthLevel';

export interface ExtractedFact<T> {
  value: T;
  truth_level: DataTruthLevel;
  confidence: number;
  evidence_quote?: string;
}

export interface StructuredExtractionOutput {
  lead_id: string;
  call_id: string;
  buying_intent: {
    interested: ExtractedFact<boolean>;
    property_type: ExtractedFact<string>;
    configuration: ExtractedFact<string>;
    purpose: ExtractedFact<string>; // 'Self-use' | 'Investment' | etc.
    budget_min: ExtractedFact<number | null>;
    budget_max: ExtractedFact<number | null>;
    preferred_locations: ExtractedFact<string[]>;
    timeline: ExtractedFact<string>;
    financing: ExtractedFact<string>;
    decision_maker: ExtractedFact<boolean | null>;
    requirements: ExtractedFact<string[]>;
    preferences: ExtractedFact<string[]>;
  };
  identity_updates?: {
    full_name?: ExtractedFact<string>;
    residence?: ExtractedFact<string>;
    profession?: ExtractedFact<string>;
    company?: ExtractedFact<string>;
  };
  conversation_summary: string;
  sentiment: 'positive' | 'neutral' | 'negative' | 'hostile';
  objections_raised: string[];
}

export interface ConversationExtractionAgent {
  readonly agentName: 'ConversationExtractionAgent';
  readonly version: string;

  extractStructuredBuyerFacts(
    leadId: string,
    transcript: CallTranscript
  ): Promise<StructuredExtractionOutput>;
}
