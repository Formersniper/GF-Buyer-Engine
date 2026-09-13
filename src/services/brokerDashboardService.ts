/**
 * GrowthForge Buyer Intelligence Engine
 * Phase 8B.1 Broker Command Center Service
 * 
 * Provides deterministic KPI aggregation, priority queue ordering, SLA matrix evaluation,
 * and multi-criteria filtering for broker workspace operations.
 */

import { GFBuyerLead, QualificationLevel } from '../types/buyerLead';
import { DbBrokerHandoff } from '../../app/schemas/database';
import { DEFAULT_TENANT_ID } from '../../app/schemas/tenant';

export interface BrokerDashboardKPIs {
  hotCount: number;
  warmCount: number;
  needsActionCount: number;
  projectMatchedCount: number;
  handoffPendingCount: number;
}

export interface DashboardFilters {
  temperature?: 'ALL' | 'HOT' | 'WARM' | 'NURTURE';
  qualification?: string;
  propertyType?: string;
  budgetRange?: 'ALL' | 'UNDER_1.5CR' | '1.5CR_3CR' | 'ABOVE_3CR';
  preferredLocation?: string;
  timeline?: string;
  projectMatch?: 'ALL' | 'MATCHED' | 'NO_MATCH';
  handoffStatus?: 'ALL' | 'HANDED_OFF' | 'PENDING' | 'NOT_STARTED';
  searchQuery?: string;
}

export interface RecommendedActionSLAResult {
  action: 'CONTACT NOW' | 'SENIOR ADVISOR FOLLOW-UP' | 'INBOUND SALES FOLLOW-UP' | 'NURTURE' | 'MANUAL REVIEW';
  slaLabel: string;
  slaMinutes: number;
  assignedRole: string;
  urgency: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  description: string;
}

/**
 * Calculates domain KPIs for the Broker Command Center
 */
export function calculateBrokerKPIs(
  leads: GFBuyerLead[],
  handoffs: DbBrokerHandoff[] = []
): BrokerDashboardKPIs {
  const handoffsByLeadId = new Map<string, DbBrokerHandoff>();
  handoffs.forEach((h) => handoffsByLeadId.set(h.lead_id, h));

  let hotCount = 0;
  let warmCount = 0;
  let needsActionCount = 0;
  let projectMatchedCount = 0;
  let handoffPendingCount = 0;

  for (const lead of leads) {
    const qual = (lead.lead_intelligence?.qualification || '').toUpperCase();
    const workflowStatus = (lead.workflow?.status || '').toUpperCase();
    const scoreBand = qual === 'HOT' || workflowStatus === 'HOT' ? 'HOT' : qual === 'WARM' || workflowStatus === 'WARM' ? 'WARM' : 'NURTURE';

    if (scoreBand === 'HOT') {
      hotCount++;
    } else if (scoreBand === 'WARM') {
      warmCount++;
    }

    // Has project matches
    const hasMatch =
      (lead.project_intelligence?.top_matches && lead.project_intelligence.top_matches.length > 0) ||
      Boolean(lead.project_intelligence?.preferred_project?.project_name);
    if (hasMatch) {
      projectMatchedCount++;
    }

    // Handoff Status
    const handoff = handoffsByLeadId.get(lead.lead_id);
    const handoffStatus = handoff?.handoff_status || (workflowStatus === 'HANDED_OFF' ? 'COMPLETED' : 'NOT_STARTED');

    if (handoffStatus !== 'COMPLETED' && handoffStatus !== 'ACKNOWLEDGED') {
      handoffPendingCount++;
    }

    // Needs Action: Qualified/Warm/Hot or pending review/call needing broker attention
    const isActionableStage = ['HOT', 'WARM', 'QUALIFIED', 'CALL_PENDING', 'REQUIRES_REVIEW', 'ENRICHED'].includes(qual) ||
      ['HOT', 'WARM', 'QUALIFIED', 'CALL_PENDING', 'REQUIRES_REVIEW', 'ENRICHED'].includes(workflowStatus);
    
    if (isActionableStage && handoffStatus !== 'COMPLETED' && handoffStatus !== 'ACKNOWLEDGED') {
      needsActionCount++;
    }
  }

  return {
    hotCount,
    warmCount,
    needsActionCount,
    projectMatchedCount,
    handoffPendingCount,
  };
}

/**
 * Evaluates SLA and recommended next action per buyer
 */
