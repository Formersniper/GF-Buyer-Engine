/**
 * GrowthForge Buyer Intelligence Engine - Lead Management Service
 *
 * Coordinates end-to-end processing across the canonical pipeline:
 * RAW LEAD -> RESOLVED -> ENRICHING -> ENRICHED -> CALL_ELIGIBILITY ->
 * CALLING -> CONNECTED -> QUALIFIED -> SCORED -> PROJECT_MATCHED -> HANDOFF
 */

import { GFBuyerLead, RawLeadInput } from '../../schemas/buyerLead';
import { WorkflowStatus } from '../../schemas/workflow';
import { WorkflowStateMachine } from '../workflow/stateMachine';
import { supabaseDataService } from '../supabase/repositories';
import { resolveLead } from './leadResolver';
import { scoutAdapter, ScoutEnrichmentQuery } from '../scout/scoutAdapter';
import { callService, CallEligibilityExecutionResult, EvaluateCallEligibilityOptions } from '../calls/callService';

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
   * Evaluates call eligibility and triggers mock voice provider handoff if eligible
   */
  evaluateCallEligibility(
    leadId: string,
    options?: EvaluateCallEligibilityOptions
  ): Promise<CallEligibilityExecutionResult>;

  /**
   * Ingests voice qualification conversation results and triggers structured extraction
   */
  handleCallCompletion(leadId: string, callId: string): Promise<GFBuyerLead>;
}

export class DefaultLeadService implements LeadService {
  private generateLeadCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = 'GF-';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    code += '-';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  /**
   * Ingests and resolves a new raw lead
   */
  async ingestRawLead(rawLead: RawLeadInput, options?: LeadProcessingOptions): Promise<GFBuyerLead> {
    const existingLeads = await supabaseDataService.leads.listLeads({ limit: 500 });
    const resolution = resolveLead(rawLead, existingLeads);

    let dbLead = await supabaseDataService.leads.getLeadByLeadId(resolution.leadId);
    if (!dbLead) {
      dbLead = await supabaseDataService.leads.createLead({
        lead_id: resolution.leadId,
        name: rawLead.full_name || null,
        phone: rawLead.phone || null,
        email: rawLead.email || null,
        source: rawLead.source || 'CSV_IMPORT',
        source_reference: (rawLead as Record<string, unknown>).source_reference as string || rawLead.external_id || null,
        status: resolution.workflowStatus,
      });

      // Audit event
      await supabaseDataService.leadEvents.appendLeadEvent({
        lead_id: dbLead.id,
        event_type: 'LEAD_INGESTED',
        event_data: {
          lead_id: resolution.leadId,
          source: rawLead.source,
          resolution_action: resolution.outcome,
        },
      });
    }

    if (options?.autoEnrich) {
      return await this.triggerEnrichment(dbLead.lead_id);
    }

    const canonical = await supabaseDataService.mapToGFBuyerLead(dbLead.id);
    if (!canonical) {
      throw new Error(`Failed to map canonical lead for ID: ${dbLead.id}`);
    }
    return canonical;
  }

  /**
   * Retrieves a buyer lead by ID or lead_id
   */
  async getLead(leadId: string): Promise<GFBuyerLead | null> {
    let dbLead = await supabaseDataService.leads.getLeadByLeadId(leadId);
    if (!dbLead) {
      dbLead = await supabaseDataService.leads.getLead(leadId);
    }
    if (!dbLead) {
      return null;
    }
    return await supabaseDataService.mapToGFBuyerLead(dbLead.id);
  }

  /**
   * Transitions a lead workflow status
   */
  async transitionStatus(
    leadId: string,
    targetStatus: WorkflowStatus,
    eventSummary: string,
    actor: string = 'system'
  ): Promise<GFBuyerLead> {
    let dbLead = await supabaseDataService.leads.getLeadByLeadId(leadId);
    if (!dbLead) {
      dbLead = await supabaseDataService.leads.getLead(leadId);
    }
    if (!dbLead) {
      throw new Error(`Lead not found: ${leadId}`);
    }

    const currentStatus = (dbLead.status as WorkflowStatus) || 'RAW';
    WorkflowStateMachine.validateTransition(currentStatus, targetStatus, actor as any);

    await supabaseDataService.leads.updateLead(dbLead.id, { status: targetStatus });

    await supabaseDataService.leadEvents.appendLeadEvent({
      lead_id: dbLead.id,
      event_type: 'STATUS_TRANSITION',
      event_data: {
        from: currentStatus,
        to: targetStatus,
        summary: eventSummary,
        actor,
        timestamp: new Date().toISOString(),
      },
    });

    const canonical = await supabaseDataService.mapToGFBuyerLead(dbLead.id);
    if (!canonical) {
      throw new Error(`Failed to map canonical lead for ID: ${dbLead.id}`);
    }
    return canonical;
  }

