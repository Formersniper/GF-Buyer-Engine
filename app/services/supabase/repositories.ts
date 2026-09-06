/**
 * GrowthForge Buyer Intelligence Engine - Supabase Repository Interfaces
 *
 * SUPABASE AS SYSTEM OF RECORD:
 * Defines authoritative repository interfaces for:
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
 * Invariant: UI components MUST NOT embed direct SQL / DB calls;
 * all interactions must be channeled through these repository contracts.
 */

import { GFBuyerLead, Project, ProjectMatch, RawLeadInput } from '../../schemas/buyerLead';
import { WorkflowStatus } from '../../schemas/workflow';

// 1. Leads Repository
export interface LeadsRepository {
  createLead(input: RawLeadInput): Promise<GFBuyerLead>;
  getLeadById(leadId: string): Promise<GFBuyerLead | null>;
  listLeads(filter?: { status?: WorkflowStatus; limit?: number; offset?: number }): Promise<GFBuyerLead[]>;
  updateWorkflowStatus(leadId: string, status: WorkflowStatus, eventSummary: string): Promise<GFBuyerLead>;
  updateLeadIdentity(leadId: string, identity: Partial<GFBuyerLead['identity']>): Promise<GFBuyerLead>;
  deleteLead(leadId: string): Promise<boolean>;
}

// 2. Lead Enrichment Repository
export interface LeadEnrichmentRecord {
  id: string;
  lead_id: string;
  provider: 'scout' | 'manual' | 'other';
  status: 'pending' | 'success' | 'failed';
  scout_payload: Record<string, unknown>;
  enriched_fields: Record<string, unknown>;
  confidence_score: number;
  created_at: string;
}

export interface LeadEnrichmentRepository {
  recordEnrichment(record: Omit<LeadEnrichmentRecord, 'id' | 'created_at'>): Promise<LeadEnrichmentRecord>;
  getEnrichmentByLeadId(leadId: string): Promise<LeadEnrichmentRecord | null>;
}

// 3. Calls Repository
export interface CallRecord {
  id: string;
  lead_id: string;
  call_provider: string;
  external_call_id: string;
  status: string;
  duration_seconds: number;
  recording_url?: string | null;
  transcript_text?: string | null;
  transcript_json?: Record<string, unknown> | null;
  initiated_at: string;
  completed_at?: string | null;
}

export interface CallsRepository {
  createCall(record: Omit<CallRecord, 'id' | 'completed_at'>): Promise<CallRecord>;
  getCallById(callId: string): Promise<CallRecord | null>;
  getCallsByLeadId(leadId: string): Promise<CallRecord[]>;
  updateCallStatus(callId: string, status: string, durationSeconds?: number, completedAt?: string): Promise<CallRecord>;
  attachTranscript(callId: string, transcriptText: string, transcriptJson?: Record<string, unknown>): Promise<CallRecord>;
}

// 4. Buyer Profiles Repository
export interface BuyerProfileRecord {
  id: string;
  lead_id: string;
  interested: boolean;
  property_type: string;
  configuration: string;
  purpose: string;
  budget_min: number | null;
  budget_max: number | null;
  currency: string;
  timeline: string;
  financing: string;
  decision_maker: boolean | null;
  qualification_level: string;
  intent_score: number;
  created_at: string;
  updated_at: string;
}

export interface BuyerProfilesRepository {
  upsertBuyerProfile(profile: Omit<BuyerProfileRecord, 'id' | 'created_at' | 'updated_at'>): Promise<BuyerProfileRecord>;
  getBuyerProfileByLeadId(leadId: string): Promise<BuyerProfileRecord | null>;
}

// 5. Buyer Preferences Repository
export interface BuyerPreferencesRecord {
  id: string;
  lead_id: string;
  preferred_locations: string[];
  requirements: string[];
  preferences: string[];
  preferred_project_id?: string | null;
  preferred_project_basis?: string | null;
  updated_at: string;
}

export interface BuyerPreferencesRepository {
  upsertPreferences(prefs: Omit<BuyerPreferencesRecord, 'id' | 'updated_at'>): Promise<BuyerPreferencesRecord>;
  getPreferencesByLeadId(leadId: string): Promise<BuyerPreferencesRecord | null>;
}

// 6. Projects Repository
export interface ProjectsRepository {
  listProjects(filters?: { city?: string; status?: string }): Promise<Project[]>;
  getProjectById(projectId: string): Promise<Project | null>;
  createProject(project: Omit<Project, 'id' | 'created_at' | 'updated_at'>): Promise<Project>;
  updateProject(projectId: string, updates: Partial<Project>): Promise<Project>;
}

// 7. Project Matches Repository
export interface ProjectMatchRecord {
  id: string;
  lead_id: string;
  project_id: string;
  match_score: number;
  budget_score: number;
  location_score: number;
  configuration_score: number;
  reason_summary: string;
  dimension_scores: Record<string, number>;
  buyer_confirmed: boolean;
  matched_at: string;
}

export interface ProjectMatchesRepository {
  saveMatches(leadId: string, matches: ProjectMatch[]): Promise<ProjectMatchRecord[]>;
  getMatchesByLeadId(leadId: string): Promise<ProjectMatchRecord[]>;
  confirmMatchByBuyer(matchId: string, confirmed: boolean): Promise<ProjectMatchRecord>;
}

// 8. Buyer Scores Repository
export interface BuyerScoreRecord {
  id: string;
  lead_id: string;
  intent_score: number;
  confidence: number;
  score_band: string; // 'HOT' | 'WARM' | 'NURTURE'
  dimension_breakdown: Record<string, unknown>;
  computed_at: string;
}

export interface BuyerScoresRepository {
  recordScore(score: Omit<BuyerScoreRecord, 'id' | 'computed_at'>): Promise<BuyerScoreRecord>;
  getLatestScoreByLeadId(leadId: string): Promise<BuyerScoreRecord | null>;
}

// 9. Lead Events Repository (Immutable Audit Log)
export interface LeadEventRecord {
  id: string;
  lead_id: string;
  event_name: string;
  from_status?: string | null;
  to_status?: string | null;
  actor: string; // 'system' | 'scout_adapter' | 'voice_provider' | 'gemini_agent' | 'user'
  payload?: Record<string, unknown>;
  occurred_at: string;
}

export interface LeadEventsRepository {
  logEvent(event: Omit<LeadEventRecord, 'id' | 'occurred_at'>): Promise<LeadEventRecord>;
  getEventsByLeadId(leadId: string): Promise<LeadEventRecord[]>;
}

// Master Aggregated Supabase Unit of Work
export interface SupabaseDataRepositories {
  leads: LeadsRepository;
  leadEnrichment: LeadEnrichmentRepository;
  calls: CallsRepository;
  buyerProfiles: BuyerProfilesRepository;
  buyerPreferences: BuyerPreferencesRepository;
  projects: ProjectsRepository;
  projectMatches: ProjectMatchesRepository;
  buyerScores: BuyerScoresRepository;
  leadEvents: LeadEventsRepository;
}
