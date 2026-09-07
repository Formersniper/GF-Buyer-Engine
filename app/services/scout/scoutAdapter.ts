/**
 * GrowthForge Buyer Intelligence Engine - Scout Public Enrichment Adapter
 *
 * SCOUT RULE:
 * Scout Python source is mounted / executed in /scout.
 * Do NOT rewrite Scout into TypeScript.
 * Do NOT duplicate Scout scraper logic elsewhere.
 * GrowthForge communicates with Scout ONLY through this ScoutAdapter boundary.
 *
 * DATA-TRUTH RULE:
 * Scout-derived information represents public OSINT enrichment evidence (truth_level: 'INFERRED').
 * It must NEVER automatically overwrite confirmed buyer information (truth_level: 'CONFIRMED').
 * Provenance is strictly preserved.
 */

import { existsSync } from 'fs';
import { resolve } from 'path';
import { spawn } from 'child_process';

export type ScoutErrorCode =
  | 'SCOUT_UNAVAILABLE'
  | 'SCOUT_DEPENDENCY_ERROR'
  | 'SCOUT_EXECUTION_ERROR'
  | 'SCOUT_INVALID_OUTPUT'
  | 'SCOUT_TIMEOUT'
  | 'SCOUT_SUCCESS';

export interface ScoutEnrichmentQuery {
  phone?: string;
  email?: string;
  full_name?: string;
  city?: string;
  location?: string;
  usernames?: {
    instagram?: string;
    linkedin?: string;
    github?: string;
    twitter?: string;
    tiktok?: string;
    youtube?: string;
  };
}

export interface ScoutSocialPresence {
  platform: 'linkedin' | 'twitter' | 'facebook' | 'github' | 'instagram' | 'tiktok' | 'youtube' | 'other';
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
  bio?: string;
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
  error_code?: ScoutErrorCode;
  error_message?: string;
}

/**
 * Normalized Output Contract conforming to GrowthForge architecture
 */
export interface ScoutNormalizedOutput {
  source: 'scout';
  status: 'success' | 'partial' | 'not_found' | 'error';
  profiles: ScoutSocialPresence[];
  signals: Array<{ key: string; value: string; confidence: number }>;
  raw: Record<string, unknown>;
  confidence: number | null;
  truth_level: 'INFERRED';
  error_code?: ScoutErrorCode;
  error_message?: string;
}

export interface ScoutAdapterExecutionOptions {
  timeoutMs?: number;
  pythonBin?: string;
  customScript?: string;
  fixtureRaw?: Record<string, unknown>;
  mockOutput?: string;
}

export interface ScoutAdapter {
  readonly adapterName: 'ScoutPythonAdapter';
  readonly version: string;

  enrichLead(query: ScoutEnrichmentQuery, options?: ScoutAdapterExecutionOptions): Promise<ScoutEnrichmentResult>;

  checkHealth(): Promise<{
    available: boolean;
    scout_version?: string;
    latency_ms: number;
    error_code?: ScoutErrorCode;
    error_message?: string;
  }>;

  normalizeOutput(
    query: ScoutEnrichmentQuery,
    rawResult: Record<string, unknown>,
    status?: 'success' | 'partial' | 'not_found' | 'error',
    errorCode?: ScoutErrorCode,
    errorMessage?: string
  ): ScoutNormalizedOutput;

  executeDeterministicVerification(
    query: ScoutEnrichmentQuery,
    fixtureRaw: Record<string, unknown>
  ): Promise<ScoutNormalizedOutput>;
}

export class ScoutPythonAdapter implements ScoutAdapter {
  public readonly adapterName = 'ScoutPythonAdapter' as const;
  public readonly version = '1.0.0';

  private readonly scoutDirPath: string;

  constructor(customScoutPath?: string) {
    this.scoutDirPath = customScoutPath || resolve(process.cwd(), 'scout');
  }

