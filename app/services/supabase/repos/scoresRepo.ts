/**
 * Tenant-Aware Buyer Scores Repository & Priority Queue
 */

import { BuyerScore, BuyerScoreRecord, PriorityQueueItem } from '../../../schemas/database';
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
import { BuyerProfilesRepository } from './profilesRepo';
import { BuyerQualificationsRepository } from './voiceRepo';

export interface BuyerScoresRepository {
  createBuyerScore(
    scopeOrScore:
      | TenantScope
      | TenantContext
      | (Omit<BuyerScore, 'id' | 'created_at'> & { id?: string }),
    maybeScore?: Omit<BuyerScore, 'id' | 'created_at'> & { id?: string }
  ): Promise<BuyerScore>;
  createBuyerScoreRecord(
    scopeOrRecord:
      | TenantScope
      | TenantContext
      | (Omit<BuyerScoreRecord, 'id' | 'created_at' | 'updated_at'> & { id?: string }),
    maybeRecord?: Omit<BuyerScoreRecord, 'id' | 'created_at' | 'updated_at'> & { id?: string }
  ): Promise<BuyerScoreRecord>;
  getBuyerScore(scopeOrId: TenantScope | TenantContext | string, maybeId?: string): Promise<BuyerScoreRecord | null>;
  getBuyerScoreByQualificationId(
    scopeOrQualId: TenantScope | TenantContext | string,
    qualIdOrRuleVersion?: string,
    maybeRuleVersion?: string
  ): Promise<BuyerScoreRecord | null>;
  getBuyerScoresByLeadId(scopeOrLeadId: TenantScope | TenantContext | string, maybeLeadId?: string): Promise<BuyerScoreRecord[]>;
  getLatestBuyerScore(scopeOrLeadId: TenantScope | TenantContext | string, maybeLeadId?: string): Promise<BuyerScore | null>;
  getLatestBuyerScoreRecord(scopeOrLeadId: TenantScope | TenantContext | string, maybeLeadId?: string): Promise<BuyerScoreRecord | null>;
  listPriorityQueue(
    scopeOrFilter?: TenantScope | TenantContext | string | { tier?: string; limit?: number },
    maybeFilter?: { tier?: string; limit?: number }
  ): Promise<PriorityQueueItem[]>;
}

