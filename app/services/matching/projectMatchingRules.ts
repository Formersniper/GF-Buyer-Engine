/**
 * GrowthForge Buyer Intelligence Engine - Phase 5E Deterministic Project Matching Rules
 *
 * Source of Truth: Formersniper/GF-Buyer-Engine
 * Frozen matching weights (Total = 100%):
 * - Budget:             25% (25 points)
 * - Location:           25% (25 points)
 * - Configuration:      15% (15 points)
 * - Property Type:      10% (10 points)
 * - Purpose:            10% (10 points)
 * - Timeline:            5% (5 points)
 * - Preferences:         5% (5 points)
 * - Project Attributes:  5% (5 points)
 *
 * Match Bands:
 * - 80–100: STRONG
 * - 60–79:  GOOD
 * - 40–59:  POSSIBLE
 * - 0–39:   WEAK
 */

import {
  ProjectMatchBand,
  ProjectMatchComponent,
  ProjectMatchDimension,
  ProjectRecommendation,
  MATCHING_RULE_VERSION,
  PROJECT_CATALOG_VERSION,
} from '../../schemas/matching';
import { DbProject } from '../../schemas/database';
import { ExtractedBuyerIntelligence } from '../../schemas/extraction';

export interface BuyerMatchingRequirement {
  id?: string;
  requirement_index?: number;
  property_type: string | null;
  configuration: string | null;
  purpose: string | null;
  budget_min: number | null;
  budget_max: number | null;
  currency: string;
  budget_truth_level: string;
  preferred_locations: string[];
  location_truth_level: string;
  timeline: string | null;
  timeline_truth_level: string;
  preferences: string[];
  explicit_preferences: string[];
}

export class ProjectMatchingRulesEngine {
  public static readonly RULE_VERSION = MATCHING_RULE_VERSION;
  public static readonly CATALOG_VERSION = PROJECT_CATALOG_VERSION;

  /**
   * Evaluates a single buyer requirement against a candidate project.
   */
  public evaluateProjectFit(
    requirement: BuyerMatchingRequirement,
    project: DbProject,
    options?: { leadId?: string; qualificationId?: string; rank?: number }
  ): ProjectRecommendation {
    const components: ProjectMatchComponent[] = [];
    const key_matches: string[] = [];
    const gaps: string[] = [];
    const risks: string[] = [];

    // 1. Budget Matching (25 pts max)
    const budgetComponent = this.evaluateBudget(requirement, project, key_matches, gaps, risks);
    components.push(budgetComponent);

    // 2. Location Matching (25 pts max)
    const locationComponent = this.evaluateLocation(requirement, project, key_matches, gaps, risks);
    components.push(locationComponent);

    // 3. Configuration Matching (15 pts max)
    const configComponent = this.evaluateConfiguration(requirement, project, key_matches, gaps, risks);
    components.push(configComponent);

    // 4. Property Type Matching (10 pts max)
    const propTypeComponent = this.evaluatePropertyType(requirement, project, key_matches, gaps, risks);
    components.push(propTypeComponent);

    // 5. Purpose Matching (10 pts max)
    const purposeComponent = this.evaluatePurpose(requirement, project, key_matches, gaps, risks);
    components.push(purposeComponent);

    // 6. Timeline Matching (5 pts max)
    const timelineComponent = this.evaluateTimeline(requirement, project, key_matches, gaps, risks);
    components.push(timelineComponent);

    // 7. Preferences Matching (5 pts max)
    const prefsComponent = this.evaluatePreferences(requirement, project, key_matches, gaps, risks);
    components.push(prefsComponent);

    // 8. Project Attributes Matching (5 pts max)
    const attrComponent = this.evaluateProjectAttributes(requirement, project, key_matches, gaps, risks);
    components.push(attrComponent);

    // Calculate total score (bounded strictly to 0 - 100)
    const rawTotal = components.reduce((sum, c) => sum + c.awarded_points, 0);
    const match_score = Math.max(0, Math.min(100, Math.round(rawTotal)));

    // Determine Match Band
    const match_band = this.calculateMatchBand(match_score);

    const now = new Date().toISOString();

    const dimension_scores = {
      budget: budgetComponent.awarded_points,
      location: locationComponent.awarded_points,
      configuration: configComponent.awarded_points,
      property_type: propTypeComponent.awarded_points,
      purpose: purposeComponent.awarded_points,
      timeline: timelineComponent.awarded_points,
      preferences: prefsComponent.awarded_points,
      project_attributes: attrComponent.awarded_points,
    };

    const requirementSummary = [
      requirement.property_type || '',
      requirement.configuration || '',
      requirement.preferred_locations.join(', '),
    ]
      .filter(Boolean)
      .join(' | ');

    return {
      id: `rec-${project.id}-${requirement.requirement_index || 0}`,
      lead_id: options?.leadId || '',
      qualification_id: options?.qualificationId || null,
      requirement_id: requirement.id || `req-${requirement.requirement_index || 0}`,
      buyer_requirement_id: requirement.id || `req-${requirement.requirement_index || 0}`,
      requirement_index: requirement.requirement_index || 0,
      requirement_summary: requirementSummary,
      project_id: project.id,
      project_code: project.project_code,
      project_name: project.project_name,
      developer_name: project.developer_name,
      city: project.city,
      locality: project.locality,
      micro_market: project.micro_market,
      property_type: project.property_type,
      configurations: project.configurations,
      price_min: project.price_min,
      price_max: project.price_max,
      possession: project.possession,
      match_score,
      match_band,
      rank: options?.rank || 1,
      dimension_scores,
      components,
      key_matches,
      gaps,
      risks,
      buyer_confirmed: false, // FROZEN RULE: AI match != buyer confirmation
      project_fit_status: 'CALCULATED',
      recommendation_status: 'AI_RECOMMENDED',
      matching_version: ProjectMatchingRulesEngine.RULE_VERSION,
      rule_version: ProjectMatchingRulesEngine.RULE_VERSION,
      catalog_version: ProjectMatchingRulesEngine.CATALOG_VERSION,
      calculated_at: now,
      created_at: now,
      updated_at: now,
    };
  }

