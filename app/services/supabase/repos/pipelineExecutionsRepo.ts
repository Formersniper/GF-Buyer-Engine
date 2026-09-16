import { SupabaseClient } from '@supabase/supabase-js';
import { PipelineExecution, PipelineExecutionStatus } from '../../../schemas/database';
import { TenantScope, parseScopeAndId, resolveEffectiveTenantScope } from './helpers';
import { getSupabaseClient } from '../client';
import { logger } from '../../security/logger';
import { generateUUID } from './helpers';



export function isMissingClaimRpcError(err: any): boolean {
  if (!err) return false;
  const code = String(err.code || '');
  const message = typeof err.message === 'string' ? err.message : '';
  const referencesClaim = message.includes('claim_pipeline_execution');

  if (code === 'PGRST202' && referencesClaim) {
    return true;
  }
  if (code === '42883' && referencesClaim) {
    return true;
  }
  if (referencesClaim && (
    message.includes('in the schema cache') ||
    message.includes('does not exist') ||
    message.includes('not find the function')
  )) {
    return true;
  }
  return false;
}

export interface CreatePipelineExecutionInput {
  lead_id: string;
  call_id?: string | null;
  source_event_id?: string | null;
  idempotency_key?: string | null;
  correlation_id: string;
  status?: PipelineExecutionStatus;
}

export interface PipelineExecutionsRepository {
  createExecution(scope: TenantScope, input: CreatePipelineExecutionInput): Promise<PipelineExecution>;
  getExecution(scope: TenantScope, executionId: string): Promise<PipelineExecution | null>;
  updateExecution(scope: TenantScope, executionId: string, updates: Partial<PipelineExecution>): Promise<PipelineExecution>;
  claimExecution(workerId: string, leaseDurationMs: number, maxAttempts: number): Promise<PipelineExecution | null>;
  updateExecutionWithFencing(scope: TenantScope, executionId: string, leaseToken: string, updates: Partial<PipelineExecution>): Promise<PipelineExecution | null>;
}

