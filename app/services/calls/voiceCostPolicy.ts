/**
 * GrowthForge Buyer Intelligence Engine - Voice Cost Policy & Cost Readiness (Phase 12.2)
 *
 * SPECIFICATION & INVARIANTS:
 * - Deterministic, provider-independent cost readiness evaluation.
 * - Enforces per-call duration ceilings, per-call cost ceilings, and tenant daily/monthly budget caps.
 * - Clearly distinguishes estimated_cost, actual_cost (null unless provided by provider record), cost_source, and cost_currency ('INR').
 * - NEVER fabricates provider invoice data or charges.
 */

export interface VoiceCostAssessmentInput {
  tenantId: string;
  leadId: string;
  estimatedDurationSeconds?: number;
  currentTenantDailyCostINR?: number;
  currentTenantMonthlyCostINR?: number;
  maxCallDurationSeconds?: number;
  maxCallCostINR?: number;
  maxDailyCostINRPerTenant?: number;
  maxMonthlyCostINRPerTenant?: number;
}

export interface VoiceCostAssessmentResult {
  passed: boolean;
  estimatedCostINR: number;
  actualCostINR: number | null;
  costSource: 'ESTIMATE' | 'PROVIDER_RECORD' | 'NONE';
  costCurrency: 'INR';
  reasons: string[];
  evaluatedAt: string;
}

function parseEnvNumber(val: string | undefined, defaultVal: number): number {
  if (!val || val.trim() === '') return defaultVal;
  const parsed = Number(val.trim());
  return isNaN(parsed) || parsed < 0 ? defaultVal : parsed;
}

/**
 * Evaluates cost readiness for an outbound voice call dispatch.
 */
export function evaluateVoiceCostPolicy(
  input: VoiceCostAssessmentInput
): VoiceCostAssessmentResult {
  const evaluatedAt = new Date().toISOString();
  const reasons: string[] = [];

  const estDuration = input.estimatedDurationSeconds ?? 180; // default 3 min
  const maxDuration =
    input.maxCallDurationSeconds ??
    parseEnvNumber(process.env.VOICE_MAX_CALL_DURATION_SECONDS, 300);
  const maxCallCost =
    input.maxCallCostINR ??
    parseEnvNumber(process.env.VOICE_MAX_CALL_COST_INR, 50);
  const maxDailyCost =
    input.maxDailyCostINRPerTenant ??
    parseEnvNumber(process.env.VOICE_MAX_DAILY_COST_INR_PER_TENANT, 1000);
  const maxMonthlyCost =
    input.maxMonthlyCostINRPerTenant ??
    parseEnvNumber(process.env.VOICE_MAX_MONTHLY_COST_INR_PER_TENANT, 25000);

  const dailyCostCurrent = input.currentTenantDailyCostINR ?? 0;
  const monthlyCostCurrent = input.currentTenantMonthlyCostINR ?? 0;

  // Estimated rate: ~0.25 INR per second (~15 INR / min)
  const estimatedCostINR = Math.round(estDuration * 0.25 * 100) / 100;

  if (estDuration > maxDuration) {
    reasons.push(
      `Estimated call duration (${estDuration}s) exceeds maximum allowed call duration (${maxDuration}s).`
    );
  }

  if (estimatedCostINR > maxCallCost) {
    reasons.push(
      `Estimated call cost (${estimatedCostINR} INR) exceeds maximum per-call cost ceiling (${maxCallCost} INR).`
    );
  }

  if (dailyCostCurrent + estimatedCostINR > maxDailyCost) {
    reasons.push(
      `Tenant daily voice budget ceiling reached (${dailyCostCurrent} + ${estimatedCostINR} > ${maxDailyCost} INR).`
    );
  }

  if (monthlyCostCurrent + estimatedCostINR > maxMonthlyCost) {
    reasons.push(
      `Tenant monthly voice budget ceiling reached (${monthlyCostCurrent} + ${estimatedCostINR} > ${maxMonthlyCost} INR).`
    );
  }

  const passed = reasons.length === 0;

  return {
    passed,
    estimatedCostINR,
    actualCostINR: null, // Never fabricate provider charges
    costSource: passed ? 'ESTIMATE' : 'NONE',
    costCurrency: 'INR',
    reasons,
    evaluatedAt,
  };
}
