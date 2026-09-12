const fs = require('fs');
const path = require('path');
const p = 'app/services/gemini/geminiExtractionProvider.ts';
let content = fs.readFileSync(p, 'utf8');

if (!content.includes('import { ExternalProviderError')) {
  content = content.replace(
    "import { GoogleGenAI, Type } from '@google/genai';",
    "import { GoogleGenAI, Type } from '@google/genai';\nimport { ExternalProviderError, ExternalProviderErrorType, withRetry, withTimeout } from '../errors';"
  );
  fs.writeFileSync(p, content);
}
console.log('Fixed imports properly');
