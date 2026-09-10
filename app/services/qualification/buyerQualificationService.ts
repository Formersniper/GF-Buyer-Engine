/**
 * GrowthForge Buyer Intelligence Engine - Phase 5C Buyer Qualification Service
 *
 * Source of Truth: Formersniper/GF-Buyer-Engine
 *
 * Coordinates:
 * 1. Extraction record retrieval from Supabase
 * 2. Deterministic qualification rule evaluation via QualificationRulesEngine
 * 3. Epistemic truth preservation
 * 4. Idempotency and versioning (rule_version, qualification_version)
 * 5. Structured persistence in buyer_qualifications table
 * 6. Audit logging to lead_events
 */

import { supabaseDataService } from '../supabase/repositories';
import {
  BuyerQualification,
  QualificationResult,
  QUALIFICATION_RULE_VERSION,
  QUALIFICATION_SCHEMA_VERSION,
} from '../../schemas/qualification';
import { qualificationRulesEngine } from './qualificationRules';

export class BuyerQualificationService {
  public readonly serviceName = 'BuyerQualificationService';

  /**
   * Qualifies an extracted conversation by extraction ID
   */
  public async qualifyExtraction(params: {
    extractionId: string;
    forceRequalify?: boolean;
    ruleVersion?: string;
  }): Promise<QualificationResult> {
    const { extractionId, forceRequalify = false, ruleVersion = QUALIFICATION_RULE_VERSION } = params;

    try {
      // 1. Check for existing qualification if not forcing requalification (Idempotency)
      if (!forceRequalify) {
        const existing = await supabaseDataService.qualifications.getQualificationByExtractionId(
          extractionId,
          ruleVersion
        );
        if (existing) {
          await supabaseDataService.leadEvents.appendLeadEvent({
            lead_id: existing.lead_id,
            event_type: 'QUALIFICATION_DUPLICATE',
            event_data: {
              qualification_id: existing.id,
              extraction_id: extractionId,
              qualification_status: existing.qualification_status,
              rule_version: ruleVersion,
            },
          });

          return {
            success: true,
            action: 'EXISTING_QUALIFICATION',
            qualificationId: existing.id,
            qualification: existing,
          };
        }
      }

      // 2. Fetch the conversation extraction
      const extraction = await supabaseDataService.extractions.getExtraction(extractionId);
      if (!extraction) {
        return {
          success: false,
          action: 'EXTRACTION_NOT_FOUND',
          error: `Extraction record not found for id: ${extractionId}`,
        };
      }

      // 3. Fetch lead details
      const lead = await supabaseDataService.leads.getLead(extraction.lead_id);

      // 4. Log qualification started event
      await supabaseDataService.leadEvents.appendLeadEvent({
        lead_id: extraction.lead_id,
        event_type: 'QUALIFICATION_STARTED',
        event_data: {
          extraction_id: extraction.id,
          call_id: extraction.call_id,
          lead_id: extraction.lead_id,
          rule_version: ruleVersion,
        },
      });

      // 5. Run deterministic qualification rules engine
      const evaluated = qualificationRulesEngine.evaluate({
        extractedData: extraction.extracted_data,
        lead: lead || undefined,
        extractionStatus: extraction.extraction_status,
      });

      // 6. Persist qualification result
      const qualificationRecord = await supabaseDataService.qualifications.createQualification({
        lead_id: extraction.lead_id,
        extraction_id: extraction.id,
        qualification_status: evaluated.status,
        reason_codes: evaluated.reason_codes,
        blocking_fields: evaluated.blocking_fields,
        follow_up_fields: evaluated.follow_up_fields,
        dimension_assessments: evaluated.dimension_assessments,
        evidence_refs: evaluated.evidence_refs,
        qualification_version: QUALIFICATION_SCHEMA_VERSION,
        rule_version: ruleVersion,
      });

      // 7. Update lead status if applicable
      if (lead) {
        let newLeadStatus = lead.status;
        if (evaluated.status === 'QUALIFIED') {
          newLeadStatus = 'QUALIFIED';
        } else if (evaluated.status === 'PARTIALLY_QUALIFIED') {
          newLeadStatus = 'QUALIFICATION_IN_PROGRESS';
        } else if (evaluated.status === 'NURTURE') {
          newLeadStatus = 'NURTURE';
        } else if (evaluated.status === 'REQUIRES_REVIEW') {
          newLeadStatus = 'REQUIRES_REVIEW';
        }

        if (newLeadStatus !== lead.status) {
          await supabaseDataService.leads.updateLead(lead.id, {
            status: newLeadStatus,
          });
        }
      }

      // 8. Audit event for qualification outcome
      const auditEventType =
        evaluated.status === 'REQUIRES_REVIEW'
          ? 'QUALIFICATION_REQUIRES_REVIEW'
          : 'QUALIFICATION_COMPLETED';

      await supabaseDataService.leadEvents.appendLeadEvent({
        lead_id: extraction.lead_id,
        event_type: auditEventType,
        event_data: {
          qualification_id: qualificationRecord.id,
          extraction_id: extraction.id,
          qualification_status: evaluated.status,
          reason_codes: evaluated.reason_codes,
          blocking_fields: evaluated.blocking_fields,
          follow_up_fields: evaluated.follow_up_fields,
          rule_version: ruleVersion,
        },
      });

      return {
        success: true,
        action: evaluated.status as QualificationResult['action'],
        qualificationId: qualificationRecord.id,
        qualification: qualificationRecord,
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      return {
        success: false,
        action: 'QUALIFICATION_FAILED',
        error: errorMsg,
      };
    }
  }

  /**
   * Qualifies the latest extraction for a given lead ID
   */
  public async qualifyLead(params: {
    leadId: string;
    forceRequalify?: boolean;
    ruleVersion?: string;
  }): Promise<QualificationResult> {
    const { leadId, forceRequalify = false, ruleVersion = QUALIFICATION_RULE_VERSION } = params;

    const extractions = await supabaseDataService.extractions.getExtractionsByLeadId(leadId);
    if (!extractions || extractions.length === 0) {
      return {
        success: false,
        action: 'EXTRACTION_NOT_FOUND',
        error: `No extractions found for lead id: ${leadId}`,
      };
    }

    // Pick the most recent extraction
    const latestExtraction = extractions[extractions.length - 1];

    return this.qualifyExtraction({
      extractionId: latestExtraction.id,
      forceRequalify,
      ruleVersion,
    });
  }
}

export const buyerQualificationService = new BuyerQualificationService();
