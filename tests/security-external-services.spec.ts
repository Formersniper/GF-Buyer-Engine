// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../app/services/supabase/client', () => ({
  getSupabaseClient: () => null,
  resetSupabaseClient: () => {}
}));
import { SupabaseDataService } from '../app/services/supabase/repositories';
import { RealGeminiExtractionProvider } from '../app/services/gemini/geminiExtractionProvider';
import { ExternalProviderError, ExternalProviderErrorType } from '../app/services/errors';
import { scoutAdapter } from '../app/services/scout/scoutAdapter';
import { resetSupabaseClient } from '../app/services/supabase/client';

describe('External Service Safeguards', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('Supabase: Fail Closed in production on missing persistence', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.VITE_SUPABASE_ANON_KEY;
    if (typeof import.meta !== 'undefined' && ((import.meta) as any).env) {
      ((import.meta) as any).env.VITE_SUPABASE_URL = '';
      ((import.meta) as any).env.SUPABASE_URL = '';
      ((import.meta) as any).env.VITE_SUPABASE_ANON_KEY = '';
      ((import.meta) as any).env.SUPABASE_ANON_KEY = '';
    }
    
    resetSupabaseClient();
    const repo = new SupabaseDataService();
    // Leads store fallback should throw
    await expect(repo.leads.getLead({ isPlatformAdmin: true }, 'test-id')).rejects.toThrow(/In-memory persistence fallback is strictly disabled in production/);
  });

  it('Gemini: Missing API Key fails closed', () => {
    delete process.env.GEMINI_API_KEY;
    const provider = new RealGeminiExtractionProvider();
    expect(() => (provider as any).getClient()).toThrow(ExternalProviderError);
    try {
      (provider as any).getClient();
    } catch (err: any) {
      expect(err.type).toBe(ExternalProviderErrorType.CONFIGURATION);
    }
  });

  it('Scout: Does not mark preferences as CONFIRMED', () => {
    const output = scoutAdapter.normalizeOutput(
      { full_name: 'Test' },
      { profiles: [{ platform: 'github', url: 'https://github.com' }] },
      'success',
      'SCOUT_SUCCESS'
    );
    expect(output.truth_level).toBe('INFERRED');
    expect(output.truth_level).not.toBe('CONFIRMED');
  });
});
