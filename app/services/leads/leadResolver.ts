/**
 * GrowthForge Buyer Intelligence Engine - Lead Resolver & Normalizer
 *
 * Responsibilities:
 * 1. Normalize input fields (trim whitespace, lowercase emails).
 * 2. Normalize phone numbers into consistent international/E.164 representation.
 * 3. Deterministic duplicate detection (Priority 1: Phone, Priority 2: Email).
 * 4. Generate stable GrowthForge Lead IDs (GF-YYYY-NNNNNN).
 * 5. Handle ambiguous cases by routing to REQUIRES_REVIEW.
 */

import { Lead } from '../../schemas/database';

export interface RawLeadRecordInput {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  source?: string | null;
  source_reference?: string | null;
}

export interface NormalizedLeadData {
  name: string;
  phone: string;
  email: string;
  source: string;
  source_reference: string | null;
}

export type ResolutionOutcome = 'NEW' | 'DUPLICATE' | 'AMBIGUOUS' | 'INVALID';

export interface LeadResolutionResult {
  outcome: ResolutionOutcome;
  leadId: string;
  normalized: NormalizedLeadData;
  matchedExistingLead?: Lead;
  workflowStatus: string;
  validationErrors: string[];
}

let leadCounter = 1;

/**
 * Normalizes lead name by trimming extra whitespace.
 */
export function normalizeName(name?: string | null): string {
  if (!name) return '';
  return name.trim().replace(/\s+/g, ' ');
}

/**
 * Normalizes email address to lowercase and validates general format.
 */
export function normalizeEmail(email?: string | null): { email: string; isValid: boolean } {
  if (!email) return { email: '', isValid: false };
  const cleaned = email.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return {
    email: cleaned,
    isValid: emailRegex.test(cleaned),
  };
}

/**
 * Normalizes phone numbers into clean, consistent storage format.
 * Preserves country code information while eliminating formatting noise.
 * Default country assumed is India (+91) for 10-digit numbers starting with 6,7,8,9.
 */
export function normalizePhone(phone?: string | null): { phone: string; isValid: boolean } {
  if (!phone) return { phone: '', isValid: false };

  let raw = phone.trim();
  // Remove spaces, dashes, dots, brackets
  let digitsOnly = raw.replace(/[\s\-\(\)\.]/g, '');

  if (digitsOnly.startsWith('+')) {
    const cleanDigits = digitsOnly.substring(1).replace(/\D/g, '');
    if (cleanDigits.length >= 7 && cleanDigits.length <= 15) {
      return { phone: `+${cleanDigits}`, isValid: true };
    }
  }

  // Handle leading 00 international prefix
  if (digitsOnly.startsWith('00')) {
    const cleanDigits = digitsOnly.substring(2).replace(/\D/g, '');
    if (cleanDigits.length >= 7 && cleanDigits.length <= 15) {
      return { phone: `+${cleanDigits}`, isValid: true };
    }
  }

  // Handle 10-digit numbers (assume India +91 default)
  const numericOnly = digitsOnly.replace(/\D/g, '');
  if (numericOnly.length === 10) {
    return { phone: `+91${numericOnly}`, isValid: true };
  }

  // Handle 12-digit numbers starting with 91
  if (numericOnly.length === 12 && numericOnly.startsWith('91')) {
    return { phone: `+${numericOnly}`, isValid: true };
  }

  // Handle 11-digit numbers starting with 0
  if (numericOnly.length === 11 && numericOnly.startsWith('0')) {
    return { phone: `+91${numericOnly.substring(1)}`, isValid: true };
  }

  // General international length check
  if (numericOnly.length >= 7 && numericOnly.length <= 15) {
    return { phone: `+${numericOnly}`, isValid: true };
  }

  return { phone: digitsOnly, isValid: false };
}

/**
 * Generates a stable canonical GrowthForge Lead ID in format GF-YYYY-NNNNNN
 */
export function generateLeadId(customSeq?: number, customYear?: number): string {
  const year = customYear || new Date().getFullYear();
  const seq = customSeq !== undefined ? customSeq : leadCounter++;
  const paddedSeq = String(seq).padStart(6, '0');
  return `GF-${year}-${paddedSeq}`;
}

/**
 * Resets the lead ID counter (primarily used in tests)
 */
export function resetLeadIdCounter(startAt = 1): void {
  leadCounter = startAt;
}

/**
 * Computes the next unique Lead ID by examining existing records and the local counter
 */
