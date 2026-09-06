/**
 * GrowthForge Buyer Intelligence Engine - Supabase Client Factory
 *
 * Provides a configured Supabase client instance with lazy initialization
 * and graceful fallback handling for Phase 0 architectural validation.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

let cachedClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (cachedClient) {
    return cachedClient;
  }

  const supabaseUrl =
    typeof process !== 'undefined' && process.env?.SUPABASE_URL
      ? process.env.SUPABASE_URL
      : typeof import.meta !== 'undefined' && (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_SUPABASE_URL;

  const supabaseAnonKey =
    typeof process !== 'undefined' && process.env?.SUPABASE_ANON_KEY
      ? process.env.SUPABASE_ANON_KEY
      : typeof import.meta !== 'undefined' && (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    // Return null in Phase 0 if environment credentials are not yet linked
    return null;
  }

  cachedClient = createClient(supabaseUrl, supabaseAnonKey);
  return cachedClient;
}
