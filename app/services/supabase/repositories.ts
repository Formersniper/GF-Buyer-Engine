/**
 * GrowthForge Buyer Intelligence Engine - Authoritative Supabase Repositories
 *
 * SUPABASE AS SYSTEM OF RECORD:
 * Provides typed repository interfaces and implementations for:
 * 1. leads
 * 2. lead_enrichment
 * 3. calls
 * 4. buyer_profiles
 * 5. buyer_preferences
 * 6. projects
 * 7. project_matches
 * 8. buyer_scores
 * 9. lead_events
 *
 * Canonical Domain Mapping:
 * Includes mapToGFBuyerLead() to aggregate normalized records into the frozen GFBuyerLead domain contract.
 */

import {
  Lead,
  LeadEnrichment,
  Call,
  BuyerProfile,
  BuyerPreference,
  DbProject,
  DbProjectMatch,
  BuyerScore,
  LeadEvent,
  CallTranscript,
  TranscriptTurn,
  ConversationExtraction,
  BuyerQualification,
  BuyerScoreRecord,
  PriorityQueueItem,
  DbBrokerHandoff,
  BrokerHandoffPackage,
  BrokerHandoffReadiness,
  BrokerRoutingStatus,
  BrokerDispatchStatus,
  HandoffQueueItem,
} from '../../schemas/database';
import { GFBuyerLead, ProjectMatch as DomainProjectMatch } from '../../schemas/buyerLead';
import { WorkflowStatus } from '../../schemas/workflow';
import { getSupabaseClient } from './client';
import { SAMPLE_PROJECT_CATALOG } from '../data/sampleProjects';

// ==========================================
// 1. REPOSITORY CONTRACTS (Section 10)
// ==========================================

export interface LeadsRepository {
  createLead(lead: Partial<Omit<Lead, 'id' | 'created_at' | 'updated_at'>> & { lead_id: string; phone: string; name?: string } & { id?: string }): Promise<Lead>;
  getLead(id: string): Promise<Lead | null>;
  getLeadByLeadId(leadId: string): Promise<Lead | null>;
  updateLead(id: string, updates: Partial<Omit<Lead, 'id' | 'lead_id' | 'created_at'>>): Promise<Lead>;
  listLeads(filter?: { status?: string; limit?: number; offset?: number }): Promise<Lead[]>;
  deleteLead(id: string): Promise<boolean>;
}

export interface LeadEnrichmentRepository {
  createEnrichment(enrichment: Omit<LeadEnrichment, 'id' | 'created_at'> & { id?: string }): Promise<LeadEnrichment>;
  getEnrichment(leadId: string): Promise<LeadEnrichment[]>;
}

export interface CallsRepository {
  createCall(call: Partial<Omit<Call, 'id' | 'created_at'>> & { lead_id: string } & { id?: string }): Promise<Call>;
  getCall(id: string): Promise<Call | null>;
  getCallByProviderCallId(providerCallId: string): Promise<Call | null>;
  getCallsByLead(leadId: string): Promise<Call[]>;
  updateCall(id: string, updates: Partial<Omit<Call, 'id' | 'lead_id' | 'created_at'>>): Promise<Call>;
}

export interface BuyerProfilesRepository {
  upsertBuyerProfile(profile: Partial<Omit<BuyerProfile, 'id' | 'created_at' | 'updated_at'>> & { lead_id: string; id?: string }): Promise<BuyerProfile>;
  getBuyerProfile(leadId: string): Promise<BuyerProfile | null>;
}

export interface BuyerPreferencesRepository {
  addBuyerPreference(preference: Omit<BuyerPreference, 'id' | 'created_at'> & { id?: string }): Promise<BuyerPreference>;
  getBuyerPreferences(leadId: string): Promise<BuyerPreference[]>;
}

export interface ProjectsRepository {
  createProject(project: Omit<DbProject, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Promise<DbProject>;
  getProject(id: string): Promise<DbProject | null>;
  getProjectByCode(projectCode: string): Promise<DbProject | null>;
  listProjects(filter?: { city?: string; status?: string; limit?: number }): Promise<DbProject[]>;
}

export interface ProjectMatchesRepository {
  upsertProjectMatch(match: Omit<DbProjectMatch, 'id' | 'created_at'> & { id?: string }): Promise<DbProjectMatch>;
  getProjectMatches(leadId: string): Promise<DbProjectMatch[]>;
}

export interface BuyerScoresRepository {
  createBuyerScore(score: Omit<BuyerScore, 'id' | 'created_at'> & { id?: string }): Promise<BuyerScore>;
  createBuyerScoreRecord(score: Omit<BuyerScoreRecord, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Promise<BuyerScoreRecord>;
  getBuyerScore(id: string): Promise<BuyerScoreRecord | null>;
  getBuyerScoreByQualificationId(qualificationId: string, ruleVersion?: string): Promise<BuyerScoreRecord | null>;
  getBuyerScoresByLeadId(leadId: string): Promise<BuyerScoreRecord[]>;
  getLatestBuyerScore(leadId: string): Promise<BuyerScore | null>;
  getLatestBuyerScoreRecord(leadId: string): Promise<BuyerScoreRecord | null>;
  listPriorityQueue(filter?: { tier?: string; limit?: number }): Promise<PriorityQueueItem[]>;
}

export interface LeadEventsRepository {
  appendLeadEvent(event: Omit<LeadEvent, 'id' | 'created_at'> & { id?: string }): Promise<LeadEvent>;
  getLeadEvents(leadId: string): Promise<LeadEvent[]>;
}

export interface CallTranscriptsRepository {
  createTranscript(transcript: {
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
  }): Promise<CallTranscript>;
  getTranscript(id: string): Promise<CallTranscript | null>;
  getTranscriptByCallId(callId: string): Promise<CallTranscript | null>;
  getTranscriptByProviderCallId(providerCallId: string): Promise<CallTranscript | null>;
  getTranscriptsByLeadId(leadId: string): Promise<CallTranscript[]>;
}

export interface ConversationExtractionsRepository {
  createExtraction(extraction: {
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
  }): Promise<ConversationExtraction>;
  getExtraction(id: string): Promise<ConversationExtraction | null>;
  getExtractionByTranscriptId(transcriptId: string, schemaVersion?: string, promptVersion?: string): Promise<ConversationExtraction | null>;
  getExtractionByCallId(callId: string): Promise<ConversationExtraction | null>;
  getExtractionsByLeadId(leadId: string): Promise<ConversationExtraction[]>;
}

export interface BuyerQualificationsRepository {
  createQualification(qualification: {
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
  }): Promise<BuyerQualification>;
  getQualification(id: string): Promise<BuyerQualification | null>;
  getQualificationByExtractionId(extractionId: string, ruleVersion?: string): Promise<BuyerQualification | null>;
  getQualificationsByLeadId(leadId: string): Promise<BuyerQualification[]>;
}

export interface BrokerHandoffRepository {
  createHandoff(handoff: Omit<DbBrokerHandoff, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Promise<DbBrokerHandoff>;
  getHandoff(id: string): Promise<DbBrokerHandoff | null>;
  getHandoffsByLeadId(leadId: string): Promise<DbBrokerHandoff[]>;
  getHandoffByScoreId(scoreId: string, ruleVersion?: string): Promise<DbBrokerHandoff | null>;
  getLatestHandoff(leadId: string): Promise<DbBrokerHandoff | null>;
  updateStatus(id: string, handoffStatus: BrokerHandoffReadiness, routingStatus?: BrokerRoutingStatus): Promise<DbBrokerHandoff>;
  updateDispatchStatus(id: string, dispatchStatus: BrokerDispatchStatus, dispatchId?: string, channel?: string): Promise<DbBrokerHandoff>;
  listHandoffQueue(filter?: { tier?: string; status?: string; limit?: number }): Promise<HandoffQueueItem[]>;
}

// ==========================================
// 2. IN-MEMORY & CLIENT BACKED STORE
// ==========================================

class SupabaseDataService {
  private leadsStore: Map<string, Lead> = new Map();
  private enrichmentStore: Map<string, LeadEnrichment[]> = new Map();
  private callsStore: Map<string, Call> = new Map();
  private transcriptsStore: Map<string, CallTranscript> = new Map();
  private extractionsStore: Map<string, ConversationExtraction> = new Map();
  private qualificationsStore: Map<string, BuyerQualification> = new Map();
  private buyerProfilesStore: Map<string, BuyerProfile> = new Map();
  private buyerPreferencesStore: Map<string, BuyerPreference[]> = new Map();
  private projectsStore: Map<string, DbProject> = new Map();
  private projectMatchesStore: Map<string, DbProjectMatch[]> = new Map();
  private buyerScoresStore: Map<string, BuyerScore[]> = new Map();
  private buyerScoreRecordsStore: Map<string, BuyerScoreRecord> = new Map();
  private brokerHandoffsStore: Map<string, DbBrokerHandoff> = new Map();
  private leadEventsStore: Map<string, LeadEvent[]> = new Map();


