import { logger } from "../../security/logger";
/**
 * Tenant-Aware Broker Handoffs Repository & Queue
 */

import {
  DbBrokerHandoff,
  BrokerHandoffReadiness,
  BrokerRoutingStatus,
  BrokerDispatchStatus,
  HandoffQueueItem,
} from '../../../schemas/database';
import { getSupabaseClient, getSupabaseAdminClient } from '../client';
import { 
  TenantScope,
  TenantContext,
  ResolvedTenantScope,
  resolveEffectiveTenantScope,
  parseScopeAndId,
  parseScopeAndFilter,
  generateUUID,
  TenantMismatchError,
  } from './helpers';
import { LeadsRepository } from './leadsRepo';

export interface BrokerHandoffRepository {
  createHandoff(
    scopeOrHandoff:
      | TenantScope
      | TenantContext
      | (Omit<DbBrokerHandoff, 'id' | 'created_at' | 'updated_at'> & { id?: string }),
    maybeHandoff?: Omit<DbBrokerHandoff, 'id' | 'created_at' | 'updated_at'> & { id?: string }
  ): Promise<DbBrokerHandoff>;
  getHandoff(scopeOrId: TenantScope | TenantContext | string, maybeId?: string): Promise<DbBrokerHandoff | null>;
  getHandoffsByLeadId(scopeOrLeadId: TenantScope | TenantContext | string, maybeLeadId?: string): Promise<DbBrokerHandoff[]>;
  getHandoffByScoreId(
    scopeOrScoreId: TenantScope | TenantContext | string,
    scoreIdOrRule?: string,
    maybeRule?: string
  ): Promise<DbBrokerHandoff | null>;
  getLatestHandoff(scopeOrLeadId: TenantScope | TenantContext | string, maybeLeadId?: string): Promise<DbBrokerHandoff | null>;
  updateStatus(
    scope: TenantScope | TenantContext,
    id: string,
    handoffStatus: BrokerHandoffReadiness,
    routingStatus?: BrokerRoutingStatus
  ): Promise<DbBrokerHandoff>;
  updateStatus(
    id: string,
    handoffStatus: BrokerHandoffReadiness,
    routingStatus?: BrokerRoutingStatus
  ): Promise<DbBrokerHandoff>;
  updateDispatchStatus(
    scope: TenantScope | TenantContext,
    id: string,
    dispatchStatus: BrokerDispatchStatus,
    dispatchId?: string | null,
    channel?: string | null,
    options?: { error?: string | null; retryEligible?: boolean; lastAttemptAt?: string }
  ): Promise<DbBrokerHandoff>;
  updateDispatchStatus(
    id: string,
    dispatchStatus: BrokerDispatchStatus,
    dispatchId?: string | null,
    channel?: string | null,
    options?: { error?: string | null; retryEligible?: boolean; lastAttemptAt?: string }
  ): Promise<DbBrokerHandoff>;
  listHandoffQueue(
    scopeOrFilter?: TenantScope | TenantContext | string | { tier?: string; status?: string; limit?: number },
    maybeFilter?: { tier?: string; status?: string; limit?: number }
  ): Promise<HandoffQueueItem[]>;
}

const mapDatabaseRow = (row: any): DbBrokerHandoff => {
  if (!row) return row;
  return {
    ...row,
    dispatch_error: row.dispatch_error !== undefined ? row.dispatch_error : (row.handoff_payload?.dispatch_error ?? null),
    retry_eligible: row.retry_eligible !== undefined ? row.retry_eligible : (row.handoff_payload?.retry_eligible ?? true),
    retry_count: row.retry_count !== undefined ? row.retry_count : (row.handoff_payload?.retry_count ?? 0),
    last_attempt_at: row.last_attempt_at !== undefined ? row.last_attempt_at : (row.handoff_payload?.last_attempt_at ?? null),
  };
};

const toDatabaseRow = (record: any): any => {
  const allowedKeys = [
    'id',
    'lead_id',
    'qualification_id',
    'score_id',
    'extraction_id',
    'transcript_id',
    'call_id',
    'handoff_payload',
    'handoff_status',
    'routing_status',
    'assigned_role',
    'assigned_team',
    'priority_tier',
    'sla_minutes',
    'sla_deadline',
    'dispatch_channel',
    'dispatch_status',
    'dispatch_id',
    'handoff_version',
    'rule_version',
    'created_at',
    'updated_at',
    'tenant_id'
  ];
  const row: any = {};
  for (const key of allowedKeys) {
    if (record[key] !== undefined) {
      row[key] = record[key];
    }
  }
  return row;
};

