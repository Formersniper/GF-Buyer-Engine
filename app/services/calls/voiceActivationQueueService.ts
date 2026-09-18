/**
 * GrowthForge Buyer Intelligence Engine - Voice Activation Queue Service
 *
 * PHASE 9.3.4 IMPLEMENTATION:
 * - Provides a read-only, tenant-scoped, deterministically ordered projection of actionable voice leads.
 * - Reuses canonical call eligibility (CALL_ELIGIBILITY_V1), compliance, buyer scoring, and SLA matrices.
 * - Zero database schema changes (derived read model).
 * - Zero provider side effects.
 */

import { supabaseDataService } from '../supabase/repositories';
import { evaluateCallEligibility, CallEligibilityResult } from './callEligibility';
import { getRecommendedActionAndSLA } from '../../../src/services/brokerDashboardService';

export interface VoiceQueueItem {
  lead_id: string;
  internal_id: string;
  buyer_name: string;
  phone: string | null;
  source: string | null;
  workflow_status: string;
  eligibility_decision: 'ELIGIBLE' | 'NOT_ELIGIBLE' | 'REQUIRES_REVIEW';
  eligibility_reasons: string[];
  next_eligible_at: string | null;
  attempt_count: number;
  last_attempt_at: string | null;
  last_call_status: string | null;
  buyer_score: number;
  buyer_tier: string;
  sla_deadline: string | null;
  urgency: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  created_at: string;
}

export interface VoiceQueueOptions {
  limit?: number;
  offset?: number;
  tier?: string;
  search?: string;
}

export interface VoiceQueueResult {
  items: VoiceQueueItem[];
  total: number;
  limit: number;
  offset: number;
}

