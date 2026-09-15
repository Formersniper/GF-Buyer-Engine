/**
 * GrowthForge Buyer Intelligence Engine - Phase 5F Broker Handoff Service
 *
 * Source of Truth: Formersniper/GF-Buyer-Engine
 * Consumes upstream intelligence layers (qualification, scoring, project recommendations,
 * extraction, provenance) to assemble the canonical sales-ready broker handoff package,
 * assigns deterministic CRM routing and SLA, handles idempotent delivery and audit logging.
 */

import {
  BrokerHandoffPackage,
  DbBrokerHandoff,
  GenerateHandoffInput,
  HandoffResult,
  DispatchResult,
  BrokerHandoffReadiness,
  BrokerRoutingStatus,
  BuyerRequirementHandoff,
  ProjectRecommendationHandoff,
  HandoffQueueItem,
  HANDOFF_SCHEMA_VERSION,
  HANDOFF_RULE_VERSION,
} from '../../schemas/handoff';
import { supabaseDataService } from '../supabase/repositories';
import { crmRouter } from './crmRouter';
import { BrokerHandoffChannel, mockBrokerHandoffChannel, WebhookBrokerHandoffChannel } from './channels/brokerHandoffChannel';
import { projectMatchingService } from '../matching/projectMatchingService';

export class BrokerHandoffService {
  private defaultChannel: BrokerHandoffChannel;

  constructor(defaultChannel: BrokerHandoffChannel = mockBrokerHandoffChannel) {
    this.defaultChannel = defaultChannel;
  }

