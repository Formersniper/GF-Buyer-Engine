/**
 * Tenant-Aware Projects and Project Matches Repositories
 */

import { DbProject, DbProjectMatch } from '../../../schemas/database';
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
import { LeadsRepository } from './leadsRepo';

export interface ProjectsRepository {
  createProject(
    scopeOrProject:
      | TenantScope
      | TenantContext
      | (Omit<DbProject, 'id' | 'created_at' | 'updated_at'> & { id?: string }),
    maybeProject?: Omit<DbProject, 'id' | 'created_at' | 'updated_at'> & { id?: string }
  ): Promise<DbProject>;
  getProject(scopeOrId: TenantScope | TenantContext | string, maybeId?: string): Promise<DbProject | null>;
  getProjectByCode(scopeOrCode: TenantScope | TenantContext | string, maybeCode?: string): Promise<DbProject | null>;
  listProjects(
    scopeOrFilter?: TenantScope | TenantContext | string | { city?: string; status?: string; limit?: number },
    maybeFilter?: { city?: string; status?: string; limit?: number }
  ): Promise<DbProject[]>;
}

export interface ProjectMatchesRepository {
  upsertProjectMatch(
    scopeOrMatch:
      | TenantScope
      | TenantContext
      | (Omit<DbProjectMatch, 'id' | 'created_at'> & { id?: string }),
    maybeMatch?: Omit<DbProjectMatch, 'id' | 'created_at'> & { id?: string }
  ): Promise<DbProjectMatch>;
  getProjectMatches(scopeOrLeadId: TenantScope | TenantContext | string, maybeLeadId?: string): Promise<DbProjectMatch[]>;
}

export function createProjectsRepository(
  projectsStore: Map<string, DbProject>
): ProjectsRepository {
  return {
    createProject: async (scopeOrProject, maybeProject) => {
      const scope = resolveEffectiveTenantScope(maybeProject !== undefined ? (scopeOrProject as TenantScope) : undefined);
      const input = maybeProject !== undefined ? maybeProject : (scopeOrProject as any);

      const client = getSupabaseClient();
      const now = new Date().toISOString();
      const id = input.id || generateUUID();
      const tenantId = scope.tenantId || input.tenant_id;
      const record: DbProject = {
        id,
        tenant_id: tenantId,
        project_code: input.project_code,
        project_name: input.project_name,
        developer_name: input.developer_name ?? null,
        city: input.city ?? null,
        locality: input.locality ?? null,
        micro_market: input.micro_market ?? null,
        property_type: input.property_type ?? null,
        configurations: input.configurations ?? null,
        price_min: input.price_min ?? null,
        price_max: input.price_max ?? null,
        possession: input.possession ?? null,
        project_description: input.project_description ?? null,
        features: input.features ?? null,
        amenities: input.amenities ?? null,
        project_url: input.project_url ?? null,
        status: input.status ?? 'ACTIVE',
        created_at: now,
        updated_at: now,
      };

      if (client) {
        try {
          const { data, error } = await client.from('projects').insert(record).select().single();
          if (error) {
            if (error.code === 'PGRST204' || error.code === 'PGRST205' || error.message?.includes('schema cache') || error.message?.includes('not find the')) {
              projectsStore.set(record.id, record);
              return record;
            }
            console.error('[Supabase Insert Error] projects:', error);
            throw new Error(`Supabase insert failed on projects: ${error.message}`);
          }
          if (data) {
            projectsStore.set(data.id, data);
            return data;
          }
        } catch (err: any) {
          if (err?.message?.includes('schema cache') || err?.message?.includes('PGRST204') || err?.message?.includes('not find the')) {
            projectsStore.set(record.id, record);
            return record;
          }
          throw err;
        }
      }

      projectsStore.set(record.id, record);
      return record;
    },

    getProject: async (scopeOrId, maybeId) => {
      const { scope, id } = parseScopeAndId(scopeOrId, maybeId);
      const client = getSupabaseClient();
      if (client) {
        try {
          let query = client.from('projects').select('*').eq('id', id);
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          const { data, error } = await query.maybeSingle();
          if (error) {
            if (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205' || error.message?.includes('does not exist') || error.message?.includes('not find the')) {
              // fallback
            } else {
              console.error('[Supabase Query Error] projects:', error);
              throw new Error(`Supabase query failed on projects: ${error.message}`);
            }
          } else if (data) return data;
        } catch (err: any) {
          if (!err?.message?.includes('does not exist') && !err?.message?.includes('PGRST')) {
            throw err;
          }
        }
      }
      const p = projectsStore.get(id) || null;
      if (!p) return null;
      if (!scope.isPlatformAdmin && scope.tenantId && p.tenant_id && p.tenant_id !== scope.tenantId) {
        return null;
      }
      return p;
    },

    getProjectByCode: async (scopeOrCode, maybeCode) => {
      const { scope, id: projectCode } = parseScopeAndId(scopeOrCode, maybeCode);
      const client = getSupabaseClient();
      if (client) {
        try {
          let query = client.from('projects').select('*').eq('project_code', projectCode);
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          const { data, error } = await query.maybeSingle();
          if (error) {
            if (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205' || error.message?.includes('does not exist') || error.message?.includes('not find the')) {
              // fallback
            } else {
              console.error('[Supabase Query Error] projects:', error);
              throw new Error(`Supabase query failed on projects: ${error.message}`);
            }
          } else if (data) return data;
        } catch (err: any) {
          if (!err?.message?.includes('does not exist') && !err?.message?.includes('PGRST')) {
            throw err;
          }
        }
      }
      for (const p of projectsStore.values()) {
        if (p.project_code === projectCode) {
          if (!scope.isPlatformAdmin && scope.tenantId && p.tenant_id && p.tenant_id !== scope.tenantId) {
            continue;
          }
          return p;
        }
      }
      return null;
    },

    listProjects: async (scopeOrFilter, maybeFilter) => {
      const { scope, filter } = parseScopeAndFilter(scopeOrFilter, maybeFilter);
      const client = getSupabaseClient();
      if (client) {
        try {
          let query = client.from('projects').select('*');
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          if (filter?.city) query = query.eq('city', filter.city);
          if (filter?.status) query = query.eq('status', filter.status);
          if (filter?.limit) query = query.limit(filter.limit);
          const { data, error } = await query;
          if (error) {
            if (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205' || error.message?.includes('does not exist') || error.message?.includes('not find the')) {
              // fallback
            } else {
              console.error('[Supabase Query Error] projects:', error);
              throw new Error(`Supabase query failed on projects: ${error.message}`);
            }
          } else if (data) return data;
        } catch (err: any) {
          if (!err?.message?.includes('does not exist') && !err?.message?.includes('PGRST')) {
            throw err;
          }
        }
      }

      let all = Array.from(projectsStore.values()).filter((p) => {
        if (!scope.isPlatformAdmin && scope.tenantId && p.tenant_id && p.tenant_id !== scope.tenantId) {
          return false;
        }
        return true;
      });
      if (filter?.city) {
        all = all.filter((p) => p.city?.toLowerCase() === filter.city?.toLowerCase());
      }
      if (filter?.status) {
        all = all.filter((p) => p.status === filter.status);
      }
      if (filter?.limit) {
        all = all.slice(0, filter.limit);
      }
      return all;
    },
  };
}

