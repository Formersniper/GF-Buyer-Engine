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
} from '../../schemas/database';
import { GFBuyerLead, ProjectMatch as DomainProjectMatch } from '../../schemas/buyerLead';
import { WorkflowStatus } from '../../schemas/workflow';
import { getSupabaseClient } from './client';

// ==========================================
// 1. REPOSITORY CONTRACTS (Section 10)
// ==========================================

export interface LeadsRepository {
  createLead(lead: Omit<Lead, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Promise<Lead>;
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
  createCall(call: Omit<Call, 'id' | 'created_at'> & { id?: string }): Promise<Call>;
  getCall(id: string): Promise<Call | null>;
  getCallByProviderCallId(providerCallId: string): Promise<Call | null>;
  getCallsByLead(leadId: string): Promise<Call[]>;
  updateCall(id: string, updates: Partial<Omit<Call, 'id' | 'lead_id' | 'created_at'>>): Promise<Call>;
}

export interface BuyerProfilesRepository {
  upsertBuyerProfile(profile: Omit<BuyerProfile, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Promise<BuyerProfile>;
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
  getLatestBuyerScore(leadId: string): Promise<BuyerScore | null>;
}

export interface LeadEventsRepository {
  appendLeadEvent(event: Omit<LeadEvent, 'id' | 'created_at'> & { id?: string }): Promise<LeadEvent>;
  getLeadEvents(leadId: string): Promise<LeadEvent[]>;
}

// ==========================================
// 2. IN-MEMORY & CLIENT BACKED STORE
// ==========================================

class SupabaseDataService {
  private leadsStore: Map<string, Lead> = new Map();
  private enrichmentStore: Map<string, LeadEnrichment[]> = new Map();
  private callsStore: Map<string, Call> = new Map();
  private buyerProfilesStore: Map<string, BuyerProfile> = new Map();
  private buyerPreferencesStore: Map<string, BuyerPreference[]> = new Map();
  private projectsStore: Map<string, DbProject> = new Map();
  private projectMatchesStore: Map<string, DbProjectMatch[]> = new Map();
  private buyerScoresStore: Map<string, BuyerScore[]> = new Map();
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
    const sampleProjects: Array<Omit<DbProject, 'id' | 'created_at' | 'updated_at'>> = [
      {
        project_code: 'DEMO_PROJECT_001',
        project_name: 'Prestige Falcon City Phase 2',
        developer_name: 'Prestige Group',
        city: 'Bengaluru',
        locality: 'Kanakapura Road',
        micro_market: 'South Bengaluru',
        property_type: 'Apartment',
        configurations: ['2 BHK', '3 BHK', '4 BHK'],
        price_min: 11500000,
        price_max: 24500000,
        possession: 'Dec 2026',
        project_description: 'High-rise luxury residential development located right next to the Forum Mall and metro connectivity.',
        features: ['Metro Adjacent', 'Forum Mall Access', 'Large Open Landscaping', 'EV Charging'],
        amenities: ['Clubhouse', 'Infinity Pool', 'Badminton Court', 'Squash Court', 'Jogging Track'],
        project_url: 'https://example.com/projects/prestige-falcon-city',
        status: 'ACTIVE',
      },
      {
        project_code: 'DEMO_PROJECT_002',
        project_name: 'Godrej Woodsman Serenity',
        developer_name: 'Godrej Properties',
        city: 'Bengaluru',
        locality: 'Hebbal',
        micro_market: 'North Bengaluru',
        property_type: 'Apartment',
        configurations: ['3 BHK', '4 BHK'],
        price_min: 18500000,
        price_max: 38000000,
        possession: 'Ready to Move',
        project_description: 'Forest-themed premium luxury apartments on Bellary Road with express airport connectivity.',
        features: ['Airport Corridor', 'Forest Theme', 'Private Decks', 'Low Density'],
        amenities: ['Heated Pool', 'Private Theatre', 'Spa & Sauna', 'Tennis Court', 'Concierge'],
        project_url: 'https://example.com/projects/godrej-woodsman',
        status: 'ACTIVE',
      },
      {
        project_code: 'DEMO_PROJECT_003',
        project_name: 'Sobha Neopolis',
        developer_name: 'Sobha Limited',
        city: 'Bengaluru',
        locality: 'Panathur',
        micro_market: 'East Bengaluru / ORR',
        property_type: 'Apartment',
        configurations: ['1 BHK', '2 BHK', '3 BHK', '4 BHK'],
        price_min: 9500000,
        price_max: 29000000,
        possession: 'Mid 2027',
        project_description: 'Greek architecture-inspired luxury township near Outer Ring Road tech corridor.',
        features: ['Greek Themed', 'Near Tech Parks', 'Precast German Construction', 'Multi-tier Security'],
        amenities: ['Grand Amphitheatre', '4 Swimming Pools', 'Co-working Lounge', 'Indoor Sports Arena'],
        project_url: 'https://example.com/projects/sobha-neopolis',
        status: 'ACTIVE',
      },
      {
        project_code: 'DEMO_PROJECT_005',
        project_name: 'DLF The Arbour',
        developer_name: 'DLF Limited',
        city: 'Gurgaon',
        locality: 'Sector 63',
        micro_market: 'Golf Course Extension',
        property_type: 'Luxury High-Rise',
        configurations: ['4 BHK'],
        price_min: 75000000,
        price_max: 110000000,
        possession: 'Mar 2028',
        project_description: 'Ultra-luxury low-density residential towers on Golf Course Extension Road.',
        features: ['Golf Course Extension', 'Double Height Lobbies', 'Wrap-around Balconies', 'Air Purification'],
        amenities: ['Private Dining', 'Temperature Controlled Pool', 'Cigar Lounge', 'Helipad Access'],
        project_url: 'https://example.com/projects/dlf-arbour',
        status: 'ACTIVE',
      },
      {
        project_code: 'DEMO_PROJECT_007',
        project_name: 'Lodha World One Reserve',
        developer_name: 'Lodha Group',
        city: 'Mumbai',
        locality: 'Lower Parel',
        micro_market: 'South Central Mumbai',
        property_type: 'Ultra Luxury High-Rise',
        configurations: ['3 BHK', '4 BHK', '5 BHK'],
        price_min: 95000000,
        price_max: 220000000,
        possession: 'Ready to Move',
        project_description: 'Iconic global architectural landmark with panoramic views of the Arabian Sea and city skyline.',
        features: ['Arabian Sea Views', 'Armani/Casa Interiors', 'Private Elevators', 'Tri-level Sky Villas'],
        amenities: ['Private Observatory', 'World-class Spa', 'Lap Pool', 'Private Butler Service'],
        project_url: 'https://example.com/projects/lodha-world-one',
        status: 'ACTIVE',
      },
    ];

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
        const { data, error } = await client.from('calls').select('*').eq('provider_call_id', providerCallId).maybeSingle();
        if (error) {
          console.error('[Supabase Query Error] calls:', error);
          throw new Error(`Supabase query failed on calls: ${error.message}`);
        }
        if (data) return data;
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