  /**
   * Generates the canonical sales-ready broker handoff package.
   */
  public async generateHandoff(input: GenerateHandoffInput): Promise<HandoffResult> {
    const {
      leadId,
      qualificationId,
      scoreId,
      extractionId,
      forceRegenerate = false,
      ruleVersion = HANDOFF_RULE_VERSION,
    } = input;

    // 1. Verify Lead existence
    const lead = await supabaseDataService.leads.getLead({ isPlatformAdmin: true }, leadId);
    if (!lead) {
      return {
        success: false,
        action: 'LEAD_NOT_FOUND',
        error: `Lead with ID ${leadId} was not found.`,
      };
    }

    // 2. Fetch Score Record
    let scoreRecord = scoreId
      ? await supabaseDataService.buyerScores.getBuyerScore({ isPlatformAdmin: true }, scoreId)
      : null;

    if (!scoreRecord) {
      scoreRecord = await supabaseDataService.buyerScores.getLatestBuyerScoreRecord({ isPlatformAdmin: true }, leadId);
    }

    // 3. Fetch Qualification Record
    let qualification = qualificationId
      ? await supabaseDataService.qualifications.getQualification({ isPlatformAdmin: true }, qualificationId)
      : null;

    if (!qualification && scoreRecord?.qualification_id) {
      qualification = await supabaseDataService.qualifications.getQualification({ isPlatformAdmin: true }, scoreRecord.qualification_id);
    }

    if (!qualification) {
      const qualifications = await supabaseDataService.qualifications.getQualificationsByLeadId({ isPlatformAdmin: true }, leadId);
      qualification = qualifications.length > 0 ? qualifications[qualifications.length - 1] : null;
    }

    // 4. Fetch Extractions, Transcripts, Calls
    let extraction = extractionId
      ? await supabaseDataService.extractions.getExtraction(extractionId)
      : scoreRecord?.extraction_id
      ? await supabaseDataService.extractions.getExtraction(scoreRecord.extraction_id)
      : qualification?.extraction_id
      ? await supabaseDataService.extractions.getExtraction(qualification.extraction_id)
      : null;

    if (!extraction) {
      const extractions = await supabaseDataService.extractions.getExtractionsByLeadId(leadId);
      extraction = extractions.length > 0 ? extractions[extractions.length - 1] : null;
    }

    const transcript = extraction?.transcript_id
      ? await supabaseDataService.transcripts.getTranscript(extraction.transcript_id)
      : null;

    const call = extraction?.call_id
      ? await supabaseDataService.calls.getCall(extraction.call_id)
      : transcript?.call_id
      ? await supabaseDataService.calls.getCall(transcript.call_id)
      : null;

    // 5. Fetch Project Recommendations
    let recommendations = await projectMatchingService.getMatchesForLead(leadId);
    if (recommendations.length === 0) {
      const matchResult = await projectMatchingService.matchBuyerRequirements({
        leadId,
        qualificationId: qualification?.id,
        extractionId: extraction?.id,
      });
      recommendations = matchResult.recommendations || [];
    }

    // 6. Check Idempotency (Existing Handoff)
    if (!forceRegenerate && scoreRecord) {
      const existing = await supabaseDataService.brokerHandoffs.getHandoffByScoreId({ isPlatformAdmin: true }, scoreRecord.id, ruleVersion);
      if (existing) {
        return {
          success: true,
          action: 'EXISTING_HANDOFF',
          handoffId: existing.id,
          handoff: existing.handoff_payload,
          dbRecord: existing,
        };
      }
    }

    // 7. Evaluate Missing Information & Risks
    const missingInfo: string[] = [];
    const risks: string[] = [];

    const qualAny = qualification as any;
    const extData = extraction?.extracted_data as any;
    const isBudgetConfirmed =
      qualAny?.budget_truth_level === 'KNOWN' ||
      qualAny?.dimension_assessments?.budget?.truth_level === 'KNOWN' ||
      qualAny?.dimension_assessments?.budget?.status === 'SATISFIED' ||
      extData?.budget?.truth_level === 'KNOWN' ||
      (extData?.budget?.min !== undefined && extData?.budget?.min !== null) ||
      (extData?.budget?.max !== undefined && extData?.budget?.max !== null);

    if (!isBudgetConfirmed) {
      missingInfo.push('Budget confirmation');
    }

    const isFinancingConfirmed =
      qualAny?.dimension_assessments?.financing?.status === 'SATISFIED' ||
      extData?.financing?.truth_level === 'KNOWN' ||
      Boolean(extData?.financing?.value);

    if (!isFinancingConfirmed) {
      missingInfo.push('Financing preference');
    }

    const isDecisionAuthorityConfirmed =
      qualAny?.dimension_assessments?.decision_maker?.status === 'SATISFIED' ||
      extData?.decision_maker?.truth_level === 'KNOWN' ||
      extData?.decision_maker?.value !== undefined;

    if (!isDecisionAuthorityConfirmed) {
      missingInfo.push('Decision authority');
    }

    // Risks evaluation
    if ((qualification?.qualification_status as string) === 'DISQUALIFIED') {
      risks.push('Lead is marked DISQUALIFIED during qualification');
    }
    if (scoreRecord?.tier === 'TIER_4_REVIEW' || scoreRecord?.score_status === 'REQUIRES_REVIEW') {
      risks.push('Buyer intelligence requires human review');
    }
    if (scoreRecord?.risk_factors && scoreRecord.risk_factors.length > 0) {
      risks.push(...scoreRecord.risk_factors);
    }

    // 8. Determine CRM Routing & SLA
    const routingDecision = crmRouter.routeLead(lead, scoreRecord, qualification);

    // 9. Determine Readiness State
    let handoffStatus: BrokerHandoffReadiness = 'READY';
    let routingStatus: BrokerRoutingStatus = 'ASSIGNED';

    if ((qualification?.qualification_status as string) === 'DISQUALIFIED') {
      handoffStatus = 'BLOCKED';
      routingStatus = 'BLOCKED';
    } else if (
      qualification?.qualification_status === 'REQUIRES_REVIEW' ||
      scoreRecord?.score_status === 'REQUIRES_REVIEW' ||
      routingDecision.tier === 'TIER_4_REVIEW' ||
      !scoreRecord ||
      !qualification
    ) {
      handoffStatus = 'REQUIRES_REVIEW';
      routingStatus = 'REQUIRES_REVIEW';
    } else if (missingInfo.length > 0) {
      handoffStatus = 'READY_WITH_MISSING_DATA';
    }

    // 10. Assemble structured requirements
    const structuredReqs: BuyerRequirementHandoff[] = [];
    const multiReqs =
      (Array.isArray(qualAny?.requirements_breakdown) ? qualAny.requirements_breakdown : null) ||
      (Array.isArray(extData?.requirements) ? extData.requirements : null) ||
      (Array.isArray(extData?.buying_intent?.requirements_breakdown) ? extData.buying_intent.requirements_breakdown : null);

    if (Array.isArray(multiReqs) && multiReqs.length > 0) {
      multiReqs.forEach((r: any, idx: number) => {
        structuredReqs.push({
          id: `req-${idx + 1}`,
          requirement_index: idx + 1,
          property_type: r.property_type || extData?.primary_property_type?.value || qualAny?.property_type || null,
          configuration: r.configuration || (r.land_area ? `${r.land_area.min}-${r.land_area.max} ${r.land_area.unit}` : null) || extData?.primary_configuration?.value || qualAny?.configuration || null,
          purpose: r.purpose || extData?.purpose?.value || qualAny?.purpose || null,
          budget_min: r.budget_min ?? extData?.budget?.min ?? qualAny?.budget_min ?? null,
          budget_max: r.budget_max ?? extData?.budget?.max ?? qualAny?.budget_max ?? null,
          currency: r.currency || extData?.budget?.currency || qualAny?.currency || 'INR',
          budget_truth_level: r.budget_truth_level || extData?.budget?.truth_level || qualAny?.budget_truth_level || 'UNKNOWN',
          preferred_locations: Array.isArray(r.preferred_locations) ? r.preferred_locations : Array.isArray(extData?.preferred_locations?.value) ? extData.preferred_locations.value : qualAny?.preferred_locations || [],
          location_truth_level: extData?.preferred_locations?.truth_level || qualAny?.location_truth_level || 'UNKNOWN',
          timeline: r.timeline || extData?.timeline?.value || qualAny?.timeline || null,
          timeline_truth_level: extData?.timeline?.truth_level || qualAny?.timeline_truth_level || 'UNKNOWN',
          preferences: Array.isArray(r.preferences) ? r.preferences : Array.isArray(extData?.stated_preferences?.value) ? extData.stated_preferences.value : qualAny?.preferences || [],
        });
      });
    } else {
      structuredReqs.push({
        id: 'req-1',
        requirement_index: 1,
        property_type: extData?.primary_property_type?.value || qualAny?.property_type || null,
        configuration: extData?.primary_configuration?.value || qualAny?.configuration || null,
        purpose: extData?.purpose?.value || qualAny?.purpose || null,
        budget_min: extData?.budget?.min ?? qualAny?.budget_min ?? null,
        budget_max: extData?.budget?.max ?? qualAny?.budget_max ?? null,
        currency: extData?.budget?.currency || qualAny?.currency || 'INR',
        budget_truth_level: extData?.budget?.truth_level || qualAny?.budget_truth_level || 'UNKNOWN',
        preferred_locations: Array.isArray(extData?.preferred_locations?.value) ? extData.preferred_locations.value : qualAny?.preferred_locations || [],
        location_truth_level: extData?.preferred_locations?.truth_level || qualAny?.location_truth_level || 'UNKNOWN',
        timeline: extData?.timeline?.value || qualAny?.timeline || null,
        timeline_truth_level: extData?.timeline?.truth_level || qualAny?.timeline_truth_level || 'UNKNOWN',
        preferences: Array.isArray(extData?.stated_preferences?.value) ? extData.stated_preferences.value : qualAny?.preferences || [],
      });
    }

    // 11. Format Project Recommendations Handoff (Always AI_RECOMMENDED, non-buyer confirmed unless explicitly set)
    const recsHandoff: ProjectRecommendationHandoff[] = recommendations.slice(0, 5).map((r) => ({
      project_id: r.project_id,
      project_code: r.project_code,
      project_name: r.project_name,
      developer_name: r.developer_name,
      city: r.city,
      locality: r.locality,
      match_score: r.match_score,
      match_band: r.match_band,
      rank: r.rank,
      key_matches: r.key_matches || [],
      gaps: r.gaps || [],
      risks: r.risks || [],
      buyer_confirmed: r.buyer_confirmed || false,
      recommendation_status: 'AI_RECOMMENDED',
    }));

    // 12. Recommended Action & Talking Points
    const recAction =
      scoreRecord?.sla_dispatch?.recommended_action ||
      (missingInfo.length > 0
        ? `Broker should contact buyer to confirm ${missingInfo.join(' and ')}.`
        : 'Contact buyer to schedule project site visits and present matched inventory.');

    const talkingPoints: string[] = [
      ...(scoreRecord?.sla_dispatch?.talking_points || []),
    ];

    if (talkingPoints.length === 0) {
      if (structuredReqs[0]) {
        talkingPoints.push(`Acknowledge buyer interest in ${structuredReqs[0].configuration || ''} ${structuredReqs[0].property_type || 'property'} around ${structuredReqs[0].preferred_locations.join(', ')}.`);
      }
      if (recsHandoff.length > 0) {
        talkingPoints.push(`Introduce top match ${recsHandoff[0].project_name} (${recsHandoff[0].match_score}% affinity fit).`);
      }
      if (missingInfo.includes('Budget confirmation')) {
        talkingPoints.push('Diplomatically establish budget bracket to tailor payment plan options.');
      }
    }

    // 13. Build Commercial Summary text
    const primaryReq = structuredReqs[0];
    const secondaryReq = structuredReqs[1];
    const topProjectsText = recsHandoff
      .slice(0, 3)
      .map((p, idx) => `${idx + 1}. ${p.project_name} — ${p.match_score}% match`)
      .join('\n');

    const commercialSummary = `
BUYER:
${lead.name || 'Unknown Buyer'}

STATUS:
${qualification?.qualification_status || 'UNQUALIFIED'}

SCORE:
${scoreRecord?.score ?? scoreRecord?.composite_score ?? 0} / 100

TIER:
${routingDecision.tier}

PRIMARY REQUIREMENT:
${primaryReq ? `${primaryReq.configuration || ''} ${primaryReq.property_type || ''}, ${primaryReq.preferred_locations.join(', ')}`.trim() : 'Not specified'}
${secondaryReq ? `\nSECONDARY REQUIREMENT:\n${secondaryReq.configuration || ''} ${secondaryReq.property_type || ''}, ${secondaryReq.preferred_locations.join(', ')}`.trim() : ''}

TIMELINE:
${primaryReq?.timeline || 'Not confirmed'}

BUDGET:
${primaryReq?.budget_min || primaryReq?.budget_max ? `${primaryReq.currency} ${primaryReq.budget_min ?? 0} - ${primaryReq.budget_max ?? 'Max'}` : 'NOT CONFIRMED'}

TOP PROJECTS:
${topProjectsText || 'No projects matched'}

MISSING INFORMATION:
${missingInfo.length > 0 ? missingInfo.join('\n') : 'None'}

NEXT ACTION:
${recAction}
`.trim();

    const handoffUuid = crypto.randomUUID();
    const handoffId = `handoff-${Date.now()}-${lead.id.slice(0, 8)}`;
    const now = new Date().toISOString();

    const handoffPackage: BrokerHandoffPackage = {
      handoff_id: handoffId,
      lead_id: lead.id,
      external_lead_id: lead.lead_id,
      qualification_id: qualification?.id || null,
      score_id: scoreRecord?.id || null,
      extraction_id: extraction?.id || null,
      transcript_id: transcript?.id || null,
      call_id: call?.id || null,
      primary_buyer_summary: {
        name: lead.name,
        phone: lead.phone,
        location: extData?.buyer_persona?.current_location?.value || lead.source_reference || null,
        contact_status: lead.phone ? 'CONTACTABLE' : 'UNKNOWN',
      },
      qualification: {
        status: qualification?.qualification_status || 'REQUIRES_REVIEW',
        reason_codes: qualification?.reason_codes || [],
        blocking_fields: qualification?.blocking_fields || [],
        follow_up_fields: qualification?.follow_up_fields || [],
      },
      priority: {
        score: scoreRecord?.score ?? scoreRecord?.composite_score ?? 0,
        band: scoreRecord?.score_band || 'REVIEW',
        tier: routingDecision.tier,
        sla_minutes: routingDecision.sla_minutes,
        sla_deadline: routingDecision.sla_deadline,
        urgency: routingDecision.follow_up_urgency,
      },
      requirements: structuredReqs,
      project_recommendations: recsHandoff,
      missing_information: missingInfo,
      risks,
      recommended_action: recAction,
      talking_points: talkingPoints,
      call_summary: extData?.call_summary || null,
      commercial_summary: commercialSummary,
      recommendation_status: 'AI_RECOMMENDED',
      handoff_status: handoffStatus,
      routing_status: routingStatus,
      routing_decision: routingDecision,
      dispatch_channel: null,
      dispatch_status: 'PENDING',
      dispatch_id: null,
      handoff_version: HANDOFF_SCHEMA_VERSION,
      rule_version: ruleVersion,
      created_at: now,
      updated_at: now,
    };

    // 14. Persist in Database
    const tenantId = lead.tenant_id || '00000000-0000-0000-0000-000000000001';
    const dbRecord = await supabaseDataService.brokerHandoffs.createHandoff(
      { tenantId },
      {
        id: handoffUuid,
        lead_id: lead.id,
        qualification_id: qualification?.id || null,
        score_id: scoreRecord?.id || null,
        extraction_id: extraction?.id || null,
        transcript_id: transcript?.id || null,
        call_id: call?.id || null,
        handoff_payload: handoffPackage,
        handoff_status: handoffStatus,
        routing_status: routingStatus,
        assigned_role: routingDecision.assigned_role,
        assigned_team: routingDecision.assigned_team,
        priority_tier: routingDecision.tier,
        sla_minutes: routingDecision.sla_minutes,
        sla_deadline: routingDecision.sla_deadline,
        dispatch_channel: null,
        dispatch_status: 'PENDING',
        dispatch_id: null,
        handoff_version: HANDOFF_SCHEMA_VERSION,
        rule_version: ruleVersion,
      }
    );

    // 15. Record Audit Events
    await supabaseDataService.leadEvents.appendLeadEvent({ tenantId }, {
      lead_id: lead.id,
      event_type: 'HANDOFF_CREATED',
      event_data: {
        handoff_id: handoffId,
        score_id: scoreRecord?.id || null,
        tier: routingDecision.tier,
        assigned_team: routingDecision.assigned_team,
        assigned_role: routingDecision.assigned_role,
        sla_minutes: routingDecision.sla_minutes,
        handoff_status: handoffStatus,
      },
    });

    if (handoffStatus === 'READY' || handoffStatus === 'READY_WITH_MISSING_DATA') {
      await supabaseDataService.leadEvents.appendLeadEvent({ tenantId }, {
        lead_id: lead.id,
        event_type: 'HANDOFF_READY',
        event_data: {
          handoff_id: handoffId,
          missing_information: missingInfo,
          total_project_matches: recsHandoff.length,
        },
      });
    } else if (handoffStatus === 'REQUIRES_REVIEW') {
      await supabaseDataService.leadEvents.appendLeadEvent({ tenantId }, {
        lead_id: lead.id,
        event_type: 'HANDOFF_REQUIRES_REVIEW',
        event_data: {
          handoff_id: handoffId,
          risks,
          reason_codes: routingDecision.reason_codes,
        },
      });
    }

    await supabaseDataService.leadEvents.appendLeadEvent({ tenantId }, {
      lead_id: lead.id,
      event_type: 'ROUTING_ASSIGNED',
      event_data: {
        handoff_id: handoffId,
        assigned_role: routingDecision.assigned_role,
        assigned_team: routingDecision.assigned_team,
        routing_action: routingDecision.routing_action,
        sla_deadline: routingDecision.sla_deadline,
      },
    });

    return {
      success: true,
      action: handoffStatus === 'REQUIRES_REVIEW' ? 'HANDOFF_REQUIRES_REVIEW' : 'HANDOFF_CREATED',
      handoffId: dbRecord.id,
      handoff: handoffPackage,
      dbRecord,
    };
  }