export function getRecommendedActionAndSLA(
  lead: GFBuyerLead,
  handoff?: DbBrokerHandoff | null
): RecommendedActionSLAResult {
  const qual = (lead.lead_intelligence?.qualification || '').toUpperCase();
  const workflowStatus = (lead.workflow?.status || '').toUpperCase();

  if (handoff?.handoff_payload?.priority) {
    const p = handoff.handoff_payload.priority;
    const tier = p.tier;
    if (tier === 'TIER_1_HOT') {
      return {
        action: 'CONTACT NOW',
        slaLabel: '15-Minute SLA',
        slaMinutes: 15,
        assignedRole: 'SENIOR_SALES_ADVISOR',
        urgency: 'CRITICAL',
        description: handoff.handoff_payload.recommended_action || 'Immediate senior advisor phone outreach',
      };
    } else if (tier === 'TIER_2_WARM') {
      return {
        action: 'SENIOR ADVISOR FOLLOW-UP',
        slaLabel: '2-Hour SLA',
        slaMinutes: 120,
        assignedRole: 'INBOUND_SALES_SPECIALIST',
        urgency: 'HIGH',
        description: handoff.handoff_payload.recommended_action || 'Inbound sales specialist follow-up',
      };
    } else if (tier === 'TIER_3_NURTURE') {
      return {
        action: 'NURTURE',
        slaLabel: '24-Hour Nurture',
        slaMinutes: 1440,
        assignedRole: 'AUTOMATED_NURTURE_WORKFLOW',
        urgency: 'LOW',
        description: handoff.handoff_payload.recommended_action || 'Enroll in automated nurture sequence',
      };
    } else if (tier === 'TIER_4_REVIEW') {
      return {
        action: 'MANUAL REVIEW',
        slaLabel: '30-Minute Review',
        slaMinutes: 30,
        assignedRole: 'SALES_SUPERVISOR_REVIEW',
        urgency: 'MEDIUM',
        description: 'Supervisor intelligence audit required',
      };
    }
  }

  // Fallback heuristic based on canonical qualification / score
  if (qual === 'HOT' || workflowStatus === 'HOT' || lead.lead_intelligence?.intent_score >= 90) {
    return {
      action: 'CONTACT NOW',
      slaLabel: '15-Minute SLA',
      slaMinutes: 15,
      assignedRole: 'SENIOR_SALES_ADVISOR',
      urgency: 'CRITICAL',
      description: lead.lead_intelligence?.recommended_action || 'Immediate senior advisor phone outreach required',
    };
  }

  if (qual === 'WARM' || workflowStatus === 'WARM' || lead.lead_intelligence?.intent_score >= 70) {
    return {
      action: 'SENIOR ADVISOR FOLLOW-UP',
      slaLabel: '2-Hour SLA',
      slaMinutes: 120,
      assignedRole: 'INBOUND_SALES_SPECIALIST',
      urgency: 'HIGH',
      description: lead.lead_intelligence?.recommended_action || 'Inbound sales specialist consultation follow-up',
    };
  }

  if (qual === 'REQUIRES_REVIEW' || workflowStatus === 'REQUIRES_REVIEW') {
    return {
      action: 'MANUAL REVIEW',
      slaLabel: '30-Minute Review',
      slaMinutes: 30,
      assignedRole: 'SALES_SUPERVISOR_REVIEW',
      urgency: 'MEDIUM',
      description: 'Review contradicting requirements before advisor contact',
    };
  }

  return {
    action: 'NURTURE',
    slaLabel: '24-Hour Nurture',
    slaMinutes: 1440,
    assignedRole: 'AUTOMATED_NURTURE_WORKFLOW',
    urgency: 'LOW',
    description: lead.lead_intelligence?.recommended_action || 'Enroll in automated marketing nurture workflow',
  };
}

/**
 * Filter & Deterministic Priority Queue Ordering
 * Order:
 * 1. HOT first (Tier 1)
 * 2. Composite Score DESC
 * 3. Last Activity / Updated DESC
 * 4. Deterministic Tie-Breaker: lead_id ASC
 */
