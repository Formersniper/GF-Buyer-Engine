/**
 * GrowthForge Lead Repository Implementation
 * 
 * Interacts with Supabase as the system of record.
 * Includes initial seed state fallback for preview environments.
 */

import { getSupabaseClient, isSupabaseConfigured } from '../client';
import { ILeadRepository } from './interfaces';
import { LeadRow } from './types';
import { GFBuyerLead } from '../../../types/buyerLead';
import { INITIAL_SEEDED_LEADS } from '../../data/seedData';

class LeadRepository implements ILeadRepository {
  private inMemoryCanonicalLeads: Map<string, GFBuyerLead> = new Map();

  constructor() {
    // Seed initial leads in memory
    INITIAL_SEEDED_LEADS.forEach((lead) => {
      this.inMemoryCanonicalLeads.set(lead.lead_id, { ...lead });
    });
  }

  async findById(id: string): Promise<LeadRow | null> {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .eq('id', id)
        .single();
      if (error || !data) return null;
      return data as LeadRow;
    }

    // Fallback search
    for (const lead of this.inMemoryCanonicalLeads.values()) {
      if (lead.lead_id === id) {
        return {
          id: lead.lead_id,
          lead_id: lead.lead_id,
          name: lead.identity.full_name,
          phone: lead.identity.phone,
          email: lead.identity.email,
          source: lead.lead_intelligence.source,
          source_reference: null,
          status: lead.workflow.status,
          created_at: lead.provenance.consent_timestamp || new Date().toISOString(),
          updated_at: lead.workflow.updated_at || new Date().toISOString(),
        };
      }
    }
    return null;
  }

  async findByLeadId(leadId: string): Promise<LeadRow | null> {
    return this.findById(leadId);
  }

  async getAll(): Promise<LeadRow[]> {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .order('created_at', { ascending: false });
      if (!error && data) return data as LeadRow[];
    }

    return Array.from(this.inMemoryCanonicalLeads.values()).map((lead) => ({
      id: lead.lead_id,
      lead_id: lead.lead_id,
      name: lead.identity.full_name,
      phone: lead.identity.phone,
      email: lead.identity.email,
      source: lead.lead_intelligence.source,
      source_reference: null,
      status: lead.workflow.status,
      created_at: lead.provenance.consent_timestamp || new Date().toISOString(),
      updated_at: lead.workflow.updated_at || new Date().toISOString(),
    }));
  }

  async create(lead: Omit<LeadRow, 'id' | 'created_at' | 'updated_at'>): Promise<LeadRow> {
    const now = new Date().toISOString();
    const newRow: LeadRow = {
      ...lead,
      id: lead.lead_id,
      created_at: now,
      updated_at: now,
    };

    const supabase = getSupabaseClient();
    if (supabase) {
      await supabase.from('leads').insert(newRow);
    }

    return newRow;
  }

  async updateStatus(id: string, status: string): Promise<LeadRow> {
    const now = new Date().toISOString();
    const existing = await this.findById(id);
    const updated: LeadRow = {
      ...(existing || {
        id,
        lead_id: id,
        name: '',
        phone: '',
        email: '',
        source: 'manual',
        source_reference: null,
        created_at: now,
      }),
      status,
      updated_at: now,
    };

    const supabase = getSupabaseClient();
    if (supabase) {
      await supabase.from('leads').update({ status, updated_at: now }).eq('id', id);
    }

    const canonical = this.inMemoryCanonicalLeads.get(id);
    if (canonical) {
      canonical.workflow.status = status;
      canonical.workflow.updated_at = now;
      this.inMemoryCanonicalLeads.set(id, canonical);
    }

    return updated;
  }

  async getCanonicalLead(leadId: string): Promise<GFBuyerLead | null> {
    return this.inMemoryCanonicalLeads.get(leadId) || null;
  }

  async getAllCanonicalLeads(): Promise<GFBuyerLead[]> {
    return Array.from(this.inMemoryCanonicalLeads.values());
  }

  async saveCanonicalLead(lead: GFBuyerLead): Promise<void> {
    this.inMemoryCanonicalLeads.set(lead.lead_id, { ...lead });

    const supabase = getSupabaseClient();
    if (supabase) {
      await supabase.from('leads').upsert({
        lead_id: lead.lead_id,
        name: lead.identity.full_name,
        phone: lead.identity.phone,
        email: lead.identity.email,
        source: lead.lead_intelligence.source,
        status: lead.workflow.status,
        updated_at: lead.workflow.updated_at || new Date().toISOString(),
      });
    }
  }
}

export const leadRepository = new LeadRepository();
