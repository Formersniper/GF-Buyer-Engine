const fs = require('fs');
const path = require('path');

const p = 'app/services/gemini/geminiExtractionProvider.ts';
let content = fs.readFileSync(p, 'utf8');

// Add imports
if (!content.includes('ExternalProviderError')) {
  content = content.replace(
    "import { GoogleGenAI } from '@google/genai';",
    "import { GoogleGenAI } from '@google/genai';\nimport { ExternalProviderError, ExternalProviderErrorType, withRetry, withTimeout } from '../errors';"
  );
}

// Update getClient to throw ExternalProviderError
content = content.replace(
  /throw new Error\('GEMINI_API_KEY environment variable is required for RealGeminiExtractionProvider'\);/,
  "throw new ExternalProviderError('Gemini', ExternalProviderErrorType.CONFIGURATION, 'GEMINI_API_KEY environment variable is required');"
);

// We need to wrap the generateContent call with retry/timeout
// Let's find the `extractBuyerIntelligence` body in RealGeminiExtractionProvider
// We'll replace the generateContent with a wrapped version.

const originalCall = `    const response = await ai.models.generateContent({
      model,
      contents: userPrompt,
      config: {
        systemInstruction: CONVERSATION_EXTRACTION_SYSTEM_INSTRUCTION,
        temperature: 0.1, // Low temperature for deterministic, factual extraction
        responseMimeType: 'application/json',
        responseSchema: EXTRACTION_JSON_SCHEMA,
      },
    });`;

const replacementCall = `    const response = await withRetry(
      () => withTimeout(
        ai.models.generateContent({
          model,
          contents: userPrompt,
          config: {
            systemInstruction: CONVERSATION_EXTRACTION_SYSTEM_INSTRUCTION,
            temperature: 0.1, // Low temperature for deterministic, factual extraction
            responseMimeType: 'application/json',
            responseSchema: EXTRACTION_JSON_SCHEMA,
          },
        }),
        15000,
        'Gemini'
      ),
      {
        provider: 'Gemini',
        maxAttempts: 3,
        baseDelayMs: 1000,
        shouldRetry: (error: any) => {
          // Retry on network errors or 5xx
          if (error?.status >= 500) return true;
          if (error?.type === ExternalProviderErrorType.TIMEOUT) return true;
          if (error?.message && error.message.includes('fetch')) return true;
          return false;
        }
      }
    ).catch(error => {
       if (error instanceof ExternalProviderError) throw error;
       let type = ExternalProviderErrorType.UNKNOWN;
       if (error?.status === 429) type = ExternalProviderErrorType.RATE_LIMIT;
       if (error?.status === 401 || error?.status === 403) type = ExternalProviderErrorType.AUTHENTICATION;
       if (error?.status >= 500) type = ExternalProviderErrorType.PROVIDER_5XX;
       throw new ExternalProviderError('Gemini', type, error.message || 'Gemini API failed', undefined, error);
    });`;

if (content.includes(originalCall)) {
  content = content.replace(originalCall, replacementCall);
}

// Update the global provider logic
const oldGlobalLogic = `// Global active provider reference
let activeExtractionProvider: GeminiExtractionProvider =
  process.env.NODE_ENV === 'test' || !process.env.GEMINI_API_KEY
    ? new MockGeminiExtractionProvider()
    : new RealGeminiExtractionProvider();`;

const newGlobalLogic = `// Global active provider reference
let activeExtractionProvider: GeminiExtractionProvider;
if (process.env.NODE_ENV === 'production') {
  activeExtractionProvider = new RealGeminiExtractionProvider();
} else {
  activeExtractionProvider = process.env.NODE_ENV === 'test' || !process.env.GEMINI_API_KEY
    ? new MockGeminiExtractionProvider()
    : new RealGeminiExtractionProvider();
}`;

if (content.includes(oldGlobalLogic)) {
  content = content.replace(oldGlobalLogic, newGlobalLogic);
}

fs.writeFileSync(p, content);
console.log('Gemini provider updated');