  constructor() {
    this.seedDefaultProjects();
  }

  private generateUUID(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  private seedDefaultProjects(): void {
    const sampleProjects: Array<Omit<DbProject, 'id' | 'created_at' | 'updated_at'>> = SAMPLE_PROJECT_CATALOG;

    const now = new Date().toISOString();
    for (const p of sampleProjects) {
      const id = this.generateUUID();
      this.projectsStore.set(id, {
        id,
        ...p,
        created_at: now,
        updated_at: now,
      });
    }
  }

  // --- Leads ---
  public readonly leads: LeadsRepository = {
    createLead: async (input) => {
      const client = getSupabaseClient();
      const now = new Date().toISOString();
      const id = input.id || this.generateUUID();
      const record: Lead = {
        id,
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
        const { data, error } = await client.from('leads').insert(record).select().single();
        if (error) {
          console.error('[Supabase Persistence Error] Failed to insert lead:', error);
          throw new Error(`Supabase insert failed on public.leads: ${error.message} (code: ${error.code || 'UNKNOWN'})`);
        }
        if (!data) {
          throw new Error('Supabase insert failed on public.leads: No row returned after insert.');
        }
        this.leadsStore.set(data.id, data);
        return data;
      }

      this.leadsStore.set(record.id, record);
      return record;
    },

    getLead: async (id: string) => {
      const client = getSupabaseClient();
      if (client) {
        const { data, error } = await client.from('leads').select('*').eq('id', id).maybeSingle();
        if (error) {
          console.error('[Supabase Query Error] Failed to get lead by id:', error);
          throw new Error(`Supabase query failed on public.leads: ${error.message}`);
        }
        if (data) {
          this.leadsStore.set(data.id, data);
          return data;
        }
        return null;
      }
      return this.leadsStore.get(id) || null;
    },

    getLeadByLeadId: async (leadId: string) => {
      const client = getSupabaseClient();
      if (client) {
        const { data, error } = await client.from('leads').select('*').eq('lead_id', leadId).maybeSingle();
        if (error) {
          console.error('[Supabase Query Error] Failed to get lead by lead_id:', error);
          throw new Error(`Supabase query failed on public.leads: ${error.message}`);
        }
        if (data) {
          this.leadsStore.set(data.id, data);
          return data;
        }
        return null;
      }
      for (const lead of this.leadsStore.values()) {
        if (lead.lead_id === leadId) return lead;
      }
      return null;
    },

    updateLead: async (id: string, updates) => {
      const client = getSupabaseClient();
      const now = new Date().toISOString();

      if (client) {
        const { data, error } = await client
          .from('leads')
          .update({ ...updates, updated_at: now })
          .eq('id', id)
          .select()
          .single();
        if (error) {
          console.error('[Supabase Update Error] Failed to update lead:', error);
          throw new Error(`Supabase update failed on public.leads: ${error.message}`);
        }
        if (data) {
          this.leadsStore.set(data.id, data);
          return data;
        }
      }

      const existing = this.leadsStore.get(id);
      if (!existing) {
        throw new Error(`Lead with ID ${id} not found.`);
      }
      const updated: Lead = {
        ...existing,
        ...updates,
        updated_at: now,
      };
      this.leadsStore.set(id, updated);
      return updated;
    },

    listLeads: async (filter) => {
      const client = getSupabaseClient();
      if (client) {
        let query = client.from('leads').select('*').order('created_at', { ascending: false });
        if (filter?.status) {
          query = query.eq('status', filter.status);
        }
        if (filter?.limit) {
          query = query.limit(filter.limit);
        }
        const { data, error } = await query;
        if (error) {
          console.error('[Supabase Query Error] Failed to list leads:', error);
          throw new Error(`Supabase list query failed on public.leads: ${error.message}`);
        }
        if (data) {
          for (const item of data) {
            this.leadsStore.set(item.id, item);
          }
          return data;
        }
      }

      let all = Array.from(this.leadsStore.values()).sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      if (filter?.status) {
        all = all.filter((l) => l.status === filter.status);
      }
      if (filter?.limit) {
        all = all.slice(filter.offset || 0, (filter.offset || 0) + filter.limit);
      }
      return all;
    },

    deleteLead: async (id: string) => {
      const client = getSupabaseClient();
      if (client) {
        const { error } = await client.from('leads').delete().eq('id', id);
        if (error) {
          console.error('[Supabase Delete Error] Failed to delete lead:', error);
          throw new Error(`Supabase delete failed on public.leads: ${error.message}`);
        }
      }
      return this.leadsStore.delete(id);
    },
  };

  // --- Lead Enrichment ---
  public readonly leadEnrichment: LeadEnrichmentRepository = {
    createEnrichment: async (input) => {
      const client = getSupabaseClient();
      const now = new Date().toISOString();
      const id = input.id || this.generateUUID();
      const record: LeadEnrichment = {
        id,
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
        const { data, error } = await client.from('lead_enrichment').insert(record).select().single();
        if (error) {
          console.error('[Supabase Insert Error] lead_enrichment:', error);
          throw new Error(`Supabase insert failed on lead_enrichment: ${error.message}`);
        }
        if (data) return data;
      }

      const list = this.enrichmentStore.get(record.lead_id) || [];
      list.push(record);
      this.enrichmentStore.set(record.lead_id, list);
      return record;
    },

    getEnrichment: async (leadId: string) => {
      const client = getSupabaseClient();
      if (client) {
        const { data, error } = await client.from('lead_enrichment').select('*').eq('lead_id', leadId);
        if (error) {
          console.error('[Supabase Query Error] lead_enrichment:', error);
          throw new Error(`Supabase query failed on lead_enrichment: ${error.message}`);
        }
        if (data) return data;
      }
      return this.enrichmentStore.get(leadId) || [];
    },
  };

  // --- Calls ---
  public readonly calls: CallsRepository = {
    createCall: async (input) => {
      const client = getSupabaseClient();
      const now = new Date().toISOString();
      const id = input.id || this.generateUUID();
      const record: Call = {
        id,
        lead_id: input.lead_id,
        provider: input.provider ?? 'generic',
        provider_call_id: input.provider_call_id ?? null,
        status: input.status ?? 'INITIATED',
        attempt_number: input.attempt_number ?? 1,
        started_at: input.started_at !== undefined ? input.started_at : now,
        ended_at: input.ended_at !== undefined ? input.ended_at : null,
        duration_seconds: input.duration_seconds ?? 0,
        transcript: input.transcript ?? null,
        recording_url: input.recording_url ?? null,
        call_outcome: input.call_outcome ?? null,
        call_metadata: input.call_metadata ?? null,
        created_at: now,
      };

      if (client) {
        const { data, error } = await client.from('calls').insert(record).select().single();
        if (error) {
          console.error('[Supabase Insert Error] calls:', error);
          throw new Error(`Supabase insert failed on calls: ${error.message}`);
        }
        if (data) {
          this.callsStore.set(data.id, data);
          return data;
        }
      }

      this.callsStore.set(record.id, record);
      return record;
    },

    getCall: async (idOrProviderCallId: string) => {
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrProviderCallId);
      const client = getSupabaseClient();
      if (client) {
        if (isUUID) {
          const { data, error } = await client.from('calls').select('*').eq('id', idOrProviderCallId).maybeSingle();
          if (error) {
            console.error('[Supabase Query Error] calls:', error);
            throw new Error(`Supabase query failed on calls: ${error.message}`);
          }
          if (data) return data;
        } else {
          const { data, error } = await client.from('calls').select('*').eq('provider_call_id', idOrProviderCallId).maybeSingle();
          if (error) {
            console.error('[Supabase Query Error] calls:', error);
            throw new Error(`Supabase query failed on calls: ${error.message}`);
          }
          if (data) return data;
        }
      }
      return (
        this.callsStore.get(idOrProviderCallId) ||
        Array.from(this.callsStore.values()).find((c) => c.provider_call_id === idOrProviderCallId) ||
        null
      );
    },

    getCallByProviderCallId: async (providerCallId: string) => {
      const client = getSupabaseClient();
      if (client) {
        const { data, error } = await client
          .from('calls')
          .select('*')
          .eq('provider_call_id', providerCallId)
          .order('created_at', { ascending: false })
          .limit(1);
        if (error) {
          console.error('[Supabase Query Error] calls:', error);
          throw new Error(`Supabase query failed on calls: ${error.message}`);
        }
        if (data && data.length > 0) return data[0];
      }
      return Array.from(this.callsStore.values()).find((c) => c.provider_call_id === providerCallId) || null;
    },

    getCallsByLead: async (leadId: string) => {
      const client = getSupabaseClient();
      if (client) {
        const { data, error } = await client.from('calls').select('*').eq('lead_id', leadId);
        if (error) {
          console.error('[Supabase Query Error] calls:', error);
          throw new Error(`Supabase query failed on calls: ${error.message}`);
        }
        if (data) return data;
      }
      return Array.from(this.callsStore.values()).filter((c) => c.lead_id === leadId);
    },

    updateCall: async (id: string, updates) => {
      const client = getSupabaseClient();
      if (client) {
        const { data, error } = await client.from('calls').update(updates).eq('id', id).select().single();
        if (error) {
          console.error('[Supabase Update Error] calls:', error);
          throw new Error(`Supabase update failed on calls: ${error.message}`);
        }
        if (data) {
          this.callsStore.set(data.id, data);
          return data;
        }
      }

      const existing = this.callsStore.get(id);
      if (!existing) {
        throw new Error(`Call with ID ${id} not found.`);
      }
      const updated: Call = { ...existing, ...updates };
      this.callsStore.set(id, updated);
      return updated;
    },
  };

