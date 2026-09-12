import { supabaseDataService } from '../supabase/repositories';

export class ConcurrencyError extends Error {
  public statusCode = 429;
  constructor(message: string, public details: any) {
    super(message);
    this.name = 'ConcurrencyError';
  }
}

export class QuotaExceededError extends Error {
  public statusCode = 429;
  constructor(message: string, public details: any) {
    super(message);
    this.name = 'QuotaExceededError';
  }
}

let activeSarvamDispatches = 0;
let activeGeminiOps = 0;
let activeScoutOps = 0;

const inFlightDispatches = new Set<string>();
const completedDispatches = new Map<string, any>();
const dispatchPromises = new Map<string, Promise<any>>();

export const costAndConcurrencyControl = {
  getLimits() {
    return {
      maxSarvamHour: parseInt(process.env.MAX_SARVAM_CALLS_PER_TENANT_PER_HOUR || '25', 10),
      maxSarvamDay: parseInt(process.env.MAX_SARVAM_CALLS_PER_TENANT_PER_DAY || '100', 10),
      maxGeminiHour: parseInt(process.env.MAX_GEMINI_OPS_PER_TENANT_PER_HOUR || '200', 10),
      maxEnrichmentHour: parseInt(process.env.MAX_ENRICHMENTS_PER_TENANT_PER_HOUR || '100', 10),
      maxActiveSarvam: parseInt(process.env.MAX_ACTIVE_SARVAM_CALL_DISPATCHES || '10', 10),
      maxActiveGemini: parseInt(process.env.MAX_ACTIVE_GEMINI_OPERATIONS || '5', 10),
      maxActiveScout: parseInt(process.env.MAX_ACTIVE_SCOUT_OPERATIONS || '5', 10),
    };
  },

  async enforceTenantQuota(tenantId: string | null, operationType: 'sarvam' | 'gemini' | 'enrichment'): Promise<void> {
    const limits = this.getLimits();
    const targetId = tenantId || 'global-tenant';

    if (operationType === 'sarvam') {
      const hourRes = await supabaseDataService.security.checkAndIncrementRateLimit(targetId, 'sarvam_call_hourly', 3600, limits.maxSarvamHour);
      if (!hourRes.allowed) {
        throw new QuotaExceededError('Tenant hourly Sarvam call quota exceeded.', { tenantId: targetId, limit: limits.maxSarvamHour });
      }
      const dayRes = await supabaseDataService.security.checkAndIncrementRateLimit(targetId, 'sarvam_call_daily', 86400, limits.maxSarvamDay);
      if (!dayRes.allowed) {
        throw new QuotaExceededError('Tenant daily Sarvam call quota exceeded.', { tenantId: targetId, limit: limits.maxSarvamDay });
      }
    } else if (operationType === 'gemini') {
      const res = await supabaseDataService.security.checkAndIncrementRateLimit(targetId, 'gemini_op_hourly', 3600, limits.maxGeminiHour);
      if (!res.allowed) {
        throw new QuotaExceededError('Tenant hourly Gemini operation quota exceeded.', { tenantId: targetId, limit: limits.maxGeminiHour });
      }
    } else if (operationType === 'enrichment') {
      const res = await supabaseDataService.security.checkAndIncrementRateLimit(targetId, 'enrichment_hourly', 3600, limits.maxEnrichmentHour);
      if (!res.allowed) {
        throw new QuotaExceededError('Tenant hourly enrichment quota exceeded.', { tenantId: targetId, limit: limits.maxEnrichmentHour });
      }
    }
  },

  async withGeminiConcurrency<T>(fn: () => Promise<T>): Promise<T> {
    const limits = this.getLimits();
    if (activeGeminiOps >= limits.maxActiveGemini) {
      throw new ConcurrencyError('Global Gemini concurrency ceiling reached. Please retry shortly.', { active: activeGeminiOps, limit: limits.maxActiveGemini });
    }
    activeGeminiOps++;
    try {
      return await fn();
    } finally {
      activeGeminiOps = Math.max(0, activeGeminiOps - 1);
    }
  },

  async withScoutConcurrency<T>(leadId: string, tenantId: string | null, fn: () => Promise<T>): Promise<T> {
    const limits = this.getLimits();
    if (activeScoutOps >= limits.maxActiveScout) {
      throw new ConcurrencyError('Global Scout concurrency ceiling reached.', { active: activeScoutOps, limit: limits.maxActiveScout });
    }

    const locked = await supabaseDataService.security.acquireResourceLock('enrichment', leadId, tenantId, 'scout-worker', 300);
    if (!locked) {
      throw new ConcurrencyError('Enrichment already in progress for this lead.', { leadId });
    }

    activeScoutOps++;
    try {
      return await fn();
    } finally {
      activeScoutOps = Math.max(0, activeScoutOps - 1);
      await supabaseDataService.security.releaseResourceLock('enrichment', leadId, 'scout-worker');
    }
  },

  async withSarvamDispatchConcurrency<T>(leadId: string, tenantId: string | null, idempotencyKey: string, fn: () => Promise<T>): Promise<{ result: T; cached: boolean }> {
    const limits = this.getLimits();
    if (activeSarvamDispatches >= limits.maxActiveSarvam) {
      throw new ConcurrencyError('Global Sarvam dispatch concurrency ceiling reached.', { active: activeSarvamDispatches, limit: limits.maxActiveSarvam });
    }

    // Synchronously check completed
    if (completedDispatches.has(idempotencyKey)) {
      return { result: completedDispatches.get(idempotencyKey) as T, cached: true };
    }
    // Synchronously check in-flight promise
    if (dispatchPromises.has(idempotencyKey)) {
      const res = await dispatchPromises.get(idempotencyKey);
      return { result: res as T, cached: true };
    }

    let resolvePromise!: (val: T) => void;
    let rejectPromise!: (err: any) => void;
    const promise = new Promise<T>((res, rej) => {
      resolvePromise = res;
      rejectPromise = rej;
    });

    // Synchronously register promise before any await
    dispatchPromises.set(idempotencyKey, promise);

    activeSarvamDispatches++;
    try {
      // Check database idempotency
      let idempotencyRecord = await supabaseDataService.security.acquireIdempotency(tenantId, idempotencyKey, 'sarvam_dispatch', 86400);
      if (idempotencyRecord && idempotencyRecord.status === 'COMPLETED') {
        completedDispatches.set(idempotencyKey, idempotencyRecord.response_body);
        dispatchPromises.delete(idempotencyKey);
        resolvePromise(idempotencyRecord.response_body as T);
        return { result: idempotencyRecord.response_body as T, cached: true };
      }

      const result = await fn();
      await supabaseDataService.security.completeIdempotency(tenantId, idempotencyKey, 200, result);
      completedDispatches.set(idempotencyKey, result);
      dispatchPromises.delete(idempotencyKey);
      resolvePromise(result);
      return { result, cached: false };
    } catch (err: unknown) {
      dispatchPromises.delete(idempotencyKey);
      const errMsg = err instanceof Error ? err.message : String(err);
      await supabaseDataService.security.failIdempotency(tenantId, idempotencyKey, 500, { error: errMsg });
      rejectPromise(err);
      throw err;
    } finally {
      activeSarvamDispatches = Math.max(0, activeSarvamDispatches - 1);
    }
  }
};
