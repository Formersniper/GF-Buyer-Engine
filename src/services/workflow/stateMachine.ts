/**
 * GrowthForge Workflow State Machine Controller
 * 
 * FROZEN ARCHITECTURE CONTRACT:
 * - Application state transitions must be controlled by application logic, not arbitrary AI output.
 * - Enforces allowed state transitions and prevents illegal jumps.
 * - Logs all state transition events.
 */

import {
  WorkflowState,
  WORKFLOW_STATES,
  ALLOWED_TRANSITIONS,
  StandardWorkflowState,
  FailureWorkflowState,
} from '../../types/workflow';
import { GFBuyerLead } from '../../types/buyerLead';

export interface TransitionResult {
  success: boolean;
  fromState: WorkflowState;
  toState: WorkflowState;
  reason?: string;
  timestamp: string;
}

export class WorkflowStateMachine {
  /**
   * Validates if transition from currentState to targetState is strictly legal
   */
  static canTransition(fromState: WorkflowState, toState: WorkflowState): boolean {
    const allowed = ALLOWED_TRANSITIONS[fromState];
    if (!allowed) {
      return false;
    }
    return allowed.includes(toState);
  }

  /**
   * Executes a verified state transition on a canonical lead
   */
  static transitionLead(
    lead: GFBuyerLead,
    targetState: WorkflowState,
    eventDescription: string
  ): { lead: GFBuyerLead; result: TransitionResult } {
    const currentState = lead.workflow.status as WorkflowState;
    const now = new Date().toISOString();

    if (!this.canTransition(currentState, targetState)) {
      const errorMsg = `Illegal workflow transition attempted: cannot move from ${currentState} to ${targetState}`;
      return {
        lead,
        result: {
          success: false,
          fromState: currentState,
          toState: targetState,
          reason: errorMsg,
          timestamp: now,
        },
      };
    }

    const updatedLead: GFBuyerLead = {
      ...lead,
      workflow: {
        status: targetState,
        last_event: eventDescription,
        updated_at: now,
      },
    };

    return {
      lead: updatedLead,
      result: {
        success: true,
        fromState: currentState,
        toState: targetState,
        timestamp: now,
      },
    };
  }

  /**
   * Returns list of valid next states for current lead state
   */
  static getValidNextStates(currentState: WorkflowState): WorkflowState[] {
    return ALLOWED_TRANSITIONS[currentState] || [];
  }
}
