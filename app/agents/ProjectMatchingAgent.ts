/**
 * Gemini Agent Interface: ProjectMatchingAgent
 *
 * Responsibilities:
 * Matches qualified buyers against controlled inventory/projects.
 * Evaluates budget overlap (25%), location affinity (25%), configuration compatibility (15%),
 * property type (10%), purpose (10%), timeline (5%), preferences (5%), project attributes (5%).
 *
 * Frozen Rule:
 * An AI project match is an algorithmically calculated fit — it does NOT automatically
 * become a confirmed buyer preference until explicitly acknowledged or accepted by the buyer.
 */

import { GFBuyerLead, Project, ProjectMatch } from '../schemas/buyerLead';

export interface ProjectMatchingInput {
  lead: GFBuyerLead;
  availableProjects: Project[];
  maxMatches?: number;
}

export interface ProjectMatchingOutput {
  lead_id: string;
  matched_projects: ProjectMatch[];
  preferred_project: {
    project_id: string | null;
    project_name: string | null;
    confidence: number;
    selection_basis: string;
  };
  matching_summary: string;
}

export interface ProjectMatchingAgent {
  readonly agentName: 'ProjectMatchingAgent';
  readonly version: string;

  matchBuyerToProjects(input: ProjectMatchingInput): Promise<ProjectMatchingOutput>;
}
