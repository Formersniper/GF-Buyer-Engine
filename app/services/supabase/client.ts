/**
 * GrowthForge Buyer Intelligence Engine - Supabase Client Factory
 *
 * Provides a configured Supabase client instance with lazy initialization,
 * strict error reporting, and reliable health diagnostics.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

export type BackendPersistenceMode = 'LIVE_SUPABASE' | 'IN_MEMORY' | 'DISCONNECTED';

export interface PersistenceHealthStatus {
  mode: BackendPersistenceMode;
  displayName: string;
  urlHost: string | null;
  isLive: boolean;
  message?: string;
  latencyMs?: number;
  lastChecked: string;
}

export interface SupabaseConfig {
  url: string | null;
  key: string | null;
  host: string | null;
}

let cachedClient: SupabaseClient | null = null;

/**
 * Resolves Supabase credentials from Node.js process environment or Vite client meta env.
 */
export function getSupabaseConfig(): SupabaseConfig {
  let supabaseUrl: string | null = null;
  let supabaseKey: string | null = null;

  // 1. Node.js process environment (server & CLI test runner)
  if (typeof process !== 'undefined' && process.env) {
    supabaseUrl =
      process.env.SUPABASE_URL ||
      process.env.VITE_SUPABASE_URL ||
      null;

    supabaseKey =
      process.env.SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      null;
  }

  // 2. Browser / Vite import.meta.env
  if ((!supabaseUrl || !supabaseKey) && typeof import.meta !== 'undefined') {
    const metaEnv = (import.meta as unknown as { env?: Record<string, string> })?.env;
    if (metaEnv) {
      supabaseUrl = supabaseUrl || metaEnv.VITE_SUPABASE_URL || metaEnv.SUPABASE_URL || null;
      supabaseKey = supabaseKey || metaEnv.VITE_SUPABASE_ANON_KEY || metaEnv.SUPABASE_ANON_KEY || null;
    }
  }

  // Extract host only (never secrets)
  let host: string | null = null;
  if (supabaseUrl) {
    try {
      const parsed = new URL(supabaseUrl.startsWith('http') ? supabaseUrl : `https://${supabaseUrl}`);
      host = parsed.host;
    } catch {
      host = supabaseUrl.replace(/https?:\/\//, '').split('/')[0] || null;
    }
  }

  return { url: supabaseUrl, key: supabaseKey, host };
}

/**
 * Returns the active Supabase client instance or null if credentials are unconfigured.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (cachedClient) {
    return cachedClient;
  }

  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    return null;
  }

  cachedClient = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return cachedClient;
}

/**
 * Resets cached Supabase client (useful in testing or dynamic config changes)
 */
export function resetSupabaseClient(): void {
  cachedClient = null;
}

/**
 * Actively checks connection health against the Supabase database.
 * Distinguishes:
 *  - LIVE_SUPABASE: Successfully queried public.leads
 *  - IN_MEMORY: No credentials found, running in explicit development fallback
 *  - DISCONNECTED: Credentials provided but query failed (network, invalid key, RLS error, missing table)
 */
export async function checkPersistenceHealth(): Promise<PersistenceHealthStatus> {
  const { url, key, host } = getSupabaseConfig();
  const now = new Date().toISOString();

  if (!url || !key) {
    return {
      mode: 'IN_MEMORY',
      displayName: 'Local Development Store',
      urlHost: null,
      isLive: false,
      message: 'Supabase credentials not configured in environment. Operating in explicit Local Development Store mode.',
      lastChecked: now,
    };
  }

  const client = getSupabaseClient();
  if (!client) {
    return {
      mode: 'DISCONNECTED',
      displayName: 'Supabase Connection Error',
      urlHost: host,
      isLive: false,
      message: 'Failed to instantiate Supabase client with provided credentials.',
      lastChecked: now,
    };
  }

  const startTime = Date.now();
  try {
    // Attempt a lightweight HEAD count query on public.leads
    const { count, error } = await client
      .from('leads')
      .select('*', { count: 'exact', head: true });

    const latencyMs = Date.now() - startTime;

    if (error) {
      return {
        mode: 'DISCONNECTED',
        displayName: 'Supabase Connection Error',
        urlHost: host,
        isLive: false,
        message: `Supabase query failed on public.leads: ${error.message} (code: ${error.code || 'UNKNOWN'})`,
        latencyMs,
        lastChecked: now,
      };
    }

    return {
      mode: 'LIVE_SUPABASE',
      displayName: 'Supabase PostgreSQL',
      urlHost: host,
      isLive: true,
      message: `Connected to live Supabase database (${count ?? 0} leads in public.leads).`,
      latencyMs,
      lastChecked: now,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown network failure';
    return {
      mode: 'DISCONNECTED',
      displayName: 'Supabase Connection Error',
      urlHost: host,
      isLive: false,
      message: `Supabase connectivity error: ${errorMsg}`,
      lastChecked: now,
    };
  }
}