  // --- Buyer Profiles ---
  public readonly buyerProfiles: BuyerProfilesRepository = {
    upsertBuyerProfile: async (input) => {
      const client = getSupabaseClient();
      const now = new Date().toISOString();
      const id = input.id || this.generateUUID();
      const record: BuyerProfile = {
        id,
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
        const { data, error } = await client
          .from('buyer_profiles')
          .upsert(record, { onConflict: 'lead_id' })
          .select()
          .single();
        if (error) {
          console.error('[Supabase Upsert Error] buyer_profiles:', error);
          throw new Error(`Supabase upsert failed on buyer_profiles: ${error.message}`);
        }
        if (data) {
          this.buyerProfilesStore.set(data.lead_id, data);
          return data;
        }
      }

      this.buyerProfilesStore.set(record.lead_id, record);
      return record;
    },

    getBuyerProfile: async (leadId: string) => {
      const client = getSupabaseClient();
      if (client) {
        const { data, error } = await client.from('buyer_profiles').select('*').eq('lead_id', leadId).maybeSingle();
        if (error) {
          console.error('[Supabase Query Error] buyer_profiles:', error);
          throw new Error(`Supabase query failed on buyer_profiles: ${error.message}`);
        }
        if (data) return data;
      }
      return this.buyerProfilesStore.get(leadId) || null;
    },
  };

  // --- Buyer Preferences ---
  public readonly buyerPreferences: BuyerPreferencesRepository = {
    addBuyerPreference: async (input) => {
      const client = getSupabaseClient();
      const now = new Date().toISOString();
      const id = input.id || this.generateUUID();
      const record: BuyerPreference = {
        id,
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
        const { data, error } = await client.from('buyer_preferences').insert(record).select().single();
        if (error) {
          console.error('[Supabase Insert Error] buyer_preferences:', error);
          throw new Error(`Supabase insert failed on buyer_preferences: ${error.message}`);
        }
        if (data) return data;
      }

      const list = this.buyerPreferencesStore.get(record.lead_id) || [];
      list.push(record);
      this.buyerPreferencesStore.set(record.lead_id, list);
      return record;
    },

    getBuyerPreferences: async (leadId: string) => {
      const client = getSupabaseClient();
      if (client) {
        const { data, error } = await client.from('buyer_preferences').select('*').eq('lead_id', leadId);
        if (error) {
          console.error('[Supabase Query Error] buyer_preferences:', error);
          throw new Error(`Supabase query failed on buyer_preferences: ${error.message}`);
        }
        if (data) return data;
      }
      return this.buyerPreferencesStore.get(leadId) || [];
    },
  };

