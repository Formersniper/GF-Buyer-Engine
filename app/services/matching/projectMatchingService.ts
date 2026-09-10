/**
 * GrowthForge Buyer Intelligence Engine - Phase 5E Project Matching Service
 *
 * Source of Truth: Formersniper/GF-Buyer-Engine
 * Orchestrates deterministic matching of buyer requirements against the structured project catalog,
 * ensures idempotency, audit trail event recording in `lead_events`, and returns ranked recommendations.
 */

import {
  ProjectMatchingInput,
  ProjectMatchingResult,
  ProjectRecommendation,
  MATCHING_RULE_VERSION,
  PROJECT_CATALOG_VERSION,
} from '../../schemas/matching';
import { supabaseDataService } from '../supabase/repositories';
import {
  ProjectMatchingRulesEngine,
  projectMatchingRulesEngine,
  BuyerMatchingRequirement,
} from './projectMatchingRules';
import { SAMPLE_PROJECT_CATALOG } from '../data/sampleProjects';
import { DbProject, DbProjectMatch } from '../../schemas/database';

export class ProjectMatchingService {
  private rulesEngine: ProjectMatchingRulesEngine;

  constructor(rulesEngine: ProjectMatchingRulesEngine = projectMatchingRulesEngine) {
    this.rulesEngine = rulesEngine;
  }