export class VoiceActivationQueueService {
  /**
   * Generates the actionable voice activation queue for a given tenant.
   */
  async getQueue(tenantId: string, options: VoiceQueueOptions = {}): Promise<VoiceQueueResult> {
    if (!tenantId) {
      throw new Error('Tenant ID is required for voice activation queue retrieval.');
    }

    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const offset = Math.max(options.offset ?? 0, 0);

    // 1. Retrieve all tenant-scoped leads
    const leads = await supabaseDataService.leads.listLeads(tenantId);
    if (!leads || leads.length === 0) {
      return { items: [], total: 0, limit, offset };
    }

    const queueItems: VoiceQueueItem[] = [];

    // States that mean the lead is already past or outside the voice activation queue
    const excludedStatuses = new Set([
      'CALL_PENDING',
      'CALLING',
      'CONNECTED',
      'QUALIFICATION_IN_PROGRESS',
      'QUALIFIED',
      'SCORED',
      'HOT',
      'WARM',
      'PROJECT_MATCHED',
      'HANDOFF',
      'DISPATCH',
      'CLOSED',
      'ARCHIVED',
    ]);

    for (const lead of leads) {
      const statusUpper = (lead.status || '').toUpperCase();
      if (excludedStatuses.has(statusUpper)) {
        continue;
      }

      // Fetch supporting records concurrently or sequentially per lead
      const callsHistory = await supabaseDataService.calls.getCallsByLead(lead.id);
      const profile = await supabaseDataService.buyerProfiles.getBuyerProfile(tenantId, lead.id);
      const consentStatus = (profile?.metadata as any)?.consent_status || (profile as any)?.consent_status || (lead as any).consent_status;
      const scoreRecord = await supabaseDataService.buyerScores.getLatestBuyerScoreRecord(tenantId, lead.id);

      // Evaluate canonical eligibility
      const eligibility = evaluateCallEligibility({
        leadId: lead.id,
        tenantId,
        status: lead.status,
        phone: lead.phone,
        email: lead.email,
        consentStatus,
        source: lead.source,
        enrichmentAvailable: true,
        callsHistory,
      });

      // Only include leads that are strictly ELIGIBLE for voice calling
      if (!eligibility.eligible || eligibility.decision !== 'ELIGIBLE') {
        continue;
      }

      // Calculate SLA and recommended action
      const slaResult = getRecommendedActionAndSLA({
        lead_id: lead.lead_id,
        tenant_id: tenantId,
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        source: lead.source,
        workflow: { status: lead.status, history: [] },
        lead_intelligence: {
          qualification: scoreRecord?.tier ? scoreRecord.tier.includes('HOT') ? 'HOT' : 'WARM' : 'WARM',
          intent_score: scoreRecord?.score ?? (lead as any).lead_intelligence?.intent_score ?? 75,
        },
      } as any);

      const attemptCount = callsHistory.length;
      const sortedCalls = [...callsHistory].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      const lastCall = sortedCalls[0];

      const buyerScore = scoreRecord?.score ?? (lead as any).lead_intelligence?.intent_score ?? 75;
      const buyerTier = scoreRecord?.tier || (buyerScore >= 85 ? 'TIER_1_HOT' : 'TIER_2_WARM');

      // Optional filters
      if (options.tier && options.tier !== 'ALL' && buyerTier !== options.tier) {
        continue;
      }

      if (options.search && options.search.trim() !== '') {
        const q = options.search.toLowerCase();
        const matchesName = lead.name?.toLowerCase().includes(q);
        const matchesPhone = lead.phone?.toLowerCase().includes(q);
        const matchesLeadId = lead.lead_id?.toLowerCase().includes(q);
        if (!matchesName && !matchesPhone && !matchesLeadId) {
          continue;
        }
      }

      queueItems.push({
        lead_id: lead.lead_id,
        internal_id: lead.id,
        buyer_name: lead.name || 'Unnamed Lead',
        phone: lead.phone || null,
        source: lead.source || 'UNKNOWN',
        workflow_status: lead.status,
        eligibility_decision: eligibility.decision,
        eligibility_reasons: eligibility.reasons,
        next_eligible_at: eligibility.compliance?.nextEligibleAt || null,
        attempt_count: attemptCount,
        last_attempt_at: lastCall?.created_at || null,
        last_call_status: lastCall?.status || null,
        buyer_score: buyerScore,
        buyer_tier: buyerTier,
        sla_deadline: scoreRecord?.sla_dispatch?.sla_deadline || null,
        urgency: slaResult.urgency,
        created_at: lead.created_at,
      });
    }

    // Deterministic Sorting:
    // 1. Urgency rank (CRITICAL = 0, HIGH = 1, MEDIUM = 2, LOW = 3)
    // 2. Tier priority (TIER_1_HOT = 0, TIER_2_WARM = 1, TIER_3_NURTURE = 2)
    // 3. Buyer Score DESC
    // 4. Created at ASC (older leads first within same score)
    // 5. Lead ID ASC (deterministic tie-breaker)
    const urgencyRank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    const tierRank = { TIER_1_HOT: 0, TIER_2_WARM: 1, TIER_3_NURTURE: 2, TIER_4_REVIEW: 3 };

    queueItems.sort((a, b) => {
      const uA = urgencyRank[a.urgency] ?? 2;
      const uB = urgencyRank[b.urgency] ?? 2;
      if (uA !== uB) return uA - uB;

      const tA = tierRank[a.buyer_tier as keyof typeof tierRank] ?? 1;
      const tB = tierRank[b.buyer_tier as keyof typeof tierRank] ?? 1;
      if (tA !== tB) return tA - tB;

      if (a.buyer_score !== b.buyer_score) {
        return b.buyer_score - a.buyer_score; // DESC
      }

      const dateA = new Date(a.created_at).getTime();
      const dateB = new Date(b.created_at).getTime();
      if (dateA !== dateB) {
        return dateA - dateB; // ASC
      }

      return a.lead_id.localeCompare(b.lead_id);
    });

    const total = queueItems.length;
    const paginatedItems = queueItems.slice(offset, offset + limit);

    return {
      items: paginatedItems,
      total,
      limit,
      offset,
    };
  }
}

export const voiceActivationQueueService = new VoiceActivationQueueService();
