/**
 * Tenant-Aware Leads, Enrichment, and Events Repositories
 */

import { Lead, LeadEnrichment, LeadEvent } from '../../../schemas/database';
import { getSupabaseClient } from '../client';
import {
  TenantScope,
  TenantContext,
  resolveEffectiveTenantScope,
  parseScopeAndId,
  parseScopeAndFilter,
  generateUUID,
  TenantMismatchError,
} from './helpers';

export interface LeadsRepository {
  createLead(
    scopeOrLead:
      | TenantScope
      | TenantContext
      | (Partial<Omit<Lead, 'id' | 'created_at' | 'updated_at'>> & { lead_id: string; phone?: string | null; name?: string | null } & { id?: string }),
    maybeLead?: Partial<Omit<Lead, 'id' | 'created_at' | 'updated_at'>> & { lead_id: string; phone?: string | null; name?: string | null } & { id?: string }
  ): Promise<Lead>;
  getLead(scopeOrId: TenantScope | TenantContext | string, maybeId?: string): Promise<Lead | null>;
  getLeadByLeadId(scopeOrLeadId: TenantScope | TenantContext | string, maybeLeadId?: string): Promise<Lead | null>;
  updateLead(
    scopeOrId: TenantScope | TenantContext | string,
    idOrUpdates: string | Partial<Omit<Lead, 'id' | 'lead_id' | 'created_at'>>,
    maybeUpdates?: Partial<Omit<Lead, 'id' | 'lead_id' | 'created_at'>>
  ): Promise<Lead>;
  listLeads(
    scopeOrFilter?: TenantScope | TenantContext | string | { status?: string; limit?: number; offset?: number },
    maybeFilter?: { status?: string; limit?: number; offset?: number }
  ): Promise<Lead[]>;
  deleteLead(scopeOrId: TenantScope | TenantContext | string, maybeId?: string): Promise<boolean>;
}

export interface LeadEnrichmentRepository {
  createEnrichment(
    scopeOrEnrichment: TenantScope | TenantContext | (Omit<LeadEnrichment, 'id' | 'created_at'> & { id?: string }),
    maybeEnrichment?: Omit<LeadEnrichment, 'id' | 'created_at'> & { id?: string }
  ): Promise<LeadEnrichment>;
  getEnrichment(scopeOrLeadId: TenantScope | TenantContext | string, maybeLeadId?: string): Promise<LeadEnrichment[]>;
}

export interface LeadEventsRepository {
  appendLeadEvent(
    scopeOrEvent: TenantScope | TenantContext | (Omit<LeadEvent, 'id' | 'created_at'> & { id?: string }),
    maybeEvent?: Omit<LeadEvent, 'id' | 'created_at'> & { id?: string }
  ): Promise<LeadEvent>;
  getLeadEvents(scopeOrLeadId: TenantScope | TenantContext | string, maybeLeadId?: string): Promise<LeadEvent[]>;
}