  /**
   * Safe Dispatch through configured channel adapter.
   * - dry-run mode (or simulation): uses MockBrokerHandoffChannel with zero outbound network calls.
   * - production mode (dryRun = false): strictly routes to WebhookBrokerHandoffChannel for active WEBHOOK configs.
   * - Never silently falls back from production to mock on missing or invalid configurations.
   */
  public async dispatchHandoff(
    handoffId: string,
    options: { channel?: string; dryRun?: boolean; forceRedispatch?: boolean } = {}
  ): Promise<DispatchResult> {
    const { dryRun = true, forceRedispatch = false } = options;

    const sanitizeErrorMessage = (msg: string): string => {
      if (!msg) return 'Dispatch failed';
      return msg
        .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
        .replace(/(?:api[_-]?key|secret|token|password)=['"]?[A-Za-z0-9._~+/-]+['"]?/gi, '[REDACTED]')
        .replace(/https?:\/\/[^/\s:@]+:[^/\s:@]+@/gi, 'https://[REDACTED]@');
    };

    const handoff = await supabaseDataService.brokerHandoffs.getHandoff({ isPlatformAdmin: true }, handoffId);
    if (!handoff) {
      return {
        success: false,
        dispatch_id: '',
        channel: this.defaultChannel.channelName,
        status: 'FAILED',
        delivered_at: new Date().toISOString(),
        dry_run: dryRun,
        error: `Broker handoff ${handoffId} not found.`,
      };
    }

    const tenantId = handoff.tenant_id || '00000000-0000-0000-0000-000000000001';
    // Server-side tenant-scoped lookup (do NOT bypass tenant boundaries with isPlatformAdmin: true)
    const configs = await supabaseDataService.crmConfigs.listConfigs({ tenantId, isPlatformAdmin: false });
    // Defense-in-depth: strictly enforce tenant ownership
    const tenantConfigs = configs.filter((c: any) => c.tenant_id === tenantId);

    const enabledConfigs = tenantConfigs
      .filter((c: any) => c.is_enabled)
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    const enabledConfig = enabledConfigs[0] || null;

    const tenantScope = { tenantId, isPlatformAdmin: true };

    // Check dispatch idempotency before dispatch execution
    if (!forceRedispatch && (handoff.dispatch_status === 'SENT' || handoff.dispatch_status === 'ACKNOWLEDGED')) {
      await supabaseDataService.leadEvents.appendLeadEvent(tenantScope, {
        lead_id: handoff.lead_id,
        event_type: 'DISPATCH_DUPLICATE',
        event_data: {
          handoff_id: handoffId,
          existing_dispatch_id: handoff.dispatch_id,
          existing_dispatch_status: handoff.dispatch_status,
        },
      });
      return {
        success: true,
        dispatch_id: handoff.dispatch_id || `dup-${handoffId}`,
        channel: handoff.dispatch_channel || (enabledConfig ? enabledConfig.provider_name : this.defaultChannel.channelName),
        status: 'IGNORED_DUPLICATE',
        delivered_at: handoff.updated_at,
        dry_run: dryRun,
        message: `Handoff ${handoffId} was already dispatched with status ${handoff.dispatch_status}. Duplicate ignored.`,
      };
    }

    const isProductionRequested = options.dryRun === false;

    // PRODUCTION DISPATCH SAFETY CHECKS:
    // When production dispatch is requested (options.dryRun === false), we MUST NEVER silently fall back to Mock!
    if (isProductionRequested) {
      // 1. Missing configuration for tenant
      if (tenantConfigs.length === 0) {
        const errorMsg = 'CRM webhook configuration is missing';
        await supabaseDataService.brokerHandoffs.updateDispatchStatus(
          tenantScope,
          handoffId,
          'FAILED',
          null,
          'WEBHOOK_SALES_CHANNEL',
          { error: errorMsg, retryEligible: false, lastAttemptAt: new Date().toISOString() }
        );
        await supabaseDataService.leadEvents.appendLeadEvent(tenantScope, {
          lead_id: handoff.lead_id,
          event_type: 'DISPATCH_FAILED',
          event_data: {
            handoff_id: handoffId,
            error: errorMsg,
            retry_eligible: false,
          },
        });
        return {
          success: false,
          dispatch_id: '',
          channel: 'WEBHOOK_SALES_CHANNEL',
          status: 'FAILED',
          delivered_at: new Date().toISOString(),
          dry_run: false,
          error: errorMsg,
          retry_eligible: false,
        };
      }

      // 2. Disabled configuration (configs exist for tenant but none is enabled)
      if (!enabledConfig) {
        const errorMsg = 'CRM webhook configuration is disabled';
        const channelName = tenantConfigs[0]?.provider_name || 'WEBHOOK_SALES_CHANNEL';
        await supabaseDataService.brokerHandoffs.updateDispatchStatus(
          tenantScope,
          handoffId,
          'FAILED',
          null,
          channelName,
          { error: errorMsg, retryEligible: false, lastAttemptAt: new Date().toISOString() }
        );
        await supabaseDataService.leadEvents.appendLeadEvent(tenantScope, {
          lead_id: handoff.lead_id,
          event_type: 'DISPATCH_FAILED',
          event_data: {
            handoff_id: handoffId,
            error: errorMsg,
            retry_eligible: false,
          },
        });
        return {
          success: false,
          dispatch_id: '',
          channel: channelName,
          status: 'FAILED',
          delivered_at: new Date().toISOString(),
          dry_run: false,
          error: errorMsg,
          retry_eligible: false,
        };
      }

      // 3. Unsupported destination type (not WEBHOOK)
      if (enabledConfig.destination_type !== 'WEBHOOK') {
        const errorMsg = 'CRM destination type is unsupported';
        const channelName = enabledConfig.provider_name || 'UNKNOWN';
        await supabaseDataService.brokerHandoffs.updateDispatchStatus(
          tenantScope,
          handoffId,
          'FAILED',
          null,
          channelName,
          { error: errorMsg, retryEligible: false, lastAttemptAt: new Date().toISOString() }
        );
        await supabaseDataService.leadEvents.appendLeadEvent(tenantScope, {
          lead_id: handoff.lead_id,
          event_type: 'DISPATCH_FAILED',
          event_data: {
            handoff_id: handoffId,
            error: errorMsg,
            retry_eligible: false,
          },
        });
        return {
          success: false,
          dispatch_id: '',
          channel: channelName,
          status: 'FAILED',
          delivered_at: new Date().toISOString(),
          dry_run: false,
          error: errorMsg,
          retry_eligible: false,
        };
      }

      // 4. Missing endpoint URL
      if (!enabledConfig.endpoint_url || !enabledConfig.endpoint_url.trim()) {
        const errorMsg = 'CRM webhook endpoint is missing';
        const channelName = enabledConfig.provider_name || 'WEBHOOK_SALES_CHANNEL';
        await supabaseDataService.brokerHandoffs.updateDispatchStatus(
          tenantScope,
          handoffId,
          'FAILED',
          null,
          channelName,
          { error: errorMsg, retryEligible: false, lastAttemptAt: new Date().toISOString() }
        );
        await supabaseDataService.leadEvents.appendLeadEvent(tenantScope, {
          lead_id: handoff.lead_id,
          event_type: 'DISPATCH_FAILED',
          event_data: {
            handoff_id: handoffId,
            error: errorMsg,
            retry_eligible: false,
          },
        });
        return {
          success: false,
          dispatch_id: '',
          channel: channelName,
          status: 'FAILED',
          delivered_at: new Date().toISOString(),
          dry_run: false,
          error: errorMsg,
          retry_eligible: false,
        };
      }

      // 5. Structurally invalid endpoint URL
      let isUrlValid = false;
      try {
        const parsed = new URL(enabledConfig.endpoint_url.trim());
        isUrlValid = parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        isUrlValid = false;
      }
      if (!isUrlValid) {
        const errorMsg = 'CRM webhook endpoint is invalid';
        const channelName = enabledConfig.provider_name || 'WEBHOOK_SALES_CHANNEL';
        await supabaseDataService.brokerHandoffs.updateDispatchStatus(
          tenantScope,
          handoffId,
          'FAILED',
          null,
          channelName,
          { error: errorMsg, retryEligible: false, lastAttemptAt: new Date().toISOString() }
        );
        await supabaseDataService.leadEvents.appendLeadEvent(tenantScope, {
          lead_id: handoff.lead_id,
          event_type: 'DISPATCH_FAILED',
          event_data: {
            handoff_id: handoffId,
            error: errorMsg,
            retry_eligible: false,
          },
        });
        return {
          success: false,
          dispatch_id: '',
          channel: channelName,
          status: 'FAILED',
          delivered_at: new Date().toISOString(),
          dry_run: false,
          error: errorMsg,
          retry_eligible: false,
        };
      }
    }

    let dispatchChannel: BrokerHandoffChannel;
    let actualDryRun: boolean;

    if (enabledConfig) {
      actualDryRun = dryRun || enabledConfig.dry_run_mode;
      if (!actualDryRun && enabledConfig.destination_type === 'WEBHOOK' && enabledConfig.endpoint_url) {
        dispatchChannel = new WebhookBrokerHandoffChannel(
          enabledConfig.endpoint_url.trim(),
          (enabledConfig.metadata as Record<string, unknown> | null) || null
        );
      } else {
        // dry-run explicitly requested or enabledConfig.dry_run_mode is true -> safe simulation
        dispatchChannel = this.defaultChannel;
      }
    } else {
      // Safe simulation fallback ONLY when dry-run was explicitly requested or defaulted
      actualDryRun = true;
      dispatchChannel = this.defaultChannel;
    }

    const channelName = enabledConfig?.provider_name || dispatchChannel.channelName;

    // Audit Event: DISPATCH_STARTED
    await supabaseDataService.leadEvents.appendLeadEvent(tenantScope, {
      lead_id: handoff.lead_id,
      event_type: 'DISPATCH_STARTED',
      event_data: {
        handoff_id: handoffId,
        channel: channelName,
        dry_run: actualDryRun,
      },
    });

    try {
      const dispatchRes = await dispatchChannel.dispatch(handoff.handoff_payload, { dryRun: actualDryRun });

      if (enabledConfig?.provider_name) {
        dispatchRes.channel = enabledConfig.provider_name;
      }

      if (dispatchRes.success) {
        await supabaseDataService.brokerHandoffs.updateDispatchStatus(
          tenantScope,
          handoffId,
          'SENT',
          dispatchRes.dispatch_id,
          dispatchRes.channel,
          { error: null, retryEligible: false, lastAttemptAt: new Date().toISOString() }
        );
        await supabaseDataService.brokerHandoffs.updateStatus(tenantScope, handoffId, 'DISPATCHED', 'ROUTED');
        await supabaseDataService.leadEvents.appendLeadEvent(tenantScope, {
          lead_id: handoff.lead_id,
          event_type: 'DISPATCH_COMPLETED',
          event_data: {
            handoff_id: handoffId,
            dispatch_id: dispatchRes.dispatch_id,
            channel: dispatchRes.channel,
            dry_run: actualDryRun,
          },
        });
      } else {
        const isRetryable = dispatchRes.retry_eligible !== undefined
          ? dispatchRes.retry_eligible
          : (!!dispatchRes.error?.toLowerCase().includes('timeout') || !!dispatchRes.error?.toLowerCase().includes('network'));
        const safeError = sanitizeErrorMessage(dispatchRes.error || 'Dispatch failed');

        await supabaseDataService.brokerHandoffs.updateDispatchStatus(
          tenantScope,
          handoffId,
          'FAILED',
          dispatchRes.dispatch_id,
          dispatchRes.channel,
          { error: safeError, retryEligible: isRetryable, lastAttemptAt: new Date().toISOString() }
        );
        await supabaseDataService.leadEvents.appendLeadEvent(tenantScope, {
          lead_id: handoff.lead_id,
          event_type: 'DISPATCH_FAILED',
          event_data: {
            handoff_id: handoffId,
            error: safeError,
            retry_eligible: isRetryable,
          },
        });
        dispatchRes.status = 'FAILED';
        dispatchRes.retry_eligible = isRetryable;
        dispatchRes.error = safeError;
      }
      return dispatchRes;
    } catch (err: unknown) {
      const rawErrorMsg = err instanceof Error ? err.message : 'Dispatch exception';
      const safeError = sanitizeErrorMessage(rawErrorMsg);
      const isRetryable = safeError.toLowerCase().includes('timeout') || safeError.toLowerCase().includes('network');

      await supabaseDataService.brokerHandoffs.updateDispatchStatus(
        tenantScope,
        handoffId, 
        'FAILED',
        null,
        channelName,
        { error: safeError, retryEligible: isRetryable, lastAttemptAt: new Date().toISOString() }
      );
      await supabaseDataService.leadEvents.appendLeadEvent(tenantScope, {
        lead_id: handoff.lead_id,
        event_type: 'DISPATCH_FAILED',
        event_data: {
          handoff_id: handoffId,
          error: safeError,
          retry_eligible: isRetryable,
        },
      });
      return {
        success: false,
        dispatch_id: '',
        channel: channelName,
        status: 'FAILED',
        delivered_at: new Date().toISOString(),
        dry_run: actualDryRun,
        error: safeError,
        retry_eligible: isRetryable,
      };
    }
  }

  /**
   * Acknowledges sales receipt of handoff package.
   */
  public async acknowledgeHandoff(
    handoffId: string,
    ackData?: { acknowledgedBy?: string; notes?: string }
  ): Promise<DbBrokerHandoff> {
    await supabaseDataService.brokerHandoffs.updateStatus(handoffId, 'ACKNOWLEDGED');
    const updated = await supabaseDataService.brokerHandoffs.updateDispatchStatus(handoffId, 'ACKNOWLEDGED');

    await supabaseDataService.leadEvents.appendLeadEvent({
      lead_id: updated.lead_id,
      event_type: 'HANDOFF_ACKNOWLEDGED',
      event_data: {
        handoff_id: handoffId,
        acknowledged_by: ackData?.acknowledgedBy || 'SALES_REPRESENTATIVE',
        notes: ackData?.notes || null,
      },
    });

    return updated;
  }

  /**
   * Retrieves handoff package by ID.
   */
  public async getHandoff(handoffId: string): Promise<DbBrokerHandoff | null> {
    return supabaseDataService.brokerHandoffs.getHandoff(handoffId);
  }

  /**
   * Retrieves latest handoff for lead.
   */
  public async getLatestHandoffForLead(leadId: string): Promise<DbBrokerHandoff | null> {
    return supabaseDataService.brokerHandoffs.getLatestHandoff(leadId);
  }

  /**
   * Retrieves deterministic priority handoff queue.
   */
  public async getHandoffQueue(filter?: { tier?: string; status?: string; limit?: number }): Promise<HandoffQueueItem[]> {
    return supabaseDataService.brokerHandoffs.listHandoffQueue(filter);
  }
}

export const brokerHandoffService = new BrokerHandoffService();
