/**
 * Tenant-Aware Buyer Profiles and Preferences Repositories
 */

import { BuyerProfile, BuyerPreference } from '../../../schemas/database';
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

export interface BuyerProfilesRepository {
  upsertBuyerProfile(
    scopeOrProfile:
      | TenantScope
      | TenantContext
      | (Partial<Omit<BuyerProfile, 'id' | 'created_at' | 'updated_at'>> & { lead_id: string; id?: string }),
    maybeProfile?: Partial<Omit<BuyerProfile, 'id' | 'created_at' | 'updated_at'>> & { lead_id: string; id?: string }
  ): Promise<BuyerProfile>;
  getBuyerProfile(scopeOrLeadId: TenantScope | TenantContext | string, maybeLeadId?: string): Promise<BuyerProfile | null>;
}

export interface BuyerPreferencesRepository {
  addBuyerPreference(
    scopeOrPref:
      | TenantScope
      | TenantContext
      | (Omit<BuyerPreference, 'id' | 'created_at'> & { id?: string }),
    maybePref?: Omit<BuyerPreference, 'id' | 'created_at'> & { id?: string }
  ): Promise<BuyerPreference>;
  getBuyerPreferences(scopeOrLeadId: TenantScope | TenantContext | string, maybeLeadId?: string): Promise<BuyerPreference[]>;
}

export function createBuyerProfilesRepository(
  buyerProfilesStore: Map<string, BuyerProfile>,
  leadsRepo: LeadsRepository
): BuyerProfilesRepository {
  return {
    upsertBuyerProfile: async (scopeOrProfile, maybeProfile) => {
      const scope = resolveEffectiveTenantScope(maybeProfile !== undefined ? (scopeOrProfile as TenantScope) : undefined);
      const input = maybeProfile !== undefined ? maybeProfile : (scopeOrProfile as any);

      // Verify parent lead is accessible within scope
      const lead = await leadsRepo.getLead(scope, input.lead_id);
      if (!lead) {
        throw new TenantMismatchError(`Cannot upsert buyer profile for lead ${input.lead_id}: lead not found in authorized tenant context.`);
      }

      const client = getSupabaseClient();
      const now = new Date().toISOString();
      const id = input.id || generateUUID();
      const tenantId = scope.tenantId || lead.tenant_id;
      const record: BuyerProfile = {
        id,
        tenant_id: tenantId,
        lead_id: input.lead_id,
        property_interest: input.property_interest ?? true,
        property_type: input.property_type ?? null,
        configuration: input.configuration ?? null,
        purpose: input.purpose ?? 'Self-use',
        budget_min: input.budget_min ?? null,
        budget_max: input.budget_max ?? null,
        currency: input.currency ?? 'INR',
        preferred_locations: input.preferred_locations ?? [],
        timeline: input.timeline ?? null,
        financing: input.financing ?? null,
        decision_maker: input.decision_maker ?? null,
        requirements: input.requirements ?? [],
        preferences: input.preferences ?? [],
        qualification_status: input.qualification_status ?? 'PENDING',
        intent_score: input.intent_score ?? null,
        confidence_score: input.confidence_score ?? null,
        created_at: now,
        updated_at: now,
      };

      if (client) {
        try {
          const { data, error } = await client
            .from('buyer_profiles')
            .upsert(record, { onConflict: 'lead_id' })
            .select()
            .single();
          if (error) {
            if (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205' || error.message?.includes('does not exist') || error.message?.includes('not find the')) {
              // fallback
            } else {
              console.error('[Supabase Upsert Error] buyer_profiles:', error);
              throw new Error(`Supabase upsert failed on buyer_profiles: ${error.message}`);
            }
          } else if (data) {
            buyerProfilesStore.set(data.lead_id, data);
            return data;
          }
        } catch (err: any) {
          if (!err?.message?.includes('does not exist') && !err?.message?.includes('PGRST')) {
            throw err;
          }
        }
      }

      buyerProfilesStore.set(record.lead_id, record);
      return record;
    },

    getBuyerProfile: async (scopeOrLeadId, maybeLeadId) => {
      const { scope, id: leadId } = parseScopeAndId(scopeOrLeadId, maybeLeadId);
      const client = getSupabaseClient();
      if (client) {
        try {
          let query = client.from('buyer_profiles').select('*').eq('lead_id', leadId);
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          const { data, error } = await query.maybeSingle();
          if (error) {
            if (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205' || error.message?.includes('does not exist') || error.message?.includes('not find the')) {
              // fallback
            } else {
              console.error('[Supabase Query Error] buyer_profiles:', error);
              throw new Error(`Supabase query failed on buyer_profiles: ${error.message}`);
            }
          } else if (data) return data;
        } catch (err: any) {
          if (!err?.message?.includes('does not exist') && !err?.message?.includes('PGRST')) {
            throw err;
          }
        }
      }
      const record = buyerProfilesStore.get(leadId) || null;
      if (!record) return null;
      if (!scope.isPlatformAdmin && scope.tenantId && record.tenant_id && record.tenant_id !== scope.tenantId) {
        return null;
      }
      return record;
    },
  };
}

