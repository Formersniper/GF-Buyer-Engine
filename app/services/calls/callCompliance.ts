/**
 * GrowthForge Buyer Intelligence Engine - Call Compliance Domain & Policy Engine
 *
 * PHASE 9.3.1 SPECIFICATION:
 * - Deterministic, configurable call-compliance policy.
 * - Explicit policy version: CALL_COMPLIANCE_V1
 * - Evaluates:
 *   1. Calling hours window (evaluated in lead/tenant policy timezone)
 *   2. Timezone conversion (Default: Asia/Kolkata)
 *   3. Cooldown between call attempts (Default: 4 hours / 240 minutes)
 *   4. Maximum lifetime call attempts (Default: 3 attempts)
 * - Invariant: Product defaults (09:00-20:00, 4h cooldown, 3 attempts) are configurable product policies,
 *   NOT hardcoded statutory requirements.
 * - Invariant: Zero external network/API/LLM calls. Pure deterministic domain boundary.
 */

export const CALL_COMPLIANCE_POLICY_VERSION = 'CALL_COMPLIANCE_V1';

export type CallComplianceDecision =
  | 'ALLOWED'
  | 'OUTSIDE_CALLING_HOURS'
  | 'COOLDOWN_ACTIVE'
  | 'MAX_ATTEMPTS_EXCEEDED';

export interface CallCompliancePolicyConfig {
  timezone?: string; // Default: 'Asia/Kolkata'
  callingWindowStart?: string; // 'HH:MM', default: '09:00' (inclusive)
  callingWindowEnd?: string; // 'HH:MM', default: '20:00' (exclusive)
  cooldownMinutes?: number; // Default: 240 minutes (4 hours)
  maxAttempts?: number; // Default: 3 attempts
  enforceCallingHours?: boolean; // Default: true (set to false for unit tests where hours should be bypassed)
}

export const DEFAULT_CALL_COMPLIANCE_CONFIG: Required<CallCompliancePolicyConfig> = {
  timezone: 'Asia/Kolkata',
  callingWindowStart: '09:00',
  callingWindowEnd: '20:00',
  cooldownMinutes: 240,
  maxAttempts: 3,
  enforceCallingHours: true,
};

export interface CallAttemptRecord {
  id?: string;
  tenant_id?: string | null;
  lead_id?: string;
  status?: string | null;
  started_at?: string | null;
  created_at: string;
  attempt_number?: number;
  provider?: string | null;
  call_metadata?: Record<string, unknown> | null;
}

export interface CallComplianceEvaluationInput {
  leadId: string;
  tenantId?: string | null;
  policyConfig?: CallCompliancePolicyConfig;
  callsHistory?: CallAttemptRecord[];
  evaluatedAt?: Date | string; // Deterministic clock injection
}

export interface CallComplianceResult {
  compliant: boolean;
  decision: CallComplianceDecision;
  reasons: string[];
  withinCallingHours: boolean;
  cooldownPassed: boolean;
  attemptsCount: number;
  maxAttempts: number;
  nextEligibleAt?: string | null;
  policyVersion: string;
}

/**
 * Call statuses that count as genuine caller attempts toward fatigue, cooldown, and attempt limits.
 * Excludes synthetic mock readiness probes where no network call occurred.
 */
export const ATTEMPT_CALL_STATUSES = new Set([
  'CALLING',
  'CONNECTED',
  'COMPLETED',
  'CALL_FAILED',
  'NO_ANSWER',
  'BUSY',
  'RINGING',
  'IN_PROGRESS',
  'FAILED',
  'UNANSWERED',
]);

/**
 * Determines whether a call record constitutes a genuine outbound attempt.
 */
export function isCallAttempt(call: CallAttemptRecord): boolean {
  if (!call) return false;

  // Synthetic mock probes without initiated dial do not count as contact attempts
  if (call.call_metadata && call.call_metadata.initiated === false) {
    return false;
  }
  if (call.status === 'MOCK_READY') {
    return false;
  }

  // Active or completed attempt statuses
  if (call.status && ATTEMPT_CALL_STATUSES.has(call.status.toUpperCase())) {
    return true;
  }

  // Explicitly initiated calls in metadata
  if (call.call_metadata && call.call_metadata.initiated === true) {
    return true;
  }

  // Any call with a recorded started_at
  if (call.started_at) {
    return true;
  }

  return false;
}

