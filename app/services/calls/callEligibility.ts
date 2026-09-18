/**
 * GrowthForge Buyer Intelligence Engine - Call Eligibility Domain & Policy Engine
 *
 * PHASE 4A SPECIFICATION:
 * - Deterministic application policy to evaluate whether an ENRICHED lead is eligible for voice qualification.
 * - Explicit policy version: CALL_ELIGIBILITY_V1
 * - Invariant: AI reasoning must NOT directly control eligibility decisions or workflow transitions.
 * - Invariant: Possession of a phone number does NOT constitute consent.
 */

import { WorkflowStatus } from '../../schemas/workflow';
import {
  CALL_COMPLIANCE_POLICY_VERSION,
  CallAttemptRecord,
  CallCompliancePolicyConfig,
  CallComplianceResult,
  evaluateCallCompliance,
} from './callCompliance';

export const CALL_ELIGIBILITY_POLICY_VERSION = 'CALL_ELIGIBILITY_V1';

export interface PhoneValidationResult {
  valid_format: boolean;
  normalized_phone: string | null;
  reasons: string[];
}

/**
 * Deterministic Phone Validation
 * Validates phone syntax without external verification APIs.
 * Terminology invariant: uses `valid_format` / `phone_valid_format`, NOT `phone_verified`.
 */
export function validatePhoneFormat(phone?: string | null): PhoneValidationResult {
  if (!phone || typeof phone !== 'string' || phone.trim() === '') {
    return {
      valid_format: false,
      normalized_phone: null,
      reasons: ['Callable phone number is missing or empty.'],
    };
  }

  const raw = phone.trim();
  // Strip whitespace, hyphens, parentheses, and periods
  const cleaned = raw.replace(/[\s\-\(\)\.]/g, '');

  // Reject invalid characters (allow only optional leading + and digits)
  if (!/^\+?[0-9]{7,15}$/.test(cleaned)) {
    return {
      valid_format: false,
      normalized_phone: null,
      reasons: [`Phone number contains invalid characters or non-standard structure: "${raw}"`],
    };
  }

  const digitsOnly = cleaned.replace(/\D/g, '');

  // Reject placeholder or repetitive digits (e.g. 0000000000, 1111111111, 9999999999, +919999999999)
  if (/(\d)\1{6,}/.test(digitsOnly)) {
    return {
      valid_format: false,
      normalized_phone: null,
      reasons: ['Phone number contains repetitive placeholder digits.'],
    };
  }

  // Reject sequential dummy digits (e.g. 1234567890, +911234567890)
  if (digitsOnly.includes('1234567890') || digitsOnly === '0123456789') {
    return {
      valid_format: false,
      normalized_phone: null,
      reasons: ['Phone number contains sequential dummy digits.'],
    };
  }

  // Normalize Indian mobile numbers
  // Indian mobile numbers are 10 digits starting with 6, 7, 8, or 9
  if (cleaned.startsWith('+91')) {
    const nationalNumber = cleaned.substring(3);
    if (nationalNumber.length === 10 && /^[6-9]/.test(nationalNumber)) {
      return {
        valid_format: true,
        normalized_phone: `+91${nationalNumber}`,
        reasons: [],
      };
    }
  } else if (cleaned.startsWith('91') && cleaned.length === 12 && /^[6-9]/.test(cleaned.substring(2))) {
    return {
      valid_format: true,
      normalized_phone: `+${cleaned}`,
      reasons: [],
    };
  } else if (cleaned.startsWith('0') && cleaned.length === 11 && /^[6-9]/.test(cleaned.substring(1))) {
    return {
      valid_format: true,
      normalized_phone: `+91${cleaned.substring(1)}`,
      reasons: [],
    };
  } else if (cleaned.length === 10 && /^[6-9]/.test(cleaned)) {
    return {
      valid_format: true,
      normalized_phone: `+91${cleaned}`,
      reasons: [],
    };
  }

  // Standard international E.164 compliance (7 to 15 digits)
  if (digitsOnly.length >= 7 && digitsOnly.length <= 15) {
    const formatted = cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
    return {
      valid_format: true,
      normalized_phone: formatted,
      reasons: [],
    };
  }

  return {
    valid_format: false,
    normalized_phone: null,
    reasons: [`Phone number digit count (${digitsOnly.length}) is outside standard E.164 limits (7-15 digits).`],
  };
}