  /**
   * Matches buyer requirements against the project catalog.
   */
  public async matchBuyerRequirements(input: ProjectMatchingInput): Promise<ProjectMatchingResult> {
    const {
      leadId,
      qualificationId,
      extractionId,
      ruleVersion = MATCHING_RULE_VERSION,
      catalogVersion = PROJECT_CATALOG_VERSION,
      forceRematch = false,
    } = input;

    const calculated_at = new Date().toISOString();

    // 1. Verify Lead existence
    const lead = await supabaseDataService.leads.getLead(leadId);
    if (!lead) {
      return {
        success: false,
        action: 'LEAD_NOT_FOUND',
        lead_id: leadId,
        total_recommendations: 0,
        recommendations: [],
        matching_version: ruleVersion,
        rule_version: ruleVersion,
        catalog_version: catalogVersion,
        calculated_at,
        error: `Lead with id ${leadId} not found.`,
      };
    }

    // 2. Fetch Buyer Qualification & Extractions
    let qualification = qualificationId
      ? await supabaseDataService.qualifications.getQualification(qualificationId)
      : null;

    if (!qualification) {
      const qualifications = await supabaseDataService.qualifications.getQualificationsByLeadId(leadId);
      qualification = qualifications.length > 0 ? qualifications[qualifications.length - 1] : null;
    }

    let extraction = extractionId
      ? await supabaseDataService.extractions.getExtraction(extractionId)
      : null;

    if (!extraction && qualification?.extraction_id) {
      extraction = await supabaseDataService.extractions.getExtraction(qualification.extraction_id);
    }

    if (!extraction) {
      const extractions = await supabaseDataService.extractions.getExtractionsByLeadId(leadId);
      extraction = extractions.length > 0 ? extractions[extractions.length - 1] : null;
    }

    // 3. Ensure Project Catalog is seeded & available
    let allProjects = await supabaseDataService.projects.listProjects({ limit: 100 });
    if (allProjects.length === 0) {
      for (const p of SAMPLE_PROJECT_CATALOG) {
        await supabaseDataService.projects.createProject(p);
      }
      allProjects = await supabaseDataService.projects.listProjects({ limit: 100 });
    }

    if (allProjects.length === 0) {
      return {
        success: false,
        action: 'NO_ACTIVE_PROJECTS',
        lead_id: leadId,
        qualification_id: qualification?.id || null,
        total_recommendations: 0,
        recommendations: [],
        matching_version: ruleVersion,
        rule_version: ruleVersion,
        catalog_version: catalogVersion,
        calculated_at,
        error: 'No active projects available in catalog.',
      };
    }

    // 4. Check Idempotency (Existing Matches)
    if (!forceRematch) {
      const existingMatches = await supabaseDataService.projectMatches.getProjectMatches(leadId);
      if (existingMatches && existingMatches.length > 0) {
        // Hydrate existing matches to ProjectRecommendation format
        const formatted = this.hydrateExistingMatches(existingMatches, allProjects);
        if (formatted.length > 0) {
          return {
            success: true,
            action: 'EXISTING_MATCHES',
            lead_id: leadId,
            qualification_id: qualification?.id || null,
            total_recommendations: formatted.length,
            recommendations: formatted,
            matching_version: ruleVersion,
            rule_version: ruleVersion,
            catalog_version: catalogVersion,
            calculated_at,
          };
        }
      }
    }

    // Record MATCHING_STARTED Audit Event
    await supabaseDataService.leadEvents.appendLeadEvent({
      lead_id: leadId,
      event_type: 'PROJECT_MATCHING_STARTED',
      event_data: {
        qualification_id: qualification?.id || null,
        extraction_id: extraction?.id || null,
        rule_version: ruleVersion,
        catalog_version: catalogVersion,
        total_candidate_projects: allProjects.length,
      },
    });

    // 5. Build structured buyer requirements
    const buyerRequirements = this.extractBuyerRequirements(qualification, extraction);

    // 6. Evaluate all candidate projects for each buyer requirement
    const allRecommendations: ProjectRecommendation[] = [];

    for (const req of buyerRequirements) {
      const reqRecommendations: ProjectRecommendation[] = [];

      for (const proj of allProjects) {
        const rec = this.rulesEngine.evaluateProjectFit(req, proj, {
          leadId,
          qualificationId: qualification?.id || undefined,
        });
        reqRecommendations.push(rec);
      }

      // Sort by match_score DESC, then location_score DESC, budget_score DESC, project_name ASC
      reqRecommendations.sort((a, b) => {
        if (b.match_score !== a.match_score) return b.match_score - a.match_score;
        if (b.dimension_scores.location !== a.dimension_scores.location) {
          return b.dimension_scores.location - a.dimension_scores.location;
        }
        if (b.dimension_scores.budget !== a.dimension_scores.budget) {
          return b.dimension_scores.budget - a.dimension_scores.budget;
        }
        return a.project_name.localeCompare(b.project_name);
      });

      // Assign ranks (1, 2, 3...)
      reqRecommendations.forEach((r, idx) => {
        r.rank = idx + 1;
      });

      allRecommendations.push(...reqRecommendations);
    }

    // 7. Persist Top Matches to Database (`project_matches` table)
    for (const rec of allRecommendations) {
      await supabaseDataService.projectMatches.upsertProjectMatch({
        lead_id: leadId,
        project_id: rec.project_id,
        match_score: rec.match_score,
        budget_score: rec.dimension_scores.budget,
        location_score: rec.dimension_scores.location,
        configuration_score: rec.dimension_scores.configuration,
        purpose_score: rec.dimension_scores.purpose,
        preference_score: rec.dimension_scores.preferences,
        timeline_score: rec.dimension_scores.timeline,
        buyer_confirmed: false, // FROZEN RULE: recommendation != confirmation
        reason: {
          match_band: rec.match_band,
          rank: rec.rank,
          requirement_id: rec.requirement_id,
          requirement_summary: rec.requirement_summary,
          key_matches: rec.key_matches,
          gaps: rec.gaps,
          risks: rec.risks,
          components: rec.components,
          dimension_scores: rec.dimension_scores,
          rule_version: rec.rule_version,
          catalog_version: rec.catalog_version,
        },
      });
    }

    // 8. Record MATCHING_COMPLETED Audit Event
    const topMatch = allRecommendations[0];
    await supabaseDataService.leadEvents.appendLeadEvent({
      lead_id: leadId,
      event_type: 'PROJECT_MATCHING_COMPLETED',
      event_data: {
        qualification_id: qualification?.id || null,
        total_recommendations: allRecommendations.length,
        top_project_id: topMatch?.project_id,
        top_project_name: topMatch?.project_name,
        top_match_score: topMatch?.match_score,
        top_match_band: topMatch?.match_band,
        rule_version: ruleVersion,
      },
    });

    return {
      success: true,
      action: 'MATCHED',
      lead_id: leadId,
      qualification_id: qualification?.id || null,
      total_recommendations: allRecommendations.length,
      recommendations: allRecommendations,
      matching_version: ruleVersion,
      rule_version: ruleVersion,
      catalog_version: catalogVersion,
      calculated_at,
    };
  }

  /**
   * Retrieves matches for a lead.
   */
  public async getMatchesForLead(leadId: string): Promise<ProjectRecommendation[]> {
    const existing = await supabaseDataService.projectMatches.getProjectMatches(leadId);
    const projects = await supabaseDataService.projects.listProjects({ limit: 100 });
    return this.hydrateExistingMatches(existing, projects);
  }