export function filterAndSortPriorityQueue(
  leads: GFBuyerLead[],
  handoffsByLeadId: Map<string, DbBrokerHandoff>,
  filters: DashboardFilters
): GFBuyerLead[] {
  let filtered = [...leads];

  // Search Query (Name, Lead ID, Phone)
  if (filters.searchQuery && filters.searchQuery.trim()) {
    const q = filters.searchQuery.trim().toLowerCase();
    filtered = filtered.filter((l) => {
      const name = (l.identity?.full_name || '').toLowerCase();
      const leadId = (l.lead_id || '').toLowerCase();
      const phone = (l.identity?.phone || '').toLowerCase();
      const email = (l.identity?.email || '').toLowerCase();
      return name.includes(q) || leadId.includes(q) || phone.includes(q) || email.includes(q);
    });
  }

  // Temperature Filter
  if (filters.temperature && filters.temperature !== 'ALL') {
    filtered = filtered.filter((l) => {
      const qual = (l.lead_intelligence?.qualification || '').toUpperCase();
      const wf = (l.workflow?.status || '').toUpperCase();
      if (filters.temperature === 'HOT') {
        return qual === 'HOT' || wf === 'HOT';
      }
      if (filters.temperature === 'WARM') {
        return qual === 'WARM' || wf === 'WARM';
      }
      if (filters.temperature === 'NURTURE') {
        return qual === 'NURTURE' || wf === 'NURTURE';
      }
      return true;
    });
  }

  // Qualification Filter
  if (filters.qualification && filters.qualification !== 'ALL') {
    filtered = filtered.filter((l) => {
      const qual = (l.lead_intelligence?.qualification || '').toUpperCase();
      const wf = (l.workflow?.status || '').toUpperCase();
      return qual === filters.qualification?.toUpperCase() || wf === filters.qualification?.toUpperCase();
    });
  }

  // Property Type Filter
  if (filters.propertyType && filters.propertyType !== 'ALL') {
    const pt = filters.propertyType.toLowerCase();
    filtered = filtered.filter((l) => {
      const leadPt = (l.buying_intent?.property_type || '').toLowerCase();
      return leadPt.includes(pt);
    });
  }

  // Budget Range Filter
  if (filters.budgetRange && filters.budgetRange !== 'ALL') {
    filtered = filtered.filter((l) => {
      const max = l.buying_intent?.budget?.max;
      const min = l.buying_intent?.budget?.min;
      const maxVal = max || min || 0;
      if (filters.budgetRange === 'UNDER_1.5CR') {
        return maxVal > 0 && maxVal < 15000000;
      }
      if (filters.budgetRange === '1.5CR_3CR') {
        return maxVal >= 15000000 && maxVal <= 30000000;
      }
      if (filters.budgetRange === 'ABOVE_3CR') {
        return maxVal > 30000000;
      }
      return true;
    });
  }

  // Preferred Location Filter
  if (filters.preferredLocation && filters.preferredLocation.trim()) {
    const loc = filters.preferredLocation.trim().toLowerCase();
    filtered = filtered.filter((l) => {
      const locs = l.buying_intent?.preferred_locations || [];
      const identityLoc = l.identity?.location || '';
      return (
        locs.some((item) => item.toLowerCase().includes(loc)) ||
        identityLoc.toLowerCase().includes(loc)
      );
    });
  }

  // Timeline Filter
  if (filters.timeline && filters.timeline.trim()) {
    const tl = filters.timeline.trim().toLowerCase();
    filtered = filtered.filter((l) => {
      const leadTl = (l.buying_intent?.timeline || '').toLowerCase();
      return leadTl.includes(tl);
    });
  }

  // Project Match Filter
  if (filters.projectMatch && filters.projectMatch !== 'ALL') {
    filtered = filtered.filter((l) => {
      const hasMatch =
        (l.project_intelligence?.top_matches && l.project_intelligence.top_matches.length > 0) ||
        Boolean(l.project_intelligence?.preferred_project?.project_name);
      if (filters.projectMatch === 'MATCHED') return hasMatch;
      if (filters.projectMatch === 'NO_MATCH') return !hasMatch;
      return true;
    });
  }

  // Handoff Status Filter
  if (filters.handoffStatus && filters.handoffStatus !== 'ALL') {
    filtered = filtered.filter((l) => {
      const handoff = handoffsByLeadId.get(l.lead_id);
      const hStatus = (handoff?.handoff_status || (l.workflow?.status === 'HANDED_OFF' ? 'COMPLETED' : 'NOT_STARTED')) as string;
      if (filters.handoffStatus === 'HANDED_OFF') {
        return hStatus === 'COMPLETED' || hStatus === 'ACKNOWLEDGED' || hStatus === 'DISPATCHED';
      }
      if (filters.handoffStatus === 'PENDING') {
        return hStatus === 'PENDING' || hStatus === 'READY' || hStatus === 'READY_WITH_MISSING_DATA' || hStatus === 'REQUIRES_REVIEW';
      }
      if (filters.handoffStatus === 'NOT_STARTED') {
        return hStatus === 'NOT_STARTED';
      }
      return true;
    });
  }

  // Deterministic Sorting
  return filtered.sort((a, b) => {
    const handoffA = handoffsByLeadId.get(a.lead_id);
    const handoffB = handoffsByLeadId.get(b.lead_id);

    // Temperature Group Rank (HOT = 1, WARM = 2, NURTURE = 3, OTHER = 4)
    const getGroupRank = (lead: GFBuyerLead, handoff?: DbBrokerHandoff | null) => {
      const qual = (lead.lead_intelligence?.qualification || '').toUpperCase();
      const wf = (lead.workflow?.status || '').toUpperCase();
      if (qual === 'HOT' || wf === 'HOT' || handoff?.priority_tier === 'TIER_1_HOT') return 1;
      if (qual === 'WARM' || wf === 'WARM' || handoff?.priority_tier === 'TIER_2_WARM') return 2;
      if (qual === 'NURTURE' || wf === 'NURTURE' || handoff?.priority_tier === 'TIER_3_NURTURE') return 3;
      return 4;
    };

    const rankA = getGroupRank(a, handoffA);
    const rankB = getGroupRank(b, handoffB);

    if (rankA !== rankB) {
      return rankA - rankB; // HOT first (1 < 2)
    }

    // Composite / Intent Score DESC
    const scoreA = a.lead_intelligence?.intent_score ?? 0;
    const scoreB = b.lead_intelligence?.intent_score ?? 0;
    if (scoreA !== scoreB) {
      return scoreB - scoreA;
    }

    // Last Updated DESC
    const dateA = new Date(a.workflow?.updated_at || 0).getTime();
    const dateB = new Date(b.workflow?.updated_at || 0).getTime();
    if (dateA !== dateB) {
      return dateB - dateA;
    }

    // Deterministic tie-breaker: lead_id ASC
    return a.lead_id.localeCompare(b.lead_id);
  });
}
