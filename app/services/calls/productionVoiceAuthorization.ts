/**
 * GrowthForge Buyer Intelligence Engine - Production Voice Authorization Contract (Phase 12.1)
 *
 * SPECIFICATION & INVARIANTS:
 * - Pure and deterministic evaluation module.
 * - ZERO side effects: no database calls, no HTTP calls, no LLM calls, no provider calls.
 * - Distinguishes "The lead is eligible to be called" from "The system is authorized to execute an outbound voice call."
 * - Evaluates mandatory tenant/lead context, kill switch, mode/environment invariants, explicit production enabler, and provider allowlists.
 */

export const PRODUCTION_VOICE_AUTHORIZATION_POLICY_VERSION = 'PRODUCTION_VOICE_AUTHORIZATION_V1';

export type VoiceAuthorizationDecision =
  | 'AUTHORIZED'
  | 'AUTHORIZED_MOCK'
  | 'BLOCKED';

export type VoiceAuthorizationReasonCode =
  | 'MOCK_ALLOWED_NON_PRODUCTION'
  | 'REAL_VOICE_NOT_ENABLED'
  | 'GLOBAL_VOICE_KILL_SWITCH_ACTIVE'
  | 'REAL_VOICE_REQUIRES_PRODUCTION'
  | 'REAL_PROVIDER_NOT_ALLOWED'
  | 'ELIGIBILITY_NOT_CONFIRMED'
  | 'TENANT_CONTEXT_MISSING'
  | 'LEAD_CONTEXT_MISSING';

export interface ProductionVoiceAuthorizationInput {
  environment: 'production' | 'development' | 'test';
  voiceMode: 'REAL' | 'MOCK';
  provider: string;
  tenantId?: string | null;
  leadId?: string | null;
  eligibilityDecision: string;
  productionVoiceEnabled: boolean;
  globalKillSwitchActive: boolean;
  realProviderAllowlist?: string[];
}

export interface ProductionVoiceAuthorizationResult {
  authorized: boolean;
  decision: VoiceAuthorizationDecision;
  reasonCodes: VoiceAuthorizationReasonCode[];
  policyVersion: string;
  evaluatedAt: string;
  provider: string;
  mode: 'REAL' | 'MOCK';
}

/**
 * Pure deterministic evaluation of final production voice authorization.
 */
export function evaluateProductionVoiceAuthorization(
  input: ProductionVoiceAuthorizationInput
): ProductionVoiceAuthorizationResult {
  const evaluatedAt = new Date().toISOString();
  const provider = input.provider;
  const mode = input.voiceMode;

  const buildResult = (
    authorized: boolean,
    decision: VoiceAuthorizationDecision,
    reasonCodes: VoiceAuthorizationReasonCode[]
  ): ProductionVoiceAuthorizationResult => ({
    authorized,
    decision,
    reasonCodes,
    policyVersion: PRODUCTION_VOICE_AUTHORIZATION_POLICY_VERSION,
    evaluatedAt,
    provider,
    mode,
  });

  // RULE 1 — Kill switch wins
  if (input.globalKillSwitchActive === true) {
    return buildResult(false, 'BLOCKED', ['GLOBAL_VOICE_KILL_SWITCH_ACTIVE']);
  }

  // RULE 2 — Tenant context is mandatory
  if (!input.tenantId || input.tenantId.trim() === '') {
    return buildResult(false, 'BLOCKED', ['TENANT_CONTEXT_MISSING']);
  }

  // RULE 3 — Lead context is mandatory
  if (!input.leadId || input.leadId.trim() === '') {
    return buildResult(false, 'BLOCKED', ['LEAD_CONTEXT_MISSING']);
  }

  // RULE 4 — Eligibility is mandatory
  if (input.eligibilityDecision !== 'ELIGIBLE') {
    return buildResult(false, 'BLOCKED', ['ELIGIBILITY_NOT_CONFIRMED']);
  }

  // RULE 5 — MOCK behavior in non-production
  if (input.voiceMode === 'MOCK') {
    if (input.environment !== 'production') {
      return buildResult(true, 'AUTHORIZED_MOCK', ['MOCK_ALLOWED_NON_PRODUCTION']);
    }
    // RULE 6 — MOCK is forbidden in production
    return buildResult(false, 'BLOCKED', ['REAL_VOICE_REQUIRES_PRODUCTION']);
  }

  // RULE 7 — REAL voice is production-only
  if (input.voiceMode === 'REAL' && input.environment !== 'production') {
    return buildResult(false, 'BLOCKED', ['REAL_VOICE_REQUIRES_PRODUCTION']);
  }

  // RULE 8 — Explicit production enablement is mandatory
  if (input.voiceMode === 'REAL' && input.environment === 'production') {
    if (input.productionVoiceEnabled !== true) {
      return buildResult(false, 'BLOCKED', ['REAL_VOICE_NOT_ENABLED']);
    }

    // RULE 9 — Provider allowlist
    const allowlist = (
      input.realProviderAllowlist && input.realProviderAllowlist.length > 0
        ? input.realProviderAllowlist
        : ['sarvam']
    ).map((p) => p.trim().toLowerCase());

    if (!allowlist.includes(provider.trim().toLowerCase())) {
      return buildResult(false, 'BLOCKED', ['REAL_PROVIDER_NOT_ALLOWED']);
    }

    // RULE 10 — Successful REAL authorization
    return buildResult(true, 'AUTHORIZED', []);
  }

  // Default fail-safe fallback
  return buildResult(false, 'BLOCKED', ['REAL_VOICE_NOT_ENABLED']);
}
