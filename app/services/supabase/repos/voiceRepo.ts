/**
 * Tenant-Aware Voice Repositories: Call Transcripts, Conversation Extractions, and Buyer Qualifications
 */

import {
  CallTranscript,
  TranscriptTurn,
  ConversationExtraction,
  BuyerQualification,
} from '../../../schemas/database';
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
import { CallsRepository } from './callsRepo';

export interface CallTranscriptsRepository {
  createTranscript(
    scopeOrTranscript:
      | TenantScope
      | TenantContext
      | {
          id?: string;
          lead_id: string;
          call_id: string;
          provider_call_id?: string | null;
          interaction_id?: string | null;
          transcript_text: string;
          transcript_turns?: TranscriptTurn[] | null;
          language?: string | null;
          duration_seconds?: number | null;
          source: string;
          source_event_type?: string | null;
          ingestion_status?: string;
          ingestion_version?: string;
          captured_at?: string;
        },
    maybeTranscript?: {
      id?: string;
      lead_id: string;
      call_id: string;
      provider_call_id?: string | null;
      interaction_id?: string | null;
      transcript_text: string;
      transcript_turns?: TranscriptTurn[] | null;
      language?: string | null;
      duration_seconds?: number | null;
      source: string;
      source_event_type?: string | null;
      ingestion_status?: string;
      ingestion_version?: string;
      captured_at?: string;
    }
  ): Promise<CallTranscript>;
  getTranscript(scopeOrId: TenantScope | TenantContext | string, maybeId?: string): Promise<CallTranscript | null>;
  getTranscriptByCallId(scopeOrCallId: TenantScope | TenantContext | string, maybeCallId?: string): Promise<CallTranscript | null>;
  getTranscriptByProviderCallId(
    scopeOrProviderCallId: TenantScope | TenantContext | string,
    maybeProviderCallId?: string
  ): Promise<CallTranscript | null>;
  getTranscriptsByLeadId(scopeOrLeadId: TenantScope | TenantContext | string, maybeLeadId?: string): Promise<CallTranscript[]>;
}

export interface ConversationExtractionsRepository {
  createExtraction(
    scopeOrExtraction:
      | TenantScope
      | TenantContext
      | {
          id?: string;
          lead_id: string;
          call_id: string;
          transcript_id: string;
          provider_call_id?: string | null;
          interaction_id?: string | null;
          model: string;
          prompt_version?: string;
          schema_version?: string;
          extraction_status?: string;
          extracted_data?: ConversationExtraction['extracted_data'];
          raw_gemini_response?: Record<string, unknown> | null;
          error_message?: string | null;
        },
    maybeExtraction?: {
      id?: string;
      lead_id: string;
      call_id: string;
      transcript_id: string;
      provider_call_id?: string | null;
      interaction_id?: string | null;
      model: string;
      prompt_version?: string;
      schema_version?: string;
      extraction_status?: string;
      extracted_data?: ConversationExtraction['extracted_data'];
      raw_gemini_response?: Record<string, unknown> | null;
      error_message?: string | null;
    }
  ): Promise<ConversationExtraction>;
  getExtraction(scopeOrId: TenantScope | TenantContext | string, maybeId?: string): Promise<ConversationExtraction | null>;
  getExtractionByTranscriptId(
    scopeOrTranscriptId: TenantScope | TenantContext | string,
    transcriptIdOrSchema?: string,
    maybeSchema?: string,
    maybePrompt?: string
  ): Promise<ConversationExtraction | null>;
  getExtractionByCallId(scopeOrCallId: TenantScope | TenantContext | string, maybeCallId?: string): Promise<ConversationExtraction | null>;
  getExtractionsByLeadId(scopeOrLeadId: TenantScope | TenantContext | string, maybeLeadId?: string): Promise<ConversationExtraction[]>;
}

