/**
 * GrowthForge Buyer Intelligence Engine - Tenant & Membership Schema & Types
 *
 * Phase 8A.2 Tenant Data Model:
 * Defines typed representations for tenants, memberships, API keys, and webhook events.
 */

import { UserRole } from './auth';

export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

export type TenantStatus = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';

export interface Tenant {
  id: string; // UUID
  name: string;
  slug: string;
  status: TenantStatus | string;
  created_at: string;
  updated_at: string;
}

export interface TenantMembership {
  id: string; // UUID
  tenant_id: string; // UUID FK -> tenants.id
  user_id: string; // UUID FK -> auth.users.id
  role: UserRole;
  is_platform_admin: boolean;
  created_at: string;
  updated_at: string;
}

export interface TenantApiKey {
  id: string; // UUID
  tenant_id: string; // UUID FK -> tenants.id
  key_hash: string; // Hashed API key (SHA-256 / bcrypt)
  name: string;
  role: UserRole | string;
  created_at: string;
  revoked_at: string | null;
}

export interface WebhookEvent {
  event_id: string; // PRIMARY KEY
  provider: string;
  received_at: string;
  status: string;
  payload_hash: string | null;
  processed_at: string | null;
}

export const DEFAULT_TENANT: Tenant = {
  id: DEFAULT_TENANT_ID,
  name: 'Default GrowthForge Tenant',
  slug: 'default-growthforge',
  status: 'ACTIVE',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

// ==========================================
// PHASE 8A.3 TENANT CONTEXT & SCOPING TYPES
// ==========================================

export interface TenantContext {
  tenantId: string;
  userId?: string;
  role: UserRole;
  isPlatformAdmin: boolean;
}

export type TenantScope =
  | { tenantId?: string; platformAdmin?: boolean; isPlatformAdmin?: boolean }
  | ResolvedTenantScope
  | TenantContext
  | string; // Direct tenant ID string

export class TenantRequiredError extends Error {
  public readonly code = 'TENANT_REQUIRED';
  constructor(message = 'Operation requires an explicit, authenticated tenant context or platform admin scope.') {
    super(message);
    this.name = 'TenantRequiredError';
  }
}

export class TenantMismatchError extends Error {
  public readonly code = 'TENANT_MISMATCH';
  constructor(message = 'Resource does not belong to the authorized tenant context.') {
    super(message);
    this.name = 'TenantMismatchError';
  }
}

export class TenantForbiddenError extends Error {
  public readonly code = 'TENANT_FORBIDDEN';
  constructor(message = 'User is not authorized for the specified tenant.') {
    super(message);
    this.name = 'TenantForbiddenError';
  }
}

export interface ResolvedTenantScope {
  tenantId?: string;
  isPlatformAdmin: boolean;
}

/**
 * Resolves the effective tenant scope from a TenantScope, TenantContext, or tenant ID string.
 * In production mode, fails closed if tenant context is missing and not platform admin.
 * In test/dev mode, defaults to DEFAULT_TENANT_ID if omitted.
 */
export function resolveEffectiveTenantScope(
  scopeOrContext?: TenantScope | TenantContext | string | null,
  options?: { strictProductionFailClosed?: boolean }
): ResolvedTenantScope {
  if (scopeOrContext) {
    if (typeof scopeOrContext === 'string') {
      const trimmed = scopeOrContext.trim();
      if (trimmed) {
        return { tenantId: trimmed, isPlatformAdmin: false };
      }
    } else if (typeof scopeOrContext === 'object') {
      if ('platformAdmin' in scopeOrContext && scopeOrContext.platformAdmin === true) {
        return { tenantId: scopeOrContext.tenantId, isPlatformAdmin: true };
      }
      if ('isPlatformAdmin' in scopeOrContext && scopeOrContext.isPlatformAdmin === true) {
        return { tenantId: scopeOrContext.tenantId, isPlatformAdmin: true };
      }
      if ('tenantId' in scopeOrContext && typeof scopeOrContext.tenantId === 'string' && scopeOrContext.tenantId.trim()) {
        const isPA = Boolean('isPlatformAdmin' in scopeOrContext ? scopeOrContext.isPlatformAdmin : false);
        return { tenantId: scopeOrContext.tenantId.trim(), isPlatformAdmin: isPA };
      }
    }
  }

  // Determine if fail closed is strictly required
  const isProduction = process.env.NODE_ENV === 'production' || options?.strictProductionFailClosed === true;
  if (isProduction) {
    throw new TenantRequiredError();
  }

  // In test / dev environments, fallback to deterministic default tenant
  return { tenantId: DEFAULT_TENANT_ID, isPlatformAdmin: false };
}