export function createProjectMatchesRepository(
  projectMatchesStore: Map<string, DbProjectMatch[]>,
  leadsRepo: LeadsRepository
): ProjectMatchesRepository {
  return {
    upsertProjectMatch: async (scopeOrMatch, maybeMatch) => {
      const scope = resolveEffectiveTenantScope(maybeMatch !== undefined ? (scopeOrMatch as TenantScope) : undefined);
      const input = maybeMatch !== undefined ? maybeMatch : (scopeOrMatch as any);

      // Verify parent lead is accessible within scope
      const lead = await leadsRepo.getLead(scope, input.lead_id);
      if (!lead) {
        throw new TenantMismatchError(`Cannot upsert project match for lead ${input.lead_id}: lead not found in authorized tenant context.`);
      }

      const client = getSupabaseClient();
      const now = new Date().toISOString();
      const id = input.id || generateUUID();
      const tenantId = scope.tenantId || lead.tenant_id;
      const record: DbProjectMatch = {
        id,
        tenant_id: tenantId,
        lead_id: input.lead_id,
        project_id: input.project_id,
        match_score: input.match_score ?? null,
        budget_score: input.budget_score ?? null,
        location_score: input.location_score ?? null,
        configuration_score: input.configuration_score ?? null,
        purpose_score: input.purpose_score ?? null,
        preference_score: input.preference_score ?? null,
        timeline_score: input.timeline_score ?? null,
        buyer_confirmed: input.buyer_confirmed ?? false,
        reason: input.reason ?? null,
        created_at: now,
      };

      if (client) {
        try {
          const { data, error } = await client
            .from('project_matches')
            .upsert(record, { onConflict: 'lead_id,project_id' })
            .select()
            .single();
          if (error) {
            if (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205' || error.message?.includes('does not exist') || error.message?.includes('not find the')) {
              // fallback
            } else {
              console.error('[Supabase Upsert Error] project_matches:', error);
              throw new Error(`Supabase upsert failed on project_matches: ${error.message}`);
            }
          } else if (data) return data;
        } catch (err: any) {
          if (!err?.message?.includes('does not exist') && !err?.message?.includes('PGRST')) {
            throw err;
          }
        }
      }

      const list = projectMatchesStore.get(record.lead_id) || [];
      const filtered = list.filter((m) => m.project_id !== record.project_id);
      filtered.push(record);
      projectMatchesStore.set(record.lead_id, filtered);
      return record;
    },

    getProjectMatches: async (scopeOrLeadId, maybeLeadId) => {
      const { scope, id: leadId } = parseScopeAndId(scopeOrLeadId, maybeLeadId);
      const client = getSupabaseClient();
      if (client) {
        try {
          let query = client.from('project_matches').select('*').eq('lead_id', leadId);
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          const { data, error } = await query;
          if (error) {
            if (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205' || error.message?.includes('does not exist') || error.message?.includes('not find the')) {
              // fallback
            } else {
              console.error('[Supabase Query Error] project_matches:', error);
              throw new Error(`Supabase query failed on project_matches: ${error.message}`);
            }
          } else if (data) return data;
        } catch (err: any) {
          if (!err?.message?.includes('does not exist') && !err?.message?.includes('PGRST')) {
            throw err;
          }
        }
      }
      const list = projectMatchesStore.get(leadId) || [];
      if (!scope.isPlatformAdmin && scope.tenantId) {
        return list.filter((m) => !m.tenant_id || m.tenant_id === scope.tenantId);
      }
      return list;
    },
  };
}
