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
