/**
 * GrowthForge Buyer Intelligence Engine - Phase 5D Deterministic Scoring Rules Engine
 *
 * Source of Truth: Formersniper/GF-Buyer-Engine
 *
 * Pure, deterministic rules calculation evaluating the 8 frozen GrowthForge dimensions:
 * 1. Buyer Intent (25%)
 * 2. Budget Clarity (15%)
 * 3. Location Clarity (15%)
 * 4. Timeline (15%)
 * 5. Project Fit (10%) -> Transparently PENDING in Phase 5D
 * 6. Decision Authority (10%)
 * 7. Contactability (5%)
 * 8. Data Freshness (5%)
 * Total: 100% / 100 points
 *
 * Enforces Epistemic truth preservation, SLA computation, and score bands (HOT: 90-100, WARM: 70-89, NURTURE: 0-69).
 */

import { ExtractedBuyerIntelligence } from '../../schemas/extraction';
import { BuyerQualification, BuyerQualificationStatus } from '../../schemas/qualification';
import {
  LeadTier,
  ScoreBand,
  ScoreStatus,
  ScoreComponent,
  SLAPriorityDispatch,
  FollowUpUrgency,
  SCORING_RULE_VERSION,
  SCORING_SCHEMA_VERSION,
} from '../../schemas/scoring';
import { DataTruthLevel } from '../../schemas/truthLevel';
import { Lead, Call } from '../../schemas/database';

export interface ScoringInput {
  qualification?: BuyerQualification | null;
  extractedData?: ExtractedBuyerIntelligence | Record<string, any> | null;
  lead?: Lead | null;
  call?: Call | null;
  qualificationStatus?: BuyerQualificationStatus;
  timestamp?: number;
}

export interface EvaluatedScoreOutput {
  score: number; // 0 - 100
  composite_score: number; // 0 - 100
  total_score: number; // 0 - 100
  scoring_confidence: number;
  tier: LeadTier;
  score_band: ScoreBand;
  score_status: ScoreStatus;
  dimension_scores: {
    buyer_intent: number;
    budget_clarity: number;
    location_clarity: number;
    timeline: number;
    project_fit: number;
    decision_authority: number;
    contactability: number;
    data_freshness: number;
    // Legacy aliases
    intent_engagement: number;
    commercial_readiness: number;
    velocity_urgency: number;
    requirement_clarity: number;
  };
  components: ScoreComponent[];
  breakdown: ScoreComponent[];
  key_drivers: string[];
  risk_factors: string[];
  reason_codes: string[];
  sla_dispatch: SLAPriorityDispatch;
  project_fit_status: 'PENDING' | 'COMPLETED';
  rule_version: string;
  scoring_version: string;
  calculated_at: string;
}