  /**
   * 1. Budget Matching (25 pts max)
   */
  private evaluateBudget(
    req: BuyerMatchingRequirement,
    project: DbProject,
    key_matches: string[],
    gaps: string[],
    risks: string[]
  ): ProjectMatchComponent {
    const isBudgetUnknown =
      (req.budget_min === null && req.budget_max === null) ||
      req.budget_truth_level === 'UNKNOWN';

    if (isBudgetUnknown) {
      gaps.push('Buyer budget not confirmed (budget pending)');
      return {
        dimension: 'budget',
        max_points: 25,
        awarded_points: 0,
        match_state: 'BUDGET_UNKNOWN',
        reason_codes: ['BUDGET_UNKNOWN', 'BUDGET_PENDING'],
        evidence_refs: ['buyer.budget.truth_level=UNKNOWN'],
        explanation: 'Buyer has not confirmed a numeric budget bracket; candidate is evaluated without budget penalty.',
      };
    }

    if (project.price_min === null && project.price_max === null) {
      gaps.push('Project pricing unverified in catalog');
      return {
        dimension: 'budget',
        max_points: 25,
        awarded_points: 0,
        match_state: 'DATA_INCOMPLETE',
        reason_codes: ['PROJECT_PRICE_MISSING'],
        evidence_refs: ['project.price_min=null', 'project.price_max=null'],
        explanation: 'Project price data is incomplete; budget fit cannot be verified.',
      };
    }

    const bMin = req.budget_min ?? 0;
    const bMax = req.budget_max ?? Number.MAX_SAFE_INTEGER;
    const pMin = project.price_min ?? 0;
    const pMax = project.price_max ?? Number.MAX_SAFE_INTEGER;

    // Check overlap: bMax >= pMin && bMin <= pMax
    const overlaps = bMax >= pMin && bMin <= pMax;

    if (overlaps) {
      // Full overlap vs partial overlap
      // Full overlap if project fits comfortably within buyer's range or spans the exact range
      const isFullFit = (project.price_min !== null && project.price_min <= bMax && (project.price_max === null || project.price_max <= bMax * 1.1)) ||
                        (project.price_max !== null && project.price_max >= bMin && project.price_min !== null && project.price_min >= bMin * 0.8);

      if (isFullFit) {
        key_matches.push(`Price range (${this.formatPriceRange(project.price_min, project.price_max)}) fits buyer budget`);
        return {
          dimension: 'budget',
          max_points: 25,
          awarded_points: 25,
          match_state: 'MATCH',
          reason_codes: ['WITHIN_BUDGET', 'BUDGET_FULL_OVERLAP'],
          evidence_refs: [`project.price=[${pMin}, ${pMax}]`, `buyer.budget=[${bMin}, ${bMax}]`],
          explanation: `Project pricing aligns with buyer budget bracket.`,
        };
      } else {
        key_matches.push(`Price range (${this.formatPriceRange(project.price_min, project.price_max)}) partially overlaps buyer budget`);
        return {
          dimension: 'budget',
          max_points: 25,
          awarded_points: 18,
          match_state: 'PARTIAL_MATCH',
          reason_codes: ['BUDGET_PARTIAL_OVERLAP'],
          evidence_refs: [`project.price=[${pMin}, ${pMax}]`, `buyer.budget=[${bMin}, ${bMax}]`],
          explanation: `Project pricing partially overlaps with buyer budget range.`,
        };
      }
    } else {
      // Budget Mismatch
      if (pMin > bMax) {
        gaps.push(`Project minimum price (${this.formatPrice(pMin)}) exceeds buyer budget maximum (${this.formatPrice(bMax)})`);
        if (pMin > bMax * 1.25) {
          risks.push(`Project price exceeds buyer stated maximum by >25%`);
        }
      } else if (pMax < bMin) {
        gaps.push(`Project price bracket is below buyer target luxury bracket`);
      }

      return {
        dimension: 'budget',
        max_points: 25,
        awarded_points: 0,
        match_state: 'MISMATCH',
        reason_codes: ['BUDGET_MISMATCH'],
        evidence_refs: [`project.price=[${pMin}, ${pMax}]`, `buyer.budget=[${bMin}, ${bMax}]`],
        explanation: `Project pricing does not overlap with buyer budget bracket.`,
      };
    }
  }

