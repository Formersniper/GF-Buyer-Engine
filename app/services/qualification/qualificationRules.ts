/**
 * GrowthForge Buyer Intelligence Engine - Phase 5C Qualification Rules Engine
 *
 * Source of Truth: Formersniper/GF-Buyer-Engine
 *
 * Implements strict, deterministic, auditable business rules to evaluate
 * extracted conversation data, authoritative lead context, and enrichment records.
 *
 * ARCHITECTURAL INVARIANT:
 * Zero subjective AI reasoning for qualification.
 * Qualification is computed purely from structured extracted evidence + deterministic rules.
 */

import {
  ExtractedBuyerIntelligence,
  ExtractedRequirement,
} from '../../schemas/extraction';
import { Lead } from '../../schemas/database';
import {
  BuyerQualificationStatus,
  QualificationReasonCode,
  DimensionAssessment,
  EvidenceRef,
  QUALIFICATION_RULE_VERSION,
  QUALIFICATION_SCHEMA_VERSION,
} from '../../schemas/qualification';

export interface EvaluatedQualification {
  status: BuyerQualificationStatus;
  reason_codes: QualificationReasonCode[];
  blocking_fields: string[];
  follow_up_fields: string[];
  dimension_assessments: Record<string, DimensionAssessment>;
  evidence_refs: EvidenceRef[];
  rule_version: string;
  qualification_version: string;
}