  // --- Projects ---
  public readonly projects: ProjectsRepository = {
    createProject: async (input) => {
      const client = getSupabaseClient();
      const now = new Date().toISOString();
      const id = input.id || this.generateUUID();
      const record: DbProject = {
        id,
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
        const { data, error } = await client.from('projects').insert(record).select().single();
        if (error) {
          console.error('[Supabase Insert Error] projects:', error);
          throw new Error(`Supabase insert failed on projects: ${error.message}`);
        }
        if (data) {
          this.projectsStore.set(data.id, data);
          return data;
        }
      }

      this.projectsStore.set(record.id, record);
      return record;
    },

    getProject: async (id: string) => {
      const client = getSupabaseClient();
      if (client) {
        const { data, error } = await client.from('projects').select('*').eq('id', id).maybeSingle();
        if (error) {
          console.error('[Supabase Query Error] projects:', error);
          throw new Error(`Supabase query failed on projects: ${error.message}`);
        }
        if (data) return data;
      }
      return this.projectsStore.get(id) || null;
    },

    getProjectByCode: async (projectCode: string) => {
      const client = getSupabaseClient();
      if (client) {
        const { data, error } = await client.from('projects').select('*').eq('project_code', projectCode).maybeSingle();
        if (error) {
          console.error('[Supabase Query Error] projects:', error);
          throw new Error(`Supabase query failed on projects: ${error.message}`);
        }
        if (data) return data;
      }
      for (const p of this.projectsStore.values()) {
        if (p.project_code === projectCode) return p;
      }
      return null;
    },

    listProjects: async (filter) => {
      const client = getSupabaseClient();
      if (client) {
        let query = client.from('projects').select('*');
        if (filter?.city) query = query.eq('city', filter.city);
        if (filter?.status) query = query.eq('status', filter.status);
        if (filter?.limit) query = query.limit(filter.limit);
        const { data, error } = await query;
        if (error) {
          console.error('[Supabase Query Error] projects:', error);
          throw new Error(`Supabase query failed on projects: ${error.message}`);
        }
        if (data) return data;
      }

      let all = Array.from(this.projectsStore.values());
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

  // --- Project Matches ---
  public readonly projectMatches: ProjectMatchesRepository = {
    upsertProjectMatch: async (input) => {
      const client = getSupabaseClient();
      const now = new Date().toISOString();
      const id = input.id || this.generateUUID();
      const record: DbProjectMatch = {
        id,
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
        const { data, error } = await client
          .from('project_matches')
          .upsert(record, { onConflict: 'lead_id,project_id' })
          .select()
          .single();
        if (error) {
          console.error('[Supabase Upsert Error] project_matches:', error);
          throw new Error(`Supabase upsert failed on project_matches: ${error.message}`);
        }
        if (data) return data;
      }

      const list = this.projectMatchesStore.get(record.lead_id) || [];
      const filtered = list.filter((m) => m.project_id !== record.project_id);
      filtered.push(record);
      this.projectMatchesStore.set(record.lead_id, filtered);
      return record;
    },

    getProjectMatches: async (leadId: string) => {
      const client = getSupabaseClient();
      if (client) {
        const { data, error } = await client.from('project_matches').select('*').eq('lead_id', leadId);
        if (error) {
          console.error('[Supabase Query Error] project_matches:', error);
          throw new Error(`Supabase query failed on project_matches: ${error.message}`);
        }
        if (data) return data;
      }
      return this.projectMatchesStore.get(leadId) || [];
    },
  };

  // --- Buyer Scores ---
  public readonly buyerScores: BuyerScoresRepository = {
    createBuyerScore: async (input) => {
      const client = getSupabaseClient();
      const now = new Date().toISOString();
      const id = input.id || this.generateUUID();
      const record: BuyerScore = {
        id,
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
        const { data, error } = await client.from('buyer_scores').insert(record).select().single();
        if (error) {
          console.error('[Supabase Insert Error] buyer_scores:', error);
          throw new Error(`Supabase insert failed on buyer_scores: ${error.message}`);
        }
        if (data) return data;
      }

      const list = this.buyerScoresStore.get(record.lead_id) || [];
      list.push(record);
      this.buyerScoresStore.set(record.lead_id, list);
      return record;
    },

    createBuyerScoreRecord: async (input) => {
      const client = getSupabaseClient();
      const now = new Date().toISOString();
      const id = input.id || this.generateUUID();
      const compScore = input.score ?? input.composite_score ?? input.total_score ?? 0;
      const record: BuyerScoreRecord = {
        id,
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
          const { data: existing } = await client
            .from('buyer_scores')
            .select('id')
            .eq('qualification_id', record.qualification_id)
            .eq('rule_version', record.rule_version)
            .maybeSingle();

          // Prepare clean payload matching database columns
          const dbPayload = {
            id: existing ? existing.id : record.id,
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
            this.buyerScoreRecordsStore.set(mergedRecord.id, mergedRecord);
            return mergedRecord;
          }
          if (error) {
            console.warn('[Supabase Insert Error] buyer_scores fallback to in-memory:', error.message);
          }
        } catch (err) {
          console.warn('[Supabase Insert Exception] buyer_scores fallback:', err);
        }
      }

      this.buyerScoreRecordsStore.set(record.id, record);
      return record;
    },

    getBuyerScore: async (id: string) => {
      const client = getSupabaseClient();
      if (client) {
        try {
          const { data, error } = await client.from('buyer_scores').select('*').eq('id', id).maybeSingle();
          if (!error && data) return data;
        } catch {
          // ignore and fallback
        }
      }
      return this.buyerScoreRecordsStore.get(id) || null;
    },

    getBuyerScoreByQualificationId: async (qualificationId: string, ruleVersion?: string) => {
      const client = getSupabaseClient();
      if (client) {
        try {
          let query = client.from('buyer_scores').select('*').eq('qualification_id', qualificationId);
          if (ruleVersion) {
            query = query.eq('rule_version', ruleVersion);
          }
          const { data, error } = await query.order('created_at', { ascending: false }).limit(1);
          if (!error && data && data.length > 0) return data[0];
        } catch {
          // ignore and fallback
        }
      }
      return (
        Array.from(this.buyerScoreRecordsStore.values())
          .filter((s) => {
            if (s.qualification_id !== qualificationId) return false;
            if (ruleVersion && s.rule_version !== ruleVersion) return false;
            return true;
          })
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] || null
      );
    },

    getBuyerScoresByLeadId: async (leadId: string) => {
      const client = getSupabaseClient();
      if (client) {
        try {
          const { data, error } = await client
            .from('buyer_scores')
            .select('*')
            .eq('lead_id', leadId)
            .order('created_at', { ascending: true });
          if (!error && data) return data;
        } catch {
          // ignore and fallback
        }
      }
      return Array.from(this.buyerScoreRecordsStore.values()).filter((s) => s.lead_id === leadId);
    },

    getLatestBuyerScore: async (leadId: string) => {
      const client = getSupabaseClient();
      if (client) {
        const { data, error } = await client
          .from('buyer_scores')
          .select('*')
          .eq('lead_id', leadId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) {
          console.error('[Supabase Query Error] buyer_scores:', error);
          throw new Error(`Supabase query failed on buyer_scores: ${error.message}`);
        }
        if (data) return data;
      }

      const list = this.buyerScoresStore.get(leadId) || [];
      if (list.length === 0) return null;
      return list[list.length - 1];
    },

    getLatestBuyerScoreRecord: async (leadId: string) => {
      const client = getSupabaseClient();
      if (client) {
        try {
          const { data, error } = await client
            .from('buyer_scores')
            .select('*')
            .eq('lead_id', leadId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (!error && data) return data;
        } catch {
          // ignore and fallback
        }
      }
      const list = Array.from(this.buyerScoreRecordsStore.values())
        .filter((s) => s.lead_id === leadId)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      return list[0] || null;
    },

    listPriorityQueue: async (filter?: { tier?: string; limit?: number }) => {
      const scores = Array.from(this.buyerScoreRecordsStore.values());
      const queue: PriorityQueueItem[] = [];

      for (const score of scores) {
        if (filter?.tier && score.tier !== filter.tier) continue;

        const lead = await this.leads.getLead(score.lead_id);
        const qualification = score.qualification_id
          ? await this.qualifications.getQualification(score.qualification_id)
          : null;
        const profile = await this.buyerProfiles.getBuyerProfile(score.lead_id);

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

      // Sort by priority rank (1 is highest), composite_score DESC, sla_deadline ASC
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

  // --- Lead Events ---
  public readonly leadEvents: LeadEventsRepository = {
    appendLeadEvent: async (input) => {
      const client = getSupabaseClient();
      const now = new Date().toISOString();
      const id = input.id || this.generateUUID();
      const record: LeadEvent = {
        id,
        lead_id: input.lead_id,
        event_type: input.event_type,
        event_data: input.event_data ?? null,
        created_at: now,
      };

      if (client) {
        const { data, error } = await client.from('lead_events').insert(record).select().single();
        if (error) {
          console.error('[Supabase Insert Error] lead_events:', error);
          throw new Error(`Supabase insert failed on lead_events: ${error.message}`);
        }
        if (data) return data;
      }

      const list = this.leadEventsStore.get(record.lead_id) || [];
      list.push(record);
      this.leadEventsStore.set(record.lead_id, list);
      return record;
    },

    getLeadEvents: async (leadId: string) => {
      const client = getSupabaseClient();
      if (client) {
        const { data, error } = await client
          .from('lead_events')
          .select('*')
          .eq('lead_id', leadId)
          .order('created_at', { ascending: true });
        if (error) {
          console.error('[Supabase Query Error] lead_events:', error);
          throw new Error(`Supabase query failed on lead_events: ${error.message}`);
        }
        if (data) return data;
      }
      return this.leadEventsStore.get(leadId) || [];
    },
  };

  // --- Call Transcripts (Phase 5A) ---
  public readonly transcripts: CallTranscriptsRepository = {
    createTranscript: async (input) => {
      const client = getSupabaseClient();
      const now = new Date().toISOString();
      const id = input.id || this.generateUUID();
      const record: CallTranscript = {
        id,
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
            // If table doesn't exist yet on remote instance, fallback to local store
            if (error.code === 'PGRST205' || error.message?.includes('not find the table')) {
              console.warn('[Supabase Fallback] call_transcripts table not found on remote; using in-memory store.');
            } else {
              console.error('[Supabase Insert Error] call_transcripts:', error);
            }
          } else if (data) {
            this.transcriptsStore.set(data.id, data);
            return data;
          }
        } catch (err) {
          console.warn('[Supabase Insert Exception] call_transcripts fallback:', err);
        }
      }

      this.transcriptsStore.set(record.id, record);
      return record;
    },

    getTranscript: async (id: string) => {
      const client = getSupabaseClient();
      if (client) {
        try {
          const { data, error } = await client.from('call_transcripts').select('*').eq('id', id).maybeSingle();
          if (!error && data) return data;
        } catch {
          // ignore and fallback
        }
      }
      return this.transcriptsStore.get(id) || null;
    },

    getTranscriptByCallId: async (callId: string) => {
      const client = getSupabaseClient();
      if (client) {
        try {
          const { data, error } = await client
            .from('call_transcripts')
            .select('*')
            .eq('call_id', callId)
            .maybeSingle();
          if (!error && data) return data;
        } catch {
          // ignore and fallback
        }
      }
      return Array.from(this.transcriptsStore.values()).find((t) => t.call_id === callId) || null;
    },

    getTranscriptByProviderCallId: async (providerCallId: string) => {
      const client = getSupabaseClient();
      if (client) {
        try {
          const { data, error } = await client
            .from('call_transcripts')
            .select('*')
            .eq('provider_call_id', providerCallId)
            .order('created_at', { ascending: false })
            .limit(1);
          if (!error && data && data.length > 0) return data[0];
        } catch {
          // ignore and fallback
        }
      }
      return Array.from(this.transcriptsStore.values()).find((t) => t.provider_call_id === providerCallId) || null;
    },

    getTranscriptsByLeadId: async (leadId: string) => {
      const client = getSupabaseClient();
      if (client) {
        try {
          const { data, error } = await client
            .from('call_transcripts')
            .select('*')
            .eq('lead_id', leadId)
            .order('created_at', { ascending: true });
          if (!error && data) return data;
        } catch {
          // ignore and fallback
        }
      }
      return Array.from(this.transcriptsStore.values()).filter((t) => t.lead_id === leadId);
    },
  };

  public extractions: ConversationExtractionsRepository = {
    createExtraction: async (extraction) => {
      const now = new Date().toISOString();
      const record: ConversationExtraction = {
        id: extraction.id || this.generateUUID(),
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
          const { data: existing } = await client
            .from('conversation_extractions')
            .select('id')
            .eq('transcript_id', record.transcript_id)
            .eq('schema_version', record.schema_version)
            .eq('prompt_version', record.prompt_version)
            .maybeSingle();

          let query;
          if (existing) {
            query = client.from('conversation_extractions').update(record).eq('id', existing.id);
          } else {
            query = client.from('conversation_extractions').insert(record);
          }
          const { data, error } = await query.select().single();
          if (!error && data) {
            this.extractionsStore.set(data.id, data);
            return data;
          }
          if (error) {
            console.warn('[Supabase Insert Error] conversation_extractions fallback to in-memory:', error.message);
          }
        } catch (err) {
          console.warn('[Supabase Insert Exception] conversation_extractions fallback:', err);
        }
      }

      this.extractionsStore.set(record.id, record);
      return record;
    },

    getExtraction: async (id: string) => {
      const client = getSupabaseClient();
      if (client) {
        try {
          const { data, error } = await client.from('conversation_extractions').select('*').eq('id', id).maybeSingle();
          if (!error && data) return data;
        } catch {
          // ignore and fallback
        }
      }
      return this.extractionsStore.get(id) || null;
    },

    getExtractionByTranscriptId: async (transcriptId: string, schemaVersion?: string, promptVersion?: string) => {
      const client = getSupabaseClient();
      if (client) {
        try {
          let query = client.from('conversation_extractions').select('*').eq('transcript_id', transcriptId);
          if (schemaVersion) {
            query = query.eq('schema_version', schemaVersion);
          }
          if (promptVersion) {
            query = query.eq('prompt_version', promptVersion);
          }
          const { data, error } = await query.order('created_at', { ascending: false }).limit(1);
          if (!error && data && data.length > 0) return data[0];
        } catch {
          // ignore and fallback
        }
      }
      return (
        Array.from(this.extractionsStore.values())
          .filter((e) => {
            if (e.transcript_id !== transcriptId) return false;
            if (schemaVersion && e.schema_version !== schemaVersion) return false;
            if (promptVersion && e.prompt_version !== promptVersion) return false;
            return true;
          })
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] || null
      );
    },

    getExtractionByCallId: async (callId: string) => {
      const client = getSupabaseClient();
      if (client) {
        try {
          const { data, error } = await client
            .from('conversation_extractions')
            .select('*')
            .eq('call_id', callId)
            .order('created_at', { ascending: false })
            .limit(1);
          if (!error && data && data.length > 0) return data[0];
        } catch {
          // ignore and fallback
        }
      }
      return (
        Array.from(this.extractionsStore.values())
          .filter((e) => e.call_id === callId)
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] || null
      );
    },