export interface BuyerQualificationsRepository {
  createQualification(
    scopeOrQualification:
      | TenantScope
      | TenantContext
      | {
          id?: string;
          lead_id: string;
          extraction_id: string;
          qualification_status: BuyerQualification['qualification_status'];
          reason_codes?: BuyerQualification['reason_codes'];
          blocking_fields?: string[];
          follow_up_fields?: string[];
          dimension_assessments?: BuyerQualification['dimension_assessments'];
          evidence_refs?: BuyerQualification['evidence_refs'];
          qualification_version?: string;
          rule_version?: string;
        },
    maybeQualification?: {
      id?: string;
      lead_id: string;
      extraction_id: string;
      qualification_status: BuyerQualification['qualification_status'];
      reason_codes?: BuyerQualification['reason_codes'];
      blocking_fields?: string[];
      follow_up_fields?: string[];
      dimension_assessments?: BuyerQualification['dimension_assessments'];
      evidence_refs?: BuyerQualification['evidence_refs'];
      qualification_version?: string;
      rule_version?: string;
    }
  ): Promise<BuyerQualification>;
  getQualification(scopeOrId: TenantScope | TenantContext | string, maybeId?: string): Promise<BuyerQualification | null>;
  getQualificationByExtractionId(
    scopeOrExtractionId: TenantScope | TenantContext | string,
    extractionIdOrRule?: string,
    maybeRule?: string
  ): Promise<BuyerQualification | null>;
  getQualificationsByLeadId(scopeOrLeadId: TenantScope | TenantContext | string, maybeLeadId?: string): Promise<BuyerQualification[]>;
}

