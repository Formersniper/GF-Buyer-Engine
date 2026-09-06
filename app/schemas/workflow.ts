/**
 * GrowthForge Buyer Intelligence Engine - Workflow State Machine Definitions
 *
 * Architecture Invariant:
 * AI reasoning must NOT directly control workflow state transitions.
 * State transitions are strictly controlled by authoritative application code.
 */

// 16 Canonical Workflow Pipeline Stages
export const CANONICAL_WORKFLOW_STATES = [
  'RAW',
  'RESOLVED',
  'ENRICHING',
  'ENRICHED',
  'CALL_ELIGIBILITY',
  'CALL_PENDING',
  'CALLING',
  'CONNECTED',
  'QUALIFICATION_IN_PROGRESS',
  'QUALIFIED',
  'SCORED',
  'HOT',
  'WARM',
  'NURTURE',
  'PROJECT_MATCHED',
  'HANDOFF',
] as const;

// 6 Canonical Failure / Exception States
export const FAILURE_WORKFLOW_STATES = [
  'ENRICHMENT_FAILED',
  'CALL_FAILED',
  'NO_ANSWER',
  'INVALID_CONTACT',
  'QUALIFICATION_FAILED',
  'REQUIRES_REVIEW',
] as const;

export type CanonicalWorkflowState = (typeof CANONICAL_WORKFLOW_STATES)[number];
export type FailureWorkflowState = (typeof FAILURE_WORKFLOW_STATES)[number];
export type WorkflowStatus = CanonicalWorkflowState | FailureWorkflowState;

export interface WorkflowTransitionRule {
  from: WorkflowStatus;
  to: WorkflowStatus[];
  allowedActor: 'system' | 'application_service' | 'human_operator';
  requiredGuards: string[];
}
