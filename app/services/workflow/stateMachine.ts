/**
 * GrowthForge Buyer Intelligence Engine - Workflow State Machine
 *
 * Enforces Architectural Rules:
 * 1. AI reasoning must NOT directly control workflow state transitions.
 * 2. State transitions are strictly validated and executed by application code.
 * 3. All valid transitions between the 16 canonical stages and 6 failure states
 *    are explicitly guarded.
 */

import {
  WorkflowStatus,
  CANONICAL_WORKFLOW_STATES,
  FAILURE_WORKFLOW_STATES,
} from '../../schemas/workflow';

export class WorkflowTransitionError extends Error {
  constructor(
    public readonly fromStatus: WorkflowStatus | string,
    public readonly toStatus: WorkflowStatus | string,
    public readonly reason: string
  ) {
    super(`Invalid workflow transition from "${fromStatus}" to "${toStatus}": ${reason}`);
    this.name = 'WorkflowTransitionError';
  }
}

// Authoritative transition mapping
const VALID_TRANSITIONS: Record<string, string[]> = {
  RAW: ['RESOLVED', 'INVALID_CONTACT', 'REQUIRES_REVIEW'],
  RESOLVED: ['ENRICHING', 'ENRICHED', 'CALL_ELIGIBILITY', 'ENRICHMENT_FAILED', 'REQUIRES_REVIEW'],
  ENRICHING: ['ENRICHED', 'ENRICHMENT_FAILED', 'REQUIRES_REVIEW'],
  ENRICHED: ['CALL_ELIGIBILITY', 'QUALIFIED', 'REQUIRES_REVIEW'],
  CALL_ELIGIBILITY: ['CALL_PENDING', 'NURTURE', 'REQUIRES_REVIEW', 'CALLING', 'CALL_FAILED'],
  CALL_PENDING: ['CALLING', 'CALL_FAILED', 'NO_ANSWER', 'REQUIRES_REVIEW'],
  CALLING: ['CONNECTED', 'NO_ANSWER', 'CALL_FAILED', 'REQUIRES_REVIEW'],
  CONNECTED: ['QUALIFICATION_IN_PROGRESS', 'QUALIFIED', 'QUALIFICATION_FAILED', 'REQUIRES_REVIEW'],
  QUALIFICATION_IN_PROGRESS: ['QUALIFIED', 'QUALIFICATION_FAILED', 'REQUIRES_REVIEW'],
  QUALIFIED: ['SCORED', 'HOT', 'WARM', 'NURTURE', 'REQUIRES_REVIEW'],
  SCORED: ['HOT', 'WARM', 'NURTURE', 'PROJECT_MATCHED', 'REQUIRES_REVIEW'],
  HOT: ['PROJECT_MATCHED', 'HANDOFF', 'REQUIRES_REVIEW'],
  WARM: ['PROJECT_MATCHED', 'HANDOFF', 'REQUIRES_REVIEW'],
  NURTURE: ['PROJECT_MATCHED', 'CALL_PENDING', 'HANDOFF', 'REQUIRES_REVIEW'],
  PROJECT_MATCHED: ['HANDOFF', 'REQUIRES_REVIEW'],
  HANDOFF: ['REQUIRES_REVIEW'],

  // Failure states can transition to retry or review
  ENRICHMENT_FAILED: ['ENRICHING', 'CALL_ELIGIBILITY', 'REQUIRES_REVIEW'],
  CALL_FAILED: ['CALL_PENDING', 'CALLING', 'REQUIRES_REVIEW'],
  NO_ANSWER: ['CALL_PENDING', 'CALLING', 'REQUIRES_REVIEW', 'NURTURE'],
  INVALID_CONTACT: ['RESOLVED', 'REQUIRES_REVIEW'],
  QUALIFICATION_FAILED: ['CALL_PENDING', 'REQUIRES_REVIEW', 'NURTURE'],
  REQUIRES_REVIEW: CANONICAL_WORKFLOW_STATES as unknown as string[],
};

export class WorkflowStateMachine {
  /**
   * Evaluates whether a proposed state transition is valid under the state machine contract
   */
  public static canTransition(currentStatus: string, nextStatus: string): boolean {
    const allowed = VALID_TRANSITIONS[currentStatus];
    if (!allowed) {
      return false;
    }
    return allowed.includes(nextStatus);
  }

  /**
   * Asserts and executes a validated state transition
   */
  public static validateTransition(
    currentStatus: string,
    nextStatus: string,
    actor: 'system' | 'application_code' | 'operator' = 'application_code'
  ): void {
    if (currentStatus === nextStatus) {
      return; // No-op idempotent transition
    }

    if (!this.canTransition(currentStatus, nextStatus)) {
      throw new WorkflowTransitionError(
        currentStatus,
        nextStatus,
        `Transition not permitted from state "${currentStatus}". Actor "${actor}" attempted unauthorized transition.`
      );
    }
  }

  /**
   * Returns list of reachable states from current status
   */
  public static getNextAllowedStates(currentStatus: string): string[] {
    return VALID_TRANSITIONS[currentStatus] || [];
  }

  /**
   * Returns true if status is an active terminal handoff
   */
  public static isCompleted(status: string): boolean {
    return status === 'HANDOFF';
  }

  /**
   * Returns true if status is an error or exception condition
   */
  public static isFailure(status: string): boolean {
    return (FAILURE_WORKFLOW_STATES as readonly string[]).includes(status);
  }
}