export function createCallTranscriptsRepository(
  transcriptsStore: Map<string, CallTranscript>,
  leadsRepo: LeadsRepository,
  callsRepo: CallsRepository
): CallTranscriptsRepository {
  return {
    createTranscript: async (scopeOrTranscript, maybeTranscript) => {
      const scope = resolveEffectiveTenantScope(maybeTranscript !== undefined ? (scopeOrTranscript as TenantScope) : undefined);
      const input = maybeTranscript !== undefined ? maybeTranscript : (scopeOrTranscript as any);

      // Verify parent call & lead
      const lead = await leadsRepo.getLead(scope, input.lead_id);
      if (!lead) {
        throw new TenantMismatchError(`Cannot create transcript for lead ${input.lead_id}: lead not found in authorized tenant context.`);
      }

      const client = getSupabaseClient();
      const now = new Date().toISOString();
      const id = input.id || generateUUID();
      const tenantId = scope.tenantId || lead.tenant_id;
      const record: CallTranscript = {
        id,
        tenant_id: tenantId,
        lead_id: input.lead_id,
        call_id: input.call_id,
        provider_call_id: input.provider_call_id ?? null,
        interaction_id: input.interaction_id ?? null,
        transcript_text: input.transcript_text,
        transcript_turns: input.transcript_turns ?? null,
        language: input.language ?? 'unknown',
        duration_seconds: input.duration_seconds ?? null,
        source: input.source ?? 'sarvam',
        source_event_type: input.source_event_type ?? null,
        ingestion_status: input.ingestion_status ?? 'INGESTED',
        ingestion_version: input.ingestion_version ?? 'v1',
        captured_at: input.captured_at || now,
        created_at: now,
        updated_at: now,
      };

      if (client) {
        try {
          const { data, error } = await client.from('call_transcripts').insert(record).select().single();
          if (error) {
            if (error.code === 'PGRST205' || error.message?.includes('not find the table')) {
              console.warn('[Supabase Fallback] call_transcripts table not found on remote; using in-memory store.');
            } else {
              console.error('[Supabase Insert Error] call_transcripts:', error);
            }
          } else if (data) {
            transcriptsStore.set(data.id, data);
            return data;
          }
        } catch (err) {
          console.warn('[Supabase Insert Exception] call_transcripts fallback:', err);
        }
      }

      transcriptsStore.set(record.id, record);
      return record;
    },

    getTranscript: async (scopeOrId, maybeId) => {
      const { scope, id } = parseScopeAndId(scopeOrId, maybeId);
      const client = getSupabaseClient();
      if (client) {
        try {
          let query = client.from('call_transcripts').select('*').eq('id', id);
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          const { data, error } = await query.maybeSingle();
          if (!error && data) return data;
        } catch { /* ignore and fallback */ }
      }
      const t = transcriptsStore.get(id) || null;
      if (!t) return null;
      if (!scope.isPlatformAdmin && scope.tenantId && t.tenant_id && t.tenant_id !== scope.tenantId) {
        return null;
      }
      return t;
    },

    getTranscriptByCallId: async (scopeOrCallId, maybeCallId) => {
      const { scope, id: callId } = parseScopeAndId(scopeOrCallId, maybeCallId);
      const client = getSupabaseClient();
      if (client) {
        try {
          let query = client.from('call_transcripts').select('*').eq('call_id', callId);
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          const { data, error } = await query.maybeSingle();
          if (!error && data) return data;
        } catch { /* ignore and fallback */ }
      }
      for (const t of transcriptsStore.values()) {
        if (t.call_id === callId) {
          if (!scope.isPlatformAdmin && scope.tenantId && t.tenant_id && t.tenant_id !== scope.tenantId) {
            continue;
          }
          return t;
        }
      }
      return null;
    },

    getTranscriptByProviderCallId: async (scopeOrProviderCallId, maybeProviderCallId) => {
      const { scope, id: providerCallId } = parseScopeAndId(scopeOrProviderCallId, maybeProviderCallId);
      const client = getSupabaseClient();
      if (client) {
        try {
          let query = client
            .from('call_transcripts')
            .select('*')
            .eq('provider_call_id', providerCallId);
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          const { data, error } = await query.order('created_at', { ascending: false }).limit(1);
          if (!error && data && data.length > 0) return data[0];
        } catch { /* ignore and fallback */ }
      }
      for (const t of transcriptsStore.values()) {
        if (t.provider_call_id === providerCallId) {
          if (!scope.isPlatformAdmin && scope.tenantId && t.tenant_id && t.tenant_id !== scope.tenantId) {
            continue;
          }
          return t;
        }
      }
      return null;
    },

    getTranscriptsByLeadId: async (scopeOrLeadId, maybeLeadId) => {
      const { scope, id: leadId } = parseScopeAndId(scopeOrLeadId, maybeLeadId);
      const client = getSupabaseClient();
      if (client) {
        try {
          let query = client
            .from('call_transcripts')
            .select('*')
            .eq('lead_id', leadId);
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          const { data, error } = await query.order('created_at', { ascending: true });
          if (!error && data) return data;
        } catch { /* ignore and fallback */ }
      }
      return Array.from(transcriptsStore.values()).filter((t) => {
        if (t.lead_id !== leadId) return false;
        if (!scope.isPlatformAdmin && scope.tenantId && t.tenant_id && t.tenant_id !== scope.tenantId) {
          return false;
        }
        return true;
      });
    },
  };
}

