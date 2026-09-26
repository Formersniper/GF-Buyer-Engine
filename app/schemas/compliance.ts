/**
 * GrowthForge Buyer Intelligence Engine - Compliance & Consent Schema (Phase 11A)
 *
 * Defines canonical consent taxonomy, contracts, and validation rules
 * for lead calling consent ingress and audit logging.
 */

// Permissible consent status values matching callEligibility.ts
export const CANONICAL_PERMISSIBLE_CONSENT = [
  'PERMISSIBLE',
  'EXPLICIT_CONSENT',
  'CONSENTED',
  'EXPLICIT_OPT_IN',
  'OPT_IN',
  'DIRECT_INQUIRY',
  'INBOUND_INQUIRY',
  'VERIFIED_PERMISSIBLE',
  'CONFIRMED',
] as const;

export type CanonicalPermissibleConsent = typeof CANONICAL_PERMISSIBLE_CONSENT[number];

// Opt-out / Do-Not-Call consent status values matching callEligibility.ts
export const CANONICAL_OPT_OUT_CONSENT = [
  'OPT_OUT',
  'DO_NOT_CALL',
  'DNC',
  'REVOKED',
  'UNSUBSCRIBED',
  'REFUSED',
  'BLOCKED',
  'EXPLICIT_OPT_OUT',
] as const;

export type CanonicalOptOutConsent = typeof CANONICAL_OPT_OUT_CONSENT[number];

// Canonical Consent Status union
export type CanonicalConsentStatus =
  | CanonicalPermissibleConsent
  | CanonicalOptOutConsent
  | 'UNKNOWN';

export const CANONICAL_PERMISSIBLE_CONSENT_SET = new Set<string>(CANONICAL_PERMISSIBLE_CONSENT);
export const CANONICAL_OPT_OUT_CONSENT_SET = new Set<string>(CANONICAL_OPT_OUT_CONSENT);

export function isPermissibleConsent(status: string): status is CanonicalPermissibleConsent {
  return CANONICAL_PERMISSIBLE_CONSENT_SET.has(status);
}

export function isOptOutConsent(status: string): status is CanonicalOptOutConsent {
  return CANONICAL_OPT_OUT_CONSENT_SET.has(status);
}

export function isValidIngressConsentStatus(status: string): status is (CanonicalPermissibleConsent | CanonicalOptOutConsent) {
  // UNKNOWN is the baseline state, not an allowed ingress transition target
  return isPermissibleConsent(status) || isOptOutConsent(status);
}

// Request interface for POST /api/leads/:leadId/consent
export interface RecordConsentRequest {
  consentStatus: CanonicalConsentStatus | string;
  consentSource: string;
  consentTimestamp: string;
  evidenceReference?: string;
  notes?: string;
  correlationId?: string;
}

// Response interface for POST /api/leads/:leadId/consent
export interface RecordConsentResponse {
  success: boolean;
  leadId: string;
  tenantId: string;
  previousConsentStatus: string;
  newConsentStatus: string;
  consentSource: string;
  consentTimestamp: string;
  evidenceReference?: string | null;
  auditEventId: string;
  updatedAt: string;
}

// Audit event payload stored in lead_events.event_data
export interface LeadConsentAuditEventData {
  previous_consent_status: string;
  new_consent_status: string;
  consent_source: string;
  consent_timestamp: string;
  evidence_reference?: string | null;
  notes?: string | null;
  correlation_id?: string | null;
  actor: string;
  actor_type: 'HUMAN_OPERATOR' | 'API_KEY' | 'SYSTEM';
  actor_role?: string | null;
  actor_email?: string | null;
}

export type ConsentErrorCode =
  | 'MISSING_REQUIRED_FIELDS'
  | 'INVALID_CONSENT_STATUS'
  | 'INVALID_CONSENT_SOURCE'
  | 'INVALID_CONSENT_TIMESTAMP'
  | 'FUTURE_TIMESTAMP'
  | 'INVALID_TRANSITION'
  | 'EVIDENCE_REQUIRED'
  | 'LEAD_NOT_FOUND'
  | 'TENANT_MISMATCH'
  | 'FORBIDDEN'
  | 'INTERNAL_ERROR';

export interface ConsentErrorResponse {
  success: false;
  error: {
    code: ConsentErrorCode;
    message: string;
    details?: unknown;
  };
}