export function createBuyerScoresRepository(
  buyerScoresStore: Map<string, BuyerScore[]>,
  buyerScoreRecordsStore: Map<string, BuyerScoreRecord>,
  leadsRepo: LeadsRepository,
  qualificationsRepo: BuyerQualificationsRepository,
  buyerProfilesRepo: BuyerProfilesRepository
): BuyerScoresRepository {
  return {
    createBuyerScore: async (scopeOrScore, maybeScore) => {
      const scope = resolveEffectiveTenantScope(maybeScore !== undefined ? (scopeOrScore as TenantScope) : undefined);
      const input = maybeScore !== undefined ? maybeScore : (scopeOrScore as any);

      const lead = await leadsRepo.getLead(scope, input.lead_id);
      if (!lead) {
        throw new TenantMismatchError(`Cannot create buyer score for lead ${input.lead_id}: lead not found in authorized tenant context.`);
      }

      const client = getSupabaseClient();
      const now = new Date().toISOString();
      const id = input.id || generateUUID();
      const tenantId = scope.tenantId || lead.tenant_id;
      const record: BuyerScore = {
        id,
        tenant_id: tenantId,
        lead_id: input.lead_id,
        intent_score: input.intent_score ?? null,
        budget_score: input.budget_score ?? null,
        location_score: input.location_score ?? null,
        timeline_score: input.timeline_score ?? null,
        decision_score: input.decision_score ?? null,
        project_fit_score: input.project_fit_score ?? null,
        overall_score: input.overall_score ?? null,
        qualification: input.qualification ?? 'NURTURE',
        reason: input.reason ?? null,
        created_at: now,
      };

      if (client) {
        try {
          const { data, error } = await client.from('buyer_scores').insert(record).select().single();
          if (error) {
            if (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205' || error.message?.includes('does not exist') || error.message?.includes('not find the')) {
              // fallback
            } else {
              console.error('[Supabase Insert Error] buyer_scores:', error);
              throw new Error(`Supabase insert failed on buyer_scores: ${error.message}`);
            }
          } else if (data) return data;
        } catch (err: any) {
          if (!err?.message?.includes('does not exist') && !err?.message?.includes('PGRST')) {
            throw err;
          }
        }
      }

      const list = buyerScoresStore.get(record.lead_id) || [];
      list.push(record);
      buyerScoresStore.set(record.lead_id, list);
      return record;
    },

    createBuyerScoreRecord: async (scopeOrRecord, maybeRecord) => {
      const scope = resolveEffectiveTenantScope(maybeRecord !== undefined ? (scopeOrRecord as TenantScope) : undefined);
      const input = maybeRecord !== undefined ? maybeRecord : (scopeOrRecord as any);

      const lead = await leadsRepo.getLead(scope, input.lead_id);
      if (!lead) {
        throw new TenantMismatchError(`Cannot create buyer score record for lead ${input.lead_id}: lead not found in authorized tenant context.`);
      }

      const client = getSupabaseClient();
      const now = new Date().toISOString();
      const id = input.id || generateUUID();
      const compScore = input.score ?? input.composite_score ?? input.total_score ?? 0;
      const tenantId = scope.tenantId || lead.tenant_id;
      const record: BuyerScoreRecord = {
        id,
        tenant_id: tenantId,
        lead_id: input.lead_id,
        qualification_id: input.qualification_id ?? null,
        extraction_id: input.extraction_id ?? null,
        score: compScore,
        composite_score: compScore,
        total_score: compScore,
        scoring_confidence: input.scoring_confidence ?? 0.85,
        tier: input.tier,
        score_band: input.score_band,
        score_status: input.score_status ?? (input.tier === 'TIER_4_REVIEW' ? 'REQUIRES_REVIEW' : 'CALCULATED'),
        dimension_scores: input.dimension_scores,
        components: input.components ?? input.breakdown ?? [],
        breakdown: input.breakdown ?? input.components ?? [],
        key_drivers: input.key_drivers ?? [],
        risk_factors: input.risk_factors ?? [],
        reason_codes: input.reason_codes ?? [],
        sla_dispatch: input.sla_dispatch,
        project_fit_status: input.project_fit_status ?? 'PENDING',
        scoring_version: input.scoring_version ?? '1.0',
        rule_version: input.rule_version ?? '1.0',
        calculated_at: input.calculated_at ?? now,
        created_at: now,
        updated_at: now,
      };

      if (client) {
        try {
          let queryExisting = client
            .from('buyer_scores')
            .select('id')
            .eq('qualification_id', record.qualification_id)
            .eq('rule_version', record.rule_version);
          if (!scope.isPlatformAdmin && tenantId) {
            queryExisting = queryExisting.eq('tenant_id', tenantId);
          }
          const { data: existing } = await queryExisting.maybeSingle();

          const dbPayload = {
            id: existing ? existing.id : record.id,
            tenant_id: tenantId,
            lead_id: record.lead_id,
            qualification_id: record.qualification_id,
            extraction_id: record.extraction_id,
            composite_score: record.composite_score,
            scoring_confidence: record.scoring_confidence,
            tier: record.tier,
            dimension_scores: record.dimension_scores,
            breakdown: record.breakdown,
            key_drivers: record.key_drivers,
            risk_factors: record.risk_factors,
            sla_dispatch: record.sla_dispatch,
            scoring_version: record.scoring_version,
            rule_version: record.rule_version,
            created_at: record.created_at,
            updated_at: record.updated_at,
          };

          let query;
          if (existing) {
            query = client.from('buyer_scores').update(dbPayload).eq('id', existing.id);
          } else {
            query = client.from('buyer_scores').insert(dbPayload);
          }
          const { data, error } = await query.select().single();
          if (!error && data) {
            const mergedRecord: BuyerScoreRecord = { ...record, ...data };
            buyerScoreRecordsStore.set(mergedRecord.id, mergedRecord);
            return mergedRecord;
          }
          if (error) {
            console.warn('[Supabase Insert Error] buyer_scores fallback to in-memory:', error.message);
          }
        } catch (err) {
          console.warn('[Supabase Insert Exception] buyer_scores fallback:', err);
        }
      }

      buyerScoreRecordsStore.set(record.id, record);
      return record;
    },

    getBuyerScore: async (scopeOrId, maybeId) => {
      const { scope, id } = parseScopeAndId(scopeOrId, maybeId);
      const client = getSupabaseClient();
      if (client) {
        try {
          let query = client.from('buyer_scores').select('*').eq('id', id);
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          const { data, error } = await query.maybeSingle();
          if (!error && data) return data;
        } catch {
          // fallback
        }
      }
      const record = buyerScoreRecordsStore.get(id) || null;
      if (!record) return null;
      if (!scope.isPlatformAdmin && scope.tenantId && record.tenant_id && record.tenant_id !== scope.tenantId) {
        return null;
      }
      return record;
    },

    getBuyerScoreByQualificationId: async (scopeOrQualId, qualIdOrRuleVersion, maybeRuleVersion) => {
      let scope: any;
      let qualificationId: string;
      let ruleVersion: string | undefined;

      if (
        typeof scopeOrQualId === 'object' ||
        (maybeRuleVersion !== undefined) ||
        (typeof scopeOrQualId === 'string' && qualIdOrRuleVersion !== undefined && !qualIdOrRuleVersion.startsWith('1.') && !qualIdOrRuleVersion.startsWith('2.') && !qualIdOrRuleVersion.startsWith('v'))
      ) {
        scope = resolveEffectiveTenantScope(scopeOrQualId as TenantScope);
        qualificationId = qualIdOrRuleVersion as string;
        ruleVersion = maybeRuleVersion;
      } else {
        scope = resolveEffectiveTenantScope(undefined);
        qualificationId = scopeOrQualId as string;
        ruleVersion = qualIdOrRuleVersion;
      }

      const client = getSupabaseClient();
      if (client) {
        try {
          let query = client.from('buyer_scores').select('*').eq('qualification_id', qualificationId);
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          if (ruleVersion) {
            query = query.eq('rule_version', ruleVersion);
          }
          const { data, error } = await query.order('created_at', { ascending: false }).limit(1);
          if (!error && data && data.length > 0) return data[0];
        } catch {
          // fallback
        }
      }
      return (
        Array.from(buyerScoreRecordsStore.values())
          .filter((s) => {
            if (s.qualification_id !== qualificationId) return false;
            if (!scope.isPlatformAdmin && scope.tenantId && s.tenant_id && s.tenant_id !== scope.tenantId) return false;
            if (ruleVersion && s.rule_version !== ruleVersion) return false;
            return true;
          })
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] || null
      );
    },

    getBuyerScoresByLeadId: async (scopeOrLeadId, maybeLeadId) => {
      const { scope, id: leadId } = parseScopeAndId(scopeOrLeadId, maybeLeadId);
      const client = getSupabaseClient();
      if (client) {
        try {
          let query = client
            .from('buyer_scores')
            .select('*')
            .eq('lead_id', leadId);
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          const { data, error } = await query.order('created_at', { ascending: true });
          if (!error && data) return data;
        } catch {
          // fallback
        }
      }
      return Array.from(buyerScoreRecordsStore.values()).filter((s) => {
        if (s.lead_id !== leadId) return false;
        if (!scope.isPlatformAdmin && scope.tenantId && s.tenant_id && s.tenant_id !== scope.tenantId) return false;
        return true;
      });
    },

    getLatestBuyerScore: async (scopeOrLeadId, maybeLeadId) => {
      const { scope, id: leadId } = parseScopeAndId(scopeOrLeadId, maybeLeadId);
      const client = getSupabaseClient();
      if (client) {
        try {
          let query = client
            .from('buyer_scores')
            .select('*')
            .eq('lead_id', leadId);
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          const { data, error } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle();
          if (error) {
            if (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205' || error.message?.includes('does not exist') || error.message?.includes('not find the')) {
              // fallback
            } else {
              console.error('[Supabase Query Error] buyer_scores:', error);
              throw new Error(`Supabase query failed on buyer_scores: ${error.message}`);
            }
          } else if (data) return data;
        } catch (err: any) {
          if (!err?.message?.includes('does not exist') && !err?.message?.includes('PGRST')) {
            throw err;
          }
        }
      }

      const list = (buyerScoresStore.get(leadId) || []).filter((s) => {
        if (!scope.isPlatformAdmin && scope.tenantId && s.tenant_id && s.tenant_id !== scope.tenantId) return false;
        return true;
      });
      if (list.length === 0) return null;
      return list[list.length - 1];
    },

    getLatestBuyerScoreRecord: async (scopeOrLeadId, maybeLeadId) => {
      const { scope, id: leadId } = parseScopeAndId(scopeOrLeadId, maybeLeadId);
      const client = getSupabaseClient();
      if (client) {
        try {
          let query = client
            .from('buyer_scores')
            .select('*')
            .eq('lead_id', leadId);
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          const { data, error } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle();
          if (!error && data) return data;
        } catch {
          // fallback
        }
      }
      const list = Array.from(buyerScoreRecordsStore.values())
        .filter((s) => {
          if (s.lead_id !== leadId) return false;
          if (!scope.isPlatformAdmin && scope.tenantId && s.tenant_id && s.tenant_id !== scope.tenantId) return false;
          return true;
        })
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      return list[0] || null;
    },

    listPriorityQueue: async (scopeOrFilter, maybeFilter) => {
      const { scope, filter } = parseScopeAndFilter(scopeOrFilter, maybeFilter);
      const scores = Array.from(buyerScoreRecordsStore.values()).filter((s) => {
        if (!scope.isPlatformAdmin && scope.tenantId && s.tenant_id && s.tenant_id !== scope.tenantId) return false;
        return true;
      });
      const queue: PriorityQueueItem[] = [];

      for (const score of scores) {
        if (filter?.tier && score.tier !== filter.tier) continue;

        const lead = await leadsRepo.getLead(scope, score.lead_id);
        const qualification = score.qualification_id
          ? await qualificationsRepo.getQualification(scope, score.qualification_id)
          : null;
        const profile = await buyerProfilesRepo.getBuyerProfile(scope, score.lead_id);

        const now = Date.now();
        const deadlineTime = new Date(score.sla_dispatch.sla_deadline).getTime();
        const minutesRemaining = Math.max(0, Math.round((deadlineTime - now) / (60 * 1000)));

        const preferredLocations = Array.isArray(profile?.preferred_locations)
          ? (profile.preferred_locations as string[])
          : [];

        queue.push({
          lead_id: score.lead_id,
          external_lead_id: lead?.lead_id || score.lead_id,
          buyer_name: lead?.name || 'Unknown Buyer',
          phone: lead?.phone || '',
          composite_score: score.composite_score,
          tier: score.tier,
          qualification_status: qualification?.qualification_status || 'PARTIALLY_QUALIFIED',
          sla_deadline: score.sla_dispatch.sla_deadline,
          sla_minutes_remaining: minutesRemaining,
          assigned_role: score.sla_dispatch.assigned_role,
          follow_up_urgency: score.sla_dispatch.follow_up_urgency,
          preferred_locations: preferredLocations,
          property_type: profile?.property_type || 'Apartment',
          key_highlights: score.key_drivers,
          talking_points: score.sla_dispatch.talking_points,
          score_id: score.id,
          created_at: score.created_at,
        });
      }

      queue.sort((a, b) => {
        if (b.composite_score !== a.composite_score) {
          return b.composite_score - a.composite_score;
        }
        return new Date(a.sla_deadline).getTime() - new Date(b.sla_deadline).getTime();
      });

      if (filter?.limit) {
        return queue.slice(0, filter.limit);
      }
      return queue;
    },
  };
}
