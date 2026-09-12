/**
 * Tenant-Aware Calls Repository
 */

import { Call } from '../../../schemas/database';
import { getSupabaseClient } from '../client';
import { 
  TenantScope,
  TenantContext,
  resolveEffectiveTenantScope,
  parseScopeAndId,
  generateUUID,
  TenantMismatchError,
  } from './helpers';
import { LeadsRepository } from './leadsRepo';

export interface CallsRepository {
  createCall(
    scopeOrCall:
      | TenantScope
      | TenantContext
      | (Partial<Omit<Call, 'id' | 'created_at'>> & { lead_id: string } & { id?: string }),
    maybeCall?: Partial<Omit<Call, 'id' | 'created_at'>> & { lead_id: string } & { id?: string }
  ): Promise<Call>;
  getCall(scopeOrId: TenantScope | TenantContext | string, maybeId?: string): Promise<Call | null>;
  getCallByProviderCallId(
    scopeOrProviderCallId: TenantScope | TenantContext | string,
    maybeProviderCallId?: string
  ): Promise<Call | null>;
  getCallsByLead(scopeOrLeadId: TenantScope | TenantContext | string, maybeLeadId?: string): Promise<Call[]>;
  updateCall(
    scopeOrId: TenantScope | TenantContext | string,
    idOrUpdates: string | Partial<Omit<Call, 'id' | 'lead_id' | 'created_at'>>,
    maybeUpdates?: Partial<Omit<Call, 'id' | 'lead_id' | 'created_at'>>
  ): Promise<Call>;
}