  /**
   * 2. Location Matching (25 pts max)
   */
  private evaluateLocation(
    req: BuyerMatchingRequirement,
    project: DbProject,
    key_matches: string[],
    gaps: string[],
    risks: string[]
  ): ProjectMatchComponent {
    if (!project.city && !project.locality && !project.micro_market) {
      gaps.push('Project location details incomplete');
      return {
        dimension: 'location',
        max_points: 25,
        awarded_points: 0,
        match_state: 'DATA_INCOMPLETE',
        reason_codes: ['PROJECT_LOCATION_MISSING'],
        evidence_refs: ['project.location=null'],
        explanation: 'Project lacks verified geographic location coordinates.',
      };
    }

    const buyerLocations = req.preferred_locations.map((loc) => loc.toLowerCase().trim());

    if (buyerLocations.length === 0 || req.location_truth_level === 'UNKNOWN') {
      return {
        dimension: 'location',
        max_points: 25,
        awarded_points: 10,
        match_state: 'NEUTRAL',
        reason_codes: ['BUYER_LOCATION_UNSPECIFIED'],
        evidence_refs: ['buyer.locations=[]'],
        explanation: 'Buyer has not specified strict geographic restrictions.',
      };
    }

    const pMicro = (project.micro_market || '').toLowerCase().trim();
    const pLoc = (project.locality || '').toLowerCase().trim();
    const pCity = (project.city || '').toLowerCase().trim();

    // 1. Exact Micro-Market Match (25 pts)
    const exactMicroMatch = buyerLocations.some(
      (bLoc) =>
        (pMicro && (pMicro.includes(bLoc) || bLoc.includes(pMicro))) ||
        (pLoc && (pLoc.includes(bLoc) || bLoc.includes(pLoc)))
    );

    if (exactMicroMatch) {
      key_matches.push(`Location matches preferred micro-market: ${project.micro_market || project.locality}`);
      return {
        dimension: 'location',
        max_points: 25,
        awarded_points: 25,
        match_state: 'MATCH',
        reason_codes: ['LOCATION_MICRO_MARKET_EXACT'],
        evidence_refs: [`project.micro_market=${project.micro_market || project.locality}`],
        explanation: `Exact micro-market alignment with buyer preferred area.`,
      };
    }

    // 2. Same Locality / Corridor Match (20 pts)
    const isAdjacentLocality =
      (pLoc && buyerLocations.some((bLoc) => bLoc.includes(pLoc) || pLoc.includes(bLoc))) ||
      (pMicro.includes('chatti') && buyerLocations.some((b) => b.includes('vrindavan') || b.includes('chatti'))) ||
      (pMicro.includes('golf course') && buyerLocations.some((b) => b.includes('sector 63') || b.includes('sector 62')));

    if (isAdjacentLocality) {
      key_matches.push(`Location in primary target corridor: ${project.locality || project.city}`);
      return {
        dimension: 'location',
        max_points: 25,
        awarded_points: 20,
        match_state: 'PARTIAL_MATCH',
        reason_codes: ['LOCATION_LOCALITY_MATCH'],
        evidence_refs: [`project.locality=${project.locality}`],
        explanation: `Project is located in the buyer target locality corridor.`,
      };
    }

    // 3. Same City Match (15 pts)
    const sameCityMatch = buyerLocations.some((bLoc) => pCity && (pCity.includes(bLoc) || bLoc.includes(pCity)));

    if (sameCityMatch) {
      key_matches.push(`Location matches target city: ${project.city}`);
      return {
        dimension: 'location',
        max_points: 25,
        awarded_points: 15,
        match_state: 'PARTIAL_MATCH',
        reason_codes: ['LOCATION_CITY_MATCH'],
        evidence_refs: [`project.city=${project.city}`],
        explanation: `Project matches target city (${project.city}).`,
      };
    }

    // 4. Adjacent Market (e.g. Mathura for Vrindavan) (8 pts)
    const isAdjacentMarket =
      (pCity === 'mathura' && buyerLocations.some((b) => b.includes('vrindavan'))) ||
      (pCity === 'vrindavan' && buyerLocations.some((b) => b.includes('mathura')));

    if (isAdjacentMarket) {
      gaps.push(`Project is located in adjacent regional market (${project.city})`);
      return {
        dimension: 'location',
        max_points: 25,
        awarded_points: 8,
        match_state: 'PARTIAL_MATCH',
        reason_codes: ['LOCATION_ADJACENT_MARKET'],
        evidence_refs: [`project.city=${project.city}`],
        explanation: `Project is in an approved adjacent market (${project.city}) rather than primary target city.`,
      };
    }

    // 5. Unrelated Market / Mismatch (0 pts)
    gaps.push(`Project location (${project.city || 'Other'}) is outside buyer target geography`);
    return {
      dimension: 'location',
      max_points: 25,
      awarded_points: 0,
      match_state: 'MISMATCH',
      reason_codes: ['LOCATION_MISMATCH'],
      evidence_refs: [`project.city=${project.city}`],
      explanation: `Project is outside acceptable buyer geographic boundaries.`,
    };
  }

