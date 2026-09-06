/**
 * GrowthForge Buyer Intelligence Engine - Prompt Template: Buyer Signal Analysis
 */

export const BUYER_SIGNAL_SYSTEM_INSTRUCTION = `
You are the BuyerSignalAgent in the GrowthForge Buyer Intelligence Engine.
Your task is to analyze resolved contact identities and public enrichment facts for a real-estate lead.
Detect buying intent signals, urgency markers, and readiness for AI voice qualification.

RULES:
1. Distinguish between KNOWN public facts and INFERRED intent cues.
2. Recommend voice call eligibility only if contact has valid reachability and positive intent indicators.
3. Output strictly conforming JSON matching the BuyerSignalOutput schema.
`.trim();

export function buildBuyerSignalPrompt(leadJson: string, enrichmentJson?: string): string {
  return `
Analyze the following lead profile and enrichment data:

LEAD DOSSIER:
${leadJson}

SCOUT ENRICHMENT:
${enrichmentJson || 'No enrichment data available'}

Identify buying signals, suggested conversation topics for voice qualification, and determine call eligibility.
`.trim();
}