    getExtractionsByLeadId: async (leadId: string) => {
      const client = getSupabaseClient();
      if (client) {
        try {
          const { data, error } = await client
            .from('conversation_extractions')
            .select('*')
            .eq('lead_id', leadId)
            .order('created_at', { ascending: true });
          if (!error && data) return data;
        } catch {
          // ignore and fallback
        }
      }
      return Array.from(this.extractionsStore.values()).filter((e) => e.lead_id === leadId);
    },
  };

  public qualifications: BuyerQualificationsRepository = {
    createQualification: async (qualification) => {
      const now = new Date().toISOString();
      const record: BuyerQualification = {
        id: qualification.id || this.generateUUID(),
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
          const { data: existing } = await client
            .from('buyer_qualifications')
            .select('id')
            .eq('extraction_id', record.extraction_id)
            .eq('rule_version', record.rule_version)
            .maybeSingle();

          let query;
          if (existing) {
            query = client.from('buyer_qualifications').update(record).eq('id', existing.id);
          } else {
            query = client.from('buyer_qualifications').insert(record);
          }
          const { data, error } = await query.select().single();
          if (!error && data) {
            this.qualificationsStore.set(data.id, data);
            return data;
          }
          if (error) {
            console.warn('[Supabase Insert Error] buyer_qualifications fallback to in-memory:', error.message);
          }
        } catch (err) {
          console.warn('[Supabase Insert Exception] buyer_qualifications fallback:', err);
        }
      }

      this.qualificationsStore.set(record.id, record);
      return record;
    },