  /**
   * Helper: Parse structured buyer requirements from Qualification and Extraction.
   */
  public extractBuyerRequirements(
    qualification: any,
    extraction: any
  ): BuyerMatchingRequirement[] {
    const ext = extraction?.extracted_data;
    const qual = qualification;

    // Check if multiple explicit requirements exist
    const multiReqs =
      (Array.isArray(qual?.requirements_breakdown) && qual.requirements_breakdown.length > 1
        ? qual.requirements_breakdown
        : null) ||
      (Array.isArray(ext?.requirements) && ext.requirements.length > 1 ? ext.requirements : null) ||
      (Array.isArray(ext?.buying_intent?.requirements_breakdown) && ext.buying_intent.requirements_breakdown.length > 1
        ? ext.buying_intent.requirements_breakdown
        : null);

    if (Array.isArray(multiReqs) && multiReqs.length > 1) {
      return multiReqs.map((req: any, index: number) => {
        const configVal =
          req.configuration ||
          (req.land_area ? `${req.land_area.min}-${req.land_area.max} ${req.land_area.unit}` : null) ||
          ext?.primary_configuration?.value ||
          ext?.buying_intent?.configuration?.value ||
          qual?.configuration ||
          null;

        const locs =
          (Array.isArray(req.preferred_locations) ? req.preferred_locations : null) ||
          (Array.isArray(ext?.preferred_locations?.value) ? ext.preferred_locations.value : null) ||
          (Array.isArray(ext?.buying_intent?.preferred_locations?.value) ? ext.buying_intent.preferred_locations.value : null) ||
          (Array.isArray(qual?.preferred_locations) ? qual.preferred_locations : []) ||
          [];

        const prefs =
          (Array.isArray(ext?.stated_preferences?.value) ? ext.stated_preferences.value : null) ||
          (Array.isArray(ext?.buying_intent?.preferences?.value) ? ext.buying_intent.preferences.value : null) ||
          (Array.isArray(ext?.preferences?.value) ? ext.preferences.value : null) ||
          (Array.isArray(qual?.preferences) ? qual.preferences : []) ||
          [];

        return {
          id: `req-${index + 1}`,
          requirement_index: index + 1,
          property_type: req.property_type || ext?.primary_property_type?.value || ext?.buying_intent?.property_type?.value || qual?.property_type || null,
          configuration: configVal,
          purpose: req.purpose || ext?.purpose?.value || ext?.buying_intent?.purpose?.value || qual?.purpose || null,
          budget_min: req.budget_min ?? ext?.budget?.min ?? ext?.buying_intent?.budget?.value?.min ?? qual?.budget_min ?? null,
          budget_max: req.budget_max ?? ext?.budget?.max ?? ext?.buying_intent?.budget?.value?.max ?? qual?.budget_max ?? null,
          currency: req.currency || ext?.budget?.currency || ext?.buying_intent?.budget?.value?.currency || qual?.currency || 'INR',
          budget_truth_level: req.budget_truth_level || ext?.budget?.truth_level || ext?.buying_intent?.budget?.truth_level || qual?.budget_truth_level || 'UNKNOWN',
          preferred_locations: locs,
          location_truth_level: ext?.preferred_locations?.truth_level || ext?.buying_intent?.preferred_locations?.truth_level || qual?.location_truth_level || 'UNKNOWN',
          timeline: req.timeline || ext?.timeline?.value || ext?.buying_intent?.timeline?.value || qual?.timeline || null,
          timeline_truth_level: ext?.timeline?.truth_level || ext?.buying_intent?.timeline?.truth_level || qual?.timeline_truth_level || 'UNKNOWN',
          preferences: prefs,
          explicit_preferences: prefs,
        };
      });
    }

    const singleLocs =
      (Array.isArray(ext?.preferred_locations?.value) ? ext.preferred_locations.value : null) ||
      (Array.isArray(ext?.buying_intent?.preferred_locations?.value) ? ext.buying_intent.preferred_locations.value : null) ||
      (Array.isArray(qual?.preferred_locations) ? qual.preferred_locations : []) ||
      [];

    const singlePrefs =
      (Array.isArray(ext?.stated_preferences?.value) ? ext.stated_preferences.value : null) ||
      (Array.isArray(ext?.buying_intent?.preferences?.value) ? ext.buying_intent.preferences.value : null) ||
      (Array.isArray(ext?.preferences?.value) ? ext.preferences.value : null) ||
      (Array.isArray(qual?.preferences) ? qual.preferences : []) ||
      [];

    const singleConfig =
      ext?.primary_configuration?.value ||
      ext?.buying_intent?.configuration?.value ||
      (ext?.requirements?.[0]?.land_area
        ? `${ext.requirements[0].land_area.min}-${ext.requirements[0].land_area.max} ${ext.requirements[0].land_area.unit}`
        : null) ||
      qual?.configuration ||
      null;

    return [
      {
        id: 'req-1',
        requirement_index: 1,
        property_type:
          ext?.primary_property_type?.value ||
          ext?.buying_intent?.property_type?.value ||
          ext?.requirements?.[0]?.property_type ||
          qual?.property_type ||
          null,
        configuration: singleConfig,
        purpose:
          ext?.purpose?.value ||
          ext?.buying_intent?.purpose?.value ||
          ext?.requirements?.[0]?.purpose ||
          qual?.purpose ||
          null,
        budget_min: ext?.budget?.min ?? ext?.buying_intent?.budget?.value?.min ?? qual?.budget_min ?? null,
        budget_max: ext?.budget?.max ?? ext?.buying_intent?.budget?.value?.max ?? qual?.budget_max ?? null,
        currency: ext?.budget?.currency || ext?.buying_intent?.budget?.value?.currency || qual?.currency || 'INR',
        budget_truth_level: ext?.budget?.truth_level || ext?.buying_intent?.budget?.truth_level || qual?.budget_truth_level || 'UNKNOWN',
        preferred_locations: singleLocs,
        location_truth_level: ext?.preferred_locations?.truth_level || ext?.buying_intent?.preferred_locations?.truth_level || qual?.location_truth_level || 'UNKNOWN',
        timeline: ext?.timeline?.value || ext?.buying_intent?.timeline?.value || qual?.timeline || null,
        timeline_truth_level: ext?.timeline?.truth_level || ext?.buying_intent?.timeline?.truth_level || qual?.timeline_truth_level || 'UNKNOWN',
        preferences: singlePrefs,
        explicit_preferences: singlePrefs,
      },
    ];
  }