  async checkHealth(): Promise<{
    available: boolean;
    scout_version?: string;
    latency_ms: number;
    error_code?: ScoutErrorCode;
    error_message?: string;
  }> {
    const startTime = Date.now();
    try {
      const scoutPyPath = resolve(this.scoutDirPath, 'scout.py');
      const requirementsPath = resolve(this.scoutDirPath, 'requirements.txt');
      const appInitPath = resolve(this.scoutDirPath, 'app', '__init__.py');

      if (!existsSync(scoutPyPath) || !existsSync(requirementsPath) || !existsSync(appInitPath)) {
        return {
          available: false,
          latency_ms: Date.now() - startTime,
          error_code: 'SCOUT_UNAVAILABLE',
          error_message: `Scout subsystem not found at ${this.scoutDirPath}`,
        };
      }

      return {
        available: true,
        scout_version: '2.0.0',
        latency_ms: Date.now() - startTime,
        error_code: 'SCOUT_SUCCESS',
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        available: false,
        latency_ms: Date.now() - startTime,
        error_code: 'SCOUT_EXECUTION_ERROR',
        error_message: msg,
      };
    }
  }

  normalizeOutput(
    query: ScoutEnrichmentQuery,
    rawResult: Record<string, unknown>,
    status: 'success' | 'partial' | 'not_found' | 'error' = 'success',
    errorCode: ScoutErrorCode = 'SCOUT_SUCCESS',
    errorMessage?: string
  ): ScoutNormalizedOutput {
    const profiles: ScoutSocialPresence[] = [];
    const signals: Array<{ key: string; value: string; confidence: number }> = [];

    const effectiveStatus = (rawResult.status as 'success' | 'partial' | 'not_found' | 'error') || status;

    if (rawResult.profiles && Array.isArray(rawResult.profiles)) {
      for (const p of rawResult.profiles) {
        if (typeof p === 'object' && p !== null) {
          const item = p as Record<string, unknown>;
          profiles.push({
            platform: (item.platform as ScoutSocialPresence['platform']) || 'other',
            url: String(item.url || ''),
            handle: item.handle ? String(item.handle) : undefined,
            bio: item.bio ? String(item.bio) : undefined,
          });
        }
      }
    }

    if (rawResult.social_presence && Array.isArray(rawResult.social_presence)) {
      for (const p of rawResult.social_presence) {
        if (typeof p === 'object' && p !== null) {
          const item = p as Record<string, unknown>;
          const platform = (item.platform as ScoutSocialPresence['platform']) || 'other';
          const url = String(item.url || '');
          if (!profiles.some((existing) => existing.url === url)) {
            profiles.push({
              platform,
              url,
              handle: item.handle ? String(item.handle) : undefined,
              bio: item.bio ? String(item.bio) : undefined,
            });
          }
        }
      }
    }

    const company = rawResult.company || (rawResult.employment && (rawResult.employment as Record<string, unknown>).company);
    if (company) {
      signals.push({
        key: 'employment_company',
        value: String(company),
        confidence: 0.85,
      });
    }

    const title = rawResult.title || (rawResult.employment && (rawResult.employment as Record<string, unknown>).title);
    if (title) {
      signals.push({
        key: 'employment_title',
        value: String(title),
        confidence: 0.85,
      });
    }

    if (rawResult.location || rawResult.residence) {
      signals.push({
        key: 'detected_location',
        value: String(rawResult.location || rawResult.residence),
        confidence: 0.75,
      });
    }

    if (rawResult.industry) {
      signals.push({
        key: 'employment_industry',
        value: String(rawResult.industry),
        confidence: 0.8,
      });
    }

    if (rawResult.seniority) {
      signals.push({
        key: 'seniority_level',
        value: String(rawResult.seniority),
        confidence: 0.8,
      });
    }

    const confidence = typeof rawResult.confidence === 'number'
      ? rawResult.confidence
      : typeof rawResult.data_confidence === 'number'
      ? rawResult.data_confidence
      : (effectiveStatus === 'success' ? 0.85 : effectiveStatus === 'partial' ? 0.6 : 0.0);

    return {
      source: 'scout',
      status: effectiveStatus,
      profiles,
      signals,
      raw: rawResult,
      confidence,
      truth_level: 'INFERRED',
      error_code: errorCode,
      error_message: errorMessage,
    };
  }

