/**
 * GrowthForge Scout Adapter Boundary
 * 
 * FROZEN ARCHITECTURE CONTRACT:
 * - Scout is located in /scout (Python repository).
 * - Do not rewrite Scout in TypeScript.
 * - Do not copy Scout scraper logic into frontend code.
 * - GrowthForge interacts with Scout exclusively through this adapter boundary.
 * - In Phase 1: Defines clean typed interfaces with explicit NotImplemented boundary.
 */

import { LeadEnrichmentRow } from '../supabase/repositories/types';
import { DataTruthLevel } from '../../types/buyerLead';

export interface ScoutProfileQuery {
  platform: 'linkedin' | 'twitter' | 'github' | 'instagram' | 'general';
  username?: string;
  fullName?: string;
  company?: string;
  email?: string;
  phone?: string;
}

export interface ScoutEnrichmentResult {
  platform: string;
  username: string | null;
  profile_url: string | null;
  full_name: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  raw_data: Record<string, unknown>;
  enriched_data: Record<string, unknown>;
  confidence: number;
  truth_level: DataTruthLevel; // 'INFERRED' or 'KNOWN'
}

export interface IScoutAdapter {
  /**
   * Scrapes an individual public profile through Scout Python subsystem
   */
  scrapeProfile(query: ScoutProfileQuery): Promise<ScoutEnrichmentResult>;

  /**
   * Enriches a lead using available identifiers (name, phone, email)
   */
  enrichLead(leadId: string, identifiers: { name: string; phone?: string; email?: string }): Promise<ScoutEnrichmentResult[]>;

  /**
   * Dispatches bulk enrichment jobs to Scout worker queue
   */
  bulkScrape(leads: Array<{ leadId: string; name: string; email?: string }>): Promise<{ jobId: string; totalQueued: number }>;
}

/**
 * Phase 1 Scout Adapter Implementation
 * Explicit NotImplemented Boundary for Phase 1
 */
export class ScoutAdapter implements IScoutAdapter {
  private scoutApiUrl: string;

  constructor(scoutApiUrl: string = 'http://localhost:8000') {
    this.scoutApiUrl = scoutApiUrl;
  }

  async scrapeProfile(_query: ScoutProfileQuery): Promise<ScoutEnrichmentResult> {
    throw new Error(
      '[Phase 1 Boundary] ScoutAdapter.scrapeProfile is scheduled for Phase 3 integration. ' +
      'Scout Python subsystem execution is not active in Phase 1.'
    );
  }

  async enrichLead(_leadId: string, _identifiers: { name: string; phone?: string; email?: string }): Promise<ScoutEnrichmentResult[]> {
    throw new Error(
      '[Phase 1 Boundary] ScoutAdapter.enrichLead is scheduled for Phase 3 integration. ' +
      'Scout Python subsystem execution is not active in Phase 1.'
    );
  }

  async bulkScrape(_leads: Array<{ leadId: string; name: string; email?: string }>): Promise<{ jobId: string; totalQueued: number }> {
    throw new Error(
      '[Phase 1 Boundary] ScoutAdapter.bulkScrape is scheduled for Phase 3 integration. ' +
      'Scout Python subsystem execution is not active in Phase 1.'
    );
  }
}

export const scoutAdapter = new ScoutAdapter();
