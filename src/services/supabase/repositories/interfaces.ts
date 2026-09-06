/**
 * GrowthForge Repository Interfaces
 * 
 * Clean separation of database persistence from UI and Business Logic.
 * In Phase 1, repository interfaces define standard CRUD and query contracts.
 */

import {
  LeadRow,
  LeadEnrichmentRow,
  CallRow,
  BuyerProfileRow,
  ProjectRow,
  ProjectMatchRow,
  BuyerScoreRow,
  LeadEventRow
} from './types';
import { GFBuyerLead, Project, ProjectMatch } from '../../../types/buyerLead';

export interface ILeadRepository {
  findById(id: string): Promise<LeadRow | null>;
  findByLeadId(leadId: string): Promise<LeadRow | null>;
  getAll(): Promise<LeadRow[]>;
  create(lead: Omit<LeadRow, 'id' | 'created_at' | 'updated_at'>): Promise<LeadRow>;
  updateStatus(id: string, status: string): Promise<LeadRow>;
  getCanonicalLead(leadId: string): Promise<GFBuyerLead | null>;
  getAllCanonicalLeads(): Promise<GFBuyerLead[]>;
  saveCanonicalLead(lead: GFBuyerLead): Promise<void>;
}

export interface ILeadEnrichmentRepository {
  getByLeadId(leadId: string): Promise<LeadEnrichmentRow[]>;
  create(enrichment: Omit<LeadEnrichmentRow, 'id' | 'created_at'>): Promise<LeadEnrichmentRow>;
}

export interface IBuyerProfileRepository {
  getByLeadId(leadId: string): Promise<BuyerProfileRow | null>;
  upsert(profile: Omit<BuyerProfileRow, 'id' | 'created_at' | 'updated_at'>): Promise<BuyerProfileRow>;
}

export interface ICallRepository {
  getByLeadId(leadId: string): Promise<CallRow[]>;
  create(call: Omit<CallRow, 'id' | 'created_at'>): Promise<CallRow>;
  updateOutcome(id: string, outcome: string, transcript: string, duration: number): Promise<CallRow>;
}

export interface IProjectRepository {
  getAll(): Promise<Project[]>;
  getById(id: string): Promise<Project | null>;
  getByCode(code: string): Promise<Project | null>;
  create(project: Omit<Project, 'id' | 'created_at' | 'updated_at'>): Promise<Project>;
}

export interface IProjectMatchRepository {
  getByLeadId(leadId: string): Promise<ProjectMatch[]>;
  createMatches(matches: Omit<ProjectMatchRow, 'id' | 'created_at'>[]): Promise<ProjectMatchRow[]>;
}

export interface IBuyerScoreRepository {
  getByLeadId(leadId: string): Promise<BuyerScoreRow | null>;
  saveScore(score: Omit<BuyerScoreRow, 'id' | 'created_at'>): Promise<BuyerScoreRow>;
}

export interface ILeadEventRepository {
  getByLeadId(leadId: string): Promise<LeadEventRow[]>;
  logEvent(leadId: string, eventType: string, eventData: Record<string, unknown>): Promise<LeadEventRow>;
}
