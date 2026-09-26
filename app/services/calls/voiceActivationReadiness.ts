/**
 * GrowthForge Buyer Intelligence Engine - Voice Activation Readiness Contract (Phase 12.2)
 *
 * SPECIFICATION & INVARIANTS:
 * - Pure and deterministic evaluation module.
 * - ZERO side effects: no database calls, no network calls, no HTTP calls, no LLM calls.
 * - Evaluates mandatory tenant/lead context, call eligibility, call compliance, production voice authorization,
 *   global kill switch, production enablement, provider allowlist, rollout controls (percentage & caps), cost readiness, and provider health.
 */

export const VOICE_ACTIVATION_READINESS_POLICY_VERSION = 'VOICE_ACTIVATION_READINESS_V1';

export type VoiceActivationReadinessDecision =
  | 'READY_FOR_CONTROLLED_REAL'
  | 'MOCK_ONLY'
  | 'BLOCKED';

export type VoiceActivationReadinessReasonCode =
  | 'MOCK_ALLOWED_NON_PRODUCTION'
  | 'REAL_VOICE_NOT_ENABLED'
  | 'GLOBAL_VOICE_KILL_SWITCH_ACTIVE'
  | 'REAL_VOICE_REQUIRES_PRODUCTION'
  | 'REAL_PROVIDER_NOT_ALLOWED'
  | 'ELIGIBILITY_NOT_CONFIRMED'
  | 'COMPLIANCE_NOT_ALLOWED'
  | 'TENANT_CONTEXT_MISSING'
  | 'LEAD_CONTEXT_MISSING'
  | 'ROLLOUT_DISABLED'
  | 'ROLLOUT_PERCENTAGE_EXCEEDED'
  | 'TENANT_ROLLOUT_CAP_REACHED'
  | 'GLOBAL_ROLLOUT_CAP_REACHED'
  | 'COST_CAP_EXCEEDED'
  | 'PROVIDER_UNHEALTHY';

export interface VoiceActivationReadinessInput {
  environment: 'production' | 'development' | 'test';
  voiceMode: 'REAL' | 'MOCK';
  provider: string;
  tenantId?: string | null;
  leadId?: string | null;
  eligibilityDecision: string;
  complianceDecision: string;
  productionVoiceEnabled: boolean;
  globalKillSwitchActive: boolean;
  rolloutEnabled: boolean;
  rolloutPercentage: number;
  realCallsForTenant: number;
  maxRealCallsPerTenant: number;
  realCallsGlobal: number;
  maxRealCallsGlobal: number;
  realProviderAllowlist?: string[];
  costCheckPassed: boolean;
  providerHealthy: boolean;
}

export interface VoiceActivationReadinessResult {
  ready: boolean;
  decision: VoiceActivationReadinessDecision;
  reasonCodes: VoiceActivationReadinessReasonCode[];
  policyVersion: string;
  evaluatedAt: string;
  provider: string;
  mode: 'REAL' | 'MOCK';
}

/**
 * Deterministic hash function for tenant/lead hashing against rollout percentage (0-100).
 */
function computeRolloutBucket(tenantId: string, leadId: string): number {
  const str = `${tenantId}:${leadId}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 100;
}

/**
 * Evaluates whether an outbound call request is operationally ready for execution.
 */
export function evaluateVoiceActivationReadiness(
  input: VoiceActivationReadinessInput
): VoiceActivationReadinessResult {
  const evaluatedAt = new Date().toISOString();
  const provider = input.provider;
  const mode = input.voiceMode;

  const buildResult = (
    ready: boolean,
    decision: VoiceActivationReadinessDecision,
    reasonCodes: VoiceActivationReadinessReasonCode[]
  ): VoiceActivationReadinessResult => ({
    ready,
    decision,
    reasonCodes,
    policyVersion: VOICE_ACTIVATION_READINESS_POLICY_VERSION,
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

  // RULE 5 — Compliance is mandatory
  if (input.complianceDecision !== 'ALLOWED') {
    return buildResult(false, 'BLOCKED', ['COMPLIANCE_NOT_ALLOWED']);
  }

  // RULE 6 — MOCK behavior in non-production
  if (input.voiceMode === 'MOCK') {
    if (input.environment !== 'production') {
      return buildResult(true, 'MOCK_ONLY', ['MOCK_ALLOWED_NON_PRODUCTION']);
    }
    return buildResult(false, 'BLOCKED', ['REAL_VOICE_REQUIRES_PRODUCTION']);
  }

  // RULE 7 — REAL voice is production-only
  if (input.voiceMode === 'REAL' && input.environment !== 'production') {
    return buildResult(false, 'BLOCKED', ['REAL_VOICE_REQUIRES_PRODUCTION']);
  }

  // RULE 8 — Explicit production enablement is mandatory for REAL voice
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

    // RULE 10 — Rollout enablement
    if (input.rolloutEnabled !== true) {
      return buildResult(false, 'BLOCKED', ['ROLLOUT_DISABLED']);
    }

    // RULE 11 — Rollout percentage check
    if (input.rolloutPercentage <= 0) {
      return buildResult(false, 'BLOCKED', ['ROLLOUT_PERCENTAGE_EXCEEDED']);
    }
    const bucket = computeRolloutBucket(input.tenantId, input.leadId);
    if (bucket >= input.rolloutPercentage) {
      return buildResult(false, 'BLOCKED', ['ROLLOUT_PERCENTAGE_EXCEEDED']);
    }

    // RULE 12 — Tenant rollout cap check
    if (
      input.maxRealCallsPerTenant > 0 &&
      input.realCallsForTenant >= input.maxRealCallsPerTenant
    ) {
      return buildResult(false, 'BLOCKED', ['TENANT_ROLLOUT_CAP_REACHED']);
    }

    // RULE 13 — Global rollout cap check
    if (
      input.maxRealCallsGlobal > 0 &&
      input.realCallsGlobal >= input.maxRealCallsGlobal
    ) {
      return buildResult(false, 'BLOCKED', ['GLOBAL_ROLLOUT_CAP_REACHED']);
    }

    // RULE 14 — Cost readiness check
    if (input.costCheckPassed !== true) {
      return buildResult(false, 'BLOCKED', ['COST_CAP_EXCEEDED']);
    }

    // RULE 15 — Provider health check
    if (input.providerHealthy !== true) {
      return buildResult(false, 'BLOCKED', ['PROVIDER_UNHEALTHY']);
    }

    // RULE 16 — Successful REAL readiness
    return buildResult(true, 'READY_FOR_CONTROLLED_REAL', []);
  }

  return buildResult(false, 'BLOCKED', ['REAL_VOICE_NOT_ENABLED']);
}
