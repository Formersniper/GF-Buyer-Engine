/**
 * GrowthForge Buyer Intelligence Engine - Lead Management Service
 *
 * Coordinates end-to-end processing across the canonical pipeline:
 * RAW LEAD -> RESOLVED -> ENRICHING -> ENRICHED -> CALL_ELIGIBILITY ->
 * CALLING -> CONNECTED -> QUALIFIED -> SCORED -> PROJECT_MATCHED -> HANDOFF
 */

import { GFBuyerLead, RawLeadInput } from '../../schemas/buyerLead';
import { WorkflowStatus, CANONICAL_WORKFLOW_STATES, FAILURE_WORKFLOW_STATES } from '../../schemas/workflow';
import { WorkflowStateMachine, WorkflowTransitionError } from '../workflow/stateMachine';
import { supabaseDataService } from '../supabase/repositories';
import { resolveLead, normalizeEmail } from './leadResolver';
import { scoutAdapter, ScoutEnrichmentQuery } from '../scout/scoutAdapter';
import { callService, CallEligibilityExecutionResult, EvaluateCallEligibilityOptions } from '../calls/callService';
import { TenantScope, TenantContext, parseScopeAndId } from '../supabase/repos/helpers';
import {
  TenantRequiredError,
  TenantForbiddenError,
  ResolvedTenantScope,
} from '../../schemas/tenant';
import { validatePhoneFormat, FIRST_PARTY_INBOUND_SOURCES } from '../calls/callEligibility';
import { Lead } from '../../schemas/database';

export interface LeadProcessingOptions {
  autoEnrich?: boolean;
  autoScore?: boolean;
  priority?: 'normal' | 'high';
}

export interface TransitionStatusOptions {
  scope?: TenantScope | TenantContext;
  tenantId?: string;
  leadId: string;
  targetStatus: WorkflowStatus;
  eventSummary?: string;
  actor?: string;
}

export interface IntakeProvenanceValidationResult {
  valid: boolean;
  reasons: string[];
}

/**
 * Validates whether a lead has required intake provenance before transitioning RAW -> RESOLVED.
 * Invariants:
 * 1. Contact name must be present and non-empty.
 * 2. Callable phone must have valid format, OR email must have valid format.
 * 3. Source must be non-empty, known, and an authorized first-party inbound source for un-enriched resolution.
 */
export function validateIntakeProvenance(lead: Partial<Lead>): IntakeProvenanceValidationResult {
  const reasons: string[] = [];

  if (!lead.name || typeof lead.name !== 'string' || lead.name.trim() === '') {
    reasons.push('Lead contact name is missing or empty.');
  }

  const rawPhone = lead.phone ? lead.phone.trim() : '';
  const rawEmail = lead.email ? lead.email.trim() : '';

  if (!rawPhone && !rawEmail) {
    reasons.push('Lead has neither a callable phone number nor an email address.');
  }

  let phoneValid = false;
  if (rawPhone) {
    const phoneRes = validatePhoneFormat(rawPhone);
    phoneValid = phoneRes.valid_format;
    if (!phoneValid) {
      reasons.push(...phoneRes.reasons);
    }
  }

  let emailValid = false;
  if (rawEmail) {
    const emailRes = normalizeEmail(rawEmail);
    emailValid = emailRes.isValid;
    if (!emailValid) {
      reasons.push(`Invalid email format: "${rawEmail}".`);
    }
  }

  if (!phoneValid && !emailValid && (rawPhone || rawEmail)) {
    reasons.push('Neither phone nor email format is valid.');
  }

  const rawSource = (lead.source || '').trim().toUpperCase();
  if (!rawSource || rawSource === 'UNKNOWN') {
    reasons.push('Lead intake source is missing or UNKNOWN.');
  }

  return {
    valid: reasons.length === 0,
    reasons,
  };
}

export interface LeadService {
  /**
   * Resolves, deduplicates, and ingests a raw real-estate lead into the engine
   */
  ingestRawLead(scope: TenantScope | TenantContext, rawLead: RawLeadInput, options?: LeadProcessingOptions): Promise<GFBuyerLead>;

  /**
   * Retrieves a buyer lead by ID with full epistemic provenance
   */
  getLead(scopeOrLeadId: TenantScope | TenantContext | string, maybeLeadId?: string): Promise<GFBuyerLead | null>;

  /**
   * Transitions a lead's authoritative workflow status via application code
   * (Enforces invariant: AI reasoning does not directly mutate status; requires explicit tenant scope)
   */
  transitionStatus(
    scopeOrOptions:
      | TenantScope
      | TenantContext
      | string
      | TransitionStatusOptions,
    maybeLeadId?: string,
    maybeTargetStatus?: WorkflowStatus,
    maybeEventSummary?: string,
    maybeActor?: string
  ): Promise<GFBuyerLead>;

