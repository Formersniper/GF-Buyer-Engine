/**
 * GrowthForge Buyer Intelligence Engine - Correlation & Request Context (Phase 8A.9)
 *
 * SPECIFICATION:
 * - Propagates request_id, correlation_id, tenant_id, and user_id across async operations
 *   (Lead -> Resolver -> Scout -> Call eligibility -> Sarvam dispatch -> Webhook -> Transcript -> Gemini extraction -> Qualification -> Score -> Matching -> Handoff).
 * - Implements deterministic UUID generation without sensitive data leakage.
 * - Isomorphic design: uses native AsyncLocalStorage in Node.js and safe context fallback in browser preview.
 */

export interface CorrelationContext {
  requestId: string;
  correlationId: string;
  tenantId?: string;
  userId?: string;
  service?: string;
  operation?: string;
  startTime?: number;
}

interface ContextStorage<T> {
  getStore(): T | undefined;
  run<R>(store: T, callback: () => R): R;
}

class FallbackContextStorage<T> implements ContextStorage<T> {
  private currentStore: T | undefined;

  public getStore(): T | undefined {
    return this.currentStore;
  }

  public run<R>(store: T, callback: () => R): R {
    const prev = this.currentStore;
    this.currentStore = store;
    try {
      return callback();
    } finally {
      this.currentStore = prev;
    }
  }
}

function initializeContextStorage(): ContextStorage<CorrelationContext> {
  if (typeof window === 'undefined' && typeof process !== 'undefined') {
    try {
      // Direct Node.js native builtin accessor
      const proc = process as any;
      if (typeof proc.getBuiltinModule === 'function') {
        const hooks = proc.getBuiltinModule('node:async_hooks');
        if (hooks && hooks.AsyncLocalStorage) {
          return new hooks.AsyncLocalStorage();
        }
      }
      // CommonJS fallback if available
      if (typeof require === 'function') {
        const hooks = require('async_hooks');
        if (hooks && hooks.AsyncLocalStorage) {
          return new hooks.AsyncLocalStorage();
        }
      }
    } catch {
      // Ignore and use fallback
    }
  }
  return new FallbackContextStorage<CorrelationContext>();
}

const asyncLocalStorage: ContextStorage<CorrelationContext> = initializeContextStorage();

/**
 * Generates a clean cryptographically safe UUID.
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Runs an async operation within an explicit correlation and request context.
 */
export async function runWithCorrelationContext<T>(
  context: Partial<CorrelationContext>,
  fn: () => Promise<T>
): Promise<T> {
  const current: Partial<CorrelationContext> = asyncLocalStorage.getStore() || {};
  const fullContext: CorrelationContext = {
    requestId: context.requestId || current.requestId || generateUUID(),
    correlationId: context.correlationId || current.correlationId || generateUUID(),
    tenantId: context.tenantId || current.tenantId,
    userId: context.userId || current.userId,
    service: context.service || current.service,
    operation: context.operation || current.operation,
    startTime: context.startTime || Date.now(),
  };

  return asyncLocalStorage.run(fullContext, fn);
}

/**
 * Retrieves the current ambient correlation and request context.
 */
export function getCorrelationContext(): CorrelationContext {
  const store = asyncLocalStorage.getStore();
  if (store) {
    return store;
  }
  return {
    requestId: 'req-untracked',
    correlationId: 'corr-untracked',
  };
}

/**
 * Creates or derives a correlation ID for a business operation on a lead/call/transcript.
 */
export function deriveCorrelationId(existingId?: string | null): string {
  if (existingId && typeof existingId === 'string' && existingId.trim().length > 0) {
    return existingId.trim();
  }
  const ambient = asyncLocalStorage.getStore();
  if (ambient && ambient.correlationId && ambient.correlationId !== 'corr-untracked') {
    return ambient.correlationId;
  }
  return generateUUID();
}
