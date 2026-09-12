/**
 * GrowthForge Buyer Intelligence Engine - Authoritative Supabase Repositories
 *
 * SUPABASE AS SYSTEM OF RECORD & TENANT-AWARE APPLICATION DATA ACCESS LAYER:
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
 * 10. call_transcripts
 * 11. conversation_extractions
 * 12. buyer_qualifications
 * 13. broker_handoffs
 * 14. tenants
 * 15. tenant_memberships
 * 16. tenant_api_keys
 * 17. webhook_events
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
import {
  Tenant,
  TenantMembership,
  TenantApiKey,
  WebhookEvent,
  TenantScope,
  TenantContext,
  ResolvedTenantScope,
  resolveEffectiveTenantScope,
  TenantRequiredError,
  TenantMismatchError,
  TenantForbiddenError,
  DEFAULT_TENANT_ID,
  DEFAULT_TENANT,
} from '../../schemas/tenant';
import { getSupabaseClient } from './client';
import { SAMPLE_PROJECT_CATALOG } from '../data/sampleProjects';

import {
  LeadsRepository,
  LeadEnrichmentRepository,
  LeadEventsRepository,
  createLeadsRepository,
  createLeadEnrichmentRepository,
  createLeadEventsRepository,
} from './repos/leadsRepo';
import {
  CallsRepository,
  createCallsRepository,
} from './repos/callsRepo';
import {
  BuyerProfilesRepository,
  BuyerPreferencesRepository,
  createBuyerProfilesRepository,
  createBuyerPreferencesRepository,
} from './repos/profilesRepo';
import {
  ProjectsRepository,
  ProjectMatchesRepository,
  createProjectsRepository,
  createProjectMatchesRepository,
} from './repos/projectsRepo';
import {
  CallTranscriptsRepository,
  ConversationExtractionsRepository,
  BuyerQualificationsRepository,
  createCallTranscriptsRepository,
  createConversationExtractionsRepository,
  createBuyerQualificationsRepository,
} from './repos/voiceRepo';
import {
  BuyerScoresRepository,
  createBuyerScoresRepository,
} from './repos/scoresRepo';
import {
  BrokerHandoffRepository,
  createBrokerHandoffRepository,
} from './repos/handoffsRepo';
import {
  TenantsRepository,
  TenantMembershipsRepository,
  TenantApiKeysRepository,
  WebhookEventsRepository,
  createTenantsRepository,
  createTenantMembershipsRepository,
  createTenantApiKeysRepository,
  createWebhookEventsRepository,
} from './repos/tenantsRepo';
import { generateUUID, parseScopeAndId } from './repos/helpers';

// Re-export repository contracts and types
export type {
  LeadsRepository,
  LeadEnrichmentRepository,
  LeadEventsRepository,
  CallsRepository,
  BuyerProfilesRepository,
  BuyerPreferencesRepository,
  ProjectsRepository,
  ProjectMatchesRepository,
  CallTranscriptsRepository,
  ConversationExtractionsRepository,
  BuyerQualificationsRepository,
  BuyerScoresRepository,
  BrokerHandoffRepository,
  TenantsRepository,
  TenantMembershipsRepository,
  TenantApiKeysRepository,
  WebhookEventsRepository,
};

// ==========================================
// CENTRAL SUPABASE DATA SERVICE
// ==========================================


class FallbackSafeMap<K, V> extends Map<K, V> {
  private assertSafe() {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[Supabase Fallback] In-memory persistence fallback is strictly disabled in production.');
    }
  }
  set(key: K, value: V): this {
    this.assertSafe();
    return super.set(key, value);
  }
  get(key: K): V | undefined {
    this.assertSafe();
    return super.get(key);
  }
  values(): IterableIterator<V> {
    this.assertSafe();
    return super.values();
  }
  keys(): IterableIterator<K> {
    this.assertSafe();
    return super.keys();
  }
  has(key: K): boolean {
    this.assertSafe();
    return super.has(key);
  }
  delete(key: K): boolean {
    this.assertSafe();
    return super.delete(key);
  }
  clear(): void {
    this.assertSafe();
    super.clear();
  }
}

export class SupabaseDataService {
  // In-memory data stores (fallback & local dev)
  private leadsStore: Map<string, Lead> = new FallbackSafeMap();
  private enrichmentStore: Map<string, LeadEnrichment[]> = new FallbackSafeMap();
  private callsStore: Map<string, Call> = new FallbackSafeMap();
  private transcriptsStore: Map<string, CallTranscript> = new FallbackSafeMap();
  private extractionsStore: Map<string, ConversationExtraction> = new FallbackSafeMap();
  private qualificationsStore: Map<string, BuyerQualification> = new FallbackSafeMap();
  private buyerProfilesStore: Map<string, BuyerProfile> = new FallbackSafeMap();
  private buyerPreferencesStore: Map<string, BuyerPreference[]> = new FallbackSafeMap();
  private projectsStore: Map<string, DbProject> = new FallbackSafeMap();
  private projectMatchesStore: Map<string, DbProjectMatch[]> = new FallbackSafeMap();
  private buyerScoresStore: Map<string, BuyerScore[]> = new FallbackSafeMap();
  private buyerScoreRecordsStore: Map<string, BuyerScoreRecord> = new FallbackSafeMap();
  private brokerHandoffsStore: Map<string, DbBrokerHandoff> = new FallbackSafeMap();
  private leadEventsStore: Map<string, LeadEvent[]> = new FallbackSafeMap();
  private tenantsStore: Map<string, Tenant> = new FallbackSafeMap();
  private membershipsStore: Map<string, TenantMembership> = new FallbackSafeMap();
  private apiKeysStore: Map<string, TenantApiKey> = new FallbackSafeMap();
  private webhookEventsStore: Map<string, WebhookEvent> = new FallbackSafeMap();

  // Public typed repositories
  public readonly leads: LeadsRepository;
  public readonly leadEnrichment: LeadEnrichmentRepository;
  public readonly calls: CallsRepository;
  public readonly buyerProfiles: BuyerProfilesRepository;
  public readonly buyerPreferences: BuyerPreferencesRepository;
  public readonly projects: ProjectsRepository;
  public readonly projectMatches: ProjectMatchesRepository;
  public readonly buyerScores: BuyerScoresRepository;
  public readonly leadEvents: LeadEventsRepository;
  public readonly transcripts: CallTranscriptsRepository;
  public readonly extractions: ConversationExtractionsRepository;
  public readonly qualifications: BuyerQualificationsRepository;
  public readonly brokerHandoffs: BrokerHandoffRepository;
  public readonly tenants: TenantsRepository;
  public readonly tenantMemberships: TenantMembershipsRepository;
  public readonly tenantApiKeys: TenantApiKeysRepository;
  public readonly webhookEvents: WebhookEventsRepository;

  constructor() {
    this.seedDefaultData();

    this.leads = createLeadsRepository(this.leadsStore);
    this.leadEnrichment = createLeadEnrichmentRepository(this.enrichmentStore, this.leads);
    this.calls = createCallsRepository(this.callsStore, this.leads);
    this.transcripts = createCallTranscriptsRepository(this.transcriptsStore, this.leads, this.calls);
    this.extractions = createConversationExtractionsRepository(this.extractionsStore, this.leads, this.transcripts);
    this.qualifications = createBuyerQualificationsRepository(this.qualificationsStore, this.leads, this.extractions);
    this.buyerProfiles = createBuyerProfilesRepository(this.buyerProfilesStore, this.leads);
    this.buyerPreferences = createBuyerPreferencesRepository(this.buyerPreferencesStore, this.leads);
    this.projects = createProjectsRepository(this.projectsStore);
    this.projectMatches = createProjectMatchesRepository(this.projectMatchesStore, this.leads);
    this.buyerScores = createBuyerScoresRepository(
      this.buyerScoresStore,
      this.buyerScoreRecordsStore,
      this.leads,
      this.qualifications,
      this.buyerProfiles
    );
    this.brokerHandoffs = createBrokerHandoffRepository(this.brokerHandoffsStore, this.leads);
    this.leadEvents = createLeadEventsRepository(this.leadEventsStore, this.leads);
    this.tenants = createTenantsRepository(this.tenantsStore);
    this.tenantMemberships = createTenantMembershipsRepository(this.membershipsStore);
    this.tenantApiKeys = createTenantApiKeysRepository(this.apiKeysStore);
    this.webhookEvents = createWebhookEventsRepository(this.webhookEventsStore);
  }

  private seedDefaultData(): void {
    if (process.env.NODE_ENV === 'production') return;
    // Seed default tenant
    this.tenantsStore.set(DEFAULT_TENANT_ID, {
      ...DEFAULT_TENANT,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Seed default projects with default tenant
    const sampleProjects: Array<Omit<DbProject, 'id' | 'created_at' | 'updated_at'>> = SAMPLE_PROJECT_CATALOG;
    const now = new Date().toISOString();
    for (const p of sampleProjects) {
      const id = generateUUID();
      this.projectsStore.set(id, {
        id,
        tenant_id: DEFAULT_TENANT_ID,
        ...p,
        created_at: now,
        updated_at: now,
      });
    }
  }

  // --- Persistence Verification & Round-Trip Diagnostic ---
  public async verifyPersistenceRoundTrip(
    scopeOrCustomLeadId?: TenantScope | TenantContext | string,
    maybeCustomLeadId?: string
  ): Promise<{
    success: boolean;
    isLiveSupabase: boolean;
    leadId: string;
    insertedId: string;
    readBackMatched: boolean;
    auditEventLogged: boolean;
    deletedSuccessfully: boolean;
    error?: string;
  }> {
    const scope = resolveEffectiveTenantScope(
      maybeCustomLeadId !== undefined
        ? (scopeOrCustomLeadId as TenantScope)
        : typeof scopeOrCustomLeadId === 'object'
        ? (scopeOrCustomLeadId as TenantScope)
        : undefined
    );
    const customLeadId =
      maybeCustomLeadId ||
      (typeof scopeOrCustomLeadId === 'string' && !scopeOrCustomLeadId.includes('00000000') ? scopeOrCustomLeadId : undefined);

    const testLeadId = customLeadId || `GF-DIAG-${Date.now()}`;
    const client = getSupabaseClient();
    const isLiveSupabase = client !== null;

    try {
      // 1. Insert test lead
      const inserted = await this.leads.createLead(scope, {
        lead_id: testLeadId,
        name: 'Diagnostic Test Lead',
        phone: '+919999988888',
        email: 'diagnostic.test@growthforge.ai',
        source: 'DIAGNOSTIC_VERIFICATION',
        source_reference: null,
        status: 'RAW',
      });

      // 2. Read back lead by lead_id
      const readBack = await this.leads.getLeadByLeadId(scope, testLeadId);
      if (!readBack || readBack.id !== inserted.id) {
        throw new Error(`Read-back verification failed: lead ${testLeadId} not found after creation.`);
      }

      // 3. Append test audit event
      const event = await this.leadEvents.appendLeadEvent(scope, {
        lead_id: inserted.id,
        event_type: 'PERSISTENCE_DIAGNOSTIC_TEST',
        event_data: { test_run_at: new Date().toISOString() },
      });

      const events = await this.leadEvents.getLeadEvents(scope, inserted.id);
      const auditEventLogged = events.some((e) => e.id === event.id);

      // 4. Delete test lead to keep database clean
      const deletedSuccessfully = await this.leads.deleteLead(scope, inserted.id);
      const postDeleteCheck = await this.leads.getLead(scope, inserted.id);
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

  // --- Canonical GF Buyer Lead Mapper ---
  public async mapToGFBuyerLead(
    scopeOrLeadId: TenantScope | TenantContext | string,
    maybeLeadId?: string
  ): Promise<GFBuyerLead | null> {
    const { scope, id: leadIdOrLeadUUID } = parseScopeAndId(scopeOrLeadId, maybeLeadId);

    // Look up lead by either internal UUID or external lead_id
    let lead = await this.leads.getLead(scope, leadIdOrLeadUUID);
    if (!lead) {
      lead = await this.leads.getLeadByLeadId(scope, leadIdOrLeadUUID);
    }
    if (!lead) return null;

    const [enrichments, profile, prefs, matches, score, events, extractionsList] = await Promise.all([
      this.leadEnrichment.getEnrichment(scope, lead.id),
      this.buyerProfiles.getBuyerProfile(scope, lead.id),
      this.buyerPreferences.getBuyerPreferences(scope, lead.id),
      this.projectMatches.getProjectMatches(scope, lead.id),
      this.buyerScores.getLatestBuyerScore(scope, lead.id),
      this.leadEvents.getLeadEvents(scope, lead.id),
      this.extractions.getExtractionsByLeadId(scope, lead.id),
    ]);

    const latestEnrichment = enrichments.length > 0 ? enrichments[enrichments.length - 1] : null;
    const latestEvent = events.length > 0 ? events[events.length - 1] : null;
    const latestExtraction = extractionsList.length > 0 ? extractionsList[extractionsList.length - 1] : null;
    const extData = latestExtraction?.extracted_data as any;

    // Map top matches
    const domainMatches: DomainProjectMatch[] = [];
    for (const m of matches) {
      const proj = await this.projects.getProject(scope, m.project_id);
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
