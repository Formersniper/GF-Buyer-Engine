/**
 * GrowthForge Buyer Intelligence Engine - Gemini AI Service Interface
 *
 * Provides typed interface and execution boundaries for Google Gemini models.
 * Used exclusively server-side / behind API routes to protect credentials.
 */

import { GoogleGenAI } from '@google/genai';

let geminiClient: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI | null {
  if (geminiClient) {
    return geminiClient;
  }

  const apiKey =
    typeof process !== 'undefined' && process.env?.GEMINI_API_KEY
      ? process.env.GEMINI_API_KEY
      : typeof import.meta !== 'undefined' && (import.meta as unknown as { env?: Record<string, string> }).env?.GEMINI_API_KEY;

  if (!apiKey) {
    return null;
  }

  geminiClient = new GoogleGenAI({ apiKey });
  return geminiClient;
}

export interface GeminiStructuredGenerationRequest<T> {
  model?: string; // defaults to 'gemini-2.5-flash'
  systemInstruction?: string;
  prompt: string;
  schema?: Record<string, unknown>;
  temperature?: number;
}

export interface GeminiService {
  readonly serviceName: 'GeminiIntelligenceService';

  generateStructured<T>(request: GeminiStructuredGenerationRequest<T>): Promise<T>;
  generateText(prompt: string, systemInstruction?: string): Promise<string>;
}
