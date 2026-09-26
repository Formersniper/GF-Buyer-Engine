/**
 * GrowthForge Buyer Intelligence Engine - Controlled Real Voice Pilot Authorization (Phase 12.3)
 *
 * SPECIFICATION & INVARIANTS:
 * - Pure, deterministic, side-effect-free pilot authorization evaluator.
 * - ZERO database mutations, network calls, HTTP calls, or provider calls inside this module.
 * - Enforces explicit tenant matching, lead matching, tenant isolation, single-call limit caps (GLOBAL=1, TENANT=1),
 *   kill switch overrides, compliance/eligibility/authorization/readiness prerequisites, resource locks, and provider restrictions (Sarvam only).
 * - Fails closed on any missing, mismatched, ambiguous, or unconfirmed configuration.
 */

export const CONTROLLED_REAL_VOICE_PILOT_POLICY_VERSION = 'CONTROLLED_REAL_VOICE_PILOT_V1';

export type ControlledRealVoicePilotDecision =
  | 'PILOT_AUTHORIZED'
  | 'PILOT_BLOCKED';

export type ControlledRealVoicePilotReasonCode =
  | 'PILOT_DISABLED'
  | 'PILOT_AUTHORIZATION_MISSING'
  | 'PILOT_TENANT_NOT_CONFIGURED'
  | 'PILOT_LEAD_NOT_CONFIGURED'
  | 'PILOT_TENANT_MISMATCH'
  | 'PILOT_LEAD_MISMATCH'
  | 'PILOT_LEAD_TENANT_MISMATCH'
  | 'TENANT_CONTEXT_MISSING'
  | 'LEAD_CONTEXT_MISSING'
  | 'ELIGIBILITY_NOT_CONFIRMED'
  | 'COMPLIANCE_NOT_ALLOWED'
  | 'PRODUCTION_AUTHORIZATION_NOT_CONFIRMED'
  | 'ACTIVATION_READINESS_NOT_CONFIRMED'
  | 'GLOBAL_VOICE_KILL_SWITCH_ACTIVE'
  | 'PILOT_KILL_SWITCH_ACTIVE'
  | 'ROLLOUT_NOT_PERMITTED'
  | 'GLOBAL_REAL_CALL_LIMIT_REACHED'
  | 'TENANT_REAL_CALL_LIMIT_REACHED'
  | 'REAL_CALL_ALREADY_ACTIVE'
  | 'IDEMPOTENCY_CONFLICT'
  | 'RESOURCE_LOCK_CONFLICT'
  | 'PROVIDER_NOT_ALLOWED'
  | 'PROVIDER_UNHEALTHY'
  | 'REAL_VOICE_NOT_ENABLED';

export interface ControlledRealVoicePilotInput {
  environment: 'production' | 'development' | 'test';
  voiceMode: 'REAL' | 'MOCK';
  provider: string;
  tenantId?: string | null;
  leadId?: string | null;
  leadTenantId?: string | null;
  eligibilityDecision: string;
  complianceDecision: string;
  productionAuthDecision: string;
  activationReadinessDecision: string;
  globalKillSwitchActive: boolean;
  pilotKillSwitchActive: boolean;
  pilotEnabled: boolean;
  configuredPilotTenantId?: string | null;
  configuredPilotLeadId?: string | null;
  pilotMaxRealCallsGlobal: number;
  pilotMaxRealCallsPerTenant: number;
  currentRealCallsGlobalCount: number;
  currentRealCallsTenantCount: number;
  hasActiveCall?: boolean;
  hasLockConflict?: boolean;
  hasIdempotencyConflict?: boolean;
  providerHealthy: boolean;
  realProviderAllowlist?: string[];
}

export interface ControlledRealVoicePilotResult {
  authorized: boolean;
  decision: ControlledRealVoicePilotDecision;
  reasonCodes: ControlledRealVoicePilotReasonCode[];
  policyVersion: string;
  evaluatedAt: string;
  provider: string;
  mode: 'REAL' | 'MOCK';
  tenantId: string | null;
  leadId: string | null;
}

/**
 * Pure deterministic evaluation for Controlled Real Voice Pilot authorization.
 */