export function createBuyerPreferencesRepository(
  buyerPreferencesStore: Map<string, BuyerPreference[]>,
  leadsRepo: LeadsRepository
): BuyerPreferencesRepository {
  return {
    addBuyerPreference: async (scopeOrPref, maybePref) => {
      const scope = resolveEffectiveTenantScope(maybePref !== undefined ? (scopeOrPref as TenantScope) : undefined);
      const input = maybePref !== undefined ? maybePref : (scopeOrPref as any);

      // Verify parent lead is accessible within scope
      const lead = await leadsRepo.getLead(scope, input.lead_id);
      if (!lead) {
        throw new TenantMismatchError(`Cannot add buyer preference for lead ${input.lead_id}: lead not found in authorized tenant context.`);
      }

      const client = getSupabaseClient();
      const now = new Date().toISOString();
      const id = input.id || generateUUID();
      const tenantId = scope.tenantId || lead.tenant_id;
      const record: BuyerPreference = {
        id,
        tenant_id: tenantId,
        lead_id: input.lead_id,
        attribute: input.attribute,
        value: input.value,
        source: input.source ?? 'CONVERSATION',
        confidence: input.confidence ?? 0.8,
        is_explicit: input.is_explicit ?? true,
        is_verified: input.is_verified ?? false,
        created_at: now,
      };

      if (client) {
        try {
          const { data, error } = await client.from('buyer_preferences').insert(record).select().single();
          if (error) {
            if (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205' || error.message?.includes('does not exist') || error.message?.includes('not find the')) {
              // fallback
            } else {
              console.error('[Supabase Insert Error] buyer_preferences:', error);
              throw new Error(`Supabase insert failed on buyer_preferences: ${error.message}`);
            }
          } else if (data) return data;
        } catch (err: any) {
          if (!err?.message?.includes('does not exist') && !err?.message?.includes('PGRST')) {
            throw err;
          }
        }
      }

      const list = buyerPreferencesStore.get(record.lead_id) || [];
      list.push(record);
      buyerPreferencesStore.set(record.lead_id, list);
      return record;
    },

    getBuyerPreferences: async (scopeOrLeadId, maybeLeadId) => {
      const { scope, id: leadId } = parseScopeAndId(scopeOrLeadId, maybeLeadId);
      const client = getSupabaseClient();
      if (client) {
        try {
          let query = client.from('buyer_preferences').select('*').eq('lead_id', leadId);
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          const { data, error } = await query;
          if (error) {
            if (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205' || error.message?.includes('does not exist') || error.message?.includes('not find the')) {
              // fallback
            } else {
              console.error('[Supabase Query Error] buyer_preferences:', error);
              throw new Error(`Supabase query failed on buyer_preferences: ${error.message}`);
            }
          } else if (data) return data;
        } catch (err: any) {
          if (!err?.message?.includes('does not exist') && !err?.message?.includes('PGRST')) {
            throw err;
          }
        }
      }
      const list = buyerPreferencesStore.get(leadId) || [];
      if (!scope.isPlatformAdmin && scope.tenantId) {
        return list.filter((p) => !p.tenant_id || p.tenant_id === scope.tenantId);
      }
      return list;
    },
  };
}
