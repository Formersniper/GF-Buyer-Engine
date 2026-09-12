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
  safeDiagnostics?: {
    urlConfigured: boolean;
    keyConfigured: boolean;
    urlHost: string | null;
  };
}

export interface SupabaseConfig {
  url: string | null;
  key: string | null;
  host: string | null;
}

let cachedClient: SupabaseClient | null = null;

/**
 * Resolves client-safe Supabase credentials (URL and anon key only).
 * Never uses or exposes SUPABASE_SERVICE_ROLE_KEY in client bundle.
 */
export function getSupabaseConfig(): SupabaseConfig {
  let supabaseUrl: string | null = null;
  let supabaseKey: string | null = null;

  // 1. Browser / Vite client environment (import.meta.env)
  try {
    const metaEnv = typeof window !== 'undefined' ? (window as any).__VITE_ENV__ : undefined;
    if (metaEnv) {
      supabaseUrl = metaEnv.VITE_SUPABASE_URL || metaEnv.SUPABASE_URL || null;
      supabaseKey = metaEnv.VITE_SUPABASE_ANON_KEY || metaEnv.SUPABASE_ANON_KEY || null;
    }
  } catch {
    // Non-module environment
  }

  // 2. Node.js process environment (SSR, test runner, server)
  if ((!supabaseUrl || !supabaseKey) && typeof process !== 'undefined' && process.env) {
    supabaseUrl =
      supabaseUrl ||
      process.env.SUPABASE_URL ||
      process.env.VITE_SUPABASE_URL ||
      null;

    supabaseKey =
      supabaseKey ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY ||
      null;
  }

  // Clean empty or placeholder values
  if (supabaseUrl && (supabaseUrl.includes('your-project') || supabaseUrl.trim() === '')) {
    supabaseUrl = null;
  }
  if (supabaseKey && (supabaseKey.includes('your-anon-key') || supabaseKey.trim() === '')) {
    supabaseKey = null;
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

let cachedAdminClient: SupabaseClient | null = null;

/**
 * Returns a Supabase client configured with the service_role key for backend bypass operations.
 * Returns null if SUPABASE_SERVICE_ROLE_KEY is missing.
 */
export function getSupabaseAdminClient(): SupabaseClient | null {
  if (cachedAdminClient) {
    return cachedAdminClient;
  }

  const { url } = getSupabaseConfig();
  const serviceRoleKey = typeof process !== 'undefined' ? process.env.SUPABASE_SERVICE_ROLE_KEY : null;

  if (!url || !serviceRoleKey) {
    return null;
  }

  cachedAdminClient = createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return cachedAdminClient;
}

/**
 * Resets cached Supabase client (useful in testing or dynamic config changes)
 */
export function resetSupabaseClient(): void {
  cachedClient = null;
  cachedAdminClient = null;
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

  const safeDiagnostics = {
    urlConfigured: Boolean(url),
    keyConfigured: Boolean(key),
    urlHost: host,
  };

  if (!url || !key) {
    if (process.env.NODE_ENV === 'production') {
      return {
        mode: 'DISCONNECTED',
        displayName: 'Supabase Credentials Missing',
        urlHost: null,
        isLive: false,
        message: 'Supabase credentials are not configured in production environment. In-memory mode is prohibited.',
        lastChecked: now,
        safeDiagnostics,
      };
    }
    return {
      mode: 'IN_MEMORY',
      displayName: 'Preview / Local Development Mode',
      urlHost: null,
      isLive: false,
      message: 'AI Studio browser preview is using the local development store. Production/server persistence uses the configured Supabase backend.',
      lastChecked: now,
      safeDiagnostics,
    };
  }

  const client = getSupabaseClient();
  if (!client) {
    return {
      mode: 'DISCONNECTED',
      displayName: 'Supabase Connection Error',
      urlHost: host,
      isLive: false,
      message: 'Supabase credentials are configured, but the backend connection could not be verified.',
      lastChecked: now,
      safeDiagnostics,
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
        message: 'Supabase credentials are configured, but the backend connection could not be verified.',
        latencyMs,
        lastChecked: now,
        safeDiagnostics,
      };
    }

    return {
      mode: 'LIVE_SUPABASE',
      displayName: 'Live Supabase Backend',
      urlHost: host,
      isLive: true,
      message: `Connected to Supabase PostgreSQL (${count ?? 0} leads in public.leads).`,
      latencyMs,
      lastChecked: now,
      safeDiagnostics,
    };
  } catch (err: unknown) {
    return {
      mode: 'DISCONNECTED',
      displayName: 'Supabase Connection Error',
      urlHost: host,
      isLive: false,
      message: 'Supabase credentials are configured, but the backend connection could not be verified.',
      lastChecked: now,
      safeDiagnostics,
    };
  }
}
