/**
 * GrowthForge Buyer Intelligence Engine - Matching Agent (Phase 5E)
 *
 * Source of Truth: Formersniper/GF-Buyer-Engine
 * Responsible for controlled semantic normalization (e.g. normalizing colloquial synonyms like
 * "farmhouse" vs "farm house", "3bhk" vs "3 BHK", "sector 63" vs "Sec 63") and executing
 * deterministic project recommendations without hallucinating unverified catalog items or
 * violating hard buyer boundaries.
 */

import { ProjectRecommendation, ProjectMatchingResult, MATCHING_RULE_VERSION, PROJECT_CATALOG_VERSION } from '../schemas/matching';
import { projectMatchingService, ProjectMatchingService } from '../services/matching/projectMatchingService';

export class MatchingAgent {
  private service: ProjectMatchingService;

  constructor(service: ProjectMatchingService = projectMatchingService) {
    this.service = service;
  }

  /**
   * Evaluates project catalog against qualified buyer profile and outputs explainable recommendations.
   */
  public async generateRecommendations(
    leadId: string,
    options?: {
      qualificationId?: string;
      forceRematch?: boolean;
    }
  ): Promise<ProjectMatchingResult> {
    return this.service.matchBuyerRequirements({
      leadId,
      qualificationId: options?.qualificationId,
      forceRematch: options?.forceRematch,
      ruleVersion: MATCHING_RULE_VERSION,
      catalogVersion: PROJECT_CATALOG_VERSION,
    });
  }

  /**
   * Semantic normalizer for terminology queries.
   */
  public normalizeSearchTerm(term: string): string {
    const t = term.toLowerCase().trim();
    if (t === 'farmhouse' || t === 'farm-house' || t === 'farm house') return 'Farm House';
    if (t === '3bhk' || t === '3-bhk') return '3 BHK';
    if (t === '4bhk' || t === '4-bhk') return '4 BHK';
    if (t === '2bhk' || t === '2-bhk') return '2 BHK';
    if (t.includes('chatti kila') || t.includes('chhati qila')) return 'Chatti Kila Road';
    return term;
  }
}

export const matchingAgent = new MatchingAgent();