  /**
   * 3. Configuration Matching (15 pts max)
   */
  private evaluateConfiguration(
    req: BuyerMatchingRequirement,
    project: DbProject,
    key_matches: string[],
    gaps: string[],
    risks: string[]
  ): ProjectMatchComponent {
    const pConfigs = project.configurations || [];

    if (pConfigs.length === 0) {
      gaps.push('Project configuration details incomplete');
      return {
        dimension: 'configuration',
        max_points: 15,
        awarded_points: 0,
        match_state: 'DATA_INCOMPLETE',
        reason_codes: ['CONFIG_DATA_MISSING'],
        evidence_refs: ['project.configurations=[]'],
        explanation: 'Project does not list verified configuration inventory.',
      };
    }

    const bConfig = (req.configuration || '').toLowerCase().trim();

    if (!bConfig) {
      return {
        dimension: 'configuration',
        max_points: 15,
        awarded_points: 10,
        match_state: 'NEUTRAL',
        reason_codes: ['CONFIG_BUYER_UNSPECIFIED'],
        evidence_refs: ['buyer.configuration=null'],
        explanation: 'Buyer configuration requirement is open/flexible.',
      };
    }

    // Check Land / Farmhouse sizing (e.g. 800-1000 sq yd)
    if (bConfig.includes('sq yd') || bConfig.includes('yard') || bConfig.includes('farm')) {
      const matchLand = pConfigs.some((c) => {
        const cLower = c.toLowerCase();
        return cLower.includes('sq yd') || cLower.includes('farm') || cLower.includes('yard') || cLower.includes('plot');
      });

      if (matchLand) {
        key_matches.push(`Land size / configuration supports ${req.configuration}`);
        return {
          dimension: 'configuration',
          max_points: 15,
          awarded_points: 15,
          match_state: 'MATCH',
          reason_codes: ['LAND_SIZE_MATCH', 'CONFIG_EXACT_MATCH'],
          evidence_refs: [`project.configurations=${pConfigs.join(', ')}`],
          explanation: `Project land parcel configurations match buyer requirement (${req.configuration}).`,
        };
      } else {
        gaps.push(`Project does not support requested land parcel size (${req.configuration})`);
        return {
          dimension: 'configuration',
          max_points: 15,
          awarded_points: 0,
          match_state: 'MISMATCH',
          reason_codes: ['CONFIG_MISMATCH'],
          evidence_refs: [`project.configurations=${pConfigs.join(', ')}`],
          explanation: `Project does not offer required land parcel sizes.`,
        };
      }
    }

    // Check BHK configs (e.g. 3 BHK, 4 BHK, 2 BHK)
    const isMin3Bhk = bConfig.includes('min') && bConfig.includes('3 bhk') || bConfig.includes('3 bhk') || bConfig.includes('3bhk');
    const is4Bhk = bConfig.includes('4 bhk') || bConfig.includes('4bhk');

    if (isMin3Bhk) {
      const supports3Or4 = pConfigs.some((c) => {
        const cL = c.toLowerCase();
        return cL.includes('3 bhk') || cL.includes('3bhk') || cL.includes('4 bhk') || cL.includes('4bhk') || cL.includes('5 bhk');
      });

      if (supports3Or4) {
        key_matches.push(`Configuration (${pConfigs.join(', ')}) supports minimum 3 BHK requirement`);
        return {
          dimension: 'configuration',
          max_points: 15,
          awarded_points: 15,
          match_state: 'MATCH',
          reason_codes: ['CONFIG_EXACT_OR_HIGHER', 'CONFIG_EXACT_MATCH'],
          evidence_refs: [`project.configurations=${pConfigs.join(', ')}`],
          explanation: `Project inventory supports 3 BHK or larger configurations.`,
        };
      } else {
        gaps.push(`Project only offers ${pConfigs.join(', ')}, failing minimum 3 BHK requirement`);
        return {
          dimension: 'configuration',
          max_points: 15,
          awarded_points: 0,
          match_state: 'MISMATCH',
          reason_codes: ['CONFIG_MISMATCH'],
          evidence_refs: [`project.configurations=${pConfigs.join(', ')}`],
          explanation: `Project fails buyer minimum 3 BHK threshold.`,
        };
      }
    }

    // General matching
    const genericMatch = pConfigs.some((c) => c.toLowerCase().includes(bConfig) || bConfig.includes(c.toLowerCase()));

    if (genericMatch) {
      key_matches.push(`Configuration matches: ${req.configuration}`);
      return {
        dimension: 'configuration',
        max_points: 15,
        awarded_points: 15,
        match_state: 'MATCH',
        reason_codes: ['CONFIG_EXACT_MATCH'],
        evidence_refs: [`project.configurations=${pConfigs.join(', ')}`],
        explanation: `Project configurations directly match buyer requirement.`,
      };
    }

    gaps.push(`Configuration mismatch: buyer requested ${req.configuration}, project offers ${pConfigs.join(', ')}`);
    return {
      dimension: 'configuration',
      max_points: 15,
      awarded_points: 0,
      match_state: 'MISMATCH',
      reason_codes: ['CONFIG_MISMATCH'],
      evidence_refs: [`project.configurations=${pConfigs.join(', ')}`],
      explanation: `Project does not offer the required configuration.`,
    };
  }

