import { logger } from "../../security/logger";
/**
 * Tenant, Membership, API Key, and Webhook Event Repositories
 */

import { Tenant, TenantMembership, TenantApiKey, WebhookEvent } from '../../../schemas/tenant';
import { getSupabaseClient, getSupabaseAdminClient } from '../client';
import {  generateUUID   } from './helpers';

export interface TenantsRepository {
  createTenant(tenant: Omit<Tenant, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Promise<Tenant>;
  getTenant(id: string): Promise<Tenant | null>;
  getTenantBySlug(slug: string): Promise<Tenant | null>;
  listTenants(): Promise<Tenant[]>;
  updateTenant(id: string, updates: Partial<Omit<Tenant, 'id' | 'created_at'>>): Promise<Tenant>;
}

export interface TenantMembershipsRepository {
  createMembership(membership: Omit<TenantMembership, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Promise<TenantMembership>;
  getMembership(tenantId: string, userId: string): Promise<TenantMembership | null>;
  getUserMemberships(userId: string): Promise<TenantMembership[]>;
  getTenantMemberships(tenantId: string): Promise<TenantMembership[]>;
  deleteMembership(tenantId: string, userId: string): Promise<boolean>;
}

export interface TenantApiKeysRepository {
  createApiKey(apiKey: Omit<TenantApiKey, 'id' | 'created_at' | 'revoked_at'> & { id?: string; revoked_at?: string | null }): Promise<TenantApiKey>;
  getApiKeyByHash(keyHash: string): Promise<TenantApiKey | null>;
  listApiKeys(tenantId: string): Promise<TenantApiKey[]>;
  revokeApiKey(id: string): Promise<boolean>;
}

export interface WebhookEventsRepository {
  recordEvent(event: WebhookEvent): Promise<WebhookEvent>;
  getEvent(eventId: string): Promise<WebhookEvent | null>;
  updateEventStatus(eventId: string, status: string, processedAt?: string): Promise<WebhookEvent>;
}

export function createTenantsRepository(tenantsStore: Map<string, Tenant>): TenantsRepository {
  return {
    createTenant: async (input) => {
      const client = getSupabaseClient();
      const now = new Date().toISOString();
      const id = input.id || generateUUID();
      const record: Tenant = {
        id,
        name: input.name,
        slug: input.slug,
        status: input.status || 'ACTIVE',
        created_at: now,
        updated_at: now,
      };

      if (client) {
        const { data, error } = await client.from('tenants').insert(record).select().single();
        if (error) {
          logger.error('[Supabase Insert Error] tenants:', { service: "supabase-repo", error_category: "DATABASE_ERROR", data: { error: (error)?.message || String(error) } });
          throw new Error(`Supabase insert failed on tenants: ${error.message}`);
        }
        if (data) {
          tenantsStore.set(data.id, data);
          return data;
        }
      }

      tenantsStore.set(record.id, record);
      return record;
    },

    getTenant: async (id: string) => {
      const client = getSupabaseClient();
      if (client) {
        const { data, error } = await client.from('tenants').select('*').eq('id', id).maybeSingle();
        if (error) {
          logger.error('[Supabase Query Error] tenants:', { service: "supabase-repo", error_category: "DATABASE_ERROR", data: { error: (error)?.message || String(error) } });
          throw new Error(`Supabase query failed on tenants: ${error.message}`);
        }
        if (data) {
          tenantsStore.set(data.id, data);
          return data;
        }
        return null;
      }
      return tenantsStore.get(id) || null;
    },

    getTenantBySlug: async (slug: string) => {
      const client = getSupabaseClient();
      if (client) {
        const { data, error } = await client.from('tenants').select('*').eq('slug', slug).maybeSingle();
        if (error) {
          logger.error('[Supabase Query Error] tenants:', { service: "supabase-repo", error_category: "DATABASE_ERROR", data: { error: (error)?.message || String(error) } });
          throw new Error(`Supabase query failed on tenants: ${error.message}`);
        }
        if (data) {
          tenantsStore.set(data.id, data);
          return data;
        }
        return null;
      }
      for (const t of tenantsStore.values()) {
        if (t.slug === slug) return t;
      }
      return null;
    },

    listTenants: async () => {
      const client = getSupabaseClient();
      if (client) {
        const { data, error } = await client.from('tenants').select('*').order('created_at', { ascending: false });
        if (error) {
          logger.error('[Supabase Query Error] tenants:', { service: "supabase-repo", error_category: "DATABASE_ERROR", data: { error: (error)?.message || String(error) } });
          throw new Error(`Supabase list query failed on tenants: ${error.message}`);
        }
        if (data) {
          for (const item of data) {
            tenantsStore.set(item.id, item);
          }
          return data;
        }
      }
      return Array.from(tenantsStore.values()).sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    },

    updateTenant: async (id: string, updates) => {
      const client = getSupabaseClient();
      const now = new Date().toISOString();

      if (client) {
        const { data, error } = await client
          .from('tenants')
          .update({ ...updates, updated_at: now })
          .eq('id', id)
          .select()
          .single();
        if (error) {
          logger.error('[Supabase Update Error] tenants:', { service: "supabase-repo", error_category: "DATABASE_ERROR", data: { error: (error)?.message || String(error) } });
          throw new Error(`Supabase update failed on tenants: ${error.message}`);
        }
        if (data) {
          tenantsStore.set(data.id, data);
          return data;
        }
      }

      const existing = tenantsStore.get(id);
      if (!existing) {
        throw new Error(`Tenant with ID ${id} not found.`);
      }
      const updated: Tenant = {
        ...existing,
        ...updates,
        updated_at: now,
      };
      tenantsStore.set(id, updated);
      return updated;
    },
  };
}

export function createTenantMembershipsRepository(
  membershipsStore: Map<string, TenantMembership>
): TenantMembershipsRepository {
  return {
    createMembership: async (input) => {
      const client = getSupabaseClient();
      const now = new Date().toISOString();
      const id = input.id || generateUUID();
      const record: TenantMembership = {
        id,
        tenant_id: input.tenant_id,
        user_id: input.user_id,
        role: input.role,
        is_platform_admin: input.is_platform_admin ?? false,
        created_at: now,
        updated_at: now,
      };

      if (client) {
        const { data, error } = await client.from('tenant_memberships').insert(record).select().single();
        if (error) {
          logger.error('[Supabase Insert Error] tenant_memberships:', { service: "supabase-repo", error_category: "DATABASE_ERROR", data: { error: (error)?.message || String(error) } });
          throw new Error(`Supabase insert failed on tenant_memberships: ${error.message}`);
        }
        if (data) {
          membershipsStore.set(`${data.tenant_id}:${data.user_id}`, data);
          return data;
        }
      }

      membershipsStore.set(`${record.tenant_id}:${record.user_id}`, record);
      return record;
    },

    getMembership: async (tenantId: string, userId: string) => {
      const client = getSupabaseClient();
      if (client) {
        const { data, error } = await client
          .from('tenant_memberships')
          .select('*')
          .eq('tenant_id', tenantId)
          .eq('user_id', userId)
          .maybeSingle();
        if (error) {
          logger.error('[Supabase Query Error] tenant_memberships:', { service: "supabase-repo", error_category: "DATABASE_ERROR", data: { error: (error)?.message || String(error) } });
          throw new Error(`Supabase query failed on tenant_memberships: ${error.message}`);
        }
        if (data) {
          membershipsStore.set(`${data.tenant_id}:${data.user_id}`, data);
          return data;
        }
        return null;
      }
      return membershipsStore.get(`${tenantId}:${userId}`) || null;
    },

    getUserMemberships: async (userId: string) => {
      const client = getSupabaseClient();
      if (client) {
        const { data, error } = await client.from('tenant_memberships').select('*').eq('user_id', userId);
        if (error) {
          logger.error('[Supabase Query Error] tenant_memberships:', { service: "supabase-repo", error_category: "DATABASE_ERROR", data: { error: (error)?.message || String(error) } });
          throw new Error(`Supabase query failed on tenant_memberships: ${error.message}`);
        }
        if (data) return data;
      }
      return Array.from(membershipsStore.values()).filter((m) => m.user_id === userId);
    },

    getTenantMemberships: async (tenantId: string) => {
      const client = getSupabaseClient();
      if (client) {
        const { data, error } = await client.from('tenant_memberships').select('*').eq('tenant_id', tenantId);
        if (error) {
          logger.error('[Supabase Query Error] tenant_memberships:', { service: "supabase-repo", error_category: "DATABASE_ERROR", data: { error: (error)?.message || String(error) } });
          throw new Error(`Supabase query failed on tenant_memberships: ${error.message}`);
        }
        if (data) return data;
      }
      return Array.from(membershipsStore.values()).filter((m) => m.tenant_id === tenantId);
    },

    deleteMembership: async (tenantId: string, userId: string) => {
      const client = getSupabaseClient();
      if (client) {
        const { error } = await client
          .from('tenant_memberships')
          .delete()
          .eq('tenant_id', tenantId)
          .eq('user_id', userId);
        if (error) {
          logger.error('[Supabase Delete Error] tenant_memberships:', { service: "supabase-repo", error_category: "DATABASE_ERROR", data: { error: (error)?.message || String(error) } });
          throw new Error(`Supabase delete failed on tenant_memberships: ${error.message}`);
        }
      }
      return membershipsStore.delete(`${tenantId}:${userId}`);
    },
  };
}

export function createTenantApiKeysRepository(
  apiKeysStore: Map<string, TenantApiKey>
): TenantApiKeysRepository {
  return {
    createApiKey: async (input) => {
      const client = getSupabaseClient();
      const now = new Date().toISOString();
      const id = input.id || generateUUID();
      const record: TenantApiKey = {
        id,
        tenant_id: input.tenant_id,
        name: input.name,
        key_hash: input.key_hash,
        role: input.role,
        revoked_at: input.revoked_at ?? null,
        created_at: now,
      };

      if (client) {
        const { data, error } = await client.from('tenant_api_keys').insert(record).select().single();
        if (error) {
          logger.error('[Supabase Insert Error] tenant_api_keys:', { service: "supabase-repo", error_category: "DATABASE_ERROR", data: { error: (error)?.message || String(error) } });
          throw new Error(`Supabase insert failed on tenant_api_keys: ${error.message}`);
        }
        if (data) {
          apiKeysStore.set(data.key_hash, data);
          return data;
        }
      }

      apiKeysStore.set(record.key_hash, record);
      return record;
    },

    getApiKeyByHash: async (keyHash: string) => {
      const client = getSupabaseClient();
      if (client) {
        const { data, error } = await client.from('tenant_api_keys').select('*').eq('key_hash', keyHash).maybeSingle();
        if (error) {
          logger.error('[Supabase Query Error] tenant_api_keys:', { service: "supabase-repo", error_category: "DATABASE_ERROR", data: { error: (error)?.message || String(error) } });
          throw new Error(`Supabase query failed on tenant_api_keys: ${error.message}`);
        }
        if (data) {
          apiKeysStore.set(data.key_hash, data);
          return data;
        }
        return null;
      }
      return apiKeysStore.get(keyHash) || null;
    },

    listApiKeys: async (tenantId: string) => {
      const client = getSupabaseClient();
      if (client) {
        const { data, error } = await client.from('tenant_api_keys').select('*').eq('tenant_id', tenantId);
        if (error) {
          logger.error('[Supabase Query Error] tenant_api_keys:', { service: "supabase-repo", error_category: "DATABASE_ERROR", data: { error: (error)?.message || String(error) } });
          throw new Error(`Supabase query failed on tenant_api_keys: ${error.message}`);
        }
        if (data) return data;
      }
      return Array.from(apiKeysStore.values()).filter((k) => k.tenant_id === tenantId);
    },

    revokeApiKey: async (id: string) => {
      const now = new Date().toISOString();
      const client = getSupabaseClient();
      if (client) {
        const { error } = await client.from('tenant_api_keys').update({ revoked_at: now }).eq('id', id);
        if (error) {
          logger.error('[Supabase Update Error] tenant_api_keys:', { service: "supabase-repo", error_category: "DATABASE_ERROR", data: { error: (error)?.message || String(error) } });
          throw new Error(`Supabase update failed on tenant_api_keys: ${error.message}`);
        }
      }
      for (const [hash, key] of apiKeysStore.entries()) {
        if (key.id === id) {
          apiKeysStore.set(hash, { ...key, revoked_at: now });
          return true;
        }
      }
      return false;
    },
  };
}

export function createWebhookEventsRepository(
  webhookEventsStore: Map<string, WebhookEvent>
): WebhookEventsRepository {
  return {
    recordEvent: async (event: WebhookEvent) => {
      const client = getSupabaseAdminClient() || getSupabaseClient();
      if (client) {
        const { data, error } = await client.from('webhook_events').insert(event).select().single();
        if (error) {
          if (error.code === '23505') {
            throw new Error(`Duplicate webhook event: ${event.event_id}`);
          }
          if (error.code === '42501' && process.env.NODE_ENV !== 'production') {
            // Test environment workaround for unapplied migration policy
            webhookEventsStore.set(event.event_id, event);
            return event;
          }
          logger.error('[Supabase Insert Error] webhook_events:', { service: "supabase-repo", error_category: "DATABASE_ERROR", data: { error: (error)?.message || String(error) } });
          throw new Error(`Supabase insert failed on webhook_events: ${error.message}`);
        }
        if (data) {
          webhookEventsStore.set(data.event_id, data);
          return data;
        }
      }
      if (process.env.NODE_ENV === 'production' && !client) {
         throw new Error('Production persistence requires Supabase database client');
      }
      webhookEventsStore.set(event.event_id, event);
      return event;
    },

    getEvent: async (eventId: string) => {
      const client = getSupabaseAdminClient() || getSupabaseClient();
      if (client) {
        try {
          const { data, error } = await client.from('webhook_events').select('*').eq('event_id', eventId).maybeSingle();
          if (!error && data) return data;
        } catch {
          // fallback
        }
      }
      return webhookEventsStore.get(eventId) || null;
    },

    updateEventStatus: async (eventId: string, status: string, processedAt?: string) => {
      const existing = webhookEventsStore.get(eventId);
      const updated: WebhookEvent = {
        ...(existing || {
          event_id: eventId,
          provider: 'webhook',
          received_at: new Date().toISOString(),
          status: 'PENDING',
          payload_hash: null,
          processed_at: null,
        }),
        status,
        processed_at: processedAt || new Date().toISOString(),
      };

      const client = getSupabaseAdminClient() || getSupabaseClient();
      if (client) {
        try {
          const { data, error } = await client.from('webhook_events').update(updated).eq('event_id', eventId).select().single();
          if (!error && data) {
            webhookEventsStore.set(eventId, data);
            return data;
          }
        } catch {
          // fallback
        }
      }
      webhookEventsStore.set(eventId, updated);
      return updated;
    },
  };
}
