/**
 * GrowthForge Buyer Intelligence Engine - Lead Management Service Interface
 *
 * Coordinates end-to-end processing across the canonical pipeline:
 * RAW LEAD -> RESOLVED -> ENRICHING -> ENRICHED -> CALL_ELIGIBILITY ->
 * CALLING -> CONNECTED -> QUALIFIED -> SCORED -> PROJECT_MATCHED -> HANDOFF
 */

import { GFBuyerLead, RawLeadInput } from '../../schemas/buyerLead';
import { WorkflowStatus } from '../../schemas/workflow';

export interface LeadProcessingOptions {
  autoEnrich?: boolean;
  autoScore?: boolean;
  priority?: 'normal' | 'high';
}

export interface LeadService {
  /**
   * Resolves, deduplicates, and ingests a raw real-estate lead into the engine
   */
  ingestRawLead(rawLead: RawLeadInput, options?: LeadProcessingOptions): Promise<GFBuyerLead>;

  /**
   * Retrieves a buyer lead by ID with full epistemic provenance
   */
  getLead(leadId: string): Promise<GFBuyerLead | null>;

  /**
   * Transitions a lead's authoritative workflow status via application code
   * (Enforces invariant: AI reasoning does not directly mutate status)
   */
  transitionStatus(
    leadId: string,
    targetStatus: WorkflowStatus,
    eventSummary: string,
    actor?: string
  ): Promise<GFBuyerLead>;

  /**
   * Dispatches public enrichment request through ScoutAdapter
   */
  triggerEnrichment(leadId: string): Promise<GFBuyerLead>;

  /**
   * Ingests voice qualification conversation results and triggers structured extraction
   */
  handleCallCompletion(leadId: string, callId: string): Promise<GFBuyerLead>;
}