export function createCallsRepository(
  callsStore: Map<string, Call>,
  leadsRepo: LeadsRepository
): CallsRepository {
  return {
    createCall: async (scopeOrCall, maybeCall) => {
      const scope = resolveEffectiveTenantScope(maybeCall !== undefined ? (scopeOrCall as TenantScope) : undefined);
      const input = maybeCall !== undefined ? maybeCall : (scopeOrCall as any);

      // Verify parent lead is accessible within scope
      const lead = await leadsRepo.getLead(scope, input.lead_id);
      if (!lead) {
        throw new TenantMismatchError(`Cannot create call for lead ${input.lead_id}: lead not found in authorized tenant context.`);
      }

      const client = getSupabaseClient();
      const now = new Date().toISOString();
      const id = input.id || generateUUID();
      const tenantId = scope.tenantId || lead.tenant_id;
      const record: Call = {
        id,
        tenant_id: tenantId,
        lead_id: input.lead_id,
        provider: input.provider ?? 'generic',
        provider_call_id: input.provider_call_id ?? null,
        status: input.status ?? 'INITIATED',
        attempt_number: input.attempt_number ?? 1,
        started_at: input.started_at !== undefined ? input.started_at : now,
        ended_at: input.ended_at !== undefined ? input.ended_at : null,
        duration_seconds: input.duration_seconds ?? 0,
        transcript: input.transcript ?? null,
        recording_url: input.recording_url ?? null,
        call_outcome: input.call_outcome ?? null,
        call_metadata: input.call_metadata ?? null,
        created_at: now,
      };

      if (client) {
        try {
          const { data, error } = await client.from('calls').insert(record).select().single();
          if (error) {
            if (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205' || error.message?.includes('does not exist') || error.message?.includes('not find the')) {
              // fallback
            } else {
              console.error('[Supabase Insert Error] calls:', error);
              throw new Error(`Supabase insert failed on calls: ${error.message}`);
            }
          } else if (data) {
            callsStore.set(data.id, data);
            return data;
          }
        } catch (err: any) {
          if (!err?.message?.includes('does not exist') && !err?.message?.includes('PGRST')) {
            throw err;
          }
        }
      }

      callsStore.set(record.id, record);
      return record;
    },

    getCall: async (scopeOrId, maybeId) => {
      const { scope, id: idOrProviderCallId } = parseScopeAndId(scopeOrId, maybeId);
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrProviderCallId);
      const client = getSupabaseClient();

      if (client) {
        try {
          let query = client.from('calls').select('*');
          if (isUUID) {
            query = query.eq('id', idOrProviderCallId);
          } else {
            query = query.eq('provider_call_id', idOrProviderCallId);
          }
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          const { data, error } = await query.maybeSingle();
          if (error) {
            if (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205' || error.message?.includes('does not exist') || error.message?.includes('not find the')) {
              // fallback
            } else {
              console.error('[Supabase Query Error] calls:', error);
              throw new Error(`Supabase query failed on calls: ${error.message}`);
            }
          } else if (data) return data;
        } catch (err: any) {
          if (!err?.message?.includes('does not exist') && !err?.message?.includes('PGRST')) {
            throw err;
          }
        }
      }

      const match = callsStore.get(idOrProviderCallId) ||
        Array.from(callsStore.values()).find((c) => c.provider_call_id === idOrProviderCallId) ||
        null;

      if (!match) return null;
      if (!scope.isPlatformAdmin && scope.tenantId && match.tenant_id && match.tenant_id !== scope.tenantId) {
        return null;
      }
      return match;
    },

    getCallByProviderCallId: async (scopeOrProviderCallId, maybeProviderCallId) => {
      const { scope, id: providerCallId } = parseScopeAndId(scopeOrProviderCallId, maybeProviderCallId);
      const client = getSupabaseClient();
      if (client) {
        try {
          let query = client
            .from('calls')
            .select('*')
            .eq('provider_call_id', providerCallId);
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          const { data, error } = await query.order('created_at', { ascending: false }).limit(1);
          if (error) {
            if (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205' || error.message?.includes('does not exist') || error.message?.includes('not find the')) {
              // fallback
            } else {
              console.error('[Supabase Query Error] calls:', error);
              throw new Error(`Supabase query failed on calls: ${error.message}`);
            }
          } else if (data && data.length > 0) return data[0];
        } catch (err: any) {
          if (!err?.message?.includes('does not exist') && !err?.message?.includes('PGRST')) {
            throw err;
          }
        }
      }

      for (const call of callsStore.values()) {
        if (call.provider_call_id === providerCallId) {
          if (!scope.isPlatformAdmin && scope.tenantId && call.tenant_id && call.tenant_id !== scope.tenantId) {
            continue;
          }
          return call;
        }
      }
      return null;
    },

    getCallsByLead: async (scopeOrLeadId, maybeLeadId) => {
      const { scope, id: leadId } = parseScopeAndId(scopeOrLeadId, maybeLeadId);
      const client = getSupabaseClient();
      if (client) {
        try {
          let query = client.from('calls').select('*').eq('lead_id', leadId);
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          const { data, error } = await query;
          if (error) {
            if (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205' || error.message?.includes('does not exist') || error.message?.includes('not find the')) {
              // fallback
            } else {
              console.error('[Supabase Query Error] calls:', error);
              throw new Error(`Supabase query failed on calls: ${error.message}`);
            }
          } else if (data) return data;
        } catch (err: any) {
          if (!err?.message?.includes('does not exist') && !err?.message?.includes('PGRST')) {
            throw err;
          }
        }
      }
      return Array.from(callsStore.values()).filter((c) => {
        if (c.lead_id !== leadId) return false;
        if (!scope.isPlatformAdmin && scope.tenantId && c.tenant_id && c.tenant_id !== scope.tenantId) {
          return false;
        }
        return true;
      });
    },

    updateCall: async (scopeOrId, idOrUpdates, maybeUpdates) => {
      let scope: any;
      let id: string;
      let updates: Partial<Omit<Call, 'id' | 'lead_id' | 'created_at'>>;

      if (maybeUpdates !== undefined) {
        scope = resolveEffectiveTenantScope(scopeOrId as TenantScope);
        id = idOrUpdates as string;
        updates = maybeUpdates;
      } else {
        scope = resolveEffectiveTenantScope(undefined);
        id = scopeOrId as string;
        updates = idOrUpdates as Partial<Omit<Call, 'id' | 'lead_id' | 'created_at'>>;
      }

      const client = getSupabaseClient();
      if (client) {
        try {
          let query = client.from('calls').update(updates).eq('id', id);
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          const { data, error } = await query.select().single();
          if (error) {
            if (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205' || error.message?.includes('does not exist') || error.message?.includes('not find the')) {
              // fallback
            } else {
              console.error('[Supabase Update Error] calls:', error);
              throw new Error(`Supabase update failed on calls: ${error.message}`);
            }
          } else if (data) {
            callsStore.set(data.id, data);
            return data;
          }
        } catch (err: any) {
          if (!err?.message?.includes('does not exist') && !err?.message?.includes('PGRST')) {
            throw err;
          }
        }
      }

      const existing = callsStore.get(id);
      if (!existing) {
        throw new Error(`Call with ID ${id} not found.`);
      }
      if (!scope.isPlatformAdmin && scope.tenantId && existing.tenant_id && existing.tenant_id !== scope.tenantId) {
        throw new Error(`Call with ID ${id} not found in authorized tenant context.`);
      }
      const updated: Call = { ...existing, ...updates };
      callsStore.set(id, updated);
      return updated;
    },
  };
}