  private hydrateExistingMatches(matches: DbProjectMatch[], projects: DbProject[]): ProjectRecommendation[] {
    const projectMap = new Map(projects.map((p) => [p.id, p]));

    return matches.map((m, idx) => {
      const p = projectMap.get(m.project_id);
      const reasonData = (m.reason as any) || {};

      return {
        id: m.id,
        lead_id: m.lead_id,
        project_id: m.project_id,
        project_code: p?.project_code || 'PROJ-UNK',
        project_name: p?.project_name || 'Project Name',
        developer_name: p?.developer_name || null,
        city: p?.city || null,
        locality: p?.locality || null,
        micro_market: p?.micro_market || null,
        property_type: p?.property_type || null,
        configurations: p?.configurations || null,
        price_min: p?.price_min || null,
        price_max: p?.price_max || null,
        possession: p?.possession || null,
        match_score: Number(m.match_score) || 0,
        match_band: reasonData.match_band || this.rulesEngine.calculateMatchBand(Number(m.match_score) || 0),
        rank: reasonData.rank || idx + 1,
        dimension_scores: {
          budget: Number(m.budget_score) || 0,
          location: Number(m.location_score) || 0,
          configuration: Number(m.configuration_score) || 0,
          property_type: reasonData.dimension_scores?.property_type || 0,
          purpose: Number(m.purpose_score) || 0,
          timeline: Number(m.timeline_score) || 0,
          preferences: Number(m.preference_score) || 0,
          project_attributes: reasonData.dimension_scores?.project_attributes || 0,
        },
        components: reasonData.components || [],
        key_matches: reasonData.key_matches || [],
        gaps: reasonData.gaps || [],
        risks: reasonData.risks || [],
        buyer_confirmed: m.buyer_confirmed || false,
        project_fit_status: 'CALCULATED',
        recommendation_status: 'AI_RECOMMENDED',
        matching_version: reasonData.rule_version || MATCHING_RULE_VERSION,
        rule_version: reasonData.rule_version || MATCHING_RULE_VERSION,
        catalog_version: reasonData.catalog_version || PROJECT_CATALOG_VERSION,
        calculated_at: m.created_at,
        created_at: m.created_at,
        updated_at: m.created_at,
      };
    });
  }
}

export const projectMatchingService = new ProjectMatchingService();