  /**
   * 4. Property Type Matching (10 pts max)
   */
  private evaluatePropertyType(
    req: BuyerMatchingRequirement,
    project: DbProject,
    key_matches: string[],
    gaps: string[],
    risks: string[]
  ): ProjectMatchComponent {
    const pType = (project.property_type || '').toLowerCase().trim();
    const bType = (req.property_type || '').toLowerCase().trim();

    if (!pType) {
      gaps.push('Project property type unverified');
      return {
        dimension: 'property_type',
        max_points: 10,
        awarded_points: 0,
        match_state: 'DATA_INCOMPLETE',
        reason_codes: ['PROPERTY_TYPE_MISSING'],
        evidence_refs: ['project.property_type=null'],
        explanation: 'Project property type classification missing.',
      };
    }

    if (!bType) {
      return {
        dimension: 'property_type',
        max_points: 10,
        awarded_points: 8,
        match_state: 'NEUTRAL',
        reason_codes: ['PROPERTY_TYPE_UNSPECIFIED'],
        evidence_refs: ['buyer.property_type=null'],
        explanation: 'Buyer is flexible on property typology.',
      };
    }

    // Normalization helpers
    const isFarmHouse = (t: string) => t.includes('farm') || t.includes('farmhouse') || t.includes('farm house');
    const isApartment = (t: string) => t.includes('apartment') || t.includes('flat') || t.includes('high-rise') || t.includes('condo') || t.includes('residential');
    const isVilla = (t: string) => t.includes('villa') || t.includes('floors') || t.includes('independent') || t.includes('row house');
    const isPlot = (t: string) => t.includes('plot') || t.includes('land');
    const isCommercial = (t: string) => t.includes('commercial') || t.includes('office') || t.includes('retail') || t.includes('shop');

    // Hard Constraint Check: Farm House vs Commercial vs High Rise
    if (isFarmHouse(bType)) {
      if (isFarmHouse(pType)) {
        key_matches.push(`Property type matches Farm House category`);
        return {
          dimension: 'property_type',
          max_points: 10,
          awarded_points: 10,
          match_state: 'MATCH',
          reason_codes: ['PROPERTY_TYPE_EXACT'],
          evidence_refs: [`project.property_type=${project.property_type}`],
          explanation: `Project is a verified Farm House development.`,
        };
      } else {
        gaps.push(`Buyer requires Farm House, but project is ${project.property_type}`);
        return {
          dimension: 'property_type',
          max_points: 10,
          awarded_points: 0,
          match_state: 'MISMATCH',
          reason_codes: ['PROPERTY_TYPE_MISMATCH'],
          evidence_refs: [`project.property_type=${project.property_type}`],
          explanation: `Hard constraint violation: Farm house requirement cannot match ${project.property_type}.`,
        };
      }
    }

    if (isCommercial(bType)) {
      if (isCommercial(pType)) {
        key_matches.push(`Property type matches Commercial requirement`);
        return {
          dimension: 'property_type',
          max_points: 10,
          awarded_points: 10,
          match_state: 'MATCH',
          reason_codes: ['PROPERTY_TYPE_EXACT'],
          evidence_refs: [`project.property_type=${project.property_type}`],
          explanation: `Project matches Commercial typology.`,
        };
      } else {
        return {
          dimension: 'property_type',
          max_points: 10,
          awarded_points: 0,
          match_state: 'MISMATCH',
          reason_codes: ['PROPERTY_TYPE_MISMATCH'],
          evidence_refs: [`project.property_type=${project.property_type}`],
          explanation: `Project is residential, mismatching commercial requirement.`,
        };
      }
    }

    // Standard Residential
    if (isApartment(bType) || bType.includes('residential')) {
      if (isApartment(pType)) {
        key_matches.push(`Property type matches Residential Apartment`);
        return {
          dimension: 'property_type',
          max_points: 10,
          awarded_points: 10,
          match_state: 'MATCH',
          reason_codes: ['PROPERTY_TYPE_EXACT'],
          evidence_refs: [`project.property_type=${project.property_type}`],
          explanation: `Direct residential apartment alignment.`,
        };
      } else if (isVilla(pType)) {
        key_matches.push(`Compatible residential typology (${project.property_type})`);
        return {
          dimension: 'property_type',
          max_points: 10,
          awarded_points: 7,
          match_state: 'PARTIAL_MATCH',
          reason_codes: ['PROPERTY_TYPE_COMPATIBLE'],
          evidence_refs: [`project.property_type=${project.property_type}`],
          explanation: `Residential villa/low-rise floors compatible with residential inquiry.`,
        };
      } else {
        gaps.push(`Property type mismatch: project is ${project.property_type}`);
        return {
          dimension: 'property_type',
          max_points: 10,
          awarded_points: 0,
          match_state: 'MISMATCH',
          reason_codes: ['PROPERTY_TYPE_MISMATCH'],
          evidence_refs: [`project.property_type=${project.property_type}`],
          explanation: `Property type mismatch with buyer residential inquiry.`,
        };
      }
    }

    // Default fallback
    if (pType.includes(bType) || bType.includes(pType)) {
      return {
        dimension: 'property_type',
        max_points: 10,
        awarded_points: 10,
        match_state: 'MATCH',
        reason_codes: ['PROPERTY_TYPE_EXACT'],
        evidence_refs: [`project.property_type=${project.property_type}`],
        explanation: `Property typology match.`,
      };
    }

    return {
      dimension: 'property_type',
      max_points: 10,
      awarded_points: 3,
      match_state: 'PARTIAL_MATCH',
      reason_codes: ['PROPERTY_TYPE_PARTIAL'],
      evidence_refs: [`project.property_type=${project.property_type}`],
      explanation: `Partial property typology alignment.`,
    };
  }