export class QualificationRulesEngine {
  /**
   * Main deterministic evaluation function
   */
  public evaluate(params: {
    extractedData: ExtractedBuyerIntelligence | null;
    lead?: Lead | null;
    extractionStatus?: string;
  }): EvaluatedQualification {
    const { extractedData, lead, extractionStatus } = params;

    const reasonCodes: QualificationReasonCode[] = [];
    const blockingFields: string[] = [];
    const followUpFields: string[] = [];
    const dimensionAssessments: Record<string, DimensionAssessment> = {};
    const evidenceRefs: EvidenceRef[] = [];

    // ---------------------------------------------------------
    // GUARD 1: Extraction Data Presence & Integrity
    // ---------------------------------------------------------
    if (!extractedData || extractionStatus === 'EXTRACTION_FAILED') {
      reasonCodes.push('EXTRACTION_DATA_INVALID');
      return {
        status: 'REQUIRES_REVIEW',
        reason_codes: reasonCodes,
        blocking_fields: ['extraction_data'],
        follow_up_fields: ['call_transcript', 'extraction_data'],
        dimension_assessments: {
          active_intent: {
            dimension: 'active_intent',
            status: 'UNRESOLVED',
            truth_level: 'UNKNOWN',
            summary: 'Extraction data is missing or extraction failed',
            evidence: null,
          },
        },
        evidence_refs: [],
        rule_version: QUALIFICATION_RULE_VERSION,
        qualification_version: QUALIFICATION_SCHEMA_VERSION,
      };
    }

    // ---------------------------------------------------------
    // DIMENSION 1: Active Buying Intent
    // ---------------------------------------------------------
    const interested = extractedData.interested;
    let intentStatus: DimensionAssessment['status'] = 'UNRESOLVED';

    if (interested && (interested.truth_level === 'CONFIRMED' || interested.truth_level === 'KNOWN')) {
      if (interested.value === true) {
        intentStatus = 'SATISFIED';
        reasonCodes.push('ACTIVE_INTENT_CONFIRMED');
        if (interested.evidence) {
          evidenceRefs.push({
            field: 'interested',
            text: interested.evidence,
            truth_level: interested.truth_level,
          });
        }
      } else if (interested.value === false) {
        intentStatus = 'DISQUALIFYING';
        reasonCodes.push('ACTIVE_INTENT_DISCONFIRMED');
        if (interested.evidence) {
          evidenceRefs.push({
            field: 'interested',
            text: interested.evidence,
            truth_level: interested.truth_level,
          });
        }
      } else {
        intentStatus = 'UNRESOLVED';
        reasonCodes.push('ACTIVE_INTENT_UNKNOWN');
      }
    } else {
      intentStatus = 'UNRESOLVED';
      reasonCodes.push('ACTIVE_INTENT_UNKNOWN');
    }

    dimensionAssessments.active_intent = {
      dimension: 'active_intent',
      status: intentStatus,
      truth_level: interested?.truth_level ?? 'UNKNOWN',
      summary:
        interested?.value === true
          ? 'Buyer demonstrated active property interest'
          : interested?.value === false
          ? 'Buyer explicitly declined or confirmed no interest'
          : 'Buyer interest is unconfirmed or unknown',
      evidence: interested?.evidence ?? null,
    };

    // ---------------------------------------------------------
    // DIMENSION 2: Property Type & Requirements
    // ---------------------------------------------------------
    const primaryType = extractedData.primary_property_type;
    const requirements = extractedData.requirements || [];
    let propertyStatus: DimensionAssessment['status'] = 'UNRESOLVED';

    const hasConfirmedPrimaryType =
      primaryType &&
      (primaryType.truth_level === 'CONFIRMED' || primaryType.truth_level === 'KNOWN') &&
      Boolean(primaryType.value);

    const hasConfirmedRequirementType = requirements.some(
      (r) => (r.truth_level === 'CONFIRMED' || r.truth_level === 'KNOWN') && Boolean(r.property_type)
    );

    if (hasConfirmedPrimaryType || hasConfirmedRequirementType) {
      propertyStatus = 'SATISFIED';
      reasonCodes.push('REQUIREMENT_CONFIRMED');
      if (primaryType?.evidence) {
        evidenceRefs.push({
          field: 'primary_property_type',
          text: primaryType.evidence,
          truth_level: primaryType.truth_level,
        });
      }
    } else if (primaryType?.value) {
      propertyStatus = 'PARTIALLY_SATISFIED';
      reasonCodes.push('REQUIREMENT_PARTIAL');
    } else {
      propertyStatus = 'UNRESOLVED';
      reasonCodes.push('REQUIREMENT_UNKNOWN');
      followUpFields.push('property_type');
    }

    dimensionAssessments.property_type = {
      dimension: 'property_type',
      status: propertyStatus,
      truth_level: primaryType?.truth_level ?? 'UNKNOWN',
      summary: primaryType?.value
        ? `Primary property type: ${primaryType.value}`
        : 'Property type requirement is unresolved',
      evidence: primaryType?.evidence ?? null,
    };

    // Multi-requirement detection
    if (requirements.length > 1) {
      reasonCodes.push('MULTI_REQUIREMENT_DETECTED');
    }

    // ---------------------------------------------------------
    // DIMENSION 3: Configuration & Space
    // ---------------------------------------------------------
    const primaryConfig = extractedData.primary_configuration;
    let configStatus: DimensionAssessment['status'] = 'UNRESOLVED';

    const hasConfirmedConfig =
      primaryConfig &&
      (primaryConfig.truth_level === 'CONFIRMED' || primaryConfig.truth_level === 'KNOWN') &&
      Boolean(primaryConfig.value);

    const hasRequirementConfigOrArea = requirements.some(
      (r) =>
        (r.truth_level === 'CONFIRMED' || r.truth_level === 'KNOWN') &&
        (Boolean(r.configuration) || (r.land_area && Boolean(r.land_area.min || r.land_area.max)))
    );

    if (hasConfirmedConfig || hasRequirementConfigOrArea) {
      configStatus = 'SATISFIED';
      reasonCodes.push('CONFIGURATION_CONFIRMED');
      if (primaryConfig?.evidence) {
        evidenceRefs.push({
          field: 'primary_configuration',
          text: primaryConfig.evidence,
          truth_level: primaryConfig.truth_level,
        });
      }
    } else if (primaryConfig?.value) {
      configStatus = 'PARTIALLY_SATISFIED';
    } else {
      configStatus = 'UNRESOLVED';
      reasonCodes.push('CONFIGURATION_UNKNOWN');
      followUpFields.push('configuration');
    }

    dimensionAssessments.configuration = {
      dimension: 'configuration',
      status: configStatus,
      truth_level: primaryConfig?.truth_level ?? 'UNKNOWN',
      summary: primaryConfig?.value
        ? `Configuration: ${primaryConfig.value}`
        : 'Configuration is unresolved',
      evidence: primaryConfig?.evidence ?? null,
    };

    // ---------------------------------------------------------
    // DIMENSION 4: Preferred Locations
    // ---------------------------------------------------------
    const locations = extractedData.preferred_locations;
    let locationStatus: DimensionAssessment['status'] = 'UNRESOLVED';

    const hasConfirmedLocation =
      locations &&
      (locations.truth_level === 'CONFIRMED' || locations.truth_level === 'KNOWN') &&
      Array.isArray(locations.value) &&
      locations.value.length > 0;

    if (hasConfirmedLocation) {
      locationStatus = 'SATISFIED';
      reasonCodes.push('LOCATION_CONFIRMED');
      if (locations.evidence) {
        evidenceRefs.push({
          field: 'preferred_locations',
          text: locations.evidence,
          truth_level: locations.truth_level,
        });
      }
    } else if (Array.isArray(locations?.value) && locations.value.length > 0) {
      locationStatus = 'PARTIALLY_SATISFIED';
    } else {
      locationStatus = 'UNRESOLVED';
      reasonCodes.push('LOCATION_UNKNOWN');
      followUpFields.push('preferred_locations');
    }

    dimensionAssessments.location = {
      dimension: 'location',
      status: locationStatus,
      truth_level: locations?.truth_level ?? 'UNKNOWN',
      summary:
        locations?.value && locations.value.length > 0
          ? `Preferred locations: ${locations.value.join(', ')}`
          : 'Preferred location is unresolved',
      evidence: locations?.evidence ?? null,
    };

    // ---------------------------------------------------------
    // DIMENSION 5: Purpose
    // ---------------------------------------------------------
    const purpose = extractedData.purpose;
    let purposeStatus: DimensionAssessment['status'] = 'UNRESOLVED';

    const hasConfirmedPurpose =
      purpose &&
      (purpose.truth_level === 'CONFIRMED' || purpose.truth_level === 'KNOWN') &&
      purpose.value &&
      purpose.value !== 'unknown';

    if (hasConfirmedPurpose) {
      purposeStatus = 'SATISFIED';
      reasonCodes.push('PURPOSE_CONFIRMED');
      if (purpose.evidence) {
        evidenceRefs.push({
          field: 'purpose',
          text: purpose.evidence,
          truth_level: purpose.truth_level,
        });
      }
    } else {
      purposeStatus = 'UNRESOLVED';
      reasonCodes.push('PURPOSE_UNKNOWN');
      followUpFields.push('purpose');
    }

    dimensionAssessments.purpose = {
      dimension: 'purpose',
      status: purposeStatus,
      truth_level: purpose?.truth_level ?? 'UNKNOWN',
      summary:
        purpose?.value && purpose.value !== 'unknown'
          ? `Purchase purpose: ${purpose.value}`
          : 'Purpose is unresolved',
      evidence: purpose?.evidence ?? null,
    };

    // ---------------------------------------------------------
    // DIMENSION 6: Timeline & Readiness
    // ---------------------------------------------------------
    const timeline = extractedData.timeline;
    let timelineStatus: DimensionAssessment['status'] = 'UNRESOLVED';

    const hasConfirmedTimeline =
      timeline &&
      (timeline.truth_level === 'CONFIRMED' || timeline.truth_level === 'KNOWN') &&
      Boolean(timeline.value);

    if (hasConfirmedTimeline) {
      const lower = (timeline.value || '').toLowerCase();
      if (
        lower.includes('distant') ||
        lower.includes('next year') ||
        lower.includes('2 year') ||
        lower.includes('just exploring') ||
        lower.includes('not immediate')
      ) {
        timelineStatus = 'PARTIALLY_SATISFIED';
        reasonCodes.push('TIMELINE_DISTANT');
      } else {
        timelineStatus = 'SATISFIED';
        reasonCodes.push('TIMELINE_CONFIRMED');
      }
      if (timeline.evidence) {
        evidenceRefs.push({
          field: 'timeline',
          text: timeline.evidence,
          truth_level: timeline.truth_level,
        });
      }
    } else {
      timelineStatus = 'UNRESOLVED';
      reasonCodes.push('TIMELINE_UNKNOWN');
      followUpFields.push('timeline');
    }

    dimensionAssessments.timeline = {
      dimension: 'timeline',
      status: timelineStatus,
      truth_level: timeline?.truth_level ?? 'UNKNOWN',
      summary: timeline?.value ? `Timeline: ${timeline.value}` : 'Timeline is unresolved',
      evidence: timeline?.evidence ?? null,
    };

    // ---------------------------------------------------------
    // DIMENSION 7: Budget Readiness
    // ---------------------------------------------------------
    const budget = extractedData.budget;
    let budgetStatus: DimensionAssessment['status'] = 'UNRESOLVED';

    const hasConfirmedNumericBudget =
      budget &&
      (budget.truth_level === 'CONFIRMED' || budget.truth_level === 'KNOWN') &&
      (budget.min !== null || budget.max !== null);

    if (hasConfirmedNumericBudget) {
      budgetStatus = 'SATISFIED';
      reasonCodes.push('BUDGET_CONFIRMED');
      if (budget.evidence) {
        evidenceRefs.push({
          field: 'budget',
          text: budget.evidence,
          truth_level: budget.truth_level,
        });
      }
    } else {
      budgetStatus = 'UNRESOLVED';
      reasonCodes.push('BUDGET_MISSING');
      blockingFields.push('budget');
      followUpFields.push('budget');
    }

    dimensionAssessments.budget = {
      dimension: 'budget',
      status: budgetStatus,
      truth_level: budget?.truth_level ?? 'UNKNOWN',
      summary:
        budget?.min !== null || budget?.max !== null
          ? `Budget: ${budget.min ? `Min ${budget.min}` : ''} ${budget.max ? `Max ${budget.max}` : ''} ${budget.currency}`
          : 'Budget is unresolved or dependent on location/specs',
      evidence: budget?.evidence ?? null,
    };

    // ---------------------------------------------------------
    // DIMENSION 8: Financing Readiness
    // ---------------------------------------------------------
    const financing = extractedData.financing;
    let financingStatus: DimensionAssessment['status'] = 'UNRESOLVED';

    const hasConfirmedFinancing =
      financing &&
      (financing.truth_level === 'CONFIRMED' || financing.truth_level === 'KNOWN') &&
      Boolean(financing.value);

    if (hasConfirmedFinancing) {
      financingStatus = 'SATISFIED';
      reasonCodes.push('FINANCING_CONFIRMED');
      if (financing.evidence) {
        evidenceRefs.push({
          field: 'financing',
          text: financing.evidence,
          truth_level: financing.truth_level,
        });
      }
    } else {
      financingStatus = 'UNRESOLVED';
      reasonCodes.push('FINANCING_UNKNOWN');
      followUpFields.push('financing');
    }

    dimensionAssessments.financing = {
      dimension: 'financing',
      status: financingStatus,
      truth_level: financing?.truth_level ?? 'UNKNOWN',
      summary: financing?.value ? `Financing: ${financing.value}` : 'Financing is unresolved',
      evidence: financing?.evidence ?? null,
    };

    // ---------------------------------------------------------
    // DIMENSION 9: Decision Authority
    // ---------------------------------------------------------
    const decisionMaker = extractedData.decision_maker;
    let dmStatus: DimensionAssessment['status'] = 'UNRESOLVED';

    const hasConfirmedDecisionMaker =
      decisionMaker &&
      (decisionMaker.truth_level === 'CONFIRMED' || decisionMaker.truth_level === 'KNOWN') &&
      decisionMaker.value !== null;

    if (hasConfirmedDecisionMaker) {
      dmStatus = 'SATISFIED';
      reasonCodes.push('DECISION_MAKER_CONFIRMED');
      if (decisionMaker.evidence) {
        evidenceRefs.push({
          field: 'decision_maker',
          text: decisionMaker.evidence,
          truth_level: decisionMaker.truth_level,
        });
      }
    } else {
      dmStatus = 'UNRESOLVED';
      reasonCodes.push('DECISION_MAKER_UNKNOWN');
      followUpFields.push('decision_maker');
    }

    dimensionAssessments.decision_maker = {
      dimension: 'decision_maker',
      status: dmStatus,
      truth_level: decisionMaker?.truth_level ?? 'UNKNOWN',
      summary:
        decisionMaker?.value !== null && decisionMaker?.value !== undefined
          ? `Decision Maker: ${decisionMaker.value}`
          : 'Decision maker authority is unresolved',
      evidence: decisionMaker?.evidence ?? null,
    };

    // ---------------------------------------------------------
    // DIMENSION 10: Contact Readiness
    // ---------------------------------------------------------
    if (lead && !lead.phone) {
      reasonCodes.push('MISSING_CONTACT_INFO');
      blockingFields.push('phone');
    }

    // ---------------------------------------------------------
    // CONTRADICTION CHECK
    // ---------------------------------------------------------
    const hasContradiction = this.detectContradictions(extractedData);
    if (hasContradiction) {
      reasonCodes.push('CONTRADICTION_DETECTED');
      return {
        status: 'REQUIRES_REVIEW',
        reason_codes: reasonCodes,
        blocking_fields: ['contradiction'],
        follow_up_fields: ['manual_review'],
        dimension_assessments: dimensionAssessments,
        evidence_refs: evidenceRefs,
        rule_version: QUALIFICATION_RULE_VERSION,
        qualification_version: QUALIFICATION_SCHEMA_VERSION,
      };
    }

    // ---------------------------------------------------------
    // DETERMINISTIC DECISION RULES
    // ---------------------------------------------------------
    // Rule 1: Explicit Disinterest / Non-buyer
    if (intentStatus === 'DISQUALIFYING') {
      return {
        status: 'NURTURE',
        reason_codes: reasonCodes,
        blocking_fields: ['buyer_intent'],
        follow_up_fields: [],
        dimension_assessments: dimensionAssessments,
        evidence_refs: evidenceRefs,
        rule_version: QUALIFICATION_RULE_VERSION,
        qualification_version: QUALIFICATION_SCHEMA_VERSION,
      };
    }

    // Rule 2: Unconfirmed / Unknown Interest with no actionable specs
    if (
      intentStatus === 'UNRESOLVED' &&
      locationStatus === 'UNRESOLVED' &&
      propertyStatus === 'UNRESOLVED'
    ) {
      return {
        status: 'NURTURE',
        reason_codes: reasonCodes,
        blocking_fields: ['buyer_intent', 'property_type', 'location'],
        follow_up_fields: ['buyer_intent', 'property_type', 'location'],
        dimension_assessments: dimensionAssessments,
        evidence_refs: evidenceRefs,
        rule_version: QUALIFICATION_RULE_VERSION,
        qualification_version: QUALIFICATION_SCHEMA_VERSION,
      };
    }

    // Rule 3: Distant timeline with weak/vague requirements
    if (
      reasonCodes.includes('TIMELINE_DISTANT') &&
      (locationStatus === 'UNRESOLVED' || propertyStatus === 'UNRESOLVED')
    ) {
      return {
        status: 'NURTURE',
        reason_codes: reasonCodes,
        blocking_fields: ['timeline', 'property_type'],
        follow_up_fields: ['timeline', 'property_type'],
        dimension_assessments: dimensionAssessments,
        evidence_refs: evidenceRefs,
        rule_version: QUALIFICATION_RULE_VERSION,
        qualification_version: QUALIFICATION_SCHEMA_VERSION,
      };
    }

    // Rule 4: Full QUALIFIED Check
    // Requirements for full QUALIFIED:
    // - Active buying intent is CONFIRMED (true)
    // - Location is CONFIRMED
    // - Requirement / Property Type is CONFIRMED
    // - Configuration is CONFIRMED
    // - Timeline is CONFIRMED
    // - Budget is CONFIRMED (numeric range known)
    // - No unresolved critical commercial blockers
    const isFullQualified =
      intentStatus === 'SATISFIED' &&
      locationStatus === 'SATISFIED' &&
      propertyStatus === 'SATISFIED' &&
      configStatus === 'SATISFIED' &&
      timelineStatus === 'SATISFIED' &&
      budgetStatus === 'SATISFIED';

    if (isFullQualified) {
      return {
        status: 'QUALIFIED',
        reason_codes: reasonCodes,
        blocking_fields: [],
        follow_up_fields: followUpFields.filter((f) => f !== 'budget'),
        dimension_assessments: dimensionAssessments,
        evidence_refs: evidenceRefs,
        rule_version: QUALIFICATION_RULE_VERSION,
        qualification_version: QUALIFICATION_SCHEMA_VERSION,
      };
    }

    // Rule 5: PARTIALLY_QUALIFIED Check
    // Genuine intent is evident / confirmed, core property requirements or location are known,
    // but commercial information (budget, financing, decision maker) or specific attributes remain unresolved.
    if (intentStatus === 'SATISFIED') {
      const coreRequirementsKnown =
        locationStatus === 'SATISFIED' ||
        propertyStatus === 'SATISFIED' ||
        configStatus === 'SATISFIED' ||
        timelineStatus === 'SATISFIED';

      if (coreRequirementsKnown) {
        return {
          status: 'PARTIALLY_QUALIFIED',
          reason_codes: reasonCodes,
          blocking_fields: blockingFields,
          follow_up_fields: Array.from(new Set(followUpFields)),
          dimension_assessments: dimensionAssessments,
          evidence_refs: evidenceRefs,
          rule_version: QUALIFICATION_RULE_VERSION,
          qualification_version: QUALIFICATION_SCHEMA_VERSION,
        };
      }
    }

    // Rule 6: Fallback for any other ambiguous state
    return {
      status: 'NURTURE',
      reason_codes: reasonCodes,
      blocking_fields: blockingFields,
      follow_up_fields: Array.from(new Set(followUpFields)),
      dimension_assessments: dimensionAssessments,
      evidence_refs: evidenceRefs,
      rule_version: QUALIFICATION_RULE_VERSION,
      qualification_version: QUALIFICATION_SCHEMA_VERSION,
    };
  }

  /**
   * Helper to detect material contradictions in extraction data
   */
  private detectContradictions(data: ExtractedBuyerIntelligence): boolean {
    // 1. Contradiction: interested is explicitly false, but timeline is "immediate / as soon as possible" and budget is explicitly stated
    if (data.interested?.value === false && data.timeline?.value && data.budget?.min !== null) {
      return true;
    }

    // 2. Contradiction: min budget is higher than max budget
    if (
      data.budget?.min !== null &&
      data.budget?.max !== null &&
      data.budget.min > data.budget.max
    ) {
      return true;
    }

    return false;
  }
}

export const qualificationRulesEngine = new QualificationRulesEngine();