export function createLeadsRepository(leadsStore: Map<string, Lead>): LeadsRepository {
  return {
    createLead: async (scopeOrLead, maybeLead) => {
      let scope = resolveEffectiveTenantScope(maybeLead !== undefined ? (scopeOrLead as TenantScope) : undefined);
      let input = maybeLead !== undefined ? maybeLead : (scopeOrLead as any);

      // If input itself contains tenant_id and scope was not explicitly passed, validate/use it
      if (input.tenant_id) {
        if (!scope.isPlatformAdmin && scope.tenantId && scope.tenantId !== input.tenant_id) {
          throw new TenantMismatchError(`Explicit lead tenant_id "${input.tenant_id}" does not match authorized scope "${scope.tenantId}".`);
        }
      }

      const tenantId = scope.tenantId || input.tenant_id;
      const client = getSupabaseClient();
      const now = new Date().toISOString();
      const id = input.id || generateUUID();
      const record: Lead = {
        id,
        tenant_id: tenantId,
        lead_id: input.lead_id,
        name: input.name ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        source: input.source ?? 'MANUAL_IMPORT',
        source_reference: input.source_reference ?? null,
        status: input.status ?? 'RAW',
        created_at: now,
        updated_at: now,
      };

      if (client) {
        try {
          const { data, error } = await client.from('leads').insert(record).select().single();
          if (error) {
            if (error.code === 'PGRST204' || error.code === 'PGRST205' || error.message?.includes('schema cache') || error.message?.includes('not find the')) {
              console.warn(`[Supabase Fallback] Schema cache pending on leads (${error.message}). Using local store.`);
              leadsStore.set(record.id, record);
              return record;
            }
            if (error.code === '23505') {
              console.warn(`[Supabase Persistence Warning] Duplicate key conflict (code 23505) on lead_id "${input.lead_id}". Resolving lead record.`);
              let fetchQuery = client.from('leads').select('*').eq('lead_id', input.lead_id);
              if (!scope.isPlatformAdmin && tenantId) {
                fetchQuery = fetchQuery.eq('tenant_id', tenantId);
              }
              const { data: existingData, error: fetchErr } = await fetchQuery.maybeSingle();

              if (!fetchErr && existingData) {
                const samePhone = Boolean(input.phone && existingData.phone && input.phone.replace(/\D/g, '') === existingData.phone.replace(/\D/g, ''));
                const sameEmail = Boolean(input.email && existingData.email && input.email.toLowerCase().trim() === existingData.email.toLowerCase().trim());

                if (samePhone || sameEmail || (!input.phone && !input.email)) {
                  let updateQuery = client
                    .from('leads')
                    .update({
                      name: input.name ?? existingData.name,
                      phone: input.phone ?? existingData.phone,
                      email: input.email ?? existingData.email,
                      source_reference: input.source_reference ?? existingData.source_reference,
                      status: input.status ?? existingData.status,
                      updated_at: now,
                    })
                    .eq('id', existingData.id);
                  if (!scope.isPlatformAdmin && tenantId) {
                    updateQuery = updateQuery.eq('tenant_id', tenantId);
                  }
                  const { data: updatedData } = await updateQuery.select().single();

                  const resolved = updatedData || existingData;
                  leadsStore.set(resolved.id, resolved);
                  return resolved;
                } else {
                  const freshLeadId = `${input.lead_id}-${Math.floor(1000 + Math.random() * 9000)}`;
                  const newRecord = { ...record, lead_id: freshLeadId };
                  const { data: freshData, error: freshErr } = await client
                    .from('leads')
                    .insert(newRecord)
                    .select()
                    .single();

                  if (!freshErr && freshData) {
                    leadsStore.set(freshData.id, freshData);
                    return freshData;
                  }
                }
              }
            }
            console.error('[Supabase Persistence Error] Failed to insert lead:', error);
            throw new Error(`Supabase insert failed on public.leads: ${error.message} (code: ${error.code || 'UNKNOWN'})`);
          }
          if (data) {
            leadsStore.set(data.id, data);
            return data;
          }
        } catch (err: any) {
          if (err?.message?.includes('schema cache') || err?.message?.includes('PGRST204') || err?.message?.includes('not find the')) {
            leadsStore.set(record.id, record);
            return record;
          }
          throw err;
        }
      }

      leadsStore.set(record.id, record);
      return record;
    },

    getLead: async (scopeOrId, maybeId) => {
      const { scope, id } = parseScopeAndId(scopeOrId, maybeId);
      const client = getSupabaseClient();
      if (client) {
        try {
          let query = client.from('leads').select('*').eq('id', id);
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          const { data, error } = await query.maybeSingle();
          if (error) {
            if (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205' || error.message?.includes('does not exist') || error.message?.includes('not find the')) {
              // fallback
            } else {
              console.error('[Supabase Query Error] Failed to get lead by id:', error);
              throw new Error(`Supabase query failed on public.leads: ${error.message}`);
            }
          } else if (data) {
            leadsStore.set(data.id, data);
            return data;
          } else {
            return null;
          }
        } catch (err: any) {
          if (!err?.message?.includes('does not exist') && !err?.message?.includes('PGRST')) {
            throw err;
          }
        }
      }
      const record = leadsStore.get(id);
      if (!record) return null;
      if (!scope.isPlatformAdmin && scope.tenantId && record.tenant_id && record.tenant_id !== scope.tenantId) {
        return null;
      }
      return record;
    },

    getLeadByLeadId: async (scopeOrLeadId, maybeLeadId) => {
      const { scope, id: leadId } = parseScopeAndId(scopeOrLeadId, maybeLeadId);
      const client = getSupabaseClient();
      if (client) {
        try {
          let query = client.from('leads').select('*').eq('lead_id', leadId);
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          const { data, error } = await query.maybeSingle();
          if (error) {
            if (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205' || error.message?.includes('does not exist') || error.message?.includes('not find the')) {
              // fallback
            } else {
              console.error('[Supabase Query Error] Failed to get lead by lead_id:', error);
              throw new Error(`Supabase query failed on public.leads: ${error.message}`);
            }
          } else if (data) {
            leadsStore.set(data.id, data);
            return data;
          } else {
            return null;
          }
        } catch (err: any) {
          if (!err?.message?.includes('does not exist') && !err?.message?.includes('PGRST')) {
            throw err;
          }
        }
      }
      for (const lead of leadsStore.values()) {
        if (lead.lead_id === leadId) {
          if (!scope.isPlatformAdmin && scope.tenantId && lead.tenant_id && lead.tenant_id !== scope.tenantId) {
            continue;
          }
          return lead;
        }
      }
      return null;
    },

    updateLead: async (scopeOrId, idOrUpdates, maybeUpdates) => {
      let scope: any;
      let id: string;
      let updates: Partial<Omit<Lead, 'id' | 'lead_id' | 'created_at'>>;

      if (maybeUpdates !== undefined) {
        scope = resolveEffectiveTenantScope(scopeOrId as TenantScope);
        id = idOrUpdates as string;
        updates = maybeUpdates;
      } else {
        scope = resolveEffectiveTenantScope(undefined);
        id = scopeOrId as string;
        updates = idOrUpdates as Partial<Omit<Lead, 'id' | 'lead_id' | 'created_at'>>;
      }

      const client = getSupabaseClient();
      const now = new Date().toISOString();

      if (client) {
        try {
          let query = client
            .from('leads')
            .update({ ...updates, updated_at: now })
            .eq('id', id);
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          const { data, error } = await query.select().single();
          if (error) {
            if (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205' || error.message?.includes('does not exist') || error.message?.includes('not find the')) {
              // fallback
            } else {
              console.error('[Supabase Update Error] Failed to update lead:', error);
              throw new Error(`Supabase update failed on public.leads: ${error.message}`);
            }
          } else if (data) {
            leadsStore.set(data.id, data);
            return data;
          }
        } catch (err: any) {
          if (!err?.message?.includes('does not exist') && !err?.message?.includes('PGRST')) {
            throw err;
          }
        }
      }

      const existing = leadsStore.get(id);
      if (!existing) {
        throw new Error(`Lead with ID ${id} not found.`);
      }
      if (!scope.isPlatformAdmin && scope.tenantId && existing.tenant_id && existing.tenant_id !== scope.tenantId) {
        throw new Error(`Lead with ID ${id} not found in authorized tenant context.`);
      }
      const updated: Lead = {
        ...existing,
        ...updates,
        updated_at: now,
      };
      leadsStore.set(id, updated);
      return updated;
    },

    listLeads: async (scopeOrFilter, maybeFilter) => {
      const { scope, filter } = parseScopeAndFilter(scopeOrFilter, maybeFilter);
      const client = getSupabaseClient();
      if (client) {
        try {
          let query = client.from('leads').select('*').order('created_at', { ascending: false });
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          if (filter?.status) {
            query = query.eq('status', filter.status);
          }
          if (filter?.limit) {
            query = query.limit(filter.limit);
          }
          const { data, error } = await query;
          if (!error && data) {
            for (const item of data) {
              leadsStore.set(item.id, item);
            }
          }
        } catch (err: any) {
          // ignore
        }
      }

      let all = Array.from(leadsStore.values()).filter((l) => {
        if (!scope.isPlatformAdmin && scope.tenantId && l.tenant_id && l.tenant_id !== scope.tenantId) {
          return false;
        }
        return true;
      }).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      if (filter?.status) {
        all = all.filter((l) => l.status === filter.status);
      }
      if (filter?.limit) {
        all = all.slice(filter.offset || 0, (filter.offset || 0) + filter.limit);
      }
      return all;
    },

    deleteLead: async (scopeOrId, maybeId) => {
      const { scope, id } = parseScopeAndId(scopeOrId, maybeId);
      const client = getSupabaseClient();
      if (client) {
        try {
          let query = client.from('leads').delete().eq('id', id);
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          const { error } = await query;
          if (error) {
            if (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205' || error.message?.includes('does not exist') || error.message?.includes('not find the')) {
              // fallback
            } else {
              console.error('[Supabase Delete Error] Failed to delete lead:', error);
              throw new Error(`Supabase delete failed on public.leads: ${error.message}`);
            }
          }
        } catch (err: any) {
          if (!err?.message?.includes('does not exist') && !err?.message?.includes('PGRST')) {
            throw err;
          }
        }
      }
      const existing = leadsStore.get(id);
      if (existing && !scope.isPlatformAdmin && scope.tenantId && existing.tenant_id && existing.tenant_id !== scope.tenantId) {
        return false;
      }
      return leadsStore.delete(id);
    },
  };
}