export class ScoringRulesEngine {
  public evaluate(input: ScoringInput): EvaluatedScoreOutput {
    const { qualification, extractedData, lead, call, qualificationStatus, timestamp = Date.now() } = input;

    const qualStatus: BuyerQualificationStatus =
      qualification?.qualification_status || qualificationStatus || 'PARTIALLY_QUALIFIED';

    // Helper for truth level confidence
    const getConfidenceFromTruth = (truth?: string): number => {
      switch (truth) {
        case 'CONFIRMED':
          return 1.0;
        case 'KNOWN':
          return 0.9;
        case 'INFERRED':
          return 0.7;
        case 'UNKNOWN':
          return 0.35;
        case 'CONFLICTED':
          return 0.2;
        default:
          return 0.8;
      }
    };

    // ==========================================
    // EXTRACT UNIFIED NORMALIZED VALUES
    // ==========================================
    const rawData: any = extractedData || {};
    let isConflicted = false;

    // 1. Intent
    let isInterested: boolean | null = null;
    let intentTruth: DataTruthLevel = 'UNKNOWN';
    let intentEvidence: string | null = null;

    if (rawData.interested && typeof rawData.interested === 'object' && 'value' in rawData.interested) {
      isInterested = rawData.interested.value;
      intentTruth = (rawData.interested.truth_level as DataTruthLevel) || 'UNKNOWN';
      intentEvidence = rawData.interested.evidence || null;
    } else if (rawData.buying_intent) {
      isInterested = rawData.buying_intent.interested;
      intentTruth = (rawData.truth_summary?.interested as DataTruthLevel) || 'CONFIRMED';
      intentEvidence = rawData.buying_intent.interested_evidence || null;
    }

    // 2. Budget
    let bMin: number | null = null;
    let bMax: number | null = null;
    let bRawExpr: string | null = null;
    let budgetTruth: DataTruthLevel = 'UNKNOWN';
    let budgetEvidence: string | null = null;
    let financing: string | null = null;

    if (rawData.budget) {
      bMin = rawData.budget.min ?? null;
      bMax = rawData.budget.max ?? null;
      bRawExpr = rawData.budget.raw_expression || rawData.budget.qualitative_budget || null;
      const rawBudgetTruth = rawData.budget.truth_level || rawData.truth_summary?.budget;
      if (rawBudgetTruth === 'CONFLICTED') {
        isConflicted = true;
        budgetTruth = 'UNKNOWN';
      } else {
        budgetTruth = (rawBudgetTruth as DataTruthLevel) || 'UNKNOWN';
      }
      budgetEvidence = rawData.budget.evidence || null;
    } else if (rawData.buying_intent?.budget) {
      bMin = rawData.buying_intent.budget.min ?? null;
      bMax = rawData.buying_intent.budget.max ?? null;
      bRawExpr = rawData.buying_intent.budget.qualitative_budget || null;
      const rawBudgetTruth = rawData.truth_summary?.budget;
      if (rawBudgetTruth === 'CONFLICTED') {
        isConflicted = true;
        budgetTruth = 'UNKNOWN';
      } else {
        budgetTruth = (rawBudgetTruth as DataTruthLevel) || (bMin ? 'CONFIRMED' : 'UNKNOWN');
      }
      budgetEvidence = rawData.buying_intent.budget.evidence || null;
    }

    if (rawData.financing && typeof rawData.financing === 'object' && 'value' in rawData.financing) {
      financing = rawData.financing.value;
    } else if (rawData.buying_intent?.financing) {
      financing = rawData.buying_intent.financing;
    }

    // 3. Timeline
    let timelineVal: string | null = null;
    let timelineTruth: DataTruthLevel = 'UNKNOWN';
    let timelineEvidence: string | null = null;

    if (rawData.timeline && typeof rawData.timeline === 'object' && 'value' in rawData.timeline) {
      timelineVal = rawData.timeline.value;
      timelineTruth = (rawData.timeline.truth_level as DataTruthLevel) || 'UNKNOWN';
      timelineEvidence = rawData.timeline.evidence || null;
    } else if (rawData.buying_intent?.timeline) {
      timelineVal = rawData.buying_intent.timeline;
      timelineTruth = (rawData.truth_summary?.timeline as DataTruthLevel) || 'CONFIRMED';
      timelineEvidence = rawData.buying_intent.timeline_evidence || null;
    }

    // 4. Locations, Type, Config, Requirements
    let preferredLocations: string[] = [];
    let locationTruth: DataTruthLevel = 'UNKNOWN';
    let locationEvidence: string | null = null;

    if (rawData.preferred_locations && typeof rawData.preferred_locations === 'object' && 'value' in rawData.preferred_locations) {
      preferredLocations = Array.isArray(rawData.preferred_locations.value) ? rawData.preferred_locations.value : [];
      locationTruth = (rawData.preferred_locations.truth_level as DataTruthLevel) || 'UNKNOWN';
      locationEvidence = rawData.preferred_locations.evidence || null;
    } else if (rawData.buying_intent?.preferred_locations) {
      preferredLocations = rawData.buying_intent.preferred_locations;
      locationTruth = (rawData.truth_summary?.preferred_locations as DataTruthLevel) || 'CONFIRMED';
      locationEvidence = preferredLocations.join(', ');
    }

    let primaryPropertyType: string | null = null;
    if (rawData.primary_property_type && typeof rawData.primary_property_type === 'object' && 'value' in rawData.primary_property_type) {
      primaryPropertyType = rawData.primary_property_type.value;
    } else if (rawData.buying_intent?.property_type) {
      primaryPropertyType = rawData.buying_intent.property_type;
    }

    let primaryConfig: string | null = null;
    if (rawData.primary_configuration && typeof rawData.primary_configuration === 'object' && 'value' in rawData.primary_configuration) {
      primaryConfig = rawData.primary_configuration.value;
    } else if (rawData.buying_intent?.configuration) {
      primaryConfig = rawData.buying_intent.configuration;
    }

    let primaryPurpose: string | null = null;
    if (rawData.purpose && typeof rawData.purpose === 'object' && 'value' in rawData.purpose) {
      primaryPurpose = rawData.purpose.value;
    } else if (rawData.buying_intent?.purpose) {
      primaryPurpose = rawData.buying_intent.purpose;
    }

    const requirements = Array.isArray(rawData.requirements) ? rawData.requirements : [];

    // 5. Decision Maker
    let decisionMakerVal: any = null;
    let decisionMakerTruth: DataTruthLevel = 'UNKNOWN';
    let decisionMakerEvidence: string | null = null;

    if (rawData.decision_maker && typeof rawData.decision_maker === 'object' && 'value' in rawData.decision_maker) {
      decisionMakerVal = rawData.decision_maker.value;
      decisionMakerTruth = (rawData.decision_maker.truth_level as DataTruthLevel) || 'UNKNOWN';
      decisionMakerEvidence = rawData.decision_maker.evidence || null;
    } else if (rawData.buying_intent?.decision_maker !== undefined) {
      decisionMakerVal = rawData.buying_intent.decision_maker;
      decisionMakerTruth = (rawData.truth_summary?.decision_maker as DataTruthLevel) || 'UNKNOWN';
    }

    // ==========================================
    // DIMENSION 1: BUYER INTENT (Weight: 25 / Max: 25)
    // ==========================================
    let intentPoints = 0;
    const intentReasonCodes: string[] = [];
    let intentExplanation = '';

    if (isInterested === true) {
      if (intentTruth === 'CONFIRMED') {
        intentPoints = 25;
        intentReasonCodes.push('INTENT_ACTIVE', 'INTENT_CONFIRMED');
        intentExplanation = 'Buyer explicitly confirmed active desire and search to purchase property.';
      } else if (intentTruth === 'INFERRED') {
        intentPoints = 18;
        intentReasonCodes.push('INTENT_INFERRED');
        intentExplanation = 'Buyer interest inferred from contextual property inquiries.';
      } else {
        intentPoints = 15;
        intentReasonCodes.push('INTENT_EXPLORATORY');
        intentExplanation = 'Buyer expressed general exploratory interest.';
      }
    } else if (isInterested === false) {
      intentPoints = 0;
      intentTruth = 'CONFIRMED';
      intentReasonCodes.push('INTENT_DISCONFIRMED');
      intentExplanation = 'Buyer explicitly declined or disconfirmed interest in buying property.';
    } else {
      intentPoints = 0;
      intentReasonCodes.push('INTENT_UNKNOWN', 'INTENT_UNCLEAR');
      intentExplanation = 'Buyer intent was unknown or unspecified in the transcript.';
    }

    const compIntent: ScoreComponent = {
      dimension: 'buyer_intent',
      max_points: 25,
      awarded_points: intentPoints,
      state: intentTruth,
      reason_codes: intentReasonCodes,
      evidence_refs: intentEvidence ? [intentEvidence] : [],
      explanation: intentExplanation,
      weight: 0.25,
      raw_score: Math.round((intentPoints / 25) * 100),
      weighted_score: intentPoints,
      confidence: getConfidenceFromTruth(intentTruth),
      truth_level: intentTruth,
      evidence: intentEvidence,
    };

    // ==========================================
    // DIMENSION 2: BUDGET CLARITY (Weight: 15 / Max: 15)
    // ==========================================
    let budgetPoints = 0;
    const budgetReasonCodes: string[] = [];
    let budgetExplanation = '';

    if (bMin != null && bMax != null && bMin > bMax) {
      budgetPoints = 0;
      isConflicted = true;
      budgetTruth = 'UNKNOWN';
      budgetReasonCodes.push('BUDGET_CONTRADICTORY', 'BUDGET_UNRESOLVED');
      budgetExplanation = `Contradictory budget range specified: min (${bMin}) > max (${bMax}).`;
    } else if (bMin != null && bMax != null && bMin > 0 && bMax > 0) {
      budgetPoints = 15;
      budgetTruth = budgetTruth === 'UNKNOWN' ? 'CONFIRMED' : budgetTruth;
      budgetReasonCodes.push('BUDGET_EXPLICIT', 'BUDGET_RANGE_CONFIRMED');
      budgetExplanation = `Confirmed explicit budget bracket (₹${(bMin / 100000).toFixed(0)}L to ₹${(bMax / 10000000).toFixed(2)}Cr).`;
    } else if ((bMin != null && bMin > 0) || (bMax != null && bMax > 0)) {
      budgetPoints = 12;
      budgetTruth = budgetTruth === 'UNKNOWN' ? 'CONFIRMED' : budgetTruth;
      budgetReasonCodes.push('BUDGET_EXPLICIT', 'BUDGET_APPROXIMATE');
      budgetExplanation = `Single explicit budget threshold stated (${bMin ? `min ₹${bMin}` : `max ₹${bMax}`}).`;
    } else {
      budgetPoints = 0;
      budgetTruth = 'UNKNOWN';
      budgetReasonCodes.push('BUDGET_UNKNOWN', 'BUDGET_UNRESOLVED');
      budgetExplanation = 'Budget unresolved / depends on area; no explicit numeric values confirmed.';
    }

    const compBudget: ScoreComponent = {
      dimension: 'budget_clarity',
      max_points: 15,
      awarded_points: budgetPoints,
      state: isConflicted ? 'UNKNOWN' : budgetTruth,
      reason_codes: budgetReasonCodes,
      evidence_refs: budgetEvidence ? [budgetEvidence] : [],
      explanation: budgetExplanation,
      weight: 0.15,
      raw_score: Math.round((budgetPoints / 15) * 100),
      weighted_score: budgetPoints,
      confidence: getConfidenceFromTruth(isConflicted ? 'CONFLICTED' : budgetTruth),
      truth_level: budgetTruth,
      evidence: budgetEvidence,
    };

    // ==========================================
    // DIMENSION 3: LOCATION CLARITY (Weight: 15 / Max: 15)
    // ==========================================
    let locationPoints = 0;
    const locationReasonCodes: string[] = [];
    let locationExplanation = '';

    const locCount = preferredLocations.length;
    const hasMicroLocation =
      preferredLocations.some((loc) =>
        ['chatti kila', 'chhatikara', 'vip road', 'raman reti', 'nh-19', 'mathura road', 'iskcon', 'sunrakh'].some((m) =>
          loc.toLowerCase().includes(m)
        )
      ) || (locCount >= 2 && preferredLocations.some((l) => l.toLowerCase().includes('vrindavan')));

    if (locationTruth === 'CONFIRMED' && locCount > 0) {
      if (hasMicroLocation || locCount >= 2) {
        locationPoints = 15;
        locationReasonCodes.push('LOCATION_CONFIRMED', 'LOCATION_MICRO_CONFIRMED');
        locationExplanation = `Specific locality and micro-location confirmed by buyer: ${preferredLocations.join(', ')}.`;
      } else {
        locationPoints = 10;
        locationReasonCodes.push('LOCATION_CONFIRMED', 'LOCATION_CITY_KNOWN');
        locationExplanation = `Target city/locality confirmed: ${preferredLocations.join(', ')}.`;
      }
    } else if (locCount > 0) {
      locationPoints = 6;
      locationReasonCodes.push('LOCATION_BROAD');
      locationExplanation = `Broad area preference identified (${preferredLocations.join(', ')}).`;
    } else {
      locationPoints = 0;
      locationReasonCodes.push('LOCATION_UNKNOWN');
      locationExplanation = 'No target location specified or confirmed.';
    }

    const compLocation: ScoreComponent = {
      dimension: 'location_clarity',
      max_points: 15,
      awarded_points: locationPoints,
      state: locationTruth,
      reason_codes: locationReasonCodes,
      evidence_refs: locationEvidence ? [locationEvidence] : preferredLocations,
      explanation: locationExplanation,
      weight: 0.15,
      raw_score: Math.round((locationPoints / 15) * 100),
      weighted_score: locationPoints,
      confidence: getConfidenceFromTruth(locationTruth),
      truth_level: locationTruth,
      evidence: locationEvidence,
    };

    // ==========================================
    // DIMENSION 4: TIMELINE (Weight: 15 / Max: 15)
    // ==========================================
    let timelinePoints = 0;
    const timelineReasonCodes: string[] = [];
    let timelineExplanation = '';

    const tLower = (timelineVal || '').toLowerCase();
    if (
      tLower.includes('asap') ||
      tLower.includes('as soon as possible') ||
      tLower.includes('immediate') ||
      tLower.includes('ready to move') ||
      tLower.includes('1 month') ||
      tLower.includes('2 weeks') ||
      tLower.includes('this month')
    ) {
      timelinePoints = 15;
      timelineTruth = 'CONFIRMED';
      timelineReasonCodes.push('TIMELINE_ASAP', 'TIMELINE_CONFIRMED');
      timelineExplanation = `High readiness purchase timeline (${timelineVal || 'ASAP'}).`;
    } else if (tLower.includes('1-3') || tLower.includes('2-3 months') || tLower.includes('3 months') || tLower.includes('near term')) {
      timelinePoints = 12;
      timelineTruth = 'CONFIRMED';
      timelineReasonCodes.push('TIMELINE_NEAR_TERM', 'TIMELINE_CONFIRMED');
      timelineExplanation = `Near-term purchase timeline (${timelineVal}).`;
    } else if (tLower.includes('3-6') || tLower.includes('6 months') || tLower.includes('under construction')) {
      timelinePoints = 8;
      timelineTruth = 'CONFIRMED';
      timelineReasonCodes.push('TIMELINE_MID_TERM');
      timelineExplanation = `Mid-term purchase timeline (${timelineVal}).`;
    } else if (tLower.includes('1 year') || tLower.includes('1-2') || tLower.includes('1 to 2') || tLower.includes('6-12') || tLower.includes('next year') || tLower.includes('long')) {
      timelinePoints = 4;
      timelineTruth = 'CONFIRMED';
      timelineReasonCodes.push('TIMELINE_LONG_TERM');
      timelineExplanation = `Long-term purchase timeline (${timelineVal}).`;
    } else if (tLower.includes('2+') || tLower.includes('2+ year') || tLower.includes('3 year') || tLower.includes('distant') || tLower.includes('exploring')) {
      timelinePoints = 2;
      timelineTruth = 'CONFIRMED';
      timelineReasonCodes.push('TIMELINE_DISTANT');
      timelineExplanation = `Distant timeline (${timelineVal}). Low near-term conversion urgency.`;
    } else if (timelineVal && timelineVal.trim().length > 0 && timelineVal.toLowerCase() !== 'unknown') {
      timelinePoints = 6;
      timelineTruth = 'INFERRED';
      timelineReasonCodes.push('TIMELINE_INFERRED');
      timelineExplanation = `General timeline indicated: ${timelineVal}.`;
    } else {
      timelinePoints = 0;
      timelineTruth = 'UNKNOWN';
      timelineReasonCodes.push('TIMELINE_UNKNOWN');
      timelineExplanation = 'Purchase timeline unknown or unspecified.';
    }

    const compTimeline: ScoreComponent = {
      dimension: 'timeline',
      max_points: 15,
      awarded_points: timelinePoints,
      state: timelineTruth,
      reason_codes: timelineReasonCodes,
      evidence_refs: timelineEvidence ? [timelineEvidence] : [],
      explanation: timelineExplanation,
      weight: 0.15,
      raw_score: Math.round((timelinePoints / 15) * 100),
      weighted_score: timelinePoints,
      confidence: getConfidenceFromTruth(timelineTruth),
      truth_level: timelineTruth,
      evidence: timelineEvidence,
    };

    // ==========================================
    // DIMENSION 5: PROJECT FIT (Weight: 10 / Max: 10)
    // Transparently PENDING in Phase 5D (Phase 5E not implemented)
    // ==========================================
    const compProjectFit: ScoreComponent = {
      dimension: 'project_fit',
      max_points: 10,
      awarded_points: 0,
      state: 'PENDING',
      reason_codes: ['PROJECT_FIT_PENDING'],
      evidence_refs: [],
      explanation: 'Phase 5E project matching engine pending. No project fit data fabricated in Phase 5D.',
      weight: 0.1,
      raw_score: 0,
      weighted_score: 0,
      confidence: 0.5,
      truth_level: 'UNKNOWN',
      evidence: null,
    };

    // ==========================================
    // DIMENSION 6: DECISION AUTHORITY (Weight: 10 / Max: 10)
    // ==========================================
    let decisionPoints = 0;
    const decisionReasonCodes: string[] = [];
    let decisionExplanation = '';

    const evLower = (decisionMakerEvidence || '').toLowerCase();
    const isJointText =
      evLower.includes('family') ||
      evLower.includes('wife') ||
      evLower.includes('husband') ||
      evLower.includes('partner') ||
      evLower.includes('discuss');

    if (decisionMakerVal === true && decisionMakerTruth === 'CONFIRMED' && !isJointText) {
      decisionPoints = 10;
      decisionReasonCodes.push('DECISION_MAKER_CONFIRMED');
      decisionExplanation = 'Buyer confirmed as sole primary decision maker.';
    } else if (isJointText || decisionMakerVal === 'joint' || decisionMakerVal === false) {
      decisionPoints = 5;
      decisionMakerTruth = 'KNOWN';
      decisionReasonCodes.push('JOINT_DECISION');
      decisionExplanation = 'Joint decision maker involved (e.g. family consultation required).';
    } else if (decisionMakerVal === 'influencer') {
      decisionPoints = 3;
      decisionReasonCodes.push('INFLUENCER');
      decisionExplanation = 'Buyer acts as influencer / preliminary researcher.';
    } else {
      decisionPoints = 0;
      decisionMakerTruth = 'UNKNOWN';
      decisionReasonCodes.push('DECISION_AUTHORITY_UNKNOWN');
      decisionExplanation = 'Decision authority not verified.';
    }

    const compDecision: ScoreComponent = {
      dimension: 'decision_authority',
      max_points: 10,
      awarded_points: decisionPoints,
      state: decisionMakerTruth,
      reason_codes: decisionReasonCodes,
      evidence_refs: decisionMakerEvidence ? [decisionMakerEvidence] : [],
      explanation: decisionExplanation,
      weight: 0.1,
      raw_score: Math.round((decisionPoints / 10) * 100),
      weighted_score: decisionPoints,
      confidence: getConfidenceFromTruth(decisionMakerTruth),
      truth_level: decisionMakerTruth,
      evidence: decisionMakerEvidence,
    };

    // ==========================================
    // DIMENSION 7: CONTACTABILITY (Weight: 5 / Max: 5)
    // ==========================================
    let contactPoints = 0;
    const contactReasonCodes: string[] = [];
    let contactExplanation = '';

    const callDuration = call?.duration_seconds ?? 0;
    const callStatus = call?.status;

    if (callStatus === 'COMPLETED' || callDuration >= 60 || rawData.interested !== undefined) {
      contactPoints = 5;
      contactReasonCodes.push('CALL_COMPLETED', 'CONTACTABILITY_HIGH');
      contactExplanation = `Qualification call completed successfully (${callDuration > 0 ? `${callDuration}s duration` : 'verified'}).`;
    } else if (callDuration > 0 || callStatus === 'IN_PROGRESS' || callStatus === 'ANSWERED') {
      contactPoints = 3;
      contactReasonCodes.push('PARTIAL_INTERACTION');
      contactExplanation = 'Partial call interaction logged.';
    } else {
      contactPoints = 0;
      contactReasonCodes.push('CONTACTABILITY_LOW', 'CONTACTABILITY_UNKNOWN');
      contactExplanation = 'No completed interactive voice session recorded.';
    }

    const compContact: ScoreComponent = {
      dimension: 'contactability',
      max_points: 5,
      awarded_points: contactPoints,
      state: 'CONFIRMED',
      reason_codes: contactReasonCodes,
      evidence_refs: call ? [`call:${call.id}`] : [],
      explanation: contactExplanation,
      weight: 0.05,
      raw_score: Math.round((contactPoints / 5) * 100),
      weighted_score: contactPoints,
      confidence: 1.0,
      truth_level: 'CONFIRMED',
      evidence: call ? `Duration: ${call.duration_seconds}s` : null,
    };

    // ==========================================
    // DIMENSION 8: DATA FRESHNESS (Weight: 5 / Max: 5)
    // ==========================================
    let freshnessPoints = 0;
    const freshnessReasonCodes: string[] = [];
    let freshnessExplanation = '';

    const callTime = call?.started_at ? new Date(call.started_at).getTime() : timestamp;
    const ageHours = (timestamp - callTime) / (1000 * 60 * 60);

    if (ageHours <= 24) {
      freshnessPoints = 5;
      freshnessReasonCodes.push('FRESH_CALL_DATA');
      freshnessExplanation = 'Intelligence captured within the last 24 hours.';
    } else if (ageHours <= 168) {
      // 7 days
      freshnessPoints = 4;
      freshnessReasonCodes.push('RECENT_ENRICHMENT');
      freshnessExplanation = 'Intelligence captured within the last 7 days.';
    } else if (ageHours <= 720) {
      // 30 days
      freshnessPoints = 2;
      freshnessReasonCodes.push('MODERATE_AGE');
      freshnessExplanation = 'Intelligence is moderate in age (7 to 30 days old).';
    } else {
      freshnessPoints = 0;
      freshnessReasonCodes.push('STALE_DATA');
      freshnessExplanation = 'Intelligence is older than 30 days (stale data).';
    }

    const compFreshness: ScoreComponent = {
      dimension: 'data_freshness',
      max_points: 5,
      awarded_points: freshnessPoints,
      state: 'KNOWN',
      reason_codes: freshnessReasonCodes,
      evidence_refs: [],
      explanation: freshnessExplanation,
      weight: 0.05,
      raw_score: Math.round((freshnessPoints / 5) * 100),
      weighted_score: freshnessPoints,
      confidence: 0.95,
      truth_level: 'KNOWN',
      evidence: `Age: ${Math.max(0, Math.round(ageHours))} hours`,
    };

    // ==========================================
    // AGGREGATE 0-100 TOTAL SCORE
    // ==========================================
    const components: ScoreComponent[] = [
      compIntent,
      compBudget,
      compLocation,
      compTimeline,
      compProjectFit,
      compDecision,
      compContact,
      compFreshness,
    ];

    let totalScore = components.reduce((sum, c) => sum + c.awarded_points, 0);
    totalScore = Math.max(0, Math.min(100, Math.round(totalScore)));

    const scoringConfidence = Number(
      (
        0.25 * compIntent.confidence! +
        0.15 * compBudget.confidence! +
        0.15 * compLocation.confidence! +
        0.15 * compTimeline.confidence! +
        0.1 * compProjectFit.confidence! +
        0.1 * compDecision.confidence! +
        0.05 * compContact.confidence! +
        0.05 * compFreshness.confidence!
      ).toFixed(3)
    );

    // ==========================================
    // SCORE STATUS & REVIEW BOUNDARIES
    // ==========================================
    let scoreStatus: ScoreStatus = 'CALCULATED';

    if (qualStatus === 'REQUIRES_REVIEW' || isConflicted) {
      scoreStatus = 'REQUIRES_REVIEW';
      totalScore = Math.min(totalScore, 20);
    }

    // ==========================================
    // SCORE BANDS & TIERS (Frozen Thresholds)
    // 90-100 = HOT, 70-89 = WARM, 0-69 = NURTURE
    // ==========================================
    let tier: LeadTier = 'TIER_3_NURTURE';
    let scoreBand: ScoreBand = 'NURTURE';

    if (scoreStatus === 'REQUIRES_REVIEW' || qualStatus === 'REQUIRES_REVIEW' || isConflicted) {
      tier = 'TIER_4_REVIEW';
      scoreBand = 'REVIEW';
      scoreStatus = 'REQUIRES_REVIEW';
    } else if (qualStatus === 'NURTURE' || intentPoints === 0) {
      tier = 'TIER_3_NURTURE';
      scoreBand = 'NURTURE';
    } else if (totalScore >= 90 && qualStatus === 'QUALIFIED') {
      tier = 'TIER_1_HOT';
      scoreBand = 'HOT';
    } else if (totalScore >= 70) {
      tier = 'TIER_2_WARM';
      scoreBand = 'WARM';
    } else {
      tier = 'TIER_3_NURTURE';
      scoreBand = 'NURTURE';
    }

    // ==========================================
    // ALL REASON CODES, DRIVERS, & RISKS
    // ==========================================
    const allReasonCodes = components.flatMap((c) => c.reason_codes);
    if (scoreStatus === 'REQUIRES_REVIEW') {
      allReasonCodes.push('QUALIFICATION_REQUIRES_REVIEW');
    }

    const keyDrivers: string[] = [];
    const riskFactors: string[] = [];

    if (intentPoints >= 20) keyDrivers.push('Strong active buying intent confirmed by buyer');
    if (timelinePoints >= 12) keyDrivers.push(`High conversion velocity (${timelineVal || 'Immediate'})`);
    if (budgetPoints >= 12) keyDrivers.push(`Confirmed numeric budget parameters`);
    if (locationPoints >= 12) keyDrivers.push(`Specific micro-locations confirmed (${preferredLocations.join(', ')})`);
    if (requirements.length > 1) {
      keyDrivers.push(`Multi-requirement buyer with secondary portfolio interest (${requirements.length} requirements identified)`);
    }

    if (budgetPoints === 0) riskFactors.push(`Commercial budget certainty pending numeric confirmation (currently "${bRawExpr || 'unresolved'}")`);
    if (!financing || financing.toLowerCase() === 'unknown') riskFactors.push('Financing modality (self-funded vs loan) unconfirmed');
    if (decisionPoints === 0) riskFactors.push('Decision maker authority unverified');
    if (scoreStatus === 'REQUIRES_REVIEW') {
      riskFactors.push('Contradictory or unresolved extraction parameters require supervisor audit');
    }

    // ==========================================
    // SLA DISPATCH RULES
    // ==========================================
    const now = Date.now();
    let slaMinutes = 120;
    let assignedRole: SLAPriorityDispatch['assigned_role'] = 'INBOUND_SALES_SPECIALIST';
    let routingAction: SLAPriorityDispatch['routing_action'] = 'SCHEDULED_CALLBACK';
    let followUpUrgency: FollowUpUrgency = 'HIGH';
    let recommendedAction = '';
    let priorityRank = 50;

    const followUpFields = qualification?.follow_up_fields || ['budget', 'financing'];

    if (tier === 'TIER_1_HOT') {
      slaMinutes = 15;
      assignedRole = 'SENIOR_SALES_ADVISOR';
      routingAction = 'IMMEDIATE_PHONE_DISPATCH';
      followUpUrgency = 'CRITICAL';
      priorityRank = 1;
      recommendedAction = `Immediate dispatch to Senior Advisor within 15 mins. Buyer has confirmed budget and ASAP timeline.`;
    } else if (tier === 'TIER_2_WARM') {
      slaMinutes = 120; // 2 hours
      assignedRole = 'INBOUND_SALES_SPECIALIST';
      routingAction = 'SCHEDULED_CALLBACK';
      followUpUrgency = 'HIGH';
      priorityRank = 2;
      recommendedAction = `Targeted follow-up within 2 hours. High intent with urgent timeline; clarify exact budget range and financing structure for ${preferredLocations.join(', ') || 'preferred area'}.`;
    } else if (tier === 'TIER_3_NURTURE') {
      slaMinutes = 1440; // 24 hours
      assignedRole = 'AUTOMATED_NURTURE_WORKFLOW';
      routingAction = 'NURTURE_DRIP_CAMPAIGN';
      followUpUrgency = 'MEDIUM';
      priorityRank = 3;
      recommendedAction = 'Enroll in automated drip campaigns with market reports and inventory updates for Vrindavan.';
    } else {
      slaMinutes = 0; // Manual review
      assignedRole = 'SALES_SUPERVISOR_REVIEW';
      routingAction = 'MANUAL_INTELLIGENCE_AUDIT';
      followUpUrgency = 'LOW';
      priorityRank = 4;
      recommendedAction = 'Flagged for supervisor audit due to data inconsistency or disconfirmed interest.';
    }

    const slaDeadline = new Date(now + slaMinutes * 60 * 1000).toISOString();

    // Talking points for sales team
    const talkingPoints: string[] = [];
    if (preferredLocations.length > 0) {
      talkingPoints.push(`Focus on available units in ${preferredLocations.join(', ')}.`);
    }
    if (primaryConfig) {
      talkingPoints.push(`Present matched ${primaryConfig} configurations matching purpose: ${primaryPurpose || 'Self-use'}.`);
    }
    if (requirements.length > 1) {
      const secondReq = requirements[1];
      talkingPoints.push(`Inquire if buyer would also like details for secondary requirement: ${secondReq?.property_type || 'Farmhouse'} (${secondReq?.notes || 'Investment'}).`);
    }
    if (followUpFields.includes('budget') || budgetPoints === 0) {
      talkingPoints.push(`Gently establish budget expectation ("Area-based pricing typically starts from ₹45L–₹1.2Cr in this corridor").`);
    }
    if (followUpFields.includes('financing')) {
      talkingPoints.push('Ask if they have pre-approved loan or prefer developer self-funding / milestone payment plans.');
    }

    const slaDispatch: SLAPriorityDispatch = {
      tier,
      sla_minutes: slaMinutes,
      sla_deadline: slaDeadline,
      priority_rank: priorityRank,
      assigned_role: assignedRole,
      routing_action: routingAction,
      recommended_action: recommendedAction,
      talking_points: talkingPoints,
      follow_up_urgency: followUpUrgency,
      follow_up_fields: followUpFields,
    };

    return {
      score: totalScore,
      composite_score: totalScore,
      total_score: totalScore,
      scoring_confidence: scoringConfidence,
      tier,
      score_band: scoreBand,
      score_status: scoreStatus,
      dimension_scores: {
        buyer_intent: intentPoints,
        budget_clarity: budgetPoints,
        location_clarity: locationPoints,
        timeline: timelinePoints,
        project_fit: 0,
        decision_authority: decisionPoints,
        contactability: contactPoints,
        data_freshness: freshnessPoints,
        // Legacy aliases
        intent_engagement: compIntent.raw_score || 0,
        commercial_readiness: compBudget.raw_score || 0,
        velocity_urgency: compTimeline.raw_score || 0,
        requirement_clarity: locationPoints >= 10 ? 90 : 50,
      },
      components,
      breakdown: components,
      key_drivers: keyDrivers,
      risk_factors: riskFactors,
      reason_codes: allReasonCodes,
      sla_dispatch: slaDispatch,
      project_fit_status: 'PENDING',
      rule_version: SCORING_RULE_VERSION,
      scoring_version: SCORING_SCHEMA_VERSION,
      calculated_at: new Date().toISOString(),
    };
  }
}

export const scoringRulesEngine = new ScoringRulesEngine();