export interface CallEligibilityInput {
  leadId: string;
  tenantId?: string | null;
  status: WorkflowStatus | string;
  phone?: string | null;
  email?: string | null;
  consentStatus?: string | null;
  source?: string | null;
  enrichmentAvailable?: boolean;
  previousCallStatus?: string | null;
  complianceConfig?: CallCompliancePolicyConfig;
  callsHistory?: CallAttemptRecord[];
  evaluatedAt?: Date | string;
}

export interface CallEligibilityResult {
  eligible: boolean;
  decision: 'ELIGIBLE' | 'NOT_ELIGIBLE' | 'REQUIRES_REVIEW';
  reasons: string[];
  evaluatedAt: string;
  policyVersion: string;
  phone_format_valid: boolean;
  consent_state: string;
  compliance?: CallComplianceResult;
}

// Explicit permissible consent status values
export const EXPLICIT_PERMISSIBLE_CONSENT = new Set([
  'PERMISSIBLE',
  'EXPLICIT_CONSENT',
  'CONSENTED',
  'EXPLICIT_OPT_IN',
  'OPT_IN',
  'DIRECT_INQUIRY',
  'INBOUND_INQUIRY',
  'VERIFIED_PERMISSIBLE',
  'CONFIRMED',
]);

// Explicit opt-out / Do-Not-Call status values
export const EXPLICIT_OPT_OUT_CONSENT = new Set([
  'OPT_OUT',
  'DO_NOT_CALL',
  'DNC',
  'REVOKED',
  'UNSUBSCRIBED',
  'REFUSED',
  'BLOCKED',
  'EXPLICIT_OPT_OUT',
]);

// Verified first-party inbound sources permitted to proceed to voice eligibility without prior OSINT enrichment
export const FIRST_PARTY_INBOUND_SOURCES = new Set([
  'WEB_FORM',
  'DIRECT_INQUIRY',
  'INBOUND_INQUIRY',
  'API_WEBHOOK',
  'META_LEAD_AD',
  'PORTAL_INQUIRY',
  'PROPERTY_INQUIRY',
  'INBOUND',
  'LANDING_PAGE',
  'CHATBOT',
  'DIRECT',
]);

/**
 * Evaluates call eligibility under deterministic CALL_ELIGIBILITY_V1 and CALL_COMPLIANCE_V1 rules.
 */
