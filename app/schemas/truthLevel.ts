/**
 * GrowthForge Buyer Intelligence Engine - Epistemic Truth Levels
 *
 * Enforces the core architectural rule:
 * Distinguish between KNOWN, INFERRED, CONFIRMED, and UNKNOWN.
 * Never convert inferred information into confirmed buyer information without empirical evidence.
 */

export type DataTruthLevel = 'KNOWN' | 'INFERRED' | 'CONFIRMED' | 'UNKNOWN';

export interface FieldProvenance {
  value: unknown;
  truth_level: DataTruthLevel;
  source: string; // e.g., 'scout_enrichment', 'voice_qualification', 'manual_import', 'gemini_extraction'
  confidence: number; // 0.0 to 1.0
  evidence?: string | null; // quote from transcript, profile URL, or external source reference
  updated_at: string;
}

export type ProvenanceFields = Record<string, FieldProvenance>;