  async enrichLead(
    query: ScoutEnrichmentQuery,
    options?: ScoutAdapterExecutionOptions
  ): Promise<ScoutEnrichmentResult> {
    const health = await this.checkHealth();
    if (!health.available) {
      return {
        query,
        status: 'error',
        data_confidence: 0.0,
        enriched_at: new Date().toISOString(),
        error_code: health.error_code || 'SCOUT_UNAVAILABLE',
        error_message: health.error_message || 'Scout Python subsystem is not available at /scout',
      };
    }

    // Fixture Raw handling
    if (options?.fixtureRaw) {
      const fixtureStatus = (options.fixtureRaw.status as 'success' | 'partial' | 'not_found' | 'error') || 'success';
      const normalized = this.normalizeOutput(query, options.fixtureRaw, fixtureStatus, 'SCOUT_SUCCESS');
      const employmentObj = options.fixtureRaw.employment
        ? (options.fixtureRaw.employment as ScoutEmploymentInfo)
        : (options.fixtureRaw.company || options.fixtureRaw.title)
        ? {
            company: options.fixtureRaw.company as string,
            title: options.fixtureRaw.title as string,
            industry: options.fixtureRaw.industry as string,
            seniority: options.fixtureRaw.seniority as string,
          }
        : undefined;

      return {
        query,
        status: normalized.status,
        full_name: (options.fixtureRaw.full_name as string) || query.full_name,
        location: (options.fixtureRaw.location as string) || query.location || query.city,
        bio: options.fixtureRaw.bio as string,
        employment: employmentObj,
        social_presence: normalized.profiles,
        data_confidence: normalized.confidence || 0.85,
        enriched_at: new Date().toISOString(),
        raw_payload: options.fixtureRaw,
        error_code: 'SCOUT_SUCCESS',
      };
    }

    const timeoutMs = options?.timeoutMs || 15000;
    const pythonBin = options?.pythonBin || process.env.PYTHON_BIN || 'python3';

    const pythonBridgeScript = options?.customScript || `
import sys
import json
import os

try:
    sys.path.insert(0, ${JSON.stringify(this.scoutDirPath)})
    query_str = sys.stdin.read()
    query = json.loads(query_str) if query_str.strip() else {}

    from app.scrapers.enrichment import LeadEnricher

    hunter_key = os.environ.get('HUNTER_API_KEY', '').strip() or None
    enricher = LeadEnricher(hunter_key)

    lead_input = {
        'name': query.get('full_name'),
        'email': query.get('email'),
        'phone': query.get('phone'),
        'location': query.get('city') or query.get('location')
    }

    result = enricher.enrich_lead(lead_input)
    profiles = []

    usernames = query.get('usernames') or {}
    if usernames.get('github'):
        try:
            from app.scrapers.github import scrape_profile as scrape_gh
            gh_profile = scrape_gh(usernames['github'])
            if gh_profile:
                profiles.append({
                    'platform': 'github',
                    'url': f"https://github.com/{usernames['github']}",
                    'handle': usernames['github'],
                    'bio': gh_profile.get('bio')
                })
        except Exception:
            pass

    out_payload = {
        'status': 'success',
        'full_name': result.get('full_name') or query.get('full_name'),
        'email': result.get('email'),
        'phone': result.get('phone'),
        'company': result.get('company'),
        'title': result.get('title'),
        'location': result.get('location') or query.get('city') or query.get('location'),
        'bio': result.get('bio'),
        'profiles': profiles,
        'lead_score': result.get('lead_score', 75),
        'confidence': 0.85
    }

    print(json.dumps(out_payload))
    sys.exit(0)

except ModuleNotFoundError as e:
    sys.stderr.write(f"ModuleNotFoundError: {str(e)}\\n")
    sys.exit(2)
except ImportError as e:
    sys.stderr.write(f"ImportError: {str(e)}\\n")
    sys.exit(2)
except Exception as e:
    sys.stderr.write(f"ScoutExecutionError: {str(e)}\\n")
    sys.exit(1)
`;

    return new Promise<ScoutEnrichmentResult>((resolvePromise) => {
      let stdoutData = '';
      let stderrData = '';
      let isTimedOut = false;
      let isCompleted = false;

      const finishOnce = (result: ScoutEnrichmentResult) => {
        if (!isCompleted) {
          isCompleted = true;
          resolvePromise(result);
        }
      };

      try {
        const child = spawn(pythonBin, ['-c', pythonBridgeScript], {
          cwd: this.scoutDirPath,
          env: {
            ...process.env,
            PYTHONPATH: this.scoutDirPath,
          },
        });

        const timer = setTimeout(() => {
          isTimedOut = true;
          try {
            child.kill('SIGKILL');
          } catch {
            // Ignore kill errors
          }
          finishOnce({
            query,
            status: 'error',
            data_confidence: 0.0,
            enriched_at: new Date().toISOString(),
            error_code: 'SCOUT_TIMEOUT',
            error_message: `Scout enrichment subprocess timed out after ${timeoutMs}ms`,
          });
        }, timeoutMs);

        child.stdout.on('data', (chunk) => {
          stdoutData += chunk.toString();
        });

        child.stderr.on('data', (chunk) => {
          stderrData += chunk.toString();
        });

        child.on('error', (err) => {
          clearTimeout(timer);
          if (isTimedOut) return;
          finishOnce({
            query,
            status: 'error',
            data_confidence: 0.0,
            enriched_at: new Date().toISOString(),
            error_code: 'SCOUT_EXECUTION_ERROR',
            error_message: `Failed to spawn Python subprocess: ${err.message}`,
          });
        });

        child.on('close', (exitCode) => {
          clearTimeout(timer);
          if (isTimedOut) return;

          if (options?.mockOutput !== undefined) {
            stdoutData = options.mockOutput;
          }

          if (exitCode !== 0) {
            let errorCode: ScoutErrorCode = 'SCOUT_EXECUTION_ERROR';
            if (
              stderrData.includes('ModuleNotFoundError') ||
              stderrData.includes('ImportError') ||
              exitCode === 2
            ) {
              errorCode = 'SCOUT_DEPENDENCY_ERROR';
            }

            return finishOnce({
              query,
              status: 'error',
              data_confidence: 0.0,
              enriched_at: new Date().toISOString(),
              error_code: errorCode,
              error_message: stderrData.trim() || `Python process exited with code ${exitCode}`,
            });
          }

          try {
            const parsed = JSON.parse(stdoutData.trim());
            const normalized = this.normalizeOutput(query, parsed, parsed.status || 'success', 'SCOUT_SUCCESS');

            return finishOnce({
              query,
              status: normalized.status,
              full_name: (parsed.full_name as string) || query.full_name,
              location: (parsed.location as string) || query.location || query.city,
              bio: parsed.bio as string,
              employment: {
                company: (parsed.company as string) || undefined,
                title: (parsed.title as string) || undefined,
                industry: (parsed.industry as string) || undefined,
                seniority: (parsed.seniority as string) || undefined,
              },
              social_presence: normalized.profiles,
              data_confidence: normalized.confidence || 0.85,
              enriched_at: new Date().toISOString(),
              raw_payload: parsed,
              error_code: 'SCOUT_SUCCESS',
            });
          } catch (jsonErr: unknown) {
            const msg = jsonErr instanceof Error ? jsonErr.message : String(jsonErr);
            return finishOnce({
              query,
              status: 'error',
              data_confidence: 0.0,
              enriched_at: new Date().toISOString(),
              error_code: 'SCOUT_INVALID_OUTPUT',
              error_message: `Failed to parse Scout output as JSON: ${msg} (Output: ${stdoutData.slice(0, 100)})`,
            });
          }
        });

        child.stdin.write(JSON.stringify(query));
        child.stdin.end();
      } catch (spawnErr: unknown) {
        const msg = spawnErr instanceof Error ? spawnErr.message : String(spawnErr);
        finishOnce({
          query,
          status: 'error',
          data_confidence: 0.0,
          enriched_at: new Date().toISOString(),
          error_code: 'SCOUT_EXECUTION_ERROR',
          error_message: `Exception during process spawn: ${msg}`,
        });
      }
    });
  }

  async executeDeterministicVerification(
    query: ScoutEnrichmentQuery,
    fixtureRaw: Record<string, unknown>
  ): Promise<ScoutNormalizedOutput> {
    const health = await this.checkHealth();
    if (!health.available) {
      return this.normalizeOutput(
        query,
        {},
        'error',
        'SCOUT_UNAVAILABLE',
        'Scout subsystem unavailable'
      );
    }

    if (!fixtureRaw || Object.keys(fixtureRaw).length === 0) {
      return this.normalizeOutput(
        query,
        {},
        'not_found',
        'SCOUT_INVALID_OUTPUT',
        'Empty or invalid raw payload received'
      );
    }

    return this.normalizeOutput(query, fixtureRaw, 'success', 'SCOUT_SUCCESS');
  }
}

export const scoutAdapter = new ScoutPythonAdapter();
