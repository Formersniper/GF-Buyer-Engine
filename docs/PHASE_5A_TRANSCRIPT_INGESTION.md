# GrowthForge Buyer Intelligence Engine
## Phase 5A — Transcript Ingestion

**Status:** COMPLETE & VALIDATED  
**Phase:** Phase 5A — Transcript Ingestion  
**Architecture:** Enterprise UI → Control/Workflow Layer → Specialized Business Agents → Voice Services → Supabase System of Record  

---

### 1. Purpose & Scope

Phase 5A implements the reliable, idempotent ingestion of raw conversational transcripts from completed Sarvam Voice Agent interactions into GrowthForge's Supabase system of record.

The transcript is preserved as **immutable raw evidence**. Phase 5A deliberately does **not** interpret, translate, or extract structured buyer preferences (which is deferred to Phase 5B Gemini Extraction).

---

### 2. Ingestion Pipeline Flow

```text
Sarvam Telephony / Voice Agent
    ↓ (call.ended / status webhook with transcript & turns)
GrowthForge Webhook Handler (processSarvamWebhook)
    ↓
TranscriptIngestionService.ingestSarvamTranscript()
    ↓
Call Correlation Hierarchy
    ├─ 1. provider_call_id / outbound_id -> calls.provider_call_id
    ├─ 2. call_id (UUID) -> calls.id
    └─ 3. fallback lead_id -> verified lead's active call
    ↓ (If unresolvable -> TRANSCRIPT_CORRELATION_FAILED; never attaches to guessed lead)
Idempotency Deduplication Check
    ├─ Already ingested for call_id / provider_call_id?
    └─ Return IGNORED_DUPLICATE (no duplicate rows, no audit spam)
    ↓
Canonical Normalization
    ├─ Raw transcript text verbatim preservation
    ├─ Structured turn-by-turn capture (agent / user / timestamp)
    └─ Language preservation (hi-IN, Hinglish, en-IN without translation)
    ↓
Supabase Persistence (call_transcripts table)
    ↓
Audit Event Logged in lead_events (TRANSCRIPT_INGESTED)
    ↓
Ready for Phase 5B Downstream Intelligence Processing
```

---

### 3. Canonical Data Model (`call_transcripts`)

Defined in migration `supabase/migrations/002_call_transcripts.sql` and typed in `app/schemas/database.ts`:

```typescript
export interface TranscriptTurn {
  speaker: 'agent' | 'user' | 'system' | string;
  text: string;
  timestamp?: string;
  raw_data?: Record<string, unknown>;
}

export interface CallTranscript {
  id: string; // UUID
  lead_id: string; // UUID FK -> leads.id
  call_id: string; // UUID FK -> calls.id
  provider_call_id: string | null;
  interaction_id: string | null;
  transcript_text: string;
  transcript_turns: TranscriptTurn[] | null;
  language: string | null;
  duration_seconds: number | null;
  source: string; // 'sarvam'
  source_event_type: string | null;
  ingestion_status: string; // 'INGESTED'
  ingestion_version: string; // 'v1'
  captured_at: string;
  created_at: string;
  updated_at: string;
}
```

---

### 4. Correlation Strategy & Safety

Transcripts are correlated strictly via the following hierarchy:
1. `provider_call_id` / `outbound_id` mapping to `calls.provider_call_id`
2. Direct `call_id` internal UUID mapping to `calls.id`
3. Fallback `metadata.lead_id` mapping to the latest verified call for that lead

If all correlation paths fail, the system returns `TRANSCRIPT_CORRELATION_FAILED` and refuses to persist the transcript against a guessed or arbitrary lead.

---

### 5. Idempotency & Deduplication

- Database constraint: `CONSTRAINT uq_call_transcripts_call_id UNIQUE (call_id)`.
- Service-level deduplication: `TranscriptIngestionService` checks existing transcripts by `call_id` and `provider_call_id`.
- Duplicate deliveries safely return `IGNORED_DUPLICATE` with the existing transcript identifier, preventing audit log pollution and state regressions.

---

### 6. Security & PII Protection

- `SARVAM_API_KEY` remains strictly server-side and is never present in transcript payloads or client data.
- Phone numbers are masked in all audit telemetry.
- Row-Level Security (RLS) is enabled on `call_transcripts`.

---

### 7. Deferred to Future Phases (Strict Scope Boundaries)

The following intelligence and workflow capabilities are explicitly deferred to subsequent phases:
1. **Phase 5B**: Gemini Structured Extraction & NLP entity parsing
2. **Phase 5C**: Buyer Qualification Algorithms & Rules Engine
3. **Phase 5D**: Multi-Factor Buyer Scoring Model
4. **Phase 5E**: Project Catalog Matching & Recommendations
5. **Phase 5F**: Broker Handoff & CRM Synchronization