export function createConversationExtractionsRepository(
  extractionsStore: Map<string, ConversationExtraction>,
  leadsRepo: LeadsRepository,
  transcriptsRepo: CallTranscriptsRepository
): ConversationExtractionsRepository {
  return {
    createExtraction: async (scopeOrExtraction, maybeExtraction) => {
      const scope = resolveEffectiveTenantScope(maybeExtraction !== undefined ? (scopeOrExtraction as TenantScope) : undefined);
      const extraction = maybeExtraction !== undefined ? maybeExtraction : (scopeOrExtraction as any);

      // Verify parent lead is accessible within scope
      const lead = await leadsRepo.getLead(scope, extraction.lead_id);
      if (!lead) {
        throw new TenantMismatchError(`Cannot create extraction for lead ${extraction.lead_id}: lead not found in authorized tenant context.`);
      }

      const now = new Date().toISOString();
      const tenantId = scope.tenantId || lead.tenant_id;
      const record: ConversationExtraction = {
        id: extraction.id || generateUUID(),
        tenant_id: tenantId,
        lead_id: extraction.lead_id,
        call_id: extraction.call_id,
        transcript_id: extraction.transcript_id,
        provider_call_id: extraction.provider_call_id ?? null,
        interaction_id: extraction.interaction_id ?? null,
        model: extraction.model,
        prompt_version: extraction.prompt_version ?? '1.0',
        schema_version: extraction.schema_version ?? '1.0',
        extraction_status: (extraction.extraction_status as ConversationExtraction['extraction_status']) ?? 'EXTRACTED',
        extracted_data: extraction.extracted_data ?? null,
        raw_gemini_response: extraction.raw_gemini_response ?? null,
        error_message: extraction.error_message ?? null,
        created_at: now,
        updated_at: now,
      };

      const client = getSupabaseClient();
      if (client) {
        try {
          let queryExisting = client
            .from('conversation_extractions')
            .select('id')
            .eq('transcript_id', record.transcript_id)
            .eq('schema_version', record.schema_version)
            .eq('prompt_version', record.prompt_version);
          if (!scope.isPlatformAdmin && tenantId) {
            queryExisting = queryExisting.eq('tenant_id', tenantId);
          }
          const { data: existing } = await queryExisting.maybeSingle();

          let query;
          if (existing) {
            query = client.from('conversation_extractions').update(record).eq('id', existing.id);
          } else {
            query = client.from('conversation_extractions').insert(record);
          }
          const { data, error } = await query.select().single();
          if (!error && data) {
            extractionsStore.set(data.id, data);
            return data;
          }
          if (error) {
            console.warn('[Supabase Insert Error] conversation_extractions fallback to in-memory:', error.message);
          }
        } catch (err) {
          console.warn('[Supabase Insert Exception] conversation_extractions fallback:', err);
        }
      }

      extractionsStore.set(record.id, record);
      return record;
    },

    getExtraction: async (scopeOrId, maybeId) => {
      const { scope, id } = parseScopeAndId(scopeOrId, maybeId);
      const client = getSupabaseClient();
      if (client) {
        try {
          let query = client.from('conversation_extractions').select('*').eq('id', id);
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          const { data, error } = await query.maybeSingle();
          if (!error && data) return data;
        } catch { /* ignore and fallback */ }
      }
      const e = extractionsStore.get(id) || null;
      if (!e) return null;
      if (!scope.isPlatformAdmin && scope.tenantId && e.tenant_id && e.tenant_id !== scope.tenantId) {
        return null;
      }
      return e;
    },

    getExtractionByTranscriptId: async (scopeOrTranscriptId, transcriptIdOrSchema, maybeSchema, maybePrompt) => {
      let scope: any;
      let transcriptId: string;
      let schemaVersion: string | undefined;
      let promptVersion: string | undefined;

      if (typeof scopeOrTranscriptId === 'object') {
        scope = resolveEffectiveTenantScope(scopeOrTranscriptId as TenantScope);
        transcriptId = transcriptIdOrSchema as string;
        schemaVersion = maybeSchema;
        promptVersion = maybePrompt;
      } else {
        scope = resolveEffectiveTenantScope(undefined);
        transcriptId = scopeOrTranscriptId as string;
        schemaVersion = transcriptIdOrSchema;
        promptVersion = maybeSchema;
      }

      const client = getSupabaseClient();
      if (client) {
        try {
          let query = client.from('conversation_extractions').select('*').eq('transcript_id', transcriptId);
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          if (schemaVersion) {
            query = query.eq('schema_version', schemaVersion);
          }
          if (promptVersion) {
            query = query.eq('prompt_version', promptVersion);
          }
          const { data, error } = await query.order('created_at', { ascending: false }).limit(1);
          if (!error && data && data.length > 0) return data[0];
        } catch { /* ignore and fallback */ }
      }
      return (
        Array.from(extractionsStore.values())
          .filter((e) => {
            if (e.transcript_id !== transcriptId) return false;
            if (!scope.isPlatformAdmin && scope.tenantId && e.tenant_id && e.tenant_id !== scope.tenantId) return false;
            if (schemaVersion && e.schema_version !== schemaVersion) return false;
            if (promptVersion && e.prompt_version !== promptVersion) return false;
            return true;
          })
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] || null
      );
    },

    getExtractionByCallId: async (scopeOrCallId, maybeCallId) => {
      const { scope, id: callId } = parseScopeAndId(scopeOrCallId, maybeCallId);
      const client = getSupabaseClient();
      if (client) {
        try {
          let query = client
            .from('conversation_extractions')
            .select('*')
            .eq('call_id', callId);
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          const { data, error } = await query.order('created_at', { ascending: false }).limit(1);
          if (!error && data && data.length > 0) return data[0];
        } catch { /* ignore and fallback */ }
      }
      return (
        Array.from(extractionsStore.values())
          .filter((e) => {
            if (e.call_id !== callId) return false;
            if (!scope.isPlatformAdmin && scope.tenantId && e.tenant_id && e.tenant_id !== scope.tenantId) return false;
            return true;
          })
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] || null
      );
    },

    getExtractionsByLeadId: async (scopeOrLeadId, maybeLeadId) => {
      const { scope, id: leadId } = parseScopeAndId(scopeOrLeadId, maybeLeadId);
      const client = getSupabaseClient();
      if (client) {
        try {
          let query = client
            .from('conversation_extractions')
            .select('*')
            .eq('lead_id', leadId);
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          const { data, error } = await query.order('created_at', { ascending: true });
          if (!error && data) return data;
        } catch { /* ignore and fallback */ }
      }
      return Array.from(extractionsStore.values()).filter((e) => {
        if (e.lead_id !== leadId) return false;
        if (!scope.isPlatformAdmin && scope.tenantId && e.tenant_id && e.tenant_id !== scope.tenantId) return false;
        return true;
      });
    },
  };
}

