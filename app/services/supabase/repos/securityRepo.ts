import { getSupabaseClient } from '../client'; // Just for context interface if needed

export interface IdempotencyRecord {
  id: string;
  tenant_id: string | null;
  idempotency_key: string;
  operation: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  response_code: number | null;
  response_body: any | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

export interface SecurityRepository {
  acquireIdempotency(tenantId: string | null, key: string, operation: string, ttlSeconds: number): Promise<IdempotencyRecord>;
  completeIdempotency(tenantId: string | null, key: string, responseCode: number, responseBody: any): Promise<void>;
  failIdempotency(tenantId: string | null, key: string, responseCode: number, responseBody: any): Promise<void>;
  
  acquireResourceLock(resourceType: string, resourceId: string, tenantId: string | null, lockedBy: string, ttlSeconds: number): Promise<boolean>;
  releaseResourceLock(resourceType: string, resourceId: string, lockedBy: string): Promise<void>;
  
  checkAndIncrementRateLimit(targetId: string, operation: string, windowSeconds: number, maxRequests: number): Promise<{ allowed: boolean; count: number }>;
}

export function createSecurityRepository(
  locksStore: Map<string, any>,
  rateLimitsStore: Map<string, any>,
  idempotencyStore: Map<string, any>
): SecurityRepository {
  return {
    async acquireIdempotency(tenantId, key, operation, ttlSeconds) {
      const client = getSupabaseClient();
      if (!client) {
        // Fallback for mock environment
        const combinedKey = `${tenantId || 'global'}:${key}`;
        const existing = idempotencyStore.get(combinedKey);
        if (existing) {
          return existing as IdempotencyRecord;
        }
        const expires_at = new Date(Date.now() + ttlSeconds * 1000).toISOString();
        const record: IdempotencyRecord = {
          id: 'mock-id',
          tenant_id: tenantId,
          idempotency_key: key,
          operation,
          status: 'PENDING',
          response_code: null,
          response_body: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          expires_at
        };
        idempotencyStore.set(combinedKey, record);
        return record;
      }
      
      const expires_at = new Date(Date.now() + ttlSeconds * 1000).toISOString();
      
      const combinedKey = `${tenantId || 'global'}:${key}`;
      const memExisting = idempotencyStore.get(combinedKey);
      if (memExisting) {
         // Because of async race, we might already have it in memory
         return memExisting as IdempotencyRecord;
      }
      
      const record = {
        id: 'mock-id',
        tenant_id: tenantId,
        idempotency_key: key,
        operation,
        status: 'PENDING',
        response_code: null,
        response_body: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        expires_at
      };
      idempotencyStore.set(combinedKey, record);

      // Attempt insert. If conflict, return existing.
      const { data, error } = await client
        .from('idempotency_records')
        .insert({
          tenant_id: tenantId,
          idempotency_key: key,
          operation,
          status: 'PENDING',
          expires_at
        })
        .select()
        .single();
        
      if (error) {
        if (error.code === 'PGRST205') { // table does not exist
          const combinedKey = `${tenantId || 'global'}:${key}`;
          const existing = idempotencyStore.get(combinedKey);
          if (existing) return existing as IdempotencyRecord;
          const record = {
            id: 'mock-id',
            tenant_id: tenantId,
            idempotency_key: key,
            operation,
            status: 'PENDING',
            response_code: null,
            response_body: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            expires_at
          };
          idempotencyStore.set(combinedKey, record);
          return record as IdempotencyRecord;
        }
        if (error.code === '23505') { // unique violation
          const { data: existing, error: fetchErr } = await client
            .from('idempotency_records')
            .select('*')
            .eq('idempotency_key', key)
            .eq(tenantId ? 'tenant_id' : 'id', tenantId ? tenantId : 'dummy') // handle null safely if needed
            // Actually, in Supabase a null in unique constraint might behave weirdly. Let's do explicit check.
            // Wait, we used: eq('tenant_id', tenantId)
            // If tenantId is null, use is('tenant_id', null)
            .is('tenant_id', tenantId)
            .single();
            
          if (fetchErr) throw fetchErr;
          return existing as unknown as IdempotencyRecord;
        }
        throw error;
      }
      
      return data as unknown as IdempotencyRecord;
    },
    
    async completeIdempotency(tenantId, key, responseCode, responseBody) {
      const client = getSupabaseClient();
      if (!client) {
        const combinedKey = `${tenantId || 'global'}:${key}`;
        const existing = idempotencyStore.get(combinedKey);
        if (existing) {
          existing.status = 'COMPLETED';
          existing.response_code = responseCode;
          existing.response_body = responseBody;
          existing.updated_at = new Date().toISOString();
        }
        return;
      }
      
      let query = client.from('idempotency_records')
        .update({
          status: 'COMPLETED',
          response_code: responseCode,
          response_body: responseBody,
          updated_at: new Date().toISOString()
        })
        .eq('idempotency_key', key);
        
      if (tenantId) query = query.eq('tenant_id', tenantId);
      else query = query.is('tenant_id', null);
      
      const { error } = await query;
      if (error && error.code === 'PGRST205') {
        const combinedKey = `${tenantId || 'global'}:${key}`;
        const existing = idempotencyStore.get(combinedKey);
        if (existing) {
          existing.status = 'COMPLETED';
          existing.response_code = responseCode;
          existing.response_body = responseBody;
        }
        return;
      }
      if (error) throw error;
    },
    
    async failIdempotency(tenantId, key, responseCode, responseBody) {
      const client = getSupabaseClient();
      if (!client) {
        const combinedKey = `${tenantId || 'global'}:${key}`;
        const existing = idempotencyStore.get(combinedKey);
        if (existing) {
          existing.status = 'FAILED';
          existing.response_code = responseCode;
          existing.response_body = responseBody;
          existing.updated_at = new Date().toISOString();
        }
        return;
      }
      
      let query = client.from('idempotency_records')
        .update({
          status: 'FAILED',
          response_code: responseCode,
          response_body: responseBody,
          updated_at: new Date().toISOString()
        })
        .eq('idempotency_key', key);
        
      if (tenantId) query = query.eq('tenant_id', tenantId);
      else query = query.is('tenant_id', null);
      
      const { error } = await query;
      if (error && error.code === 'PGRST205') {
        const combinedKey = `${tenantId || 'global'}:${key}`;
        const existing = idempotencyStore.get(combinedKey);
        if (existing) {
          existing.status = 'FAILED';
          existing.response_code = responseCode;
          existing.response_body = responseBody;
        }
        return;
      }
      if (error) throw error;
    },
    
    async acquireResourceLock(resourceType, resourceId, tenantId, lockedBy, ttlSeconds) {
      const client = getSupabaseClient();
      if (!client) {
        const key = `${resourceType}:${resourceId}`;
        const existing = locksStore.get(key);
        const now = Date.now();
        if (existing && existing.expires_at > now) {
          return existing.locked_by === lockedBy;
        }
        locksStore.set(key, {
          locked_by: lockedBy,
          expires_at: now + ttlSeconds * 1000
        });
        return true;
      }
      
      // Try memory lock first to avoid async race if DB is missing
      const memKey = `${resourceType}:${resourceId}`;
      const memNow = Date.now();
      const memExisting = locksStore.get(memKey);
      if (memExisting && memExisting.expires_at > memNow && memExisting.locked_by !== lockedBy) {
         return false; // locked by someone else
      }
      locksStore.set(memKey, { locked_by: lockedBy, expires_at: memNow + ttlSeconds * 1000 });

      // Cleanup expired locks first
      const del = await client.from('resource_locks')
        .delete()
        .eq('resource_type', resourceType)
        .eq('resource_id', resourceId)
        .lt('expires_at', new Date().toISOString());
      
      if (del.error && del.error.code === 'PGRST205') {
        const key = `${resourceType}:${resourceId}`;
        const existing = locksStore.get(key);
        const now = Date.now();
        if (existing && existing.expires_at > now) {
          return existing.locked_by === lockedBy;
        }
        locksStore.set(key, { locked_by: lockedBy, expires_at: now + ttlSeconds * 1000 });
        return true;
      }
        
      const expires_at = new Date(Date.now() + ttlSeconds * 1000).toISOString();
      const { error } = await client
        .from('resource_locks')
        .insert({
          resource_type: resourceType,
          resource_id: resourceId,
          tenant_id: tenantId,
          locked_by: lockedBy,
          expires_at
        });
        
      if (error) {
        if (error.code === '23505') {
          // Check if we already own it
          const { data } = await client
            .from('resource_locks')
            .select('*')
            .eq('resource_type', resourceType)
            .eq('resource_id', resourceId)
            .single();
          
          if (data && data.locked_by === lockedBy && new Date(data.expires_at).getTime() > Date.now()) {
            return true;
          }
          return false;
        }
        throw error;
      }
      
      return true;
    },
    
    async releaseResourceLock(resourceType, resourceId, lockedBy) {
      const client = getSupabaseClient();
      if (!client) {
        const key = `${resourceType}:${resourceId}`;
        const existing = locksStore.get(key);
        if (existing && existing.locked_by === lockedBy) {
          locksStore.delete(key);
        }
        return;
      }
      
      const res = await client.from('resource_locks')
        .delete()
        .eq('resource_type', resourceType)
        .eq('resource_id', resourceId)
        .eq('locked_by', lockedBy);
      if (res.error && res.error.code === 'PGRST205') {
        locksStore.delete(`${resourceType}:${resourceId}`);
      }
    },
    
    async checkAndIncrementRateLimit(targetId, operation, windowSeconds, maxRequests) {
      const windowStartMs = Math.floor(Date.now() / (windowSeconds * 1000)) * (windowSeconds * 1000);
      const windowStartIso = new Date(windowStartMs).toISOString();
      
      const client = getSupabaseClient();
      if (!client) {
        const key = `${targetId}:${operation}:${windowStartMs}`;
        const current = rateLimitsStore.get(key) || { count: 0 };
        current.count++;
        rateLimitsStore.set(key, current);
        return { allowed: current.count <= maxRequests, count: current.count };
      }
      
      const { data, error } = await client.rpc('increment_rate_limit', {
        p_target_id: targetId,
        p_operation: operation,
        p_window_start: windowStartIso
      });
      if (error) {
        // Fallback if RPC doesn't exist (e.g. migration not applied)
        if (error.code === 'PGRST202' || error.message.includes('Could not find the function')) {
          const key = `${targetId}:${operation}:${windowStartMs}`;
          const current = rateLimitsStore.get(key) || { count: 0 };
          current.count++;
          rateLimitsStore.set(key, current);
          return { allowed: current.count <= maxRequests, count: current.count };
        }
        throw error;
      }
      const count = data as number;
      return { allowed: count <= maxRequests, count };
    }
  };
}
