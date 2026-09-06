/**
 * GrowthForge Buyer Intelligence Engine - Scout Public Enrichment Adapter
 *
 * SCOUT RULE:
 * Scout Python source will be mounted / executed in /scout.
 * Do NOT rewrite Scout into TypeScript.
 * Do NOT duplicate Scout scraper logic elsewhere.
 * GrowthForge communicates with Scout ONLY through this ScoutAdapter boundary.
 */

export interface ScoutEnrichmentQuery {
  phone?: string;
  email?: string;
  full_name?: string;
  city?: string;
  location?: string;
}

export interface ScoutSocialPresence {
  platform: 'linkedin' | 'twitter' | 'facebook' | 'github' | 'instagram' | 'other';
  url: string;
  handle?: string;
  bio?: string;
}

export interface ScoutEmploymentInfo {
  company?: string;
  title?: string;
  industry?: string;
  seniority?: string;
}

export interface ScoutEnrichmentResult {
  query: ScoutEnrichmentQuery;
  status: 'success' | 'partial' | 'not_found' | 'error';
  full_name?: string;
  residence?: string;
  location?: string;
  employment?: ScoutEmploymentInfo;
  social_presence?: ScoutSocialPresence[];
  public_records?: {
    director_records?: Array<{ company: string; din: string; appointed_date?: string }>;
    property_registrations?: Array<{ locality: string; year: string }>;
  };
  estimated_income_bracket?: string;
  data_confidence: number; // 0.0 - 1.0
  enriched_at: string;
  raw_payload?: Record<string, unknown>;
}

export interface ScoutAdapter {
  readonly adapterName: 'ScoutPythonAdapter';
  readonly version: string;

  /**
   * Dispatches an asynchronous or synchronous enrichment request to the Python Scout subprocess / microservice
   */
  enrichLead(query: ScoutEnrichmentQuery): Promise<ScoutEnrichmentResult>;

  /**
   * Checks the health and availability of the Scout Python runtime environment
   */
  checkHealth(): Promise<{ available: boolean; scout_version?: string; latency_ms: number }>;
}