  /**
   * Dispatches public enrichment request through ScoutAdapter
   */
  triggerEnrichment(scopeOrLeadId: TenantScope | TenantContext | string, maybeLeadId?: string): Promise<GFBuyerLead>;

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
  async ingestRawLead(scope: TenantScope | TenantContext, rawLead: RawLeadInput, options?: LeadProcessingOptions): Promise<GFBuyerLead> {
    const { phone, email } = rawLead;
    let existingLeads: any[] = [];
    
    // Efficient targeted lookup instead of full table scan
    const matchedLead = await supabaseDataService.leads.getLeadByPhoneOrEmail(
      scope, 
      phone || '', 
      email || ''
    );
    if (matchedLead) {
      existingLeads.push(matchedLead);
    }

    const resolution = resolveLead(rawLead, existingLeads);

    let finalLeadId = resolution.leadId;
    let dbLead = await supabaseDataService.leads.getLeadByLeadId(scope, finalLeadId);

    // If resolution outcome is NEW, but lead_id already exists in the database, resolve to a unique ID
    if (resolution.outcome === 'NEW' && dbLead) {
      let attempts = 0;
      const year = new Date().getFullYear();
      while (dbLead && attempts < 50) {
        const uniqueSeq = Math.floor(100000 + Math.random() * 900000);
        finalLeadId = `GF-${year}-${uniqueSeq}`;
        dbLead = await supabaseDataService.leads.getLeadByLeadId(scope, finalLeadId);
        attempts++;
      }
    }

    if (!dbLead) {
      dbLead = await supabaseDataService.leads.createLead(scope, {
        lead_id: finalLeadId,
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
          lead_id: finalLeadId,
          source: rawLead.source,
          resolution_action: resolution.outcome,
        },
      });
    }

    if (options?.autoEnrich) {
      return await this.triggerEnrichment(dbLead.lead_id);
    }

    const canonical = await supabaseDataService.mapToGFBuyerLead(scope, dbLead.id);
    if (!canonical) {
      throw new Error(`Failed to map canonical lead for ID: ${dbLead.id}`);
    }

