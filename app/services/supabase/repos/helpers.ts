/**
 * Scoping & Query Helpers for Tenant-Aware Repositories
 */

import {
  TenantScope,
  TenantContext,
  ResolvedTenantScope,
  resolveEffectiveTenantScope,
  TenantRequiredError,
  TenantMismatchError,
  TenantForbiddenError,
  DEFAULT_TENANT_ID,
} from '../../../schemas/tenant';

export type { TenantScope, TenantContext, ResolvedTenantScope };
export {
  resolveEffectiveTenantScope,
  TenantRequiredError,
  TenantMismatchError,
  TenantForbiddenError,
  DEFAULT_TENANT_ID,
};

export function parseScopeAndId(
  scopeOrId: TenantScope | TenantContext | string,
  maybeId?: string
): { scope: ResolvedTenantScope; id: string } {
  if (maybeId !== undefined) {
    return {
      scope: resolveEffectiveTenantScope(scopeOrId as TenantScope),
      id: maybeId,
    };
  }
  return {
    scope: resolveEffectiveTenantScope(undefined),
    id: scopeOrId as string,
  };
}

export function parseScopeAndFilter<T>(
  scopeOrFilter?: TenantScope | TenantContext | string | T,
  maybeFilter?: T
): { scope: ResolvedTenantScope; filter?: T } {
  if (maybeFilter !== undefined) {
    return {
      scope: resolveEffectiveTenantScope(scopeOrFilter as TenantScope),
      filter: maybeFilter,
    };
  }
  if (
    typeof scopeOrFilter === 'string' ||
    (scopeOrFilter && typeof scopeOrFilter === 'object' && ('tenantId' in scopeOrFilter || 'platformAdmin' in scopeOrFilter || 'isPlatformAdmin' in scopeOrFilter))
  ) {
    return {
      scope: resolveEffectiveTenantScope(scopeOrFilter as TenantScope),
      filter: undefined,
    };
  }
  return {
    scope: resolveEffectiveTenantScope(undefined),
    filter: scopeOrFilter as T | undefined,
  };
}

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

import { logger } from '../../security/logger';

export function checkProductionFallback(operation: string, error?: any): void {
  if (process.env.NODE_ENV === 'production') {
    const msg = `[Supabase Fallback Error] in-memory fallback is disabled in production for: ${operation}. ${error ? error.message : 'Missing client or connection.'}`;
    logger.error(msg, {
      service: 'supabase-repo',
      operation,
      error_category: 'PERSISTENCE_FALLBACK_DENIED',
      data: {
        error: error ? error.message : undefined,
      },
    });
    throw new Error(msg);
  }
}
