/**
 * GrowthForge Buyer Intelligence Engine - Gemini Extraction Provider Boundary
 *
 * Provides typed interface and execution boundaries for Google Gemini models.
 * Separates real @google/genai SDK execution from deterministic test mocks.
 */

import { GoogleGenAI, Type } from '@google/genai';
import { ExternalProviderError, ExternalProviderErrorType, withRetry, withTimeout } from '../errors';
import {
  ExtractedBuyerIntelligence,
  EXTRACTION_PROMPT_VERSION,
  EXTRACTION_SCHEMA_VERSION,
} from '../../schemas/extraction';
import {
  CONVERSATION_EXTRACTION_SYSTEM_INSTRUCTION,
  buildConversationExtractionPrompt,
} from '../../prompts/conversationExtraction';

export interface ExtractionProviderInput {
  transcriptText: string;
  transcriptTurns?: Array<{ speaker: string; text: string; timestamp?: string }>;
  leadId: string;
  language?: string;
  modelOverride?: string;
}

export interface ExtractionProviderOutput {
  model: string;
  promptVersion: string;
  schemaVersion: string;
  extractedData: ExtractedBuyerIntelligence;
  rawResponse: Record<string, unknown>;
}

export interface GeminiExtractionProvider {
  readonly providerName: string;
  extractBuyerIntelligence(input: ExtractionProviderInput): Promise<ExtractionProviderOutput>;
}

// ==========================================
// 1. REAL GEMINI EXTRACTION PROVIDER
// ==========================================

export class RealGeminiExtractionProvider implements GeminiExtractionProvider {
  public readonly providerName = 'RealGeminiExtractionProvider';
  private defaultModel = 'gemini-3.8-flash';

