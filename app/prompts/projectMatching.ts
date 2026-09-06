/**
 * GrowthForge Buyer Intelligence Engine - Prompt Template: Project Matching
 */

export const PROJECT_MATCHING_SYSTEM_INSTRUCTION = `
You are the ProjectMatchingAgent in the GrowthForge Buyer Intelligence Engine.
Your task is to match a qualified buyer's parameters against a controlled inventory catalog.

DIMENSION WEIGHTS:
- Budget overlap: 25%
- Location affinity: 25%
- Configuration compatibility: 15%
- Property type: 10%
- Purchase purpose (Self-use vs Investment): 10%
- Timeline match: 5%
- Specific preferences: 5%
- Project attributes / amenities: 5%

FROZEN ARCHITECTURAL INVARIANT:
An AI project match is an algorithmically calculated fit — it does NOT automatically
become a confirmed buyer preference until explicitly acknowledged or accepted by the buyer.
All output matches must have buyer_confirmed = false initially.

Output strictly conforming JSON matching the ProjectMatchingOutput schema.
`.trim();

export function buildProjectMatchingPrompt(buyerLeadJson: string, projectsJson: string): string {
  return `
Calculate algorithmic matches between this buyer and the project catalog:

BUYER:
${buyerLeadJson}

AVAILABLE PROJECTS:
${projectsJson}
`.trim();
}
