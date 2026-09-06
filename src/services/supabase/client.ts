/**
 * GrowthForge Supabase Client Abstraction
 * 
 * Re-exports canonical client factory, configurations, and health check from app/services/supabase/client.
 */

export {
  getSupabaseClient,
  getSupabaseConfig,
  checkPersistenceHealth,
  resetSupabaseClient,
  type BackendPersistenceMode,
  type PersistenceHealthStatus,
  type SupabaseConfig,
} from '../../../app/services/supabase/client';

import { getSupabaseConfig } from '../../../app/services/supabase/client';

export const isSupabaseConfigured = Boolean(
  getSupabaseConfig().url && getSupabaseConfig().key
);

