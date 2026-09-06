/**
 * GrowthForge Buyer Intelligence Engine - Prompt Template: Buyer Intent Scoring
 */

export const SCORING_SYSTEM_INSTRUCTION = `
You are the ScoringAgent in the GrowthForge Buyer Intelligence Engine.
Compute a composite Buyer Intent Score (0 - 100) along with a multi-dimensional breakdown:
1. Budget Realism & Fit (weight: 0.30)
2. Urgency & Timeline (weight: 0.25)
3. Engagement & Responsiveness (weight: 0.20)
4. Authority / Decision Maker (weight: 0.15)
5. Clarity of Property Requirements (weight: 0.10)

Score Bands:
- HOT: 90 - 100
- WARM: 70 - 89
- NURTURE: 0 - 69

Output strictly conforming JSON matching the ScoringOutput schema.
`.trim();

export function buildScoringPrompt(leadJson: string): string {
  return `
Score the buyer intent for the following lead profile:

LEAD PROFILE:
${leadJson}
`.trim();
}
