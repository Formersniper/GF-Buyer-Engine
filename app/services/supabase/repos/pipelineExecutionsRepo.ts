import { SupabaseClient } from '@supabase/supabase-js';
import { PipelineExecution, PipelineExecutionStatus } from '../../../schemas/database';
import { TenantScope, parseScopeAndId, resolveEffectiveTenantScope } from './helpers';
import { getSupabaseClient } from '../client';
import { logger } from '../../security/logger';
import { generateUUID } from './helpers';

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
           if (!err?.message?.includes('does not exist') && !err?.message?.includes('PGRST')) {
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
           if (!err?.message?.includes('does not exist') && !err?.message?.includes('PGRST')) {
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
           if (!err?.message?.includes('does not exist') && !err?.message?.includes('PGRST')) {
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
    }
  };
}