export function createLeadEnrichmentRepository(
  enrichmentStore: Map<string, LeadEnrichment[]>,
  leadsRepo: LeadsRepository
): LeadEnrichmentRepository {
  return {
    createEnrichment: async (scopeOrEnrichment, maybeEnrichment) => {
      const scope = resolveEffectiveTenantScope(maybeEnrichment !== undefined ? (scopeOrEnrichment as TenantScope) : undefined);
      const input = maybeEnrichment !== undefined ? maybeEnrichment : (scopeOrEnrichment as any);

      // Verify parent lead is in scope
      const lead = await leadsRepo.getLead(scope, input.lead_id);
      if (!lead) {
        throw new TenantMismatchError(`Cannot create enrichment for lead ${input.lead_id}: lead not found in authorized tenant context.`);
      }

      const client = getSupabaseClient();
      const now = new Date().toISOString();
      const id = input.id || generateUUID();
      const tenantId = scope.tenantId || lead.tenant_id;
      const record: LeadEnrichment = {
        id,
        tenant_id: tenantId,
        lead_id: input.lead_id,
        platform: input.platform ?? null,
        username: input.username ?? null,
        profile_url: input.profile_url ?? null,
        full_name: input.full_name ?? null,
        bio: input.bio ?? null,
        website: input.website ?? null,
        company: input.company ?? null,
        location: input.location ?? null,
        raw_data: input.raw_data ?? null,
        enriched_data: input.enriched_data ?? null,
        source_confidence: input.source_confidence ?? 0.5,
        created_at: now,
      };

      if (client) {
        try {
          const { data, error } = await client.from('lead_enrichment').insert(record).select().single();
          if (error) {
            if (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205' || error.message?.includes('does not exist') || error.message?.includes('not find the')) {
              // fallback
            } else {
              console.error('[Supabase Insert Error] lead_enrichment:', error);
              throw new Error(`Supabase insert failed on lead_enrichment: ${error.message}`);
            }
          } else if (data) return data;
        } catch (err: any) {
          if (!err?.message?.includes('does not exist') && !err?.message?.includes('PGRST')) {
            throw err;
          }
        }
      }

      const list = enrichmentStore.get(record.lead_id) || [];
      list.push(record);
      enrichmentStore.set(record.lead_id, list);
      return record;
    },

    getEnrichment: async (scopeOrLeadId, maybeLeadId) => {
      const { scope, id: leadId } = parseScopeAndId(scopeOrLeadId, maybeLeadId);
      const client = getSupabaseClient();
      if (client) {
        try {
          let query = client.from('lead_enrichment').select('*').eq('lead_id', leadId);
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          const { data, error } = await query;
          if (error) {
            if (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205' || error.message?.includes('does not exist') || error.message?.includes('not find the')) {
              // fallback
            } else {
              console.error('[Supabase Query Error] lead_enrichment:', error);
              throw new Error(`Supabase query failed on lead_enrichment: ${error.message}`);
            }
          } else if (data) return data;
        } catch (err: any) {
          if (!err?.message?.includes('does not exist') && !err?.message?.includes('PGRST')) {
            throw err;
          }
        }
      }
      const list = enrichmentStore.get(leadId) || [];
      if (!scope.isPlatformAdmin && scope.tenantId) {
        return list.filter((e) => !e.tenant_id || e.tenant_id === scope.tenantId);
      }
      return list;
    },
  };
}