export function generateLeadIdFromExisting(existingLeads: Lead[] = [], customYear?: number): string {
  const year = customYear || new Date().getFullYear();
  const prefix = `GF-${year}-`;
  let maxSeq = 0;

  for (const lead of existingLeads) {
    if (lead?.lead_id && lead.lead_id.startsWith(prefix)) {
      const seqStr = lead.lead_id.substring(prefix.length);
      const parsed = parseInt(seqStr, 10);
      if (!isNaN(parsed) && parsed > maxSeq) {
        maxSeq = parsed;
      }
    }
  }

  const nextSeq = Math.max(leadCounter, maxSeq + 1);
  leadCounter = nextSeq + 1;
  const paddedSeq = String(nextSeq).padStart(6, '0');
  return `GF-${year}-${paddedSeq}`;
}

/**
 * Authoritative Lead Resolver
 * Resolves, normalizes, validates, and deduplicates an incoming raw lead against existing database records.
 */
export function resolveLead(
  input: RawLeadRecordInput,
  existingLeads: Lead[],
  suggestedLeadId?: string
): LeadResolutionResult {
  const validationErrors: string[] = [];

  const name = normalizeName(input.name);
  const { email, isValid: isEmailValid } = normalizeEmail(input.email);
  const { phone, isValid: isPhoneValid } = normalizePhone(input.phone);
  const source = (input.source && input.source.trim()) || 'CSV_IMPORT';
  const source_reference = input.source_reference ? input.source_reference.trim() : null;

  if (!input.name || name.length === 0) {
    validationErrors.push('Missing contact name.');
  }

  if (!input.phone && !input.email) {
    validationErrors.push('Lead must have at least a valid phone number or email address.');
  }

  if (input.phone && !isPhoneValid) {
    validationErrors.push(`Invalid phone number format: "${input.phone}".`);
  }

  if (input.email && !isEmailValid) {
    validationErrors.push(`Invalid email address format: "${input.email}".`);
  }

  const normalized: NormalizedLeadData = {
    name,
    phone,
    email,
    source,
    source_reference,
  };

  if (validationErrors.length > 0 && (!isPhoneValid && !isEmailValid)) {
    return {
      outcome: 'INVALID',
      leadId: suggestedLeadId || generateLeadIdFromExisting(existingLeads),
      normalized,
      workflowStatus: 'INVALID_CONTACT',
      validationErrors,
    };
  }

  // Deduplication Check
  // Primary Priority: Phone match
  let matchedLead: Lead | undefined;

  if (phone && isPhoneValid) {
    matchedLead = existingLeads.find((lead) => {
      if (!lead.phone) return false;
      const { phone: existingNormPhone } = normalizePhone(lead.phone);
      return existingNormPhone === phone;
    });
  }

  // Secondary Priority: Email match
  if (!matchedLead && email && isEmailValid) {
    matchedLead = existingLeads.find((lead) => {
      if (!lead.email) return false;
      const { email: existingNormEmail } = normalizeEmail(lead.email);
      return existingNormEmail === email;
    });
  }

  if (matchedLead) {
    // Check for ambiguity (e.g. same phone but completely different person name)
    const existingName = normalizeName(matchedLead.name);
    const namesDifferSignificantly =
      name &&
      existingName &&
      name.toLowerCase() !== existingName.toLowerCase() &&
      !name.toLowerCase().includes(existingName.toLowerCase()) &&
      !existingName.toLowerCase().includes(name.toLowerCase());

    if (namesDifferSignificantly) {
      return {
        outcome: 'AMBIGUOUS',
        leadId: matchedLead.lead_id,
        normalized,
        matchedExistingLead: matchedLead,
        workflowStatus: 'REQUIRES_REVIEW',
        validationErrors: [
          `Phone/Email matched existing lead ${matchedLead.lead_id}, but names conflict ("${name}" vs "${existingName}"). Flagged for operator review.`,
        ],
      };
    }

    return {
      outcome: 'DUPLICATE',
      leadId: matchedLead.lead_id, // Keep existing stable Lead ID
      normalized,
      matchedExistingLead: matchedLead,
      workflowStatus: matchedLead.status || 'RAW',
      validationErrors: [],
    };
  }

  // New Valid Lead
  return {
    outcome: 'NEW',
    leadId: suggestedLeadId || generateLeadIdFromExisting(existingLeads),
    normalized,
    workflowStatus: 'RAW',
    validationErrors,
  };
}