export function evaluateControlledRealVoicePilot(
  input: ControlledRealVoicePilotInput
): ControlledRealVoicePilotResult {
  const evaluatedAt = new Date().toISOString();
  const provider = input.provider;
  const mode = input.voiceMode;
  const tenantId = input.tenantId ?? null;
  const leadId = input.leadId ?? null;

  const buildResult = (
    authorized: boolean,
    decision: ControlledRealVoicePilotDecision,
    reasonCodes: ControlledRealVoicePilotReasonCode[]
  ): ControlledRealVoicePilotResult => ({
    authorized,
    decision,
    reasonCodes,
    policyVersion: CONTROLLED_REAL_VOICE_PILOT_POLICY_VERSION,
    evaluatedAt,
    provider,
    mode,
    tenantId,
    leadId,
  });

  // RULE 1 — Global Kill Switch wins
  if (input.globalKillSwitchActive === true) {
    return buildResult(false, 'PILOT_BLOCKED', ['GLOBAL_VOICE_KILL_SWITCH_ACTIVE']);
  }

  // RULE 2 — Pilot Kill Switch wins
  if (input.pilotKillSwitchActive === true) {
    return buildResult(false, 'PILOT_BLOCKED', ['PILOT_KILL_SWITCH_ACTIVE']);
  }

  // RULE 3 — Tenant context is mandatory
  if (!input.tenantId || input.tenantId.trim() === '') {
    return buildResult(false, 'PILOT_BLOCKED', ['TENANT_CONTEXT_MISSING']);
  }

  // RULE 4 — Lead context is mandatory
  if (!input.leadId || input.leadId.trim() === '') {
    return buildResult(false, 'PILOT_BLOCKED', ['LEAD_CONTEXT_MISSING']);
  }

  // RULE 5 — Tenant isolation: lead's tenant must match request tenant
  if (input.leadTenantId && input.leadTenantId.trim() !== input.tenantId.trim()) {
    return buildResult(false, 'PILOT_BLOCKED', ['PILOT_LEAD_TENANT_MISMATCH']);
  }

  // RULE 6 — Pilot mode must be explicitly enabled
  if (input.pilotEnabled !== true) {
    return buildResult(false, 'PILOT_BLOCKED', ['PILOT_DISABLED']);
  }

  // RULE 7 — Authoritative Pilot Tenant must be configured
  if (!input.configuredPilotTenantId || input.configuredPilotTenantId.trim() === '') {
    return buildResult(false, 'PILOT_BLOCKED', ['PILOT_TENANT_NOT_CONFIGURED']);
  }

  // RULE 8 — Authoritative Pilot Lead must be configured
  if (!input.configuredPilotLeadId || input.configuredPilotLeadId.trim() === '') {
    return buildResult(false, 'PILOT_BLOCKED', ['PILOT_LEAD_NOT_CONFIGURED']);
  }

  // RULE 9 — Request Tenant must match Configured Pilot Tenant
  if (input.tenantId.trim() !== input.configuredPilotTenantId.trim()) {
    return buildResult(false, 'PILOT_BLOCKED', ['PILOT_TENANT_MISMATCH']);
  }

  // RULE 10 — Request Lead must match Configured Pilot Lead
  if (input.leadId.trim() !== input.configuredPilotLeadId.trim()) {
    return buildResult(false, 'PILOT_BLOCKED', ['PILOT_LEAD_MISMATCH']);
  }

  // RULE 11 — Call Eligibility prerequisite
  if (input.eligibilityDecision !== 'ELIGIBLE') {
    return buildResult(false, 'PILOT_BLOCKED', ['ELIGIBILITY_NOT_CONFIRMED']);
  }

  // RULE 12 — Call Compliance prerequisite
  if (input.complianceDecision !== 'ALLOWED') {
    return buildResult(false, 'PILOT_BLOCKED', ['COMPLIANCE_NOT_ALLOWED']);
  }

  // RULE 13 — Production Voice Authorization prerequisite
  if (input.productionAuthDecision !== 'AUTHORIZED' && input.productionAuthDecision !== 'AUTHORIZED_MOCK') {
    return buildResult(false, 'PILOT_BLOCKED', ['PRODUCTION_AUTHORIZATION_NOT_CONFIRMED']);
  }

  // RULE 14 — Activation Readiness prerequisite
  if (input.activationReadinessDecision !== 'READY_FOR_CONTROLLED_REAL' && input.activationReadinessDecision !== 'MOCK_ONLY') {
    return buildResult(false, 'PILOT_BLOCKED', ['ACTIVATION_READINESS_NOT_CONFIRMED']);
  }

  // RULE 15 — Voice Mode must be REAL
  if (input.voiceMode !== 'REAL') {
    return buildResult(false, 'PILOT_BLOCKED', ['REAL_VOICE_NOT_ENABLED']);
  }

  // RULE 16 — Lock conflict protection
  if (input.hasLockConflict === true) {
    return buildResult(false, 'PILOT_BLOCKED', ['RESOURCE_LOCK_CONFLICT']);
  }

  // RULE 17 — Idempotency conflict protection
  if (input.hasIdempotencyConflict === true) {
    return buildResult(false, 'PILOT_BLOCKED', ['IDEMPOTENCY_CONFLICT']);
  }

  // RULE 18 — Active call concurrency protection
  if (input.hasActiveCall === true) {
    return buildResult(false, 'PILOT_BLOCKED', ['REAL_CALL_ALREADY_ACTIVE']);
  }

  // RULE 19 — Global real call ceiling
  if (
    input.pilotMaxRealCallsGlobal <= 0 ||
    input.currentRealCallsGlobalCount >= input.pilotMaxRealCallsGlobal
  ) {
    return buildResult(false, 'PILOT_BLOCKED', ['GLOBAL_REAL_CALL_LIMIT_REACHED']);
  }

  // RULE 20 — Tenant real call ceiling
  if (
    input.pilotMaxRealCallsPerTenant <= 0 ||
    input.currentRealCallsTenantCount >= input.pilotMaxRealCallsPerTenant
  ) {
    return buildResult(false, 'PILOT_BLOCKED', ['TENANT_REAL_CALL_LIMIT_REACHED']);
  }

  // RULE 21 — Provider restriction: Sarvam only and allowlisted
  const allowlist = (
    input.realProviderAllowlist && input.realProviderAllowlist.length > 0
      ? input.realProviderAllowlist
      : ['sarvam']
  ).map((p) => p.trim().toLowerCase());

  if (
    input.provider.trim().toLowerCase() !== 'sarvam' ||
    !allowlist.includes(input.provider.trim().toLowerCase())
  ) {
    return buildResult(false, 'PILOT_BLOCKED', ['PROVIDER_NOT_ALLOWED']);
  }

  // RULE 22 — Provider Health requirement
  if (input.providerHealthy !== true) {
    return buildResult(false, 'PILOT_BLOCKED', ['PROVIDER_UNHEALTHY']);
  }

  // RULE 23 — Fully Authorized Controlled Pilot
  return buildResult(true, 'PILOT_AUTHORIZED', []);
}