  /**
   * 5. Purpose Matching (10 pts max)
   */
  private evaluatePurpose(
    req: BuyerMatchingRequirement,
    project: DbProject,
    key_matches: string[],
    gaps: string[],
    risks: string[]
  ): ProjectMatchComponent {
    const bPurpose = (req.purpose || '').toLowerCase().trim();

    if (!bPurpose) {
      return {
        dimension: 'purpose',
        max_points: 10,
        awarded_points: 8,
        match_state: 'NEUTRAL',
        reason_codes: ['PURPOSE_UNSPECIFIED'],
        evidence_refs: ['buyer.purpose=null'],
        explanation: 'Purpose is open / flexible.',
      };
    }

    const isEndUse = bPurpose.includes('end') || bPurpose.includes('self') || bPurpose.includes('family') || bPurpose.includes('live');
    const isInvestment = bPurpose.includes('invest') || bPurpose.includes('capital') || bPurpose.includes('rental');

    const desc = (project.project_description || '').toLowerCase();
    const pType = (project.property_type || '').toLowerCase();

    if (isEndUse) {
      if (pType.includes('commercial office')) {
        gaps.push('Commercial office project cannot serve residential end-use purpose');
        return {
          dimension: 'purpose',
          max_points: 10,
          awarded_points: 0,
          match_state: 'MISMATCH',
          reason_codes: ['PURPOSE_MISMATCH'],
          evidence_refs: [`project.property_type=${project.property_type}`],
          explanation: 'Commercial project unsuitable for residential end-use.',
        };
      }

      key_matches.push(`Development is highly suitable for self/end-use`);
      return {
        dimension: 'purpose',
        max_points: 10,
        awarded_points: 10,
        match_state: 'MATCH',
        reason_codes: ['PURPOSE_ALIGNMENT', 'END_USE_SUITABLE'],
        evidence_refs: [`buyer.purpose=${req.purpose}`],
        explanation: `Project features and master plan support residential end-use living.`,
      };
    }

    if (isInvestment) {
      key_matches.push(`Strong appreciation and rental yield potential`);
      return {
        dimension: 'purpose',
        max_points: 10,
        awarded_points: 10,
        match_state: 'MATCH',
        reason_codes: ['PURPOSE_ALIGNMENT', 'INVESTMENT_SUITABLE'],
        evidence_refs: [`buyer.purpose=${req.purpose}`],
        explanation: `Project is positioned for capital growth and investment yields.`,
      };
    }

    return {
      dimension: 'purpose',
      max_points: 10,
      awarded_points: 7,
      match_state: 'NEUTRAL',
      reason_codes: ['PURPOSE_NEUTRAL'],
      evidence_refs: [`buyer.purpose=${req.purpose}`],
      explanation: `General residential purpose suitability.`,
    };
  }

