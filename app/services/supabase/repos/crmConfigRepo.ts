import { CrmConfiguration } from '../../../schemas/handoff';
import { getSupabaseClient, getSupabaseAdminClient } from '../client';
const generateUUID = () => crypto.randomUUID();
import { TenantScope, TenantContext, resolveEffectiveTenantScope, ResolvedTenantScope } from '../../../schemas/tenant';

function parseScope(scopeOrContext: TenantScope | TenantContext | string | undefined | null): ResolvedTenantScope {
  return resolveEffectiveTenantScope(scopeOrContext);
}

export interface CrmConfigurationRepository {
  createConfig: (scope: TenantScope | TenantContext | string, input: Omit<CrmConfiguration, 'id' | 'created_at' | 'updated_at' | 'tenant_id'>) => Promise<CrmConfiguration>;
  updateConfig: (scope: TenantScope | TenantContext | string, id: string, updates: Partial<Omit<CrmConfiguration, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>>) => Promise<CrmConfiguration>;
  getConfig: (scope: TenantScope | TenantContext | string, id: string) => Promise<CrmConfiguration | null>;
  listConfigs: (scope: TenantScope | TenantContext | string) => Promise<CrmConfiguration[]>;
  deleteConfig: (scope: TenantScope | TenantContext | string, id: string) => Promise<boolean>;
}

export function createCrmConfigurationRepository(
  configsStore: Map<string, CrmConfiguration>
): CrmConfigurationRepository {
  return {
    createConfig: async (scopeArg, input) => {
      const scope = parseScope(scopeArg);
      const now = new Date().toISOString();
      const id = generateUUID();
      const record: CrmConfiguration = {
        id,
        tenant_id: scope.tenantId!,
        provider_name: input.provider_name,
        destination_type: input.destination_type,
        endpoint_url: input.endpoint_url || null,
        is_enabled: input.is_enabled,
        dry_run_mode: input.dry_run_mode,
        metadata: input.metadata || null,
        created_at: now,
        updated_at: now,
      };

      const client = getSupabaseAdminClient();
      if (client) {
        try {
          const { data, error } = await client.from('crm_configurations').insert(record).select().single();
          if (!error && data) {
            configsStore.set(data.id, data);
            return data;
          }
        } catch {
          // fallback
        }
      }

      configsStore.set(id, record);
      return record;
    },
    updateConfig: async (scopeArg, id, updates) => {
      const scope = parseScope(scopeArg);
      let existing: CrmConfiguration | null = null;
      
      const client = getSupabaseAdminClient();
      if (client) {
        try {
          let query = client.from('crm_configurations').select('*').eq('id', id);
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          const { data } = await query.maybeSingle();
          if (data) {
            existing = data;
          }
        } catch {}
      }

      if (!existing) {
        existing = configsStore.get(id) || null;
      }
      
      if (!existing || (!scope.isPlatformAdmin && existing.tenant_id !== scope.tenantId)) {
        throw new Error(`CrmConfiguration with id ${id} not found or unauthorized.`);
      }

      const now = new Date().toISOString();
      const updatedRecord: CrmConfiguration = {
        ...existing,
        ...updates,
        updated_at: now,
      };

      if (client) {
        try {
          const { data, error } = await client.from('crm_configurations').update(updatedRecord).eq('id', id).select().single();
          if (!error && data) {
            configsStore.set(id, data);
            return data;
          }
        } catch {}
      }

      configsStore.set(id, updatedRecord);
      return updatedRecord;
    },
    getConfig: async (scopeArg, id) => {
      const scope = parseScope(scopeArg);
      const client = getSupabaseAdminClient();
      if (client) {
        try {
          let query = client.from('crm_configurations').select('*').eq('id', id);
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          const { data, error } = await query.maybeSingle();
          if (!error && data) {
            configsStore.set(data.id, data);
            return data;
          }
        } catch {}
      }

      const record = configsStore.get(id);
      if (record && (!scope.isPlatformAdmin && record.tenant_id !== scope.tenantId)) {
         return null;
      }
      return record || null;
    },
    listConfigs: async (scopeArg) => {
      const scope = parseScope(scopeArg);
      const client = getSupabaseAdminClient();
      if (client) {
        try {
          let query = client.from('crm_configurations').select('*');
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          const { data, error } = await query;
          if (!error && data) {
            return data;
          }
        } catch {}
      }

      return Array.from(configsStore.values()).filter(c => scope.isPlatformAdmin || c.tenant_id === scope.tenantId);
    },
    deleteConfig: async (scopeArg, id) => {
      const scope = parseScope(scopeArg);
      const client = getSupabaseAdminClient();
      if (client) {
        try {
          let query = client.from('crm_configurations').delete().eq('id', id);
          if (!scope.isPlatformAdmin && scope.tenantId) {
             query = query.eq('tenant_id', scope.tenantId);
          }
          await query;
        } catch {}
      }
      return configsStore.delete(id);
    }
  };
}