export function createPipelineExecutionsRepository(store: Map<string, PipelineExecution>): PipelineExecutionsRepository {

  return {
    async createExecution(scope, input) {
      const client = getSupabaseClient();
      const resolvedScope = resolveEffectiveTenantScope(scope);
      
      const record: PipelineExecution = {
        id: generateUUID(),
        tenant_id: resolvedScope.tenantId,
        lead_id: input.lead_id,
        call_id: input.call_id || null,
        source_event_id: input.source_event_id || null,
        idempotency_key: input.idempotency_key || null,
        correlation_id: input.correlation_id,
        status: input.status || 'PENDING',
        attempt_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      
      if (client) {
        try {
          const { data, error } = await client
            .from('pipeline_executions')
            .insert(record)
            .select()
            .single();
            
          if (error) {
            if (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205' || error.message?.includes('does not exist') || error.message?.includes('not find the')) {
               // fallback to in-memory
            } else {
               if (error.message?.includes('duplicate key value violates unique constraint') || error.code === '23505') {
                 // Return the existing one if idempotency key violated? Wait, uniqueness is tested differently. Let's just throw.
                 throw new Error(`Failed to create pipeline execution: ${error.message}`);
               }
               logger.error('[Supabase Insert Error] pipeline_executions:', { service: "supabase-repo", error_category: "DATABASE_ERROR", data: { error: error.message } });
               throw new Error(`Failed to create pipeline execution: ${error.message}`);
            }
          } else if (data) {
            store.set(data.id, data);
            return data as PipelineExecution;
          }
        } catch (err: any) {
           if (!err?.message?.includes('does not exist') && !err?.message?.includes('PGRST') && !err?.code?.includes('PGRST') && err?.code !== '42703') {
              throw err;
           }
        }
      }
      
      // Enforce in-memory unique idempotency_key
      if (record.idempotency_key) {
        for (const existing of store.values()) {
           if (existing.idempotency_key === record.idempotency_key) {
              throw new Error(`Failed to create pipeline execution: duplicate key value violates unique constraint`);
           }
        }
      }
      
      store.set(record.id, record);
      return record;
    },
    
    async getExecution(scope, executionId) {
      const client = getSupabaseClient();
      const resolvedScope = resolveEffectiveTenantScope(scope);
      
      if (client) {
        try {
          let query = client.from('pipeline_executions').select('*').eq('id', executionId);
          if (!resolvedScope.isPlatformAdmin && resolvedScope.tenantId) {
            query = query.eq('tenant_id', resolvedScope.tenantId);
          }
          const { data, error } = await query.maybeSingle();
          if (error) {
            if (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205' || error.message?.includes('does not exist') || error.message?.includes('not find the')) {
               // fallback
            } else {
               logger.error('[Supabase Query Error] pipeline_executions:', { service: "supabase-repo", error_category: "DATABASE_ERROR", data: { error: error.message } });
               throw new Error(`Failed to get pipeline execution: ${error.message}`);
            }
          } else if (data) {
             return data as PipelineExecution;
          }
        } catch (err: any) {
           if (!err?.message?.includes('does not exist') && !err?.message?.includes('PGRST') && !err?.code?.includes('PGRST') && err?.code !== '42703') {
              throw err;
           }
        }
      }
      
      const match = store.get(executionId);
      if (!match) return null;
      if (!resolvedScope.isPlatformAdmin && resolvedScope.tenantId && match.tenant_id && match.tenant_id !== resolvedScope.tenantId) {
         return null;
      }
      return match;
    },
    
    async updateExecution(scope, executionId, updates) {
      const client = getSupabaseClient();
      const resolvedScope = resolveEffectiveTenantScope(scope);
      
      if (client) {
        try {
          let query = client.from('pipeline_executions').update(updates).eq('id', executionId);
          if (!resolvedScope.isPlatformAdmin && resolvedScope.tenantId) {
            query = query.eq('tenant_id', resolvedScope.tenantId);
          }
          const { data, error } = await query.select().single();
          if (error) {
            if (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205' || error.message?.includes('does not exist') || error.message?.includes('not find the')) {
               // fallback
            } else {
               logger.error('[Supabase Update Error] pipeline_executions:', { service: "supabase-repo", error_category: "DATABASE_ERROR", data: { error: error.message } });
               throw new Error(`Failed to update pipeline execution: ${error.message}`);
            }
          } else if (data) {
             store.set(data.id, data);
             return data as PipelineExecution;
          }
        } catch (err: any) {
           if (!err?.message?.includes('does not exist') && !err?.message?.includes('PGRST') && !err?.code?.includes('PGRST') && err?.code !== '42703') {
              throw err;
           }
        }
      }
      
      const existing = store.get(executionId);
      if (!existing) {
         throw new Error(`Execution with ID ${executionId} not found.`);
      }
      if (!resolvedScope.isPlatformAdmin && resolvedScope.tenantId && existing.tenant_id && existing.tenant_id !== resolvedScope.tenantId) {
         throw new Error(`Execution with ID ${executionId} not found in authorized tenant context.`);
      }
      const updated = { ...existing, ...updates, updated_at: new Date().toISOString() };
      store.set(executionId, updated as PipelineExecution);
      return updated as PipelineExecution;
    },
    
    async claimExecution(workerId, leaseDurationMs, maxAttempts) {
      const client = getSupabaseClient();
      
      if (client) {
        try {
          const { data, error } = await client.rpc('claim_pipeline_execution', {
            p_worker_id: workerId,
            p_lease_duration: `${leaseDurationMs / 1000} seconds`,
            p_max_attempts: maxAttempts
          });
          

          if (error) {
            if (isMissingClaimRpcError(error)) {
              // fallback
            } else {
              logger.error('[Supabase RPC Error] claim_pipeline_execution:', { service: "supabase-repo", error_category: "DATABASE_ERROR", data: { error: error.message } });
              throw new Error(`Failed to claim pipeline execution: ${error.message}`);
            }
          } else if (data && data.length > 0) {
            const execution = data[0] as PipelineExecution;
            store.set(execution.id, execution);
            return execution;
          } else {
            return null; // Nothing to claim
          }
        } catch (err: any) {

          if (!isMissingClaimRpcError(err)) {
             throw err;
          }
        }
      }
      
      // In-memory mock
      const now = new Date().toISOString();
      let selected: PipelineExecution | null = null;
      for (const exec of Array.from(store.values()).sort((a, b) => a.created_at.localeCompare(b.created_at))) {
        if (exec.attempt_count < maxAttempts) {
          if (exec.status === 'PENDING' && (!exec.next_attempt_at || exec.next_attempt_at <= now)) {
            selected = exec;
            break;
          }
          if (exec.status === 'RUNNING' && exec.lease_expires_at && exec.lease_expires_at < now) {
            selected = exec;
            break;
          }
        }
      }
      
      if (!selected) return null;
      
      const leaseExpiresAt = new Date(Date.now() + leaseDurationMs).toISOString();
      const updated = {
        ...selected,
        status: 'RUNNING' as PipelineExecutionStatus,
        lease_owner: workerId,
        lease_token: generateUUID(),
        lease_expires_at: leaseExpiresAt,
        attempt_count: selected.attempt_count + 1,
        started_at: selected.started_at || now,
        updated_at: now
      };
      store.set(updated.id, updated as PipelineExecution);
      return updated as PipelineExecution;
    },
    
    async updateExecutionWithFencing(scope, executionId, leaseToken, updates) {
      const client = getSupabaseClient();
      const resolvedScope = resolveEffectiveTenantScope(scope);
      
      if (client) {
        try {
          let query = client.from('pipeline_executions')
            .update(updates)
            .eq('id', executionId)
            .eq('lease_token', leaseToken);
            
          if (!resolvedScope.isPlatformAdmin && resolvedScope.tenantId) {
            query = query.eq('tenant_id', resolvedScope.tenantId);
          }
          const { data, error } = await query.select().maybeSingle();
          if (error) {
            if (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205' || error.message?.includes('does not exist') || error.message?.includes('not find the')) {
               // fallback
            } else {
               logger.error('[Supabase Update Error] updateExecutionWithFencing:', { service: "supabase-repo", error_category: "DATABASE_ERROR", data: { error: error.message } });
               throw new Error(`Failed to fenced-update pipeline execution: ${error.message}`);
            }
          } else {
             if (!data) return null; // Token mismatch or not found
             store.set(data.id, data as PipelineExecution);
             return data as PipelineExecution;
          }
        } catch (err: any) {
           if (!err?.message?.includes('does not exist') && !err?.message?.includes('PGRST') && !err?.code?.includes('PGRST') && err?.code !== '42703') {
              throw err;
           }
        }
      }
      
      // In-memory mock
      const existing = store.get(executionId);
      if (!existing) return null;
      
      if (!resolvedScope.isPlatformAdmin && resolvedScope.tenantId && existing.tenant_id && existing.tenant_id !== resolvedScope.tenantId) {
         return null;
      }
      
      if (existing.lease_token !== leaseToken) {
         return null; // Fencing failed
      }
      
      const updated = { ...existing, ...updates, updated_at: new Date().toISOString() };
      store.set(executionId, updated as PipelineExecution);
      return updated as PipelineExecution;
    }
  };
}
