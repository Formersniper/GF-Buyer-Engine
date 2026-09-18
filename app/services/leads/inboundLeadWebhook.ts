import { Request } from 'express';
import crypto from 'crypto';
import { supabaseDataService } from '../supabase/repositories';
import { leadService } from './leadService';
import { logger } from '../security/logger';

export async function processInboundLeadWebhook(req: Request): Promise<any> {
  const auth = (req as any).auth;
  if (!auth || !auth.tenantId) {
    throw new Error('Tenant context missing from authenticated request.');
  }
  
  const payload = req.body;
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid or missing JSON payload.');
  }

  // 1. Establish transport idempotency
  const rawId = req.headers['x-event-id'] || payload.id || payload.event_id || crypto.randomUUID();
  const provider = (req.headers['x-provider'] as string) || payload.source || 'inbound_api';
  
  // Namespace event ID to prevent cross-tenant collisions
  const namespacedEventId = `inbound_${auth.tenantId}_${rawId}`;
  
  try {
    // Try to record the event for idempotency
    await supabaseDataService.webhookEvents.recordEvent({
      event_id: namespacedEventId,
      provider,
      status: 'RECEIVED',
      received_at: new Date().toISOString(),
      payload_hash: null,
      processed_at: null
    });
  } catch (err: any) {
    if (err.message && err.message.includes('Duplicate webhook event')) {
      logger.info('Duplicate inbound webhook event detected. Returning idempotent success.', {
        data: { event_id: namespacedEventId },
        tenant_id: auth.tenantId,
      });
      return { success: true, idempotent: true, message: 'Event already processed.' };
    }
    throw err;
  }

  try {
    // 2. Validate and Map Payload
    const name = payload.name || payload.full_name;
    const phone = payload.phone;
    if (!name && !phone && !payload.email) {
      throw new Error('Lead payload must contain at least a name, phone, or email.');
    }

    const rawLead = {
      full_name: name,
      phone: phone,
      email: payload.email,
      source: payload.source || 'API_WEBHOOK',
      external_id: payload.external_id || payload.lead_id || rawId,
      declared_project: payload.declared_project,
      declared_budget: payload.declared_budget
    };

    // 3. Process Lead using tenant scope
    const tenantScope = { tenantId: auth.tenantId, isPlatformAdmin: auth.isPlatformAdmin };
    const lead = await leadService.ingestRawLead(tenantScope, rawLead);

    await supabaseDataService.webhookEvents.updateEventStatus(namespacedEventId, 'PROCESSED', new Date().toISOString());

    return { success: true, lead_id: lead.lead_id, status: lead.workflow.status };
  } catch (err) {
    await supabaseDataService.webhookEvents.updateEventStatus(namespacedEventId, 'FAILED', new Date().toISOString());
    throw err;
  }
}
