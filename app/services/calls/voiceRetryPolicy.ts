/**
 * GrowthForge Buyer Intelligence Engine - Voice Retry Policy (Phase 12.2)
 *
 * SPECIFICATION & INVARIANTS:
 * - Deterministic, rule-based call retry evaluation.
 * - MOCK_READY status does NOT consume a genuine outbound attempt.
 * - Distinguishes outcomes: PROVIDER_REJECTED, CALL_FAILED, NO_ANSWER, BUSY, COMPLETED, CONNECTED.
 * - Never retries blindly; respects max attempt limits (default 3) and produces deterministic idempotency keys:
 *   voice:{tenantId}:{leadId}:attempt:{attemptNumber}
 */

export interface VoiceRetryEvaluationInput {
  tenantId: string;
  leadId: string;
  attemptNumber: number;
  maxAttemptsAllowed?: number;
  lastCallStatus?: string | null;
  lastCallOutcome?: string | null;
  lastCallEndedAt?: string | null;
  cooldownMinutes?: number;
}

export interface VoiceRetryEvaluationResult {
  canRetry: boolean;
  reason: string;
  nextAttemptNumber: number;
  idempotencyKey: string;
  evaluatedAt: string;
}

export function evaluateVoiceRetryPolicy(
  input: VoiceRetryEvaluationInput
): VoiceRetryEvaluationResult {
  const evaluatedAt = new Date().toISOString();
  const maxAttempts = input.maxAttemptsAllowed ?? 3;
  const currentAttempt = Math.max(0, input.attemptNumber ?? 0);
  const status = (input.lastCallStatus || '').trim().toUpperCase();
  const outcome = (input.lastCallOutcome || '').trim().toUpperCase();

  // 1. MOCK_READY does not consume a real attempt
  if (status === 'MOCK_READY') {
    const nextAttemptNumber = currentAttempt > 0 ? currentAttempt : 1;
    return {
      canRetry: true,
      reason: 'MOCK_READY state does not consume genuine outbound call attempts.',
      nextAttemptNumber,
      idempotencyKey: `voice:${input.tenantId}:${input.leadId}:attempt:${nextAttemptNumber}`,
      evaluatedAt,
    };
  }

  // 2. Successful call outcomes -> do not retry
  if (
    status === 'CONNECTED' ||
    status === 'COMPLETED' ||
    outcome === 'CONNECTED' ||
    outcome === 'QUALIFIED' ||
    outcome === 'COMPLETED'
  ) {
    return {
      canRetry: false,
      reason: 'Call already reached connected or completed terminal state.',
      nextAttemptNumber: currentAttempt,
      idempotencyKey: `voice:${input.tenantId}:${input.leadId}:attempt:${currentAttempt}`,
      evaluatedAt,
    };
  }

  // 3. Max attempt limit reached
  if (currentAttempt >= maxAttempts) {
    return {
      canRetry: false,
      reason: `Maximum allowed call attempt limit (${maxAttempts}) reached for lead.`,
      nextAttemptNumber: currentAttempt,
      idempotencyKey: `voice:${input.tenantId}:${input.leadId}:attempt:${currentAttempt}`,
      evaluatedAt,
    };
  }

  // 4. Retryable failed or unanswered statuses
  const nextAttemptNumber = currentAttempt + 1;
  const idempotencyKey = `voice:${input.tenantId}:${input.leadId}:attempt:${nextAttemptNumber}`;

  if (
    status === 'PROVIDER_REJECTED' ||
    status === 'CALL_FAILED' ||
    status === 'NO_ANSWER' ||
    status === 'BUSY' ||
    status === 'FAILED' ||
    outcome === 'NO_ANSWER' ||
    outcome === 'BUSY' ||
    outcome === 'FAILED'
  ) {
    return {
      canRetry: true,
      reason: `Retry permitted for call status '${status || outcome}' (attempt ${nextAttemptNumber} of ${maxAttempts}).`,
      nextAttemptNumber,
      idempotencyKey,
      evaluatedAt,
    };
  }

  // Default initial attempt or safe fallback
  return {
    canRetry: true,
    reason: `Initial or standard retry permitted (attempt ${nextAttemptNumber} of ${maxAttempts}).`,
    nextAttemptNumber,
    idempotencyKey,
    evaluatedAt,
  };
}