  private getClient(): GoogleGenAI {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new ExternalProviderError('Gemini', ExternalProviderErrorType.CONFIGURATION, 'GEMINI_API_KEY environment variable is required');
    }
    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }

  public async extractBuyerIntelligence(input: ExtractionProviderInput): Promise<ExtractionProviderOutput> {
    const ai = this.getClient();
    const model =
      input.modelOverride ||
      process.env.GEMINI_EXTRACTION_MODEL ||
      process.env.GEMINI_MODEL ||
      this.defaultModel;

    const userPrompt = buildConversationExtractionPrompt({
      leadId: input.leadId,
      transcriptText: input.transcriptText,
      transcriptTurns: input.transcriptTurns,
      language: input.language,
    });

    const response = await ai.models.generateContent({
      model,
      contents: userPrompt,
      config: {
        systemInstruction: CONVERSATION_EXTRACTION_SYSTEM_INSTRUCTION,
        temperature: 0.1, // Low temperature for deterministic, factual extraction
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            interested: {
              type: Type.OBJECT,
              properties: {
                value: { type: Type.BOOLEAN },
                truth_level: { type: Type.STRING },
                evidence: { type: Type.STRING },
                source: { type: Type.STRING },
              },
              required: ['value', 'truth_level'],
            },
            primary_property_type: {
              type: Type.OBJECT,
              properties: {
                value: { type: Type.STRING },
                truth_level: { type: Type.STRING },
                evidence: { type: Type.STRING },
                source: { type: Type.STRING },
              },
              required: ['truth_level'],
            },
            primary_configuration: {
              type: Type.OBJECT,
              properties: {
                value: { type: Type.STRING },
                truth_level: { type: Type.STRING },
                evidence: { type: Type.STRING },
                source: { type: Type.STRING },
              },
              required: ['truth_level'],
            },
            purpose: {
              type: Type.OBJECT,
              properties: {
                value: { type: Type.STRING },
                truth_level: { type: Type.STRING },
                evidence: { type: Type.STRING },
                source: { type: Type.STRING },
              },
              required: ['value', 'truth_level'],
            },
            budget: {
              type: Type.OBJECT,
              properties: {
                min: { type: Type.NUMBER },
                max: { type: Type.NUMBER },
                currency: { type: Type.STRING },
                raw_expression: { type: Type.STRING },
                truth_level: { type: Type.STRING },
                evidence: { type: Type.STRING },
              },
              required: ['currency', 'truth_level'],
            },
            preferred_locations: {
              type: Type.OBJECT,
              properties: {
                value: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                truth_level: { type: Type.STRING },
                evidence: { type: Type.STRING },
                source: { type: Type.STRING },
              },
              required: ['value', 'truth_level'],
            },
            timeline: {
              type: Type.OBJECT,
              properties: {
                value: { type: Type.STRING },
                truth_level: { type: Type.STRING },
                evidence: { type: Type.STRING },
                source: { type: Type.STRING },
              },
              required: ['truth_level'],
            },
            possession_preference: {
              type: Type.OBJECT,
              properties: {
                value: { type: Type.STRING },
                truth_level: { type: Type.STRING },
                evidence: { type: Type.STRING },
                source: { type: Type.STRING },
              },
              required: ['value', 'truth_level'],
            },
            financing: {
              type: Type.OBJECT,
              properties: {
                value: { type: Type.STRING },
                truth_level: { type: Type.STRING },
                evidence: { type: Type.STRING },
                source: { type: Type.STRING },
              },
              required: ['truth_level'],
            },
            decision_maker: {
              type: Type.OBJECT,
              properties: {
                value: { type: Type.BOOLEAN },
                truth_level: { type: Type.STRING },
                evidence: { type: Type.STRING },
                source: { type: Type.STRING },
              },
              required: ['truth_level'],
            },
            requirements: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  property_type: { type: Type.STRING },
                  configuration: { type: Type.STRING },
                  purpose: { type: Type.STRING },
                  land_area: {
                    type: Type.OBJECT,
                    properties: {
                      min: { type: Type.NUMBER },
                      max: { type: Type.NUMBER },
                      unit: { type: Type.STRING },
                    },
                  },
                  truth_level: { type: Type.STRING },
                  evidence: { type: Type.STRING },
                },
                required: ['property_type', 'truth_level'],
              },
            },
            stated_preferences: {
              type: Type.OBJECT,
              properties: {
                value: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                truth_level: { type: Type.STRING },
                evidence: { type: Type.STRING },
                source: { type: Type.STRING },
              },
              required: ['value', 'truth_level'],
            },
            additional_notes: {
              type: Type.OBJECT,
              properties: {
                value: { type: Type.STRING },
                truth_level: { type: Type.STRING },
                evidence: { type: Type.STRING },
                source: { type: Type.STRING },
              },
              required: ['truth_level'],
            },
          },
          required: [
            'interested',
            'primary_property_type',
            'primary_configuration',
            'purpose',
            'budget',
            'preferred_locations',
            'timeline',
            'possession_preference',
            'financing',
            'decision_maker',
            'requirements',
            'stated_preferences',
          ],
        },
      },
    });

    const text = response.text;
    if (!text) {
      throw new Error('Gemini returned an empty response during structured extraction');
    }

    let parsed: ExtractedBuyerIntelligence;
    try {
      parsed = JSON.parse(text.trim());
    } catch (parseErr) {
      throw new Error(`Failed to parse Gemini JSON output: ${(parseErr as Error).message}`);
    }

    return {
      model,
      promptVersion: EXTRACTION_PROMPT_VERSION,
      schemaVersion: EXTRACTION_SCHEMA_VERSION,
      extractedData: parsed,
      rawResponse: { raw_text: text },
    };
  }
}

// ==========================================
// 2. MOCK GEMINI EXTRACTION PROVIDER (FOR TESTS)
// ==========================================

export class MockGeminiExtractionProvider implements GeminiExtractionProvider {
  public readonly providerName = 'MockGeminiExtractionProvider';
  private mockFailNext = false;
  private mockMalformedJsonNext = false;
  private mockTimeoutNext = false;
  private customMockExtractor?: (input: ExtractionProviderInput) => ExtractedBuyerIntelligence;

  constructor(customExtractorOrData?: any) {
    if (typeof customExtractorOrData === 'function') {
      this.customMockExtractor = customExtractorOrData;
    } else if (customExtractorOrData && typeof customExtractorOrData === 'object') {
      this.customMockExtractor = () => customExtractorOrData;
    }
  }

  public setMockFailure(shouldFail: boolean) {
    this.mockFailNext = shouldFail;
  }

  public setMockMalformedJson(isMalformed: boolean) {
    this.mockMalformedJsonNext = isMalformed;
  }

  public setMockTimeout(isTimeout: boolean) {
    this.mockTimeoutNext = isTimeout;
  }