export function createBuyerQualificationsRepository(
  qualificationsStore: Map<string, BuyerQualification>,
  leadsRepo: LeadsRepository,
  extractionsRepo: ConversationExtractionsRepository
): BuyerQualificationsRepository {
  return {
    createQualification: async (scopeOrQualification, maybeQualification) => {
      const scope = resolveEffectiveTenantScope(maybeQualification !== undefined ? (scopeOrQualification as TenantScope) : undefined);
      const qualification = maybeQualification !== undefined ? maybeQualification : (scopeOrQualification as any);

      // Verify parent lead is accessible within scope
      const lead = await leadsRepo.getLead(scope, qualification.lead_id);
      if (!lead) {
        throw new TenantMismatchError(`Cannot create qualification for lead ${qualification.lead_id}: lead not found in authorized tenant context.`);
      }

      const now = new Date().toISOString();
      const tenantId = scope.tenantId || lead.tenant_id;
      const record: BuyerQualification = {
        id: qualification.id || generateUUID(),
        tenant_id: tenantId,
        lead_id: qualification.lead_id,
        extraction_id: qualification.extraction_id,
        qualification_status: qualification.qualification_status,
        reason_codes: qualification.reason_codes ?? [],
        blocking_fields: qualification.blocking_fields ?? [],
        follow_up_fields: qualification.follow_up_fields ?? [],
        dimension_assessments: qualification.dimension_assessments ?? {},
        evidence_refs: qualification.evidence_refs ?? [],
        qualification_version: qualification.qualification_version ?? '1.0',
        rule_version: qualification.rule_version ?? '1.0',
        created_at: now,
        updated_at: now,
      };

      const client = getSupabaseClient();
      if (client) {
        try {
          let queryExisting = client
            .from('buyer_qualifications')
            .select('id')
            .eq('extraction_id', record.extraction_id)
            .eq('rule_version', record.rule_version);
          if (!scope.isPlatformAdmin && tenantId) {
            queryExisting = queryExisting.eq('tenant_id', tenantId);
          }
          const { data: existing } = await queryExisting.maybeSingle();

          let query;
          if (existing) {
            query = client.from('buyer_qualifications').update(record).eq('id', existing.id);
          } else {
            query = client.from('buyer_qualifications').insert(record);
          }
          const { data, error } = await query.select().single();
          if (!error && data) {
            qualificationsStore.set(data.id, data);
            return data;
          }
          if (error) {
            console.warn('[Supabase Insert Error] buyer_qualifications fallback to in-memory:', error.message);
          }
        } catch (err) {
          console.warn('[Supabase Insert Exception] buyer_qualifications fallback:', err);
        }
      }

      qualificationsStore.set(record.id, record);
      return record;
    },

    getQualification: async (scopeOrId, maybeId) => {
      const { scope, id } = parseScopeAndId(scopeOrId, maybeId);
      const client = getSupabaseClient();
      if (client) {
        try {
          let query = client.from('buyer_qualifications').select('*').eq('id', id);
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          const { data, error } = await query.maybeSingle();
          if (!error && data) return data;
        } catch { /* ignore and fallback */ }
      }
      const q = qualificationsStore.get(id) || null;
      if (!q) return null;
      if (!scope.isPlatformAdmin && scope.tenantId && q.tenant_id && q.tenant_id !== scope.tenantId) {
        return null;
      }
      return q;
    },

    getQualificationByExtractionId: async (scopeOrExtractionId, extractionIdOrRule, maybeRule) => {
      let scope: any;
      let extractionId: string;
      let ruleVersion: string | undefined;

      if (
        typeof scopeOrExtractionId === 'object' ||
        (maybeRule !== undefined) ||
        (typeof scopeOrExtractionId === 'string' && extractionIdOrRule !== undefined && !extractionIdOrRule.startsWith('1.') && !extractionIdOrRule.startsWith('2.') && !extractionIdOrRule.startsWith('v'))
      ) {
        scope = resolveEffectiveTenantScope(scopeOrExtractionId as TenantScope);
        extractionId = extractionIdOrRule as string;
        ruleVersion = maybeRule;
      } else {
        scope = resolveEffectiveTenantScope(undefined);
        extractionId = scopeOrExtractionId as string;
        ruleVersion = extractionIdOrRule;
      }

      const client = getSupabaseClient();
      if (client) {
        try {
          let query = client.from('buyer_qualifications').select('*').eq('extraction_id', extractionId);
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          if (ruleVersion) {
            query = query.eq('rule_version', ruleVersion);
          }
          const { data, error } = await query.order('created_at', { ascending: false }).limit(1);
          if (!error && data && data.length > 0) return data[0];
        } catch { /* ignore and fallback */ }
      }
      return (
        Array.from(qualificationsStore.values())
          .filter((q) => {
            if (q.extraction_id !== extractionId) return false;
            if (!scope.isPlatformAdmin && scope.tenantId && q.tenant_id && q.tenant_id !== scope.tenantId) return false;
            if (ruleVersion && q.rule_version !== ruleVersion) return false;
            return true;
          })
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] || null
      );
    },

    getQualificationsByLeadId: async (scopeOrLeadId, maybeLeadId) => {
      const { scope, id: leadId } = parseScopeAndId(scopeOrLeadId, maybeLeadId);
      const client = getSupabaseClient();
      if (client) {
        try {
          let query = client
            .from('buyer_qualifications')
            .select('*')
            .eq('lead_id', leadId);
          if (!scope.isPlatformAdmin && scope.tenantId) {
            query = query.eq('tenant_id', scope.tenantId);
          }
          const { data, error } = await query.order('created_at', { ascending: true });
          if (!error && data) return data;
        } catch { /* ignore and fallback */ }
      }
      return Array.from(qualificationsStore.values()).filter((q) => {
        if (q.lead_id !== leadId) return false;
        if (!scope.isPlatformAdmin && scope.tenantId && q.tenant_id && q.tenant_id !== scope.tenantId) return false;
        return true;
      });
    },
  };
}