  /**
   * Dispatches public OSINT enrichment through ScoutAdapter and records results
   */
  async triggerEnrichment(leadId: string): Promise<GFBuyerLead> {
    let dbLead = await supabaseDataService.leads.getLeadByLeadId(leadId);
    if (!dbLead) {
      dbLead = await supabaseDataService.leads.getLead(leadId);
    }
    if (!dbLead) {
      throw new Error(`Lead not found: ${leadId}`);
    }

    // Move status to ENRICHING
    const currentStatus = (dbLead.status as WorkflowStatus) || 'RAW';
    if (WorkflowStateMachine.canTransition(currentStatus, 'ENRICHING')) {
      await supabaseDataService.leads.updateLead(dbLead.id, { status: 'ENRICHING' });
    }

    await supabaseDataService.leadEvents.appendLeadEvent({
      lead_id: dbLead.id,
      event_type: 'LEAD_ENRICHMENT_STARTED',
      event_data: {
        lead_id: dbLead.lead_id,
        timestamp: new Date().toISOString(),
      },
    });

    // Formulate query for ScoutAdapter
    const query: ScoutEnrichmentQuery = {
      full_name: dbLead.name || undefined,
      phone: dbLead.phone || undefined,
      email: dbLead.email || undefined,
    };

    const tenantId = dbLead.tenant_id || null;
    if (tenantId) {
      const rl = await supabaseDataService.security.checkAndIncrementRateLimit(tenantId, 'scout_enrichment', 3600, 100);
      if (!rl.allowed) {
        throw new Error('Tenant rate limit exceeded for lead enrichment');
      }
    }
    
    const lockAcquired = await supabaseDataService.security.acquireResourceLock('lead_enrichment', dbLead.id, tenantId, 'scoutAdapter', 60);
    if (!lockAcquired) {
      throw new Error('Enrichment already in progress for this lead');
    }

    let enrichmentResult;
    try {
      enrichmentResult = await scoutAdapter.enrichLead(query);
    } finally {
      await supabaseDataService.security.releaseResourceLock('lead_enrichment', dbLead.id, 'scoutAdapter');
    }

    if (enrichmentResult.status === 'error') {
      await supabaseDataService.leadEvents.appendLeadEvent({
        lead_id: dbLead.id,
        event_type: 'LEAD_ENRICHMENT_FAILED',
        event_data: {
          error_code: enrichmentResult.error_code,
          error_message: enrichmentResult.error_message,
          timestamp: new Date().toISOString(),
        },
      });

      await supabaseDataService.leads.updateLead(dbLead.id, { status: 'ENRICHMENT_FAILED' });

      const canonical = await supabaseDataService.mapToGFBuyerLead(dbLead.id);
      if (!canonical) {
        throw new Error(`Failed to map canonical lead for ID: ${dbLead.id}`);
      }
      return canonical;
    }

    // Normalize output conforming to canonical contract
    const normalized = scoutAdapter.normalizeOutput(
      query,
      enrichmentResult.raw_payload || {},
      enrichmentResult.status,
      enrichmentResult.error_code,
      enrichmentResult.error_message
    );

    // Persist enrichment record
    await supabaseDataService.leadEnrichment.createEnrichment({
      lead_id: dbLead.id,
      platform: 'scout',
      username: null,
      profile_url: normalized.profiles[0]?.url || null,
      full_name: enrichmentResult.full_name || null,
      bio: enrichmentResult.bio || null,
      website: null,
      company: enrichmentResult.employment?.company || null,
      location: enrichmentResult.location || null,
      raw_data: enrichmentResult.raw_payload || {},
      enriched_data: {
        signals: normalized.signals,
        profiles: normalized.profiles,
      },
      source_confidence: normalized.confidence || 0.85,
    });

    // Audit event
    await supabaseDataService.leadEvents.appendLeadEvent({
      lead_id: dbLead.id,
      event_type: 'LEAD_ENRICHED',
      event_data: {
        status: enrichmentResult.status,
        profiles_found: normalized.profiles.length,
        signals_found: normalized.signals.length,
        source: 'scout',
        truth_level: 'INFERRED',
        timestamp: new Date().toISOString(),
      },
    });

    // Update status to ENRICHED
    await supabaseDataService.leads.updateLead(dbLead.id, { status: 'ENRICHED' });

    const canonical = await supabaseDataService.mapToGFBuyerLead(dbLead.id);
    if (!canonical) {
      throw new Error(`Failed to map canonical lead for ID: ${dbLead.id}`);
    }
    return canonical;
  }

  /**
   * Ingests call completion
   */
  async handleCallCompletion(leadId: string, callId: string): Promise<GFBuyerLead> {
    let dbLead = await supabaseDataService.leads.getLeadByLeadId(leadId);
    if (!dbLead) {
      dbLead = await supabaseDataService.leads.getLead(leadId);
    }
    if (!dbLead) {
      throw new Error(`Lead not found: ${leadId}`);
    }

    await supabaseDataService.leadEvents.appendLeadEvent({
      lead_id: dbLead.id,
      event_type: 'CALL_COMPLETED',
      event_data: {
        call_id: callId,
        timestamp: new Date().toISOString(),
      },
    });

    const canonical = await supabaseDataService.mapToGFBuyerLead(dbLead.id);
    if (!canonical) {
      throw new Error(`Failed to map canonical lead for ID: ${dbLead.id}`);
    }
    return canonical;
  }

  /**
   * Evaluates call eligibility and coordinates deterministic transition and mock provider handoff
   */
  async evaluateCallEligibility(
    leadId: string,
    options?: EvaluateCallEligibilityOptions
  ): Promise<CallEligibilityExecutionResult> {
    return callService.evaluateAndPrepareCall(leadId, options);
  }
}

export const leadService = new DefaultLeadService();