  /**
   * 6. Timeline Matching (5 pts max)
   */
  private evaluateTimeline(
    req: BuyerMatchingRequirement,
    project: DbProject,
    key_matches: string[],
    gaps: string[],
    risks: string[]
  ): ProjectMatchComponent {
    const pPossession = (project.possession || '').toLowerCase().trim();
    const bTimeline = (req.timeline || '').toLowerCase().trim();

    if (!pPossession) {
      return {
        dimension: 'timeline',
        max_points: 5,
        awarded_points: 2,
        match_state: 'DATA_INCOMPLETE',
        reason_codes: ['PROJECT_POSSESSION_UNSPECIFIED'],
        evidence_refs: ['project.possession=null'],
        explanation: 'Project possession date unverified in catalog.',
      };
    }

    const isReady = pPossession.includes('ready') || pPossession.includes('immediate');
    const isNearTerm = pPossession.includes('2026') || pPossession.includes('q1') || pPossession.includes('q2');
    const isLongTerm = pPossession.includes('2028') || pPossession.includes('2029') || pPossession.includes('2030');

    const isAsap = bTimeline.includes('asap') || bTimeline.includes('immediate') || bTimeline.includes('1-3') || bTimeline.includes('soon');

    if (isAsap) {
      if (isReady) {
        key_matches.push(`Ready-to-move status directly satisfies ASAP timeline`);
        return {
          dimension: 'timeline',
          max_points: 5,
          awarded_points: 5,
          match_state: 'MATCH',
          reason_codes: ['TIMELINE_READY_TO_MOVE'],
          evidence_refs: [`project.possession=${project.possession}`],
          explanation: `Ready-to-move status perfectly matches buyer urgent purchase timeline.`,
        };
      } else if (isNearTerm) {
        key_matches.push(`Near-term possession (${project.possession}) aligns with purchase window`);
        return {
          dimension: 'timeline',
          max_points: 5,
          awarded_points: 3,
          match_state: 'PARTIAL_MATCH',
          reason_codes: ['TIMELINE_NEAR_TERM'],
          evidence_refs: [`project.possession=${project.possession}`],
          explanation: `Possession date is near-term (${project.possession}).`,
        };
      } else if (isLongTerm) {
        gaps.push(`Project possession (${project.possession}) is too distant for ASAP buyer`);
        return {
          dimension: 'timeline',
          max_points: 5,
          awarded_points: 0,
          match_state: 'MISMATCH',
          reason_codes: ['TIMELINE_MISMATCH'],
          evidence_refs: [`project.possession=${project.possession}`],
          explanation: `Project possession timeline is too distant for buyer urgent timeline.`,
        };
      }
    }

    // Flexible or general timeline
    if (isReady || isNearTerm) {
      return {
        dimension: 'timeline',
        max_points: 5,
        awarded_points: 5,
        match_state: 'MATCH',
        reason_codes: ['TIMELINE_ALIGNED'],
        evidence_refs: [`project.possession=${project.possession}`],
        explanation: `Possession timeline is favorable for buyer schedule.`,
      };
    }

    return {
      dimension: 'timeline',
      max_points: 5,
      awarded_points: 4,
      match_state: 'NEUTRAL',
      reason_codes: ['TIMELINE_NEUTRAL'],
      evidence_refs: [`project.possession=${project.possession}`],
      explanation: `Standard construction timeline delivery.`,
    };
  }