export function createLeadEventsRepository(
  leadEventsStore: Map<string, LeadEvent[]>,
  leadsRepo: LeadsRepository
): LeadEventsRepository {
  return {
    appendLeadEvent: async (scopeOrEvent, maybeEvent) => {
      const scope = resolveEffectiveTenantScope(maybeEvent !== undefined ? (scopeOrEvent as TenantScope) : undefined);
      const input = maybeEvent !== undefined ? maybeEvent : (scopeOrEvent as any);

      // Verify parent lead is in scope
      const lead = await leadsRepo.getLead(scope, input.lead_id);
      if (!lead) {
        throw new TenantMismatchError(`Cannot create lead event for lead ${input.lead_id}: lead not found in authorized tenant context.`);
      }

      const client = getSupabaseClient();
      const now = new Date().toISOString();
      const id = input.id || generateUUID();
      const tenantId = scope.tenantId || lead.tenant_id;
      const record: LeadEvent = {
        id,
        tenant_id: tenantId,
        lead_id: input.lead_id,
        event_type: input.event_type,
        event_data: input.event_data ?? null,
        created_at: now,
      };

      if (client) {
        try {
          const { data, error } = await client.from('lead_events').insert(record).select().single();
          if (error) {
            if (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205' || error.message?.includes('does not exist') || error.message?.includes('not find the')) {
              // fallback
            } else {
              console.error('[Supabase Insert Error] lead_events:', error);
              throw new Error(`Supabase insert failed on lead_events: ${error.message}`);
            }
          } else if (data) return data;
        } catch (err: any) {
          if (!err?.message?.includes('does not exist') && !err?.message?.includes('PGRST')) {
            throw err;
          }
        }
      }

      const list = leadEventsStore.get(record.lead_id) || [];
      list.push(record);
      leadEventsStore.set(record.lead_id, list);
      return record;
    },

    getLeadEvents: async (scopeOrLeadId, maybeLeadId) => {
      const { scope, id: leadId } = parseScopeAndId(scopeOrLeadId, maybeLeadId);
      const client = getSupabaseClient();
      if (client) {
        try {
          let query = client
            .from('lead_events')
            .select('*')
            .eq('lead_id', leadId)
            .order('created_at', { ascending: true });
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          const { data, error } = await query;
          if (error) {
            if (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205' || error.message?.includes('does not exist') || error.message?.includes('not find the')) {
              // fallback
            } else {
              console.error('[Supabase Query Error] lead_events:', error);
              throw new Error(`Supabase query failed on lead_events: ${error.message}`);
            }
          } else if (data) return data;
        } catch (err: any) {
          if (!err?.message?.includes('does not exist') && !err?.message?.includes('PGRST')) {
            throw err;
          }
        }
      }
      const list = leadEventsStore.get(leadId) || [];
      if (!scope.isPlatformAdmin && scope.tenantId) {
        return list.filter((e) => !e.tenant_id || e.tenant_id === scope.tenantId);
      }
      return list;
    },
  };
}