  public setCustomExtractor(fn?: (input: ExtractionProviderInput) => ExtractedBuyerIntelligence) {
    this.customMockExtractor = fn;
  }

  public async extractBuyerIntelligence(input: ExtractionProviderInput): Promise<ExtractionProviderOutput> {
    if (this.mockTimeoutNext) {
      throw new Error('Gemini extraction API request timed out (simulated)');
    }
    if (this.mockFailNext) {
      throw new Error('Gemini API unavailable: 503 Service Unavailable (simulated)');
    }
    if (this.mockMalformedJsonNext) {
      throw new Error('Failed to parse Gemini JSON output: Unexpected token < in JSON at position 0');
    }

    if (this.customMockExtractor) {
      let customData: any = this.customMockExtractor(input);
      if (customData && customData.buying_intent && !customData.primary_property_type) {
        const bi = customData.buying_intent;
        const normalized: ExtractedBuyerIntelligence = {
          interested: bi.interested?.value !== undefined
            ? {
                value: Boolean(bi.interested.value),
                truth_level: bi.interested.truth_level === 'EXPLICIT' ? 'CONFIRMED' : bi.interested.truth_level || 'CONFIRMED',
                evidence: bi.interested.evidence || null,
                source: 'CALL_TRANSCRIPT',
              }
            : { value: true, truth_level: 'CONFIRMED', evidence: null, source: 'CALL_TRANSCRIPT' },
          primary_property_type: {
            value: bi.property_type?.value || null,
            truth_level: bi.property_type?.truth_level || 'UNKNOWN',
            evidence: bi.property_type?.evidence || null,
            source: 'CALL_TRANSCRIPT',
          },
          primary_configuration: {
            value: bi.configuration?.value || null,
            truth_level: bi.configuration?.truth_level || 'UNKNOWN',
            evidence: bi.configuration?.evidence || null,
            source: 'CALL_TRANSCRIPT',
          },
          purpose: {
            value: bi.purpose?.value || 'unknown',
            truth_level: bi.purpose?.truth_level || 'UNKNOWN',
            evidence: bi.purpose?.evidence || null,
            source: 'CALL_TRANSCRIPT',
          },
          budget: {
            min: bi.budget?.value?.min ?? bi.budget?.min ?? null,
            max: bi.budget?.value?.max ?? bi.budget?.max ?? null,
            currency: bi.budget?.value?.currency || bi.budget?.currency || 'INR',
            raw_expression: bi.budget?.raw_expression || null,
            truth_level: bi.budget?.truth_level || 'UNKNOWN',
            evidence: bi.budget?.evidence || null,
          },
          preferred_locations: {
            value: bi.preferred_locations?.value || (Array.isArray(bi.preferred_locations) ? bi.preferred_locations : []),
            truth_level: bi.preferred_locations?.truth_level || 'UNKNOWN',
            evidence: bi.preferred_locations?.evidence || null,
            source: 'CALL_TRANSCRIPT',
          },
          timeline: {
            value: bi.timeline?.value || null,
            truth_level: bi.timeline?.truth_level || 'UNKNOWN',
            evidence: bi.timeline?.evidence || null,
            source: 'CALL_TRANSCRIPT',
          },
          possession_preference: {
            value: bi.possession_preference?.value || 'unknown',
            truth_level: bi.possession_preference?.truth_level || 'UNKNOWN',
            evidence: null,
            source: 'CALL_TRANSCRIPT',
          },
          financing: {
            value: bi.financing?.value || null,
            truth_level: bi.financing?.truth_level || 'UNKNOWN',
            evidence: null,
            source: 'CALL_TRANSCRIPT',
          },
          decision_maker: {
            value: bi.decision_maker?.value || null,
            truth_level: bi.decision_maker?.truth_level || 'UNKNOWN',
            evidence: null,
            source: 'CALL_TRANSCRIPT',
          },
          stated_preferences: {
            value: bi.preferences?.value || [],
            truth_level: bi.preferences?.truth_level || 'UNKNOWN',
            evidence: null,
            source: 'CALL_TRANSCRIPT',
          },
          additional_notes: {
            value: bi.additional_notes?.value || null,
            truth_level: bi.additional_notes?.truth_level || 'UNKNOWN',
            evidence: null,
            source: 'CALL_TRANSCRIPT',
          },
          requirements: Array.isArray(bi.requirements_breakdown)
            ? bi.requirements_breakdown.map((r: any) => ({
                property_type: r.property_type || null,
                configuration: r.configuration || null,
                purpose: r.purpose || null,
                land_area: r.land_area || null,
                truth_level: r.truth_level || 'CONFIRMED',
                evidence: r.evidence || null,
              }))
            : bi.property_type?.value
            ? [
                {
                  property_type: bi.property_type.value,
                  configuration: bi.configuration?.value || null,
                  purpose: bi.purpose?.value || null,
                  land_area: null,
                  truth_level: bi.property_type.truth_level || 'CONFIRMED',
                  evidence: null,
                },
              ]
            : [],
        };
        customData = normalized;
      }
      return {
        model: 'gemini-3.8-flash-mock',
        promptVersion: EXTRACTION_PROMPT_VERSION,
        schemaVersion: EXTRACTION_SCHEMA_VERSION,
        extractedData: customData,
        rawResponse: { mock: true, custom: true },
      };
    }

    // Default intelligent rule-based extraction matching the Sarvam conversation fixture
    const text = input.transcriptText.toLowerCase();

    // Check for explicit residential & 3 BHK
    const has3Bhk = text.includes('3 bhk') || text.includes('3bhk');
    const hasResidential = text.includes('residential') || has3Bhk;
    const hasVrindavan = text.includes('vrindavan');
    const hasChattiKila = text.includes('chatti kila') || text.includes('chhati kila');
    const hasFarmHouse = text.includes('farm house') || text.includes('farmhouse');
    const hasEndUse = text.includes('end use') || text.includes('residence') || text.includes('end-use');
    const hasAsap = text.includes('as soon as possible') || text.includes('asap') || text.includes('jaldi');
    const hasBothPossession = text.includes('ready-to-move') || text.includes('under-construction') || text.includes('dono chalega');
    const hasBudgetDepends = text.includes('budget') && (text.includes('depends') || text.includes('depend') || text.includes('dekh lenge'));

    // Check for explicit numeric budget if present (e.g. 50 lakhs, 1 crore)
    let budgetMin: number | null = null;
    let budgetMax: number | null = null;
    let budgetTruth: 'CONFIRMED' | 'UNKNOWN' = 'UNKNOWN';
    let budgetEvidence: string | null = null;

    if (text.includes('50 lakh') || text.includes('50 lacs')) {
      budgetMin = 5000000;
      budgetMax = 6000000;
      budgetTruth = 'CONFIRMED';
      budgetEvidence = 'Budget approximately 50-60 lakhs hai.';
    } else if (hasBudgetDepends || !text.includes('lakh') && !text.includes('crore')) {
      budgetMin = null;
      budgetMax = null;
      budgetTruth = 'UNKNOWN';
      budgetEvidence = hasBudgetDepends ? 'Budget area par depend karega' : null;
    }

    const preferredLocations: string[] = [];
    if (hasVrindavan) preferredLocations.push('Vrindavan');
    if (hasChattiKila) preferredLocations.push('Chatti Kila Road');

    const requirements: ExtractedBuyerIntelligence['requirements'] = [];
    if (hasResidential) {
      requirements.push({
        property_type: 'residential',
        configuration: has3Bhk ? '3 BHK' : null,
        purpose: hasEndUse ? 'end_use' : 'unknown',
        land_area: null,
        truth_level: 'CONFIRMED',
        evidence: has3Bhk ? 'Minimum 3 BHK hona chahiye... End use / residence ke liye.' : 'Residential property dekh rahe hain.',
      });
    }

    if (hasFarmHouse) {
      requirements.push({
        property_type: 'farm_house',
        configuration: null,
        purpose: 'investment',
        land_area: {
          min: 800,
          max: 1000,
          unit: 'sq_yd',
        },
        truth_level: 'CONFIRMED',
        evidence: 'farm house requirement bhi hai, approximately 800 se 1000 square yards.',
      });
    }

    const hasFamilyDiscuss = text.includes('family') || text.includes('discuss') || text.includes('baat karenge');
    const isSoleDecision = text.includes('sole decision') || text.includes('i am the decision') || text.includes('main hi decide');

    const extractedData: ExtractedBuyerIntelligence = {
      interested: {
        value: true,
        truth_level: 'CONFIRMED',
        evidence: 'Haan ji, main Vrindavan mein property dekh raha hoon.',
        source: 'CALL_TRANSCRIPT',
      },
      primary_property_type: {
        value: hasResidential ? 'residential' : hasFarmHouse ? 'farm_house' : null,
        truth_level: hasResidential || hasFarmHouse ? 'CONFIRMED' : 'UNKNOWN',
        evidence: hasResidential ? 'Residential property dekh rahe hain' : null,
        source: 'CALL_TRANSCRIPT',
      },
      primary_configuration: {
        value: has3Bhk ? '3 BHK' : null,
        truth_level: has3Bhk ? 'CONFIRMED' : 'UNKNOWN',
        evidence: has3Bhk ? 'Minimum 3 BHK hona chahiye' : null,
        source: 'CALL_TRANSCRIPT',
      },
      purpose: {
        value: hasEndUse ? 'end_use' : 'unknown',
        truth_level: hasEndUse ? 'CONFIRMED' : 'UNKNOWN',
        evidence: hasEndUse ? 'End use / residence ke liye dekh rahe hain' : null,
        source: 'CALL_TRANSCRIPT',
      },
      budget: {
        min: budgetMin,
        max: budgetMax,
        currency: 'INR',
        raw_expression: hasBudgetDepends ? 'budget depends on the area' : null,
        truth_level: budgetTruth,
        evidence: budgetEvidence,
      },
      preferred_locations: {
        value: preferredLocations,
        truth_level: preferredLocations.length > 0 ? 'CONFIRMED' : 'UNKNOWN',
        evidence: preferredLocations.length > 0 ? preferredLocations.join(', ') : null,
        source: 'CALL_TRANSCRIPT',
      },
      timeline: {
        value: hasAsap ? 'as soon as possible' : null,
        truth_level: hasAsap ? 'CONFIRMED' : 'UNKNOWN',
        evidence: hasAsap ? 'As soon as possible plan hai' : null,
        source: 'CALL_TRANSCRIPT',
      },
      possession_preference: {
        value: hasBothPossession ? 'both' : 'unknown',
        truth_level: hasBothPossession ? 'CONFIRMED' : 'UNKNOWN',
        evidence: hasBothPossession ? 'Ready-to-move and under-construction dono chalega' : null,
        source: 'CALL_TRANSCRIPT',
      },
      financing: {
        value: null,
        truth_level: 'UNKNOWN',
        evidence: null,
        source: 'CALL_TRANSCRIPT',
      },
      decision_maker: {
        value: isSoleDecision ? true : null,
        truth_level: isSoleDecision ? 'CONFIRMED' : 'UNKNOWN',
        evidence: isSoleDecision ? 'Sole decision maker' : null,
        source: 'CALL_TRANSCRIPT',
      },
      requirements,
      stated_preferences: {
        value: hasFarmHouse ? ['farm house 800-1000 sq yd'] : [],
        truth_level: hasFarmHouse ? 'CONFIRMED' : 'UNKNOWN',
        evidence: hasFarmHouse ? '800 se 1000 sq yd farm house' : null,
        source: 'CALL_TRANSCRIPT',
      },
      additional_notes: {
        value: 'Buyer has dual intent: residential end-use 3 BHK and farm house 800-1000 sq yd.',
        truth_level: 'CONFIRMED',
        evidence: null,
        source: 'CALL_TRANSCRIPT',
      },
    };

    return {
      model: 'gemini-3.8-flash-mock',
      promptVersion: EXTRACTION_PROMPT_VERSION,
      schemaVersion: EXTRACTION_SCHEMA_VERSION,
      extractedData,
      rawResponse: { mock: true, defaultGenerated: true },
    };
  }
}

// Global active provider reference
let activeExtractionProvider: GeminiExtractionProvider;
if (process.env.NODE_ENV === 'production') {
  activeExtractionProvider = new RealGeminiExtractionProvider();
} else {
  activeExtractionProvider = process.env.NODE_ENV === 'test' || !process.env.GEMINI_API_KEY
    ? new MockGeminiExtractionProvider()
    : new RealGeminiExtractionProvider();
}

export function getGeminiExtractionProvider(): GeminiExtractionProvider {
  return activeExtractionProvider;
}

export function setGeminiExtractionProvider(provider: GeminiExtractionProvider): void {
  activeExtractionProvider = provider;
}
