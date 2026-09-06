/**
 * Gemini Agent Interface: BuyerSignalAgent
 *
 * Responsibilities:
 * Analyzes resolved & enriched lead data to detect initial buying intent signals,
 * urgency cues, and determine eligibility for voice qualification outreach.
 *
 * Invariant: Agent generates advisory analysis; state transition to CALL_ELIGIBILITY
 * is executed by authoritative application code.
 */

import { GFBuyerLead } from '../schemas/buyerLead';
import { ScoutEnrichmentResult } from '../services/scout/scoutAdapter';

export interface BuyerSignalInput {
  lead: GFBuyerLead;
  enrichmentData?: ScoutEnrichmentResult | null;
  rawNotes?: string;
}

export interface BuyerSignalOutput {
  lead_id: string;
  has_buyer_signals: boolean;
  signal_confidence: number; // 0.0 - 1.0
  detected_signals: Array<{
    category: 'budget' | 'urgency' | 'location' | 'investment' | 'life_event';
    description: string;
    weight: number;
    source: string;
  }>;
  suggested_call_topics: string[];
  call_eligibility_recommendation: {
    eligible: boolean;
    reason: string;
    suggested_call_timing?: string;
  };
  reasoning: string;
}

export interface BuyerSignalAgent {
  readonly agentName: 'BuyerSignalAgent';
  readonly version: string;

  analyzeSignals(input: BuyerSignalInput): Promise<BuyerSignalOutput>;
}