export function evaluateCallEligibility(input: CallEligibilityInput): CallEligibilityResult {
  const evaluatedAt = input.evaluatedAt
    ? (typeof input.evaluatedAt === 'string' ? new Date(input.evaluatedAt).toISOString() : input.evaluatedAt.toISOString())
    : new Date().toISOString();

  // A. Lead must exist
  if (!input || !input.leadId) {
    return {
      eligible: false,
      decision: 'NOT_ELIGIBLE',
      reasons: ['Lead record does not exist or has no valid ID.'],
      evaluatedAt,
      policyVersion: CALL_ELIGIBILITY_POLICY_VERSION,
      phone_format_valid: false,
      consent_state: 'UNKNOWN',
    };
  }

  // Handle REQUIRES_REVIEW leads
  if (input.status === 'REQUIRES_REVIEW') {
    return {
      eligible: false,
      decision: 'REQUIRES_REVIEW',
      reasons: ['Lead is currently in REQUIRES_REVIEW status. Operator intervention required before calling.'],
      evaluatedAt,
      policyVersion: CALL_ELIGIBILITY_POLICY_VERSION,
      phone_format_valid: false,
      consent_state: input.consentStatus || 'UNKNOWN',
    };
  }

  const rawConsent = (input.consentStatus || '').trim().toUpperCase();
  const rawSource = (input.source || '').trim().toUpperCase();

  // B. Workflow Status must be ENRICHED, OR RESOLVED with verified first-party inbound consent/source
  const isFirstPartyInbound =
    FIRST_PARTY_INBOUND_SOURCES.has(rawSource) ||
    rawConsent === 'DIRECT_INQUIRY' ||
    rawConsent === 'INBOUND_INQUIRY';

  const isStatusEligible =
    input.status === 'ENRICHED' || (input.status === 'RESOLVED' && isFirstPartyInbound);

  if (!isStatusEligible) {
    const reasons: string[] = [];
    if (input.status === 'RAW') {
      reasons.push('Lead workflow status is RAW. Must complete resolution and intake verification before call evaluation.');
    } else if (input.status === 'RESOLVED') {
      reasons.push(
        `Lead workflow status is RESOLVED but source "${input.source || 'UNKNOWN'}" is not an authorized first-party inbound source. Must undergo enrichment before calling.`
      );
    } else if (input.status === 'ENRICHING') {
      reasons.push('Lead is currently undergoing enrichment (ENRICHING).');
    } else if (input.status === 'ENRICHMENT_FAILED') {
      reasons.push('Lead enrichment failed (ENRICHMENT_FAILED). Cannot proceed without verified enrichment baseline.');
    } else if (input.status === 'INVALID_CONTACT') {
      reasons.push('Lead contact is marked as INVALID_CONTACT.');
    } else {
      reasons.push(`Lead workflow status is "${input.status}". Only ENRICHED leads or verified first-party RESOLVED leads may proceed to call eligibility.`);
    }

    return {
      eligible: false,
      decision: 'NOT_ELIGIBLE',
      reasons,
      evaluatedAt,
      policyVersion: CALL_ELIGIBILITY_POLICY_VERSION,
      phone_format_valid: false,
      consent_state: input.consentStatus || 'UNKNOWN',
    };
  }

  // C & D. Phone existence & syntactic validation
  const phoneValidation = validatePhoneFormat(input.phone);
  const phoneFormatValid = phoneValidation.valid_format;

  if (!phoneFormatValid) {
    return {
      eligible: false,
      decision: 'NOT_ELIGIBLE',
      reasons: phoneValidation.reasons,
      evaluatedAt,
      policyVersion: CALL_ELIGIBILITY_POLICY_VERSION,
      phone_format_valid: false,
      consent_state: input.consentStatus || 'UNKNOWN',
    };
  }

  // F. Explicit Opt-Out / Do Not Call check (always takes absolute precedence)
  if (EXPLICIT_OPT_OUT_CONSENT.has(rawConsent)) {
    return {
      eligible: false,
      decision: 'NOT_ELIGIBLE',
      reasons: ['Lead has explicitly opted out of communications (Do Not Call / Opt-Out).'],
      evaluatedAt,
      policyVersion: CALL_ELIGIBILITY_POLICY_VERSION,
      phone_format_valid: true,
      consent_state: rawConsent,
    };
  }

  // G. Ambiguous / Unknown consent check
  if (!rawConsent || !EXPLICIT_PERMISSIBLE_CONSENT.has(rawConsent)) {
    return {
      eligible: false,
      decision: 'REQUIRES_REVIEW',
      reasons: [
        'Calling consent is unknown or ambiguous. Possession of phone number does not constitute calling permission.',
      ],
      evaluatedAt,
      policyVersion: CALL_ELIGIBILITY_POLICY_VERSION,
      phone_format_valid: true,
      consent_state: rawConsent || 'UNKNOWN',
    };
  }

  // H. Call Compliance Policy Check (calling window, timezone, cooldown, max attempts)
  const compliance = evaluateCallCompliance({
    leadId: input.leadId,
    tenantId: input.tenantId,
    policyConfig: input.complianceConfig,
    callsHistory: input.callsHistory,
    evaluatedAt,
  });

  if (!compliance.compliant) {
    return {
      eligible: false,
      decision: 'NOT_ELIGIBLE',
      reasons: compliance.reasons,
      evaluatedAt,
      policyVersion: CALL_ELIGIBILITY_POLICY_VERSION,
      phone_format_valid: true,
      consent_state: rawConsent,
      compliance,
    };
  }

  // E. All positive conditions satisfied
  const leadContextDesc = input.status === 'ENRICHED'
    ? 'ENRICHED'
    : `RESOLVED first-party inbound (${input.source || rawConsent})`;

  return {
    eligible: true,
    decision: 'ELIGIBLE',
    reasons: [`Lead is ${leadContextDesc} with valid phone format, verified permissible calling consent, and compliant calling policy.`],
    evaluatedAt,
    policyVersion: CALL_ELIGIBILITY_POLICY_VERSION,
    phone_format_valid: true,
    consent_state: rawConsent,
    compliance,
  };
}