export function createBrokerHandoffRepository(
  brokerHandoffsStore: Map<string, DbBrokerHandoff>,
  leadsRepo: LeadsRepository
): BrokerHandoffRepository {
  return {
    createHandoff: async (scopeOrHandoff, maybeHandoff) => {
      const scope = resolveEffectiveTenantScope(maybeHandoff !== undefined ? (scopeOrHandoff as TenantScope) : undefined);
      const input = maybeHandoff !== undefined ? maybeHandoff : (scopeOrHandoff as any);

      const lead = await leadsRepo.getLead(scope, input.lead_id);
      if (!lead) {
        throw new TenantMismatchError(`Cannot create broker handoff for lead ${input.lead_id}: lead not found in authorized tenant context.`);
      }

      const now = new Date().toISOString();
      const id = input.id || generateUUID();
      const tenantId = scope.tenantId || lead.tenant_id;
      const record: DbBrokerHandoff = {
        id,
        tenant_id: tenantId,
        lead_id: input.lead_id,
        qualification_id: input.qualification_id ?? null,
        score_id: input.score_id ?? null,
        extraction_id: input.extraction_id ?? null,
        transcript_id: input.transcript_id ?? null,
        call_id: input.call_id ?? null,
        handoff_payload: input.handoff_payload,
        handoff_status: input.handoff_status,
        routing_status: input.routing_status,
        assigned_role: input.assigned_role ?? null,
        assigned_team: input.assigned_team ?? null,
        priority_tier: input.priority_tier,
        sla_minutes: input.sla_minutes,
        sla_deadline: input.sla_deadline,
        dispatch_channel: input.dispatch_channel ?? null,
        dispatch_status: input.dispatch_status ?? 'PENDING',
        dispatch_id: input.dispatch_id ?? null,
        handoff_version: input.handoff_version ?? '1.0',
        rule_version: input.rule_version ?? '1.0',
        created_at: now,
        updated_at: now,
      };

      const isRealSupabase = !!getSupabaseAdminClient() || getSupabaseClient();
      if (isRealSupabase) {
        const client = getSupabaseAdminClient();
        if (!client) {
          logger.error('Database write aborted: SUPABASE_SERVICE_ROLE_KEY is missing in the current runtime.', {
            service: 'supabase-repo',
            operation: 'createHandoff',
            error_category: 'MISSING_SECURE_RUNTIME_CONFIG',
          });
          throw new Error('Database write aborted: SUPABASE_SERVICE_ROLE_KEY environment variable is required for trusted server-side handoff persistence but is missing in the current runtime.');
        }
        try {
          let queryExisting = client
            .from('broker_handoffs')
            .select('id');
          if (record.score_id === null) {
            queryExisting = queryExisting.is('score_id', null);
          } else {
            queryExisting = queryExisting.eq('score_id', record.score_id);
          }
          queryExisting = queryExisting.eq('rule_version', record.rule_version);
          if (!scope.isPlatformAdmin && tenantId) {
            queryExisting = queryExisting.eq('tenant_id', tenantId);
          }
          const { data: existing, error: existError } = await queryExisting.maybeSingle();
          if (existError) {
            throw existError;
          }

          let query;
          if (existing) {
            query = client.from('broker_handoffs').update(toDatabaseRow(record)).eq('id', existing.id);
          } else {
            query = client.from('broker_handoffs').insert(toDatabaseRow(record));
          }
          const { data, error } = await query.select().single();
          if (error) {
            throw error;
          }
          if (data) {
            const mapped = mapDatabaseRow(data);
            brokerHandoffsStore.set(mapped.id, mapped);
            return mapped;
          }
        } catch (err: any) {
          logger.error('Database write failed in REAL_SUPABASE mode', {
            service: 'supabase-repo',
            operation: 'createHandoff',
            error_category: 'DATABASE_WRITE_ERROR',
            data: { error: err.message || String(err) },
          });
          throw new Error(`Database operation failed: ${err.message || String(err)}`);
        }
      } else {
        logger.info('Running in EXPLICIT PREVIEW mode (in-memory fallback)', {
          service: 'supabase-repo',
          operation: 'createHandoff',
        });
        brokerHandoffsStore.set(record.id, record);
        return record;
      }
      throw new Error('Database write operation was not finalized.');
    },

    getHandoff: async (scopeOrId, maybeId) => {
      const { scope, id } = parseScopeAndId(scopeOrId, maybeId);
      const client = getSupabaseAdminClient() || getSupabaseAdminClient() || getSupabaseClient();
      if (client) {
        try {
          let query = client.from('broker_handoffs').select('*').eq('id', id);
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          const { data, error } = await query.maybeSingle();
          if (error) {
            throw error;
          }
          return mapDatabaseRow(data);
        } catch (err: any) {
          logger.error('Database read failed in REAL_SUPABASE mode', {
            service: 'supabase-repo',
            operation: 'getHandoff',
            error_category: 'DATABASE_READ_ERROR',
            data: { error: err.message || String(err) },
          });
          throw new Error(`Database operation failed: ${err.message || String(err)}`);
        }
      } else {
        const h = brokerHandoffsStore.get(id) || null;
        if (!h) return null;
        if (!scope.isPlatformAdmin && scope.tenantId && h.tenant_id && h.tenant_id !== scope.tenantId) {
          return null;
        }
        return h;
      }
    },

    getHandoffsByLeadId: async (scopeOrLeadId, maybeLeadId) => {
      const { scope, id: leadId } = parseScopeAndId(scopeOrLeadId, maybeLeadId);
      const client = getSupabaseAdminClient() || getSupabaseAdminClient() || getSupabaseClient();
      if (client) {
        try {
          let query = client
            .from('broker_handoffs')
            .select('*')
            .eq('lead_id', leadId)
            .order('created_at', { ascending: false });
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          const { data, error } = await query;
          if (error) {
            throw error;
          }
          return (data || []).map(mapDatabaseRow);
        } catch (err: any) {
          logger.error('Database query failed in REAL_SUPABASE mode', {
            service: 'supabase-repo',
            operation: 'getHandoffsByLeadId',
            error_category: 'DATABASE_QUERY_ERROR',
            data: { error: err.message || String(err) },
          });
          throw new Error(`Database operation failed: ${err.message || String(err)}`);
        }
      } else {
        return Array.from(brokerHandoffsStore.values())
          .filter((h) => {
            if (h.lead_id !== leadId) return false;
            if (!scope.isPlatformAdmin && scope.tenantId && h.tenant_id && h.tenant_id !== scope.tenantId) return false;
            return true;
          })
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      }
    },

    getHandoffByScoreId: async (scopeOrScoreId, scoreIdOrRule, maybeRule) => {
      let scope: any;
      let scoreId: string;
      let ruleVersion: string | undefined;

      if (
        typeof scopeOrScoreId === 'object' ||
        (maybeRule !== undefined) ||
        (typeof scopeOrScoreId === 'string' && scoreIdOrRule !== undefined && !scoreIdOrRule.startsWith('1.') && !scoreIdOrRule.startsWith('2.') && !scoreIdOrRule.startsWith('v'))
      ) {
        scope = resolveEffectiveTenantScope(scopeOrScoreId as TenantScope);
        scoreId = scoreIdOrRule as string;
        ruleVersion = maybeRule;
      } else {
        scope = resolveEffectiveTenantScope(undefined);
        scoreId = scopeOrScoreId as string;
        ruleVersion = scoreIdOrRule;
      }

      const client = getSupabaseAdminClient() || getSupabaseAdminClient() || getSupabaseClient();
      if (client) {
        try {
          let query = client.from('broker_handoffs').select('*').eq('score_id', scoreId);
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          if (ruleVersion) {
            query = query.eq('rule_version', ruleVersion);
          }
          const { data, error } = await query.order('created_at', { ascending: false }).limit(1);
          if (error) {
            throw error;
          }
          return data && data.length > 0 ? mapDatabaseRow(data[0]) : null;
        } catch (err: any) {
          logger.error('Database query failed in REAL_SUPABASE mode', {
            service: 'supabase-repo',
            operation: 'getHandoffByScoreId',
            error_category: 'DATABASE_QUERY_ERROR',
            data: { error: err.message || String(err) },
          });
          throw new Error(`Database operation failed: ${err.message || String(err)}`);
        }
      } else {
        return (
          Array.from(brokerHandoffsStore.values())
            .filter((h) => {
              if (h.score_id !== scoreId) return false;
              if (!scope.isPlatformAdmin && scope.tenantId && h.tenant_id && h.tenant_id !== scope.tenantId) return false;
              if (ruleVersion && h.rule_version !== ruleVersion) return false;
              return true;
            })
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] || null
        );
      }
    },

    getLatestHandoff: async (scopeOrLeadId, maybeLeadId) => {
      const { scope, id: leadId } = parseScopeAndId(scopeOrLeadId, maybeLeadId);
      const handoffs = await createBrokerHandoffRepository(brokerHandoffsStore, leadsRepo).getHandoffsByLeadId(scope, leadId);
      return handoffs.length > 0 ? handoffs[0] : null;
    },

    updateStatus: async (
      arg1: any,
      arg2: any,
      arg3?: any,
      arg4?: any
    ) => {
      let scope: ResolvedTenantScope;
      let id: string;
      let handoffStatus: BrokerHandoffReadiness;
      let routingStatus: BrokerRoutingStatus | undefined;

      if (typeof arg1 === 'object' || (typeof arg1 === 'string' && typeof arg2 === 'string' && typeof arg3 === 'string' && arg4 !== undefined)) {
        scope = resolveEffectiveTenantScope(arg1 as TenantScope);
        id = arg2 as string;
        handoffStatus = arg3 as BrokerHandoffReadiness;
        routingStatus = arg4 as BrokerRoutingStatus | undefined;
      } else {
        scope = resolveEffectiveTenantScope(undefined);
        id = arg1 as string;
        handoffStatus = arg2 as BrokerHandoffReadiness;
        routingStatus = arg3 as BrokerRoutingStatus | undefined;
      }

      const existing = await createBrokerHandoffRepository(brokerHandoffsStore, leadsRepo).getHandoff(scope, id);
      if (!existing) {
        throw new Error(`Broker handoff with id ${id} not found.`);
      }
      const now = new Date().toISOString();
      const updatedPayload = {
        ...existing.handoff_payload,
        handoff_status: handoffStatus,
        routing_status: routingStatus || existing.routing_status,
        updated_at: now,
      };

      const updatedRecord: DbBrokerHandoff = {
        ...existing,
        handoff_status: handoffStatus,
        routing_status: routingStatus || existing.routing_status,
        handoff_payload: updatedPayload,
        updated_at: now,
      };

      const isRealSupabase = !!getSupabaseAdminClient() || getSupabaseClient();
      if (isRealSupabase) {
        const client = getSupabaseAdminClient();
        if (!client) {
          logger.error('Database update aborted: SUPABASE_SERVICE_ROLE_KEY is missing in the current runtime.', {
            service: 'supabase-repo',
            operation: 'updateStatus',
            error_category: 'MISSING_SECURE_RUNTIME_CONFIG',
          });
          throw new Error('Database update aborted: SUPABASE_SERVICE_ROLE_KEY environment variable is required for trusted server-side handoff updates but is missing in the current runtime.');
        }
        try {
          let query = client
            .from('broker_handoffs')
            .update(toDatabaseRow(updatedRecord))
            .eq('id', id);
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          const { data, error } = await query.select().single();
          if (error) {
            throw error;
          }
          if (data) {
            const mapped = {
              ...updatedRecord,
              ...mapDatabaseRow(data),
            };
            brokerHandoffsStore.set(mapped.id, mapped);
            return mapped;
          }
        } catch (err: any) {
          logger.error('Database update failed in REAL_SUPABASE mode', {
            service: 'supabase-repo',
            operation: 'updateStatus',
            error_category: 'DATABASE_UPDATE_ERROR',
            data: { error: err.message || String(err) },
          });
          throw new Error(`Database operation failed: ${err.message || String(err)}`);
        }
      } else {
        brokerHandoffsStore.set(id, updatedRecord);
        return updatedRecord;
      }
      throw new Error('Database status update was not finalized.');
    },

    updateDispatchStatus: async (
      arg1: any,
      arg2: any,
      arg3?: any,
      arg4?: any,
      arg5?: any,
      arg6?: any
    ) => {
      let scope: ResolvedTenantScope;
      let id: string;
      let dispatchStatus: BrokerDispatchStatus;
      let dispatchId: string | null | undefined;
      let channel: string | null | undefined;
      let options: { error?: string | null; retryEligible?: boolean; lastAttemptAt?: string } | undefined;

      // Fixed condition: if arg1 is an object (scope), or if we explicitly identify the first arg as tenantId (not standard here without object).
      // A better check: arg1 is scope if it's an object OR if arg1 is a string (tenantId) BUT handoffStatus (arg3) is a valid status.
      // Actually, BrokerDispatchStatus is one of 'PENDING', 'SENT', 'ACKNOWLEDGED', 'FAILED', 'IGNORED_DUPLICATE'.
      // If arg2 is NOT one of those, then arg1 is scope and arg2 is id.
      const validStatuses = ['PENDING', 'SENT', 'ACKNOWLEDGED', 'FAILED', 'IGNORED_DUPLICATE'];
      if (typeof arg1 === 'object' || (typeof arg1 === 'string' && !validStatuses.includes(arg2))) {
        scope = resolveEffectiveTenantScope(arg1 as TenantScope);
        id = arg2 as string;
        dispatchStatus = arg3 as BrokerDispatchStatus;
        dispatchId = arg4;
        channel = arg5;
        options = arg6;
      } else {
        scope = resolveEffectiveTenantScope(undefined);
        id = arg1 as string;
        dispatchStatus = arg2 as BrokerDispatchStatus;
        dispatchId = arg3;
        channel = arg4;
        options = arg5;
      }

      const existing = await createBrokerHandoffRepository(brokerHandoffsStore, leadsRepo).getHandoff(scope, id);
      if (!existing) {
        throw new Error(`Broker handoff with id ${id} not found.`);
      }
      const now = new Date().toISOString();
      const updatedPayload = {
        ...existing.handoff_payload,
        dispatch_status: dispatchStatus,
        dispatch_id: dispatchId !== undefined ? dispatchId : existing.dispatch_id,
        dispatch_channel: channel !== undefined ? channel : existing.dispatch_channel,
        dispatch_error: options?.error !== undefined ? options.error : existing.dispatch_error,
        retry_eligible: options?.retryEligible !== undefined ? options.retryEligible : existing.retry_eligible,
        retry_count: existing.retry_count !== undefined ? (options?.lastAttemptAt && existing.last_attempt_at ? existing.retry_count + 1 : existing.retry_count) : 0,
        last_attempt_at: options?.lastAttemptAt !== undefined ? options.lastAttemptAt : existing.last_attempt_at,
        updated_at: now,
      };

      const updatedRecord: DbBrokerHandoff = {
        ...existing,
        dispatch_status: dispatchStatus,
        dispatch_id: dispatchId !== undefined ? dispatchId : existing.dispatch_id,
        dispatch_channel: channel !== undefined ? channel : existing.dispatch_channel,
        dispatch_error: options?.error !== undefined ? options.error : existing.dispatch_error,
        retry_eligible: options?.retryEligible !== undefined ? options.retryEligible : existing.retry_eligible,
        retry_count: existing.retry_count !== undefined ? (options?.lastAttemptAt && existing.last_attempt_at ? existing.retry_count + 1 : existing.retry_count) : 0,
        last_attempt_at: options?.lastAttemptAt !== undefined ? options.lastAttemptAt : existing.last_attempt_at,
        handoff_payload: updatedPayload,
        updated_at: now,
      };

      const isRealSupabase = !!getSupabaseAdminClient() || getSupabaseClient();
      if (isRealSupabase) {
        const client = getSupabaseAdminClient();
        if (!client) {
          logger.error('Database update aborted: SUPABASE_SERVICE_ROLE_KEY is missing in the current runtime.', {
            service: 'supabase-repo',
            operation: 'updateDispatchStatus',
            error_category: 'MISSING_SECURE_RUNTIME_CONFIG',
          });
          throw new Error('Database update aborted: SUPABASE_SERVICE_ROLE_KEY environment variable is required for trusted server-side handoff updates but is missing in the current runtime.');
        }
        try {
          let query = client
            .from('broker_handoffs')
            .update(toDatabaseRow(updatedRecord))
            .eq('id', id);
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          const { data, error } = await query.select().single();
          if (error) {
            throw error;
          }
          if (data) {
            const mapped = {
              ...updatedRecord,
              ...mapDatabaseRow(data),
            };
            brokerHandoffsStore.set(mapped.id, mapped);
            return mapped;
          }
        } catch (err: any) {
          logger.error('Database update failed in REAL_SUPABASE mode', {
            service: 'supabase-repo',
            operation: 'updateDispatchStatus',
            error_category: 'DATABASE_UPDATE_ERROR',
            data: { error: err.message || String(err) },
          });
          throw new Error(`Database operation failed: ${err.message || String(err)}`);
        }
      } else {
        brokerHandoffsStore.set(id, updatedRecord);
        return updatedRecord;
      }
      throw new Error('Database dispatch status update was not finalized.');
    },

    listHandoffQueue: async (scopeOrFilter, maybeFilter) => {
      const { scope, filter } = parseScopeAndFilter(scopeOrFilter, maybeFilter);

      const tierRank = (tier: string): number => {
        switch (tier) {
          case 'TIER_1_HOT':
            return 1;
          case 'TIER_2_WARM':
            return 2;
          case 'TIER_3_NURTURE':
            return 3;
          case 'TIER_4_REVIEW':
            return 4;
          default:
            return 5;
        }
      };

      let handoffs = Array.from(brokerHandoffsStore.values()).filter((h) => {
        if (!scope.isPlatformAdmin && scope.tenantId && h.tenant_id && h.tenant_id !== scope.tenantId) return false;
        return true;
      });

      if (filter?.tier) {
        handoffs = handoffs.filter((h) => h.priority_tier === filter.tier);
      }
      if (filter?.status) {
        handoffs = handoffs.filter((h) => h.handoff_status === filter.status);
      }

      const queueItems: HandoffQueueItem[] = [];

      for (const h of handoffs) {
        const payload = h.handoff_payload;
        const lead = await leadsRepo.getLead(scope, h.lead_id);
        const topProj = payload?.project_recommendations?.[0];
        const primaryReq = payload?.requirements?.[0];
        const reqStr = primaryReq
          ? `${primaryReq.property_type || 'Residential'} ${primaryReq.configuration || ''} in ${(primaryReq.preferred_locations || []).join(', ')}`.trim()
          : 'Property requirement';

        const deadline = h.sla_deadline ? new Date(h.sla_deadline).getTime() : NaN;
        const nowMs = Date.now();
        const minsRemaining = isNaN(deadline) ? 0 : Math.round((deadline - nowMs) / 60000);

        queueItems.push({
          handoff_id: h.id,
          lead_id: h.lead_id,
          external_lead_id: lead?.lead_id || payload?.external_lead_id || 'GF-UNK',
          buyer_name: lead?.name || payload?.primary_buyer_summary?.name || 'Unknown Buyer',
          phone: lead?.phone || payload?.primary_buyer_summary?.phone || '',
          score: payload?.priority?.score ?? 0,
          tier: h.priority_tier,
          sla_deadline: h.sla_deadline || new Date().toISOString(),
          sla_minutes_remaining: minsRemaining,
          assigned_role: h.assigned_role || 'INBOUND_SALES_SPECIALIST',
          assigned_team: h.assigned_team || 'INBOUND_SALES',
          urgency: payload?.priority?.urgency || 'MEDIUM',
          handoff_status: h.handoff_status,
          routing_status: h.routing_status,
          dispatch_status: h.dispatch_status,
          primary_requirement: reqStr,
          top_project: topProj ? `${topProj.project_name} (${topProj.match_score}% Match)` : null,
          missing_information: payload?.missing_information || [],
          recommended_action: payload?.recommended_action || 'Contact buyer',
          created_at: h.created_at,
        });
      }

      queueItems.sort((a, b) => {
        const rankA = tierRank(a.tier);
        const rankB = tierRank(b.tier);
        if (rankA !== rankB) return rankA - rankB;
        const deadlineA = a.sla_deadline ? new Date(a.sla_deadline).getTime() : 0;
        const deadlineB = b.sla_deadline ? new Date(b.sla_deadline).getTime() : 0;
        const safeDeadA = isNaN(deadlineA) ? 0 : deadlineA;
        const safeDeadB = isNaN(deadlineB) ? 0 : deadlineB;
        if (safeDeadA !== safeDeadB) return safeDeadA - safeDeadB;
        if (b.score !== a.score) return b.score - a.score;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });

      if (filter?.limit) {
        return queueItems.slice(0, filter.limit);
      }

      return queueItems;
    },
  };
}