    getQualification: async (id: string) => {
      const client = getSupabaseClient();
      if (client) {
        try {
          const { data, error } = await client.from('buyer_qualifications').select('*').eq('id', id).maybeSingle();
          if (!error && data) return data;
        } catch {
          // ignore and fallback
        }
      }
      return this.qualificationsStore.get(id) || null;
    },

    getQualificationByExtractionId: async (extractionId: string, ruleVersion?: string) => {
      const client = getSupabaseClient();
      if (client) {
        try {
          let query = client.from('buyer_qualifications').select('*').eq('extraction_id', extractionId);
          if (ruleVersion) {
            query = query.eq('rule_version', ruleVersion);
          }
          const { data, error } = await query.order('created_at', { ascending: false }).limit(1);
          if (!error && data && data.length > 0) return data[0];
        } catch {
          // ignore and fallback
        }
      }
      return (
        Array.from(this.qualificationsStore.values())
          .filter((q) => {
            if (q.extraction_id !== extractionId) return false;
            if (ruleVersion && q.rule_version !== ruleVersion) return false;
            return true;
          })
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] || null
      );
    },

    getQualificationsByLeadId: async (leadId: string) => {
      const client = getSupabaseClient();
      if (client) {
        try {
          const { data, error } = await client
            .from('buyer_qualifications')
            .select('*')
            .eq('lead_id', leadId)
            .order('created_at', { ascending: true });
          if (!error && data) return data;
        } catch {
          // ignore and fallback
        }
      }
      return Array.from(this.qualificationsStore.values()).filter((q) => q.lead_id === leadId);
    },
  };