export interface ZonedTime {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  second: number; // 0-59
}

/**
 * Extracts local date/time parts in a target IANA timezone using standard Intl APIs.
 */
export function getZonedTime(date: Date, timeZone: string): ZonedTime {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }

  return {
    year: parseInt(map.year, 10),
    month: parseInt(map.month, 10),
    day: parseInt(map.day, 10),
    hour: parseInt(map.hour, 10) % 24,
    minute: parseInt(map.minute, 10),
    second: parseInt(map.second, 10),
  };
}

/**
 * Reconstructs a UTC Date corresponding to a specific local year, month, day, hour, minute in an IANA timezone.
 */
export function createDateInTimezone(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  for (let i = 0; i < 2; i++) {
    const z = getZonedTime(guess, timeZone);
    const zMs = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second);
    const targetMs = Date.UTC(year, month - 1, day, hour, minute, 0);
    const diff = targetMs - zMs;
    if (diff === 0) break;
    guess = new Date(guess.getTime() + diff);
  }
  return guess;
}

/**
 * Evaluates the call-compliance policy for a lead against calling window, timezone,
 * cooldown period, and lifetime attempt caps.
 */
export function evaluateCallCompliance(input: CallComplianceEvaluationInput): CallComplianceResult {
  const config: Required<CallCompliancePolicyConfig> = {
    timezone: input.policyConfig?.timezone || DEFAULT_CALL_COMPLIANCE_CONFIG.timezone,
    callingWindowStart: input.policyConfig?.callingWindowStart || DEFAULT_CALL_COMPLIANCE_CONFIG.callingWindowStart,
    callingWindowEnd: input.policyConfig?.callingWindowEnd || DEFAULT_CALL_COMPLIANCE_CONFIG.callingWindowEnd,
    cooldownMinutes: input.policyConfig?.cooldownMinutes !== undefined
      ? input.policyConfig.cooldownMinutes
      : DEFAULT_CALL_COMPLIANCE_CONFIG.cooldownMinutes,
    maxAttempts: input.policyConfig?.maxAttempts !== undefined
      ? input.policyConfig.maxAttempts
      : DEFAULT_CALL_COMPLIANCE_CONFIG.maxAttempts,
    enforceCallingHours: input.policyConfig?.enforceCallingHours !== undefined
      ? input.policyConfig.enforceCallingHours
      : DEFAULT_CALL_COMPLIANCE_CONFIG.enforceCallingHours,
  };

  const evalDate = input.evaluatedAt
    ? (typeof input.evaluatedAt === 'string' ? new Date(input.evaluatedAt) : input.evaluatedAt)
    : new Date();

  // 1. Evaluate Calling Hours in configured timezone
  const [startH, startM] = config.callingWindowStart.split(':').map((v) => parseInt(v, 10));
  const [endH, endM] = config.callingWindowEnd.split(':').map((v) => parseInt(v, 10));
  const startTotalMinutes = startH * 60 + startM;
  const endTotalMinutes = endH * 60 + endM;

  const z = getZonedTime(evalDate, config.timezone);
  const currentTotalMinutes = z.hour * 60 + z.minute;

  // Semantics: callingWindowStart inclusive, callingWindowEnd exclusive (e.g., 09:00:00 inclusive to 19:59:59 inclusive)
  let withinCallingHours = true;
  let nextWindowOpening: Date | null = null;

  if (config.enforceCallingHours) {
    withinCallingHours = currentTotalMinutes >= startTotalMinutes && currentTotalMinutes < endTotalMinutes;

    if (!withinCallingHours) {
      if (currentTotalMinutes < startTotalMinutes) {
        // Window opens today at callingWindowStart
        nextWindowOpening = createDateInTimezone(z.year, z.month, z.day, startH, startM, config.timezone);
      } else {
        // Window already closed today; next window opens tomorrow at callingWindowStart
        const tomorrowUtc = new Date(Date.UTC(z.year, z.month - 1, z.day + 1, 0, 0, 0));
        const zTomorrow = getZonedTime(tomorrowUtc, config.timezone);
        nextWindowOpening = createDateInTimezone(
          zTomorrow.year,
          zTomorrow.month,
          zTomorrow.day,
          startH,
          startM,
          config.timezone
        );
      }
    }
  }

  // 2. Filter Call History for Tenant Scoping and Attempt Qualification
  const rawHistory = input.callsHistory || [];
  const validAttempts: { call: CallAttemptRecord; timestamp: Date }[] = [];

  for (const call of rawHistory) {
    // Tenant Isolation Guard: ignore call history records belonging to a different tenant
    if (input.tenantId && call.tenant_id && call.tenant_id !== input.tenantId) {
      continue;
    }

    if (isCallAttempt(call)) {
      const ts = new Date(call.started_at || call.created_at);
      if (!isNaN(ts.getTime())) {
        validAttempts.push({ call, timestamp: ts });
      }
    }
  }

  // Sort attempts descending (most recent first)
  validAttempts.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  const attemptsCount = validAttempts.length;

  // 3. Evaluate Maximum Lifetime Attempts
  const maxAttemptsExceeded = attemptsCount >= config.maxAttempts;

  // 4. Evaluate Cooldown from Most Recent Attempt
  let cooldownPassed = true;
  let cooldownExpiry: Date | null = null;

  if (validAttempts.length > 0) {
    const mostRecent = validAttempts[0];
    const elapsedMs = evalDate.getTime() - mostRecent.timestamp.getTime();
    const cooldownMs = config.cooldownMinutes * 60 * 1000;

    if (elapsedMs < cooldownMs) {
      cooldownPassed = false;
      cooldownExpiry = new Date(mostRecent.timestamp.getTime() + cooldownMs);
    }
  }

  // 5. Synthesize Decision & Machine-Readable Reasons
  const reasons: string[] = [];

  if (maxAttemptsExceeded) {
    reasons.push(
      `Maximum call attempts limit reached (${attemptsCount} of ${config.maxAttempts}). Further outbound calling is blocked.`
    );
    return {
      compliant: false,
      decision: 'MAX_ATTEMPTS_EXCEEDED',
      reasons,
      withinCallingHours,
      cooldownPassed,
      attemptsCount,
      maxAttempts: config.maxAttempts,
      nextEligibleAt: null, // Exhausted, no further attempts permitted
      policyVersion: CALL_COMPLIANCE_POLICY_VERSION,
    };
  }

  if (!withinCallingHours || !cooldownPassed) {
    let nextEligibleMs = 0;

    if (!withinCallingHours) {
      reasons.push(
        `Current time is outside the configured calling window (${config.callingWindowStart}–${config.callingWindowEnd} in ${config.timezone}).`
      );
      if (nextWindowOpening) {
        nextEligibleMs = Math.max(nextEligibleMs, nextWindowOpening.getTime());
      }
    }

    if (!cooldownPassed && cooldownExpiry) {
      reasons.push(
        `Call attempt cooldown is currently active. Minimum interval of ${config.cooldownMinutes} minutes required between attempts.`
      );
      nextEligibleMs = Math.max(nextEligibleMs, cooldownExpiry.getTime());
    }

    // Determine primary decision code
    const decision: CallComplianceDecision = !cooldownPassed
      ? 'COOLDOWN_ACTIVE'
      : 'OUTSIDE_CALLING_HOURS';

    return {
      compliant: false,
      decision,
      reasons,
      withinCallingHours,
      cooldownPassed,
      attemptsCount,
      maxAttempts: config.maxAttempts,
      nextEligibleAt: nextEligibleMs > 0 ? new Date(nextEligibleMs).toISOString() : null,
      policyVersion: CALL_COMPLIANCE_POLICY_VERSION,
    };
  }

  // All compliance checks passed
  reasons.push(
    `Call compliance verified: within calling hours (${config.timezone}), cooldown period satisfied, and attempt count (${attemptsCount}/${config.maxAttempts}) within threshold.`
  );

  return {
    compliant: true,
    decision: 'ALLOWED',
    reasons,
    withinCallingHours: true,
    cooldownPassed: true,
    attemptsCount,
    maxAttempts: config.maxAttempts,
    nextEligibleAt: evalDate.toISOString(),
    policyVersion: CALL_COMPLIANCE_POLICY_VERSION,
  };
}