    return canonical;
  }

  /**
   * Retrieves a buyer lead by ID or lead_id
   */
  async getLead(
    scopeOrLeadId: TenantScope | TenantContext | string,
    maybeLeadId?: string
  ): Promise<GFBuyerLead | null> {
    const { scope, id: leadId } = parseScopeAndId(scopeOrLeadId, maybeLeadId);
    let dbLead = await supabaseDataService.leads.getLeadByLeadId(scope, leadId);
    if (!dbLead) {
      dbLead = await supabaseDataService.leads.getLead(scope, leadId);
    }
    if (!dbLead) {
      return null;
    }
    return await supabaseDataService.mapToGFBuyerLead(scope, dbLead.id);
  }

  /**
   * Transitions a lead workflow status
   *
   * STRICT MULTI-TENANT INVARIANT (PHASE 11C):
   * Requires an explicit, authoritative TenantScope or TenantContext.
   * NEVER silently falls back to DEFAULT_TENANT_ID.
   * Fails closed with TenantRequiredError if tenant context is missing.
   * Rejects cross-tenant access with TenantForbiddenError.
   * Enforces intake provenance verification for RAW -> RESOLVED transitions.
   */
  async transitionStatus(
    scopeOrOptions:
      | TenantScope
      | TenantContext
      | string
      | TransitionStatusOptions,
    maybeLeadId?: string,
    maybeTargetStatus?: WorkflowStatus,
    maybeEventSummary?: string,
    maybeActor?: string
  ): Promise<GFBuyerLead> {
    let rawScope: any;
    let leadId: string;
    let targetStatus: WorkflowStatus;
    let eventSummary: string;
    let actor: string;

    // Check if second argument is a workflow status (i.e. transitionStatus(leadId, targetStatus, eventSummary))
    const isSecondArgStatus =
      typeof maybeLeadId === 'string' &&
      ((CANONICAL_WORKFLOW_STATES as readonly string[]).includes(maybeLeadId) ||
       (FAILURE_WORKFLOW_STATES as readonly string[]).includes(maybeLeadId));

    if (isSecondArgStatus) {
      // Caller invoked legacy signature: transitionStatus(leadId, targetStatus, eventSummary)
      // FAIL CLOSED: No tenant context provided!
      throw new TenantRequiredError(
        'Tenant context is required for lifecycle transitions. No tenant scope provided.'
      );
    }

    // Detect options object form: { scope?, tenantId?, leadId, targetStatus, eventSummary?, actor? }
    if (
      scopeOrOptions &&
      typeof scopeOrOptions === 'object' &&
      'leadId' in scopeOrOptions &&
      'targetStatus' in scopeOrOptions
    ) {
      const opts = scopeOrOptions as TransitionStatusOptions;
      rawScope = opts.scope || opts.tenantId;
      leadId = opts.leadId;
      targetStatus = opts.targetStatus;
      eventSummary = opts.eventSummary || `Transition to ${opts.targetStatus}`;
      actor = opts.actor || 'system';
    } else if (maybeLeadId !== undefined && maybeTargetStatus !== undefined) {
      // Standard signature: (scope, leadId, targetStatus, eventSummary?, actor?)
      rawScope = scopeOrOptions;
      leadId = maybeLeadId;
      targetStatus = maybeTargetStatus;
      eventSummary = maybeEventSummary || `Transition to ${maybeTargetStatus}`;
      actor = maybeActor || 'system';
    } else {
      // Missing required arguments
      throw new TenantRequiredError(
        'Tenant context is required for lifecycle transitions. No tenant scope provided.'
      );
    }

    // STRICT FAIL-CLOSED TENANT RESOLUTION:
    // Missing, empty, or un-resolvable tenant context MUST fail immediately.
    let resolvedScope: ResolvedTenantScope;
    if (!rawScope) {
      throw new TenantRequiredError(
        'Tenant context is required for lifecycle transitions. Missing tenant context.'
      );
    }

    if (typeof rawScope === 'string') {
      const trimmed = rawScope.trim();
      if (!trimmed) {
        throw new TenantRequiredError(
          'Tenant context is required for lifecycle transitions. Empty tenant ID string.'
        );
      }
      resolvedScope = { tenantId: trimmed, isPlatformAdmin: false };
    } else if (typeof rawScope === 'object') {
      if (rawScope.isPlatformAdmin === true || (rawScope as any).platformAdmin === true) {
        resolvedScope = { tenantId: rawScope.tenantId, isPlatformAdmin: true };
      } else if (
        rawScope.tenantId &&
        typeof rawScope.tenantId === 'string' &&
        rawScope.tenantId.trim()
      ) {
        resolvedScope = { tenantId: rawScope.tenantId.trim(), isPlatformAdmin: false };
      } else {
        throw new TenantRequiredError(
          'Tenant context is required for lifecycle transitions. Invalid tenant scope object.'
        );
      }
    } else {
      throw new TenantRequiredError(
        'Tenant context is required for lifecycle transitions. Unsupported tenant format.'
      );
    }

    if (!resolvedScope.tenantId && !resolvedScope.isPlatformAdmin) {
      throw new TenantRequiredError(
        'Tenant context is required for lifecycle transitions. Tenant ID is missing.'
      );
    }

    // 1. Tenant-scoped database lookup at the repository boundary
    let dbLead = await supabaseDataService.leads.getLeadByLeadId(resolvedScope, leadId);
    if (!dbLead) {
      dbLead = await supabaseDataService.leads.getLead(resolvedScope, leadId);
    }

    if (!dbLead) {
      // Check if the lead exists in another tenant to provide explicit cross-tenant denial
      if (!resolvedScope.isPlatformAdmin) {
        const adminLead =
          (await supabaseDataService.leads.getLead({ isPlatformAdmin: true }, leadId)) ||
          (await supabaseDataService.leads.getLeadByLeadId({ isPlatformAdmin: true }, leadId));
        if (adminLead && adminLead.tenant_id && adminLead.tenant_id !== resolvedScope.tenantId) {
          throw new TenantForbiddenError(
            `Cross-tenant lead access denied: Lead '${leadId}' belongs to another tenant.`
          );
        }
      }
      throw new Error(`Lead not found: ${leadId}`);
    }

    // Enforce tenant boundary validation
    if (
      !resolvedScope.isPlatformAdmin &&
      dbLead.tenant_id &&
      dbLead.tenant_id !== resolvedScope.tenantId
    ) {
      throw new TenantForbiddenError(
        `Cross-tenant lead access denied: Lead belongs to tenant '${dbLead.tenant_id}', caller scoped to '${resolvedScope.tenantId}'.`
      );
    }

    const currentStatus = (dbLead.status as WorkflowStatus) || 'RAW';

    // 2. Validate state machine transition rules
    WorkflowStateMachine.validateTransition(currentStatus, targetStatus, actor as any);

    // 3. Provenance & Intake Verification for RAW -> RESOLVED
    if (currentStatus === 'RAW' && targetStatus === 'RESOLVED') {
      const intakeCheck = validateIntakeProvenance(dbLead);
      if (!intakeCheck.valid) {
        throw new Error(
          `Lead intake provenance validation failed: ${intakeCheck.reasons.join(' ')}`
        );
      }
    }

    // 4. Execute transition in database scoped to authoritative tenant
    await supabaseDataService.leads.updateLead(resolvedScope, dbLead.id, {
      status: targetStatus,
    });

    // 5. Append lifecycle audit event
    await supabaseDataService.leadEvents.appendLeadEvent(resolvedScope, {
      tenant_id: resolvedScope.tenantId || dbLead.tenant_id,
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

    // 6. Reload updated canonical lead
    const canonical = await supabaseDataService.mapToGFBuyerLead(resolvedScope, dbLead.id);
    if (!canonical) {
      throw new Error(`Failed to map canonical lead for ID: ${dbLead.id}`);
    }
    return canonical;
  }

  /**
   * Dispatches public OSINT enrichment through ScoutAdapter and records results
   */
  async triggerEnrichment(
    scopeOrLeadId: TenantScope | TenantContext | string,
    maybeLeadId?: string
  ): Promise<GFBuyerLead> {
    const { scope, id: leadId } = parseScopeAndId(scopeOrLeadId, maybeLeadId);
    let dbLead = await supabaseDataService.leads.getLeadByLeadId(scope, leadId);
    if (!dbLead) {
      dbLead = await supabaseDataService.leads.getLead(scope, leadId);
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