    const [enrichments, profile, prefs, matches, score, events] = await Promise.all([
      this.leadEnrichment.getEnrichment(lead.id),
      this.buyerProfiles.getBuyerProfile(lead.id),
      this.buyerPreferences.getBuyerPreferences(lead.id),
      this.projectMatches.getProjectMatches(lead.id),
      this.buyerScores.getLatestBuyerScore(lead.id),
      this.leadEvents.getLeadEvents(lead.id),
    ]);

    const latestEnrichment = enrichments.length > 0 ? enrichments[enrichments.length - 1] : null;
    const latestEvent = events.length > 0 ? events[events.length - 1] : null;

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

    const preferredLocations = Array.isArray(profile?.preferred_locations)
      ? (profile.preferred_locations as string[])
      : [];
    const requirements = Array.isArray(profile?.requirements)
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
        interested: profile?.property_interest ?? true,
        property_type: profile?.property_type ?? 'Apartment',
        configuration: profile?.configuration ?? '',
        purpose: profile?.purpose ?? 'Self-use',
        budget: {
          min: profile?.budget_min ?? null,
          max: profile?.budget_max ?? null,
          currency: profile?.currency ?? 'INR',
        },
        preferred_locations: preferredLocations,
        timeline: profile?.timeline ?? '',
        financing: profile?.financing ?? '',
        decision_maker: profile?.decision_maker ?? null,
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