  // --- Broker Handoffs (Phase 5F) ---
  public brokerHandoffs: BrokerHandoffRepository = {
    createHandoff: async (input) => {
      const now = new Date().toISOString();
      const id = input.id || this.generateUUID();
      const record: DbBrokerHandoff = {
        id,
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

      const client = getSupabaseClient();
      if (client) {
        try {
          const { data: existing } = await client
            .from('broker_handoffs')
            .select('id')
            .eq('score_id', record.score_id)
            .eq('rule_version', record.rule_version)
            .maybeSingle();

          let query;
          if (existing) {
            query = client.from('broker_handoffs').update(record).eq('id', existing.id);
          } else {
            query = client.from('broker_handoffs').insert(record);
          }
          const { data, error } = await query.select().single();
          if (!error && data) {
            this.brokerHandoffsStore.set(data.id, data);
            return data;
          }
        } catch {
          // fallback to in-memory store
        }
      }

      this.brokerHandoffsStore.set(record.id, record);
      return record;
    },

    getHandoff: async (id: string) => {
      const client = getSupabaseClient();
      if (client) {
        try {
          const { data, error } = await client.from('broker_handoffs').select('*').eq('id', id).maybeSingle();
          if (!error && data) return data;
        } catch {
          // fallback
        }
      }
      return this.brokerHandoffsStore.get(id) || null;
    },

    getHandoffsByLeadId: async (leadId: string) => {
      const client = getSupabaseClient();
      if (client) {
        try {
          const { data, error } = await client
            .from('broker_handoffs')
            .select('*')
            .eq('lead_id', leadId)
            .order('created_at', { ascending: false });
          if (!error && data) return data;
        } catch {
          // fallback
        }
      }
      return Array.from(this.brokerHandoffsStore.values())
        .filter((h) => h.lead_id === leadId)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    },

    getHandoffByScoreId: async (scoreId: string, ruleVersion?: string) => {
      const client = getSupabaseClient();
      if (client) {
        try {
          let query = client.from('broker_handoffs').select('*').eq('score_id', scoreId);
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
        Array.from(this.brokerHandoffsStore.values())
          .filter((h) => {
            if (h.score_id !== scoreId) return false;
            if (ruleVersion && h.rule_version !== ruleVersion) return false;
            return true;
          })
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] || null
      );
    },

    getLatestHandoff: async (leadId: string) => {
      const handoffs = await this.brokerHandoffs.getHandoffsByLeadId(leadId);
      return handoffs.length > 0 ? handoffs[0] : null;
    },

    updateStatus: async (id: string, handoffStatus: BrokerHandoffReadiness, routingStatus?: BrokerRoutingStatus) => {
      const existing = await this.brokerHandoffs.getHandoff(id);
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

      const client = getSupabaseClient();
      if (client) {
        try {
          const { data, error } = await client
            .from('broker_handoffs')
            .update(updatedRecord)
            .eq('id', id)
            .select()
            .single();
          if (!error && data) {
            this.brokerHandoffsStore.set(data.id, data);
            return data;
          }
        } catch {
          // fallback
        }
      }

      this.brokerHandoffsStore.set(id, updatedRecord);
      return updatedRecord;
    },

    updateDispatchStatus: async (id: string, dispatchStatus: BrokerDispatchStatus, dispatchId?: string, channel?: string) => {
      const existing = await this.brokerHandoffs.getHandoff(id);
      if (!existing) {
        throw new Error(`Broker handoff with id ${id} not found.`);
      }
      const now = new Date().toISOString();
      const updatedPayload = {
        ...existing.handoff_payload,
        dispatch_status: dispatchStatus,
        dispatch_id: dispatchId ?? existing.dispatch_id,
        dispatch_channel: channel ?? existing.dispatch_channel,
        updated_at: now,
      };

      const updatedRecord: DbBrokerHandoff = {
        ...existing,
        dispatch_status: dispatchStatus,
        dispatch_id: dispatchId ?? existing.dispatch_id,
        dispatch_channel: channel ?? existing.dispatch_channel,
        handoff_payload: updatedPayload,
        updated_at: now,
      };

      const client = getSupabaseClient();
      if (client) {
        try {
          const { data, error } = await client
            .from('broker_handoffs')
            .update(updatedRecord)
            .eq('id', id)
            .select()
            .single();
          if (!error && data) {
            this.brokerHandoffsStore.set(data.id, data);
            return data;
          }
        } catch {
          // fallback
        }
      }

      this.brokerHandoffsStore.set(id, updatedRecord);
      return updatedRecord;
    },

    listHandoffQueue: async (filter) => {
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

      let handoffs = Array.from(this.brokerHandoffsStore.values());

      if (filter?.tier) {
        handoffs = handoffs.filter((h) => h.priority_tier === filter.tier);
      }
      if (filter?.status) {
        handoffs = handoffs.filter((h) => h.handoff_status === filter.status);
      }

      const queueItems: HandoffQueueItem[] = [];

      for (const h of handoffs) {
        const payload = h.handoff_payload;
        const lead = await this.leads.getLead(h.lead_id);
        const topProj = payload?.project_recommendations?.[0];
        const primaryReq = payload?.requirements?.[0];
        const reqStr = primaryReq
          ? `${primaryReq.property_type || 'Residential'} ${primaryReq.configuration || ''} in ${(primaryReq.preferred_locations || []).join(', ')}`.trim()
          : 'Property requirement';

        const deadline = new Date(h.sla_deadline).getTime();
        const nowMs = Date.now();
        const minsRemaining = Math.round((deadline - nowMs) / 60000);

        queueItems.push({
          handoff_id: h.id,
          lead_id: h.lead_id,
          external_lead_id: lead?.lead_id || payload?.external_lead_id || 'GF-UNK',
          buyer_name: lead?.name || payload?.primary_buyer_summary?.name || 'Unknown Buyer',
          phone: lead?.phone || payload?.primary_buyer_summary?.phone || '',
          score: payload?.priority?.score ?? 0,
          tier: h.priority_tier,
          sla_deadline: h.sla_deadline,
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

      // Sort: Tier Priority ASC, SLA Deadline ASC, Score DESC, Created ASC
      queueItems.sort((a, b) => {
        const rankA = tierRank(a.tier);
        const rankB = tierRank(b.tier);
        if (rankA !== rankB) return rankA - rankB;
        const deadlineA = new Date(a.sla_deadline).getTime();
        const deadlineB = new Date(b.sla_deadline).getTime();
        if (deadlineA !== deadlineB) return deadlineA - deadlineB;
        if (b.score !== a.score) return b.score - a.score;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });

      if (filter?.limit) {
        return queueItems.slice(0, filter.limit);
      }

      return queueItems;
    },
  };

  // --- Persistence Verification & Round-Trip Diagnostic (Section 12) ---
  public async verifyPersistenceRoundTrip(customLeadId?: string): Promise<{
    success: boolean;
    isLiveSupabase: boolean;
    leadId: string;
    insertedId: string;
    readBackMatched: boolean;
    auditEventLogged: boolean;
    deletedSuccessfully: boolean;
    error?: string;
  }> {
    const testLeadId = customLeadId || `GF-DIAG-${Date.now()}`;
    const client = getSupabaseClient();
    const isLiveSupabase = client !== null;

    try {
      // 1. Insert test lead
      const inserted = await this.leads.createLead({
        lead_id: testLeadId,
        name: 'Diagnostic Test Lead',
        phone: '+919999988888',
        email: 'diagnostic.test@growthforge.ai',
        source: 'DIAGNOSTIC_VERIFICATION',
        source_reference: null,
        status: 'RAW',
      });

      // 2. Read back lead by lead_id
      const readBack = await this.leads.getLeadByLeadId(testLeadId);
      if (!readBack || readBack.id !== inserted.id) {
        throw new Error(`Read-back verification failed: lead ${testLeadId} not found after creation.`);
      }

      // 3. Append test audit event
      const event = await this.leadEvents.appendLeadEvent({
        lead_id: inserted.id,
        event_type: 'PERSISTENCE_DIAGNOSTIC_TEST',
        event_data: { test_run_at: new Date().toISOString() },
      });

      const events = await this.leadEvents.getLeadEvents(inserted.id);
      const auditEventLogged = events.some((e) => e.id === event.id);

      // 4. Delete test lead to keep database clean
      const deletedSuccessfully = await this.leads.deleteLead(inserted.id);
      const postDeleteCheck = await this.leads.getLead(inserted.id);
      if (postDeleteCheck !== null) {
        throw new Error(`Delete verification failed: lead ${inserted.id} still exists after deletion.`);
      }

      return {
        success: true,
        isLiveSupabase,
        leadId: testLeadId,
        insertedId: inserted.id,
        readBackMatched: true,
        auditEventLogged,
        deletedSuccessfully: true,
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown persistence round-trip error';
      return {
        success: false,
        isLiveSupabase,
        leadId: testLeadId,
        insertedId: '',
        readBackMatched: false,
        auditEventLogged: false,
        deletedSuccessfully: false,
        error: errorMsg,
      };
    }
  }

  // --- Canonical GF Buyer Lead Mapper (Section 8) ---
  public async mapToGFBuyerLead(leadIdOrLeadUUID: string): Promise<GFBuyerLead | null> {
    // Look up lead by either internal UUID or external lead_id
    let lead = await this.leads.getLead(leadIdOrLeadUUID);
    if (!lead) {
      lead = await this.leads.getLeadByLeadId(leadIdOrLeadUUID);
    }
    if (!lead) return null;

    const [enrichments, profile, prefs, matches, score, events, extractionsList] = await Promise.all([
      this.leadEnrichment.getEnrichment(lead.id),
      this.buyerProfiles.getBuyerProfile(lead.id),
      this.buyerPreferences.getBuyerPreferences(lead.id),
      this.projectMatches.getProjectMatches(lead.id),
      this.buyerScores.getLatestBuyerScore(lead.id),
      this.leadEvents.getLeadEvents(lead.id),
      this.extractions.getExtractionsByLeadId(lead.id),
    ]);

    const latestEnrichment = enrichments.length > 0 ? enrichments[enrichments.length - 1] : null;
    const latestEvent = events.length > 0 ? events[events.length - 1] : null;
    const latestExtraction = extractionsList.length > 0 ? extractionsList[extractionsList.length - 1] : null;
    const extData = latestExtraction?.extracted_data as any;

    // Map top matches
    const domainMatches: DomainProjectMatch[] = [];
    for (const m of matches) {
      const proj = await this.projects.getProject(m.project_id);
      domainMatches.push({
        id: m.id,
        project_id: m.project_id,
        project_name: proj?.project_name ?? 'Unknown Project',
        developer_name: proj?.developer_name ?? '',
        city: proj?.city ?? '',
        locality: proj?.locality ?? '',
        match_score: m.match_score ?? 0,
        budget_score: m.budget_score ?? 0,
        location_score: m.location_score ?? 0,
        configuration_score: m.configuration_score ?? 0,
        reason: {
          summary: typeof m.reason?.summary === 'string' ? m.reason.summary : 'Algorithmic affinity match',
          dimension_scores: {
            budget: m.budget_score ?? 0,
            location: m.location_score ?? 0,
            configuration: m.configuration_score ?? 0,
            property_type: m.purpose_score ?? 0,
            purpose: m.purpose_score ?? 0,
            timeline: m.timeline_score ?? 0,
            preferences: m.preference_score ?? 0,
            project_attributes: m.match_score ?? 0,
          },
          highlights: Array.isArray(m.reason?.highlights) ? (m.reason.highlights as string[]) : [],
          caveats: Array.isArray(m.reason?.caveats) ? (m.reason.caveats as string[]) : undefined,
        },
        buyer_confirmed: m.buyer_confirmed,
        created_at: m.created_at,
      });
    }

    const preferredLocations =
      extData?.preferred_locations?.value && Array.isArray(extData.preferred_locations.value) && extData.preferred_locations.value.length > 0
        ? extData.preferred_locations.value
        : Array.isArray(profile?.preferred_locations)
        ? (profile.preferred_locations as string[])
        : [];

    const requirements =
      extData?.requirements && Array.isArray(extData.requirements) && extData.requirements.length > 0
        ? extData.requirements.map((r: any) => `${r.property_type || ''} ${r.configuration || ''}`.trim())
        : Array.isArray(profile?.requirements)
        ? (profile.requirements as string[])
        : [];

    const preferencesList = prefs.map((p) => `${p.attribute}: ${JSON.stringify(p.value)}`);

    const gfLead: GFBuyerLead = {
      lead_id: lead.lead_id,
      identity: {
        full_name: lead.name ?? latestEnrichment?.full_name ?? '',
        phone: lead.phone ?? '',
        email: lead.email ?? '',
        location: latestEnrichment?.location ?? '',
        residence: latestEnrichment?.location ?? '',
        profession: latestEnrichment?.bio ?? '',
        company: latestEnrichment?.company ?? '',
      },
      buying_intent: {
        interested: extData?.interested?.value ?? profile?.property_interest ?? true,
        property_type: extData?.primary_property_type?.value ?? profile?.property_type ?? 'Apartment',
        configuration: extData?.primary_configuration?.value ?? profile?.configuration ?? '',
        purpose: extData?.purpose?.value ?? profile?.purpose ?? 'Self-use',
        budget: {
          min: extData?.budget?.min ?? profile?.budget_min ?? null,
          max: extData?.budget?.max ?? profile?.budget_max ?? null,
          currency: extData?.budget?.currency ?? profile?.currency ?? 'INR',
          qualitative_budget: extData?.budget?.raw_expression ?? undefined,
        },
        preferred_locations: preferredLocations,
        timeline: extData?.timeline?.value ?? profile?.timeline ?? '',
        financing: extData?.financing?.value ?? profile?.financing ?? '',
        decision_maker: extData?.decision_maker?.value ?? profile?.decision_maker ?? null,
        requirements: requirements,
        preferences: preferencesList,
      },
      project_intelligence: {
        top_matches: domainMatches,
        preferred_project: {
          project_id: domainMatches[0]?.project_id ?? null,
          project_name: domainMatches[0]?.project_name ?? null,
          confidence: (domainMatches[0]?.match_score ?? 0) / 100,
          selection_basis: domainMatches[0]?.reason.summary ?? 'None',
        },
      },
      lead_intelligence: {
        source: lead.source ?? 'CSV_IMPORT',
        intent_score: score?.intent_score ?? profile?.intent_score ?? 0,
        qualification: score?.qualification ?? profile?.qualification_status ?? 'RAW',
        confidence: score?.overall_score ? score.overall_score / 100 : 0.5,
        recommended_action:
          lead.status === 'RAW'
            ? 'Proceed with public enrichment and contact validation'
            : lead.status === 'QUALIFIED'
            ? 'Hand off to project sales advisor'
            : 'Review lead dossier',
      },
      provenance: {
        consent_status: 'CONFIRMED',
        consent_source: lead.source ?? 'CSV_IMPORT',
        consent_timestamp: lead.created_at,
        fields: {
          phone: { truth: 'KNOWN', truth_level: 'KNOWN', source: lead.source ?? 'CSV_IMPORT', confidence: 1.0, updated_at: lead.created_at },
          email: { truth: 'KNOWN', truth_level: 'KNOWN', source: lead.source ?? 'CSV_IMPORT', confidence: 1.0, updated_at: lead.created_at },
          full_name: { truth: 'KNOWN', truth_level: 'KNOWN', source: lead.source ?? 'CSV_IMPORT', confidence: 1.0, updated_at: lead.created_at },
          ...(latestEnrichment
            ? {
                company: { truth: 'INFERRED', truth_level: 'INFERRED', source: 'scout', confidence: latestEnrichment.source_confidence || 0.85, updated_at: latestEnrichment.created_at },
                location: { truth: 'INFERRED', truth_level: 'INFERRED', source: 'scout', confidence: latestEnrichment.source_confidence || 0.85, updated_at: latestEnrichment.created_at },
                profession: { truth: 'INFERRED', truth_level: 'INFERRED', source: 'scout', confidence: latestEnrichment.source_confidence || 0.85, updated_at: latestEnrichment.created_at },
              }
            : {}),
        },
      },
      workflow: {
        status: (lead.status as WorkflowStatus) || 'RAW',
        last_event: latestEvent ? `${latestEvent.event_type}` : 'LEAD_CREATED',
        updated_at: lead.updated_at,
      },
    };

    return gfLead;
  }
}

// Global Singleton Repository Provider
export const supabaseDataService = new SupabaseDataService();
