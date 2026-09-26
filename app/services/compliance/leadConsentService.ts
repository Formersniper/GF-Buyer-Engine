/**
 * GrowthForge Buyer Intelligence Engine - Lead Consent Service (Phase 11A)
 *
 * Canonical application boundary for lead calling consent mutations,
 * state transition validation, provenance tracking, and audit logging.
 */

import {
  CanonicalConsentStatus,
  isPermissibleConsent,
  isOptOutConsent,
  isValidIngressConsentStatus,
  RecordConsentRequest,
  RecordConsentResponse,
  LeadConsentAuditEventData,
  ConsentErrorCode,
} from '../../schemas/compliance';
import { TenantScope, resolveEffectiveTenantScope } from '../../schemas/tenant';
import { AuthContext } from '../../schemas/auth';
import { supabaseDataService } from '../supabase/repositories';
import { Lead } from '../../schemas/database';
import { logger } from '../security/logger';

export class ConsentServiceError extends Error {
  public readonly statusCode: number;
  public readonly code: ConsentErrorCode;
  public readonly details?: unknown;

  constructor(statusCode: number, code: ConsentErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ConsentServiceError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

/**
 * Safely parses any date string, Date object, or numeric timestamp into epoch milliseconds.
 * Returns null if the value is missing or unparseable.
 */
export function parseInstantMs(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) {
    const t = val.getTime();
    return isNaN(t) ? null : t;
  }
  if (typeof val === 'string' || typeof val === 'number') {
    const str = String(val).trim();
    if (!str) return null;
    const t = Date.parse(str);
    return isNaN(t) ? null : t;
  }
  return null;
}

/**
 * Compares two timestamps for semantic temporal instant equality,
 * independent of textual serialization format (ISO 8601 vs Postgres TIMESTAMPTZ,
 * timezone offset representations, trailing zero padding, or fractional second formats).
 */
export function isSameInstant(a: unknown, b: unknown): boolean {
  const msA = parseInstantMs(a);
  const msB = parseInstantMs(b);
  if (msA === null || msB === null) return false;
  return msA === msB;
}

/**
 * Normalizes an evidence reference string by trimming whitespace and mapping empty/whitespace values to null.
 */
export function normalizeEvidence(val?: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export interface LeadConsentService {
  recordConsent(
    scope: TenantScope,
    leadIdParam: string,
    request: RecordConsentRequest,
    actorContext?: AuthContext
  ): Promise<RecordConsentResponse>;
}

export class DefaultLeadConsentService implements LeadConsentService {
  /**
   * Canonical entrypoint to record or update lead consent with validation,
   * tenant isolation, and audit logging.
   */
  async recordConsent(
    scopeOrContext: TenantScope,
    leadIdParam: string,
    request: RecordConsentRequest,
    actorContext?: AuthContext
  ): Promise<RecordConsentResponse> {
    const scope = resolveEffectiveTenantScope(scopeOrContext);
    if (!scope.isPlatformAdmin && !scope.tenantId) {
      throw new ConsentServiceError(
        401,
        'TENANT_MISMATCH',
        'Authenticated tenant context is required for consent operations.'
      );
    }

    // 1. Validate URL leadIdParam format
    if (!leadIdParam || typeof leadIdParam !== 'string' || !leadIdParam.trim()) {
      throw new ConsentServiceError(400, 'MISSING_REQUIRED_FIELDS', 'leadId parameter is required.');
    }
    const cleanLeadId = leadIdParam.trim();
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const isUuid = uuidRegex.test(cleanLeadId);

    // 2. Resolve Lead within Tenant Scope
    let lead: Lead | null = null;
    if (isUuid) {
      try {
        lead = await supabaseDataService.leads.getLead(scope, cleanLeadId);
      } catch {
        // Continue to check by lead_id
      }
    }
    if (!lead) {
      lead = await supabaseDataService.leads.getLeadByLeadId(scope, cleanLeadId);
    }

    // 3. Cross-Tenant Existence Check (Fail Closed)
    if (!lead) {
      if (isUuid) {
        try {
          const crossLead = await supabaseDataService.leads.getLead(cleanLeadId);
          if (crossLead && crossLead.tenant_id && crossLead.tenant_id !== scope.tenantId) {
            throw new ConsentServiceError(
              403,
              'TENANT_MISMATCH',
              `Lead ${cleanLeadId} belongs to another tenant context.`
            );
          }
        } catch (err) {
          if (err instanceof ConsentServiceError) throw err;
          // Ignore lookup error and report 404
        }
      }
      throw new ConsentServiceError(
        404,
        'LEAD_NOT_FOUND',
        `Lead not found for identifier: ${cleanLeadId}`
      );
    }

    // 4. Validate Request Body Fields
    if (!request || typeof request !== 'object') {
      throw new ConsentServiceError(400, 'MISSING_REQUIRED_FIELDS', 'Request body is required.');
    }

    const rawStatus = (request.consentStatus || '').trim().toUpperCase();
    if (!rawStatus) {
      throw new ConsentServiceError(400, 'MISSING_REQUIRED_FIELDS', 'consentStatus is required.');
    }

    if (rawStatus === 'UNKNOWN') {
      throw new ConsentServiceError(
        422,
        'INVALID_TRANSITION',
        'UNKNOWN is the default unverified baseline state and cannot be submitted as an ingress consent state.'
      );
    }

    if (!isValidIngressConsentStatus(rawStatus)) {
      throw new ConsentServiceError(
        400,
        'INVALID_CONSENT_STATUS',
        `Invalid consentStatus '${rawStatus}'. Must belong to canonical permissible or opt-out sets.`
      );
    }
    const targetStatus = rawStatus as CanonicalConsentStatus;

    // 5. Validate consentSource
    const rawSource = typeof request.consentSource === 'string' ? request.consentSource.trim() : '';
    if (!rawSource) {
      throw new ConsentServiceError(400, 'INVALID_CONSENT_SOURCE', 'consentSource is required and cannot be empty.');
    }
    if (rawSource.length < 3 || rawSource.length > 200) {
      throw new ConsentServiceError(
        400,
        'INVALID_CONSENT_SOURCE',
        'consentSource must be between 3 and 200 characters.'
      );
    }

    // 6. Validate consentTimestamp
    const rawTimestamp = typeof request.consentTimestamp === 'string' ? request.consentTimestamp.trim() : '';
    if (!rawTimestamp) {
      throw new ConsentServiceError(400, 'INVALID_CONSENT_TIMESTAMP', 'consentTimestamp is required.');
    }
    const parsedTime = Date.parse(rawTimestamp);
    if (isNaN(parsedTime)) {
      throw new ConsentServiceError(
        400,
        'INVALID_CONSENT_TIMESTAMP',
        'consentTimestamp must be a valid ISO 8601 date string.'
      );
    }

    // Guard against future timestamps (> 60s ahead of server clock)
    const nowMs = Date.now();
    const futureToleranceMs = 60 * 1000;
    if (parsedTime > nowMs + futureToleranceMs) {
      throw new ConsentServiceError(
        400,
        'FUTURE_TIMESTAMP',
        'consentTimestamp cannot be in the future beyond clock skew tolerance (60 seconds).'
      );
    }
    const normalizedTimestamp = new Date(parsedTime).toISOString();

    // 7. State Transition Rules
    const previousConsentStatus = lead.consent_status || 'UNKNOWN';

    // Check for opt-out to permissible re-consent
    if (isOptOutConsent(previousConsentStatus) && isPermissibleConsent(targetStatus)) {
      const evidenceRef = typeof request.evidenceReference === 'string' ? request.evidenceReference.trim() : '';
      if (!evidenceRef) {
        throw new ConsentServiceError(
          422,
          'EVIDENCE_REQUIRED',
          'Re-consent after an existing opt-out requires explicit affirmative evidence reference.'
        );
      }
    }

    // 8. Idempotency Check
    // If identical canonical consent state, semantic timestamp, and evidence are re-submitted,
    // return early without mutating lead or creating duplicate audit record
    const incomingEvidence = normalizeEvidence(request.evidenceReference);

    let existingEvidence: string | null = null;
    try {
      const events = await supabaseDataService.leadEvents.getLeadEvents(scope, lead.id);
      const consentEvents = events.filter(
        (e) => e.event_type === 'LEAD_CONSENT_CAPTURED' || e.event_type === 'LEAD_CONSENT_UPDATED'
      );
      if (consentEvents.length > 0) {
        const latest = consentEvents[consentEvents.length - 1];
        existingEvidence = normalizeEvidence(latest.event_data?.evidence_reference);
      }
    } catch (evtErr) {
      logger.warn('[LeadConsentService] Unable to fetch prior consent events for evidence comparison:', {
        service: 'lead-consent',
        operation: 'recordConsent',
        data: { leadId: lead.id, error: evtErr instanceof Error ? evtErr.message : String(evtErr) },
      });
    }

    const isSameEvidence = incomingEvidence === existingEvidence;
    const isSameTimestamp = isSameInstant(lead.consent_timestamp, rawTimestamp);

    if (
      lead.consent_status === targetStatus &&
      lead.consent_source === rawSource &&
      isSameTimestamp &&
      isSameEvidence
    ) {
      return {
        success: true,
        leadId: lead.id,
        tenantId: lead.tenant_id,
        previousConsentStatus,
        newConsentStatus: targetStatus,
        consentSource: rawSource,
        consentTimestamp: normalizedTimestamp,
        evidenceReference: incomingEvidence,
        auditEventId: 'IDEMPOTENT_NOOP',
        updatedAt: lead.updated_at || normalizedTimestamp,
      };
    }

    // 9. Persist Canonical Consent to public.leads
    const updatedLead = await supabaseDataService.leads.updateLead(scope, lead.id, {
      consent_status: targetStatus,
      consent_source: rawSource,
      consent_timestamp: normalizedTimestamp,
    });

    if (!updatedLead) {
      throw new ConsentServiceError(500, 'INTERNAL_ERROR', 'Failed to persist consent update to database.');
    }

    // 10. Append Audit Event to public.lead_events
    // Architecture Note: The repository layer manages leads and lead_events as separate calls.
    // Near-atomic audit logging is achieved by immediate append and error logging.
    const eventType = previousConsentStatus === 'UNKNOWN' ? 'LEAD_CONSENT_CAPTURED' : 'LEAD_CONSENT_UPDATED';
    const auditEventData: LeadConsentAuditEventData = {
      previous_consent_status: previousConsentStatus,
      new_consent_status: targetStatus,
      consent_source: rawSource,
      consent_timestamp: normalizedTimestamp,
      evidence_reference: request.evidenceReference?.trim() || null,
      notes: request.notes?.trim() || null,
      correlation_id: request.correlationId?.trim() || null,
      actor: actorContext?.userId || 'SYSTEM',
      actor_type: actorContext?.authMethod === 'API_KEY' ? 'API_KEY' : (actorContext?.userId ? 'HUMAN_OPERATOR' : 'SYSTEM'),
      actor_role: actorContext?.role || null,
      actor_email: actorContext?.email || null,
    };

    let auditEventId = 'evt_' + Date.now();
    try {
      const eventRecord = await supabaseDataService.leadEvents.appendLeadEvent(scope, {
        lead_id: lead.id,
        event_type: eventType,
        event_data: auditEventData as any,
      });
      if (eventRecord && eventRecord.id) {
        auditEventId = eventRecord.id;
      }
    } catch (auditErr: unknown) {
      logger.error('[LeadConsentService] Warning: Failed to append lead consent audit event:', {
        service: 'lead-consent',
        operation: 'recordConsent',
        data: {
          leadId: lead.id,
          error: auditErr instanceof Error ? auditErr.message : String(auditErr),
        },
      });
    }

    return {
      success: true,
      leadId: lead.id,
      tenantId: lead.tenant_id,
      previousConsentStatus,
      newConsentStatus: targetStatus,
      consentSource: rawSource,
      consentTimestamp: normalizedTimestamp,
      evidenceReference: request.evidenceReference?.trim() || null,
      auditEventId,
      updatedAt: updatedLead.updated_at || new Date().toISOString(),
    };
  }
}

export const leadConsentService = new DefaultLeadConsentService();