  /**
   * 7. Preferences Matching (5 pts max)
   * Evaluates ONLY buyer explicit confirmed preferences (never unverified agent suggestions).
   */
  private evaluatePreferences(
    req: BuyerMatchingRequirement,
    project: DbProject,
    key_matches: string[],
    gaps: string[],
    risks: string[]
  ): ProjectMatchComponent {
    const explicitPrefs = req.explicit_preferences || req.preferences || [];

    if (explicitPrefs.length === 0) {
      return {
        dimension: 'preferences',
        max_points: 5,
        awarded_points: 4,
        match_state: 'NEUTRAL',
        reason_codes: ['PREFERENCES_NONE_EXPLICIT'],
        evidence_refs: ['buyer.preferences=[]'],
        explanation: 'No specialized buyer preferences specified.',
      };
    }

    const pFeats = (project.features || []).join(' ').toLowerCase();
    const pAmens = (project.amenities || []).join(' ').toLowerCase();
    const pDesc = (project.project_description || '').toLowerCase();
    const projectText = `${pFeats} ${pAmens} ${pDesc}`;

    let matchCount = 0;
    for (const pref of explicitPrefs) {
      const prefLower = pref.toLowerCase();
      if (
        (prefLower.includes('gate') && projectText.includes('gate')) ||
        (prefLower.includes('low density') && projectText.includes('low density')) ||
        (prefLower.includes('temple') && (projectText.includes('temple') || projectText.includes('mandir') || projectText.includes('satsang') || projectText.includes('iskcon'))) ||
        (prefLower.includes('vastu') && projectText.includes('vastu')) ||
        (prefLower.includes('organic') && projectText.includes('organic')) ||
        (prefLower.includes('security') && projectText.includes('security'))
      ) {
        matchCount++;
      }
    }

    if (matchCount > 0) {
      key_matches.push(`Matches buyer explicit preferences (gated, amenities, security)`);
      return {
        dimension: 'preferences',
        max_points: 5,
        awarded_points: 5,
        match_state: 'MATCH',
        reason_codes: ['PREFERENCES_CONFIRMED_MATCH'],
        evidence_refs: [`buyer.explicit_preferences=${explicitPrefs.join(', ')}`],
        explanation: `Project features and amenities satisfy buyer explicit preferences.`,
      };
    }

    return {
      dimension: 'preferences',
      max_points: 5,
      awarded_points: 3,
      match_state: 'NEUTRAL',
      reason_codes: ['PREFERENCES_PARTIAL_OR_NEUTRAL'],
      evidence_refs: [`buyer.explicit_preferences=${explicitPrefs.join(', ')}`],
      explanation: `Project provides standard premium infrastructure.`,
    };
  }

  /**
   * 8. Project Attributes Matching (5 pts max)
   */
  private evaluateProjectAttributes(
    req: BuyerMatchingRequirement,
    project: DbProject,
    key_matches: string[],
    gaps: string[],
    risks: string[]
  ): ProjectMatchComponent {
    const hasDeveloper = Boolean(project.developer_name);
    const hasAmenities = Array.isArray(project.amenities) && project.amenities.length > 0;
    const hasFeatures = Array.isArray(project.features) && project.features.length > 0;
    const isActive = project.status === 'ACTIVE' || (project.status as string) === 'active';

    if (!isActive) {
      gaps.push('Project is not currently marked as active inventory');
      risks.push('Inventory availability must be re-verified before broker dispatch');
      return {
        dimension: 'project_attributes',
        max_points: 5,
        awarded_points: 1,
        match_state: 'DATA_INCOMPLETE',
        reason_codes: ['PROJECT_INACTIVE'],
        evidence_refs: [`project.status=${project.status}`],
        explanation: 'Project is not actively open for allocation.',
      };
    }

    if (hasDeveloper && hasAmenities && hasFeatures) {
      return {
        dimension: 'project_attributes',
        max_points: 5,
        awarded_points: 5,
        match_state: 'MATCH',
        reason_codes: ['PROJECT_ATTRIBUTES_COMPLETE'],
        evidence_refs: [`project.developer=${project.developer_name}`],
        explanation: 'Verified developer brand, complete amenity specs, and active catalog listing.',
      };
    } else if (hasDeveloper || hasAmenities) {
      return {
        dimension: 'project_attributes',
        max_points: 5,
        awarded_points: 3,
        match_state: 'PARTIAL_MATCH',
        reason_codes: ['PROJECT_ATTRIBUTES_PARTIAL'],
        evidence_refs: [`project.developer=${project.developer_name || 'unverified'}`],
        explanation: 'Partially verified project listing attributes.',
      };
    } else {
      gaps.push('Project missing verified developer and amenity specifications');
      return {
        dimension: 'project_attributes',
        max_points: 5,
        awarded_points: 0,
        match_state: 'DATA_INCOMPLETE',
        reason_codes: ['PROJECT_DATA_INCOMPLETE'],
        evidence_refs: ['project.developer=null', 'project.amenities=null'],
        explanation: 'Project listing contains incomplete structured metadata.',
      };
    }
  }

  /**
   * Helper: Map match score to match band
   */
  public calculateMatchBand(score: number): ProjectMatchBand {
    if (score >= 80) return 'STRONG';
    if (score >= 60) return 'GOOD';
    if (score >= 40) return 'POSSIBLE';
    return 'WEAK';
  }

  private formatPrice(num: number): string {
    if (num >= 10000000) {
      return `₹${(num / 10000000).toFixed(2)} Cr`;
    }
    if (num >= 100000) {
      return `₹${(num / 100000).toFixed(1)} Lakh`;
    }
    return `₹${num}`;
  }

  private formatPriceRange(min: number | null, max: number | null): string {
    if (min !== null && max !== null) {
      return `${this.formatPrice(min)} – ${this.formatPrice(max)}`;
    }
    if (min !== null) return `From ${this.formatPrice(min)}`;
    if (max !== null) return `Up to ${this.formatPrice(max)}`;
    return 'Price on request';
  }
}

export const projectMatchingRulesEngine = new ProjectMatchingRulesEngine();
