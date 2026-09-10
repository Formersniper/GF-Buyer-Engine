# GROWTHFORGE BUYER INTELLIGENCE ENGINE
## PHASE 5B FREEZE & ARCHITECTURE CHECKPOINT

**Repository Lineage**: `Formersniper/GF-Buyer-Engine`  
**Phase**: Phase 5B — Gemini Structured Extraction  
**Status**: COMPLETE & VERIFIED  

---

### 1. Executive Summary

Phase 5B establishes the canonical Gemini Structured Extraction layer of the GrowthForge Buyer Intelligence Engine.
It transforms raw conversational evidence persisted during Phase 5A into strict, typed, evidence-grounded buyer intelligence representations without mutating the raw transcript.

```
Sarvam Completed Call
        ↓
Phase 5A Ingestion (`call_transcripts` table)
        ↓
ConversationExtractionService (Gemini 2.5 Flash / Structured Output)
        ↓
Strict Canonical JSON & Epistemic Truth Levels
        ↓
Persistence (`conversation_extractions` table & `lead_events` audit)
        ↓
Ready for Phase 5C (Qualification & Scoring)
```

---

### 2. Core Epistemic Truth Levels

Every extracted buyer preference is strictly tagged with an epistemic truth level:

| Truth Level | Semantic Meaning | Rule |
| :--- | :--- | :--- |
| **`CONFIRMED`** | Explicitly stated by the buyer during the call. | Direct affirmative statement from buyer. |
| **`KNOWN`** | Authoritatively established by prior database records. | Not stated in current call, but verified elsewhere. |
| **`INFERRED`** | Reasonable interpretation from conversational context. | Not explicitly stated verbatim. |
| **`UNKNOWN`** | Missing, ambiguous, not discussed, or deferred. | **No numeric or value hallucination permitted.** If buyer says "budget depends on area", budget min/max are `null` and truth level is `UNKNOWN`. |

---

### 3. Architecture & Key Modules

1. **Canonical Extraction Schema** (`app/schemas/extraction.ts`)
   - `ExtractedBuyerIntelligence`
   - `ExtractedField<T>` with provenance (`value`, `truth_level`, `evidence`, `source`)
   - `ConversationExtraction` entity
   - `EXTRACTION_PROMPT_VERSION = '1.0'`, `EXTRACTION_SCHEMA_VERSION = '1.0'`

2. **Database Migration** (`supabase/migrations/003_conversation_extractions.sql`)
   - Table `conversation_extractions`
   - Foreign keys to `leads(id)`, `calls(id)`, `call_transcripts(id)` with `ON DELETE CASCADE`
   - Unique constraint `uq_conversation_extractions_unique UNIQUE (transcript_id, schema_version, prompt_version)`
   - Indexes on `lead_id`, `call_id`, `transcript_id`, `extraction_status`, `created_at`
   - Row-Level Security (RLS) and `updated_at` trigger

3. **System Prompt & Extraction Logic** (`app/prompts/conversationExtraction.ts`)
   - System instruction with strict speaker attribution rules (rejecting agent suggestions unless confirmed by buyer).
   - Multi-intent preservation (e.g., residential 3 BHK end-use + 800-1000 sq yd farmhouse investment).
   - Multilingual / Hinglish comprehension with verbatim source quotes.

4. **Gemini Extraction Provider Boundary** (`app/services/gemini/geminiExtractionProvider.ts`)
   - `RealGeminiExtractionProvider`: Server-side `@google/genai` client using `gemini-3.8-flash` and structured JSON schema enforcement (`responseMimeType: 'application/json'`).
   - `MockGeminiExtractionProvider`: Deterministic offline mock provider with error injection and scenario simulation for comprehensive test suites.

5. **Conversation Extraction Service** (`app/services/gemini/conversationExtractionService.ts`)
   - Ingestion coordination, validation, deterministic idempotency checking, schema validation, persistence, and audit logging.

6. **API Endpoints** (`server.ts`)
   - `POST /api/voice/extractions/extract`
   - `GET /api/voice/extractions/call/:callId`
   - `GET /api/voice/extractions/transcript/:transcriptId`
   - `GET /api/voice/extractions/lead/:leadId`

---

### 4. Deterministic Test Matrix (`tests/phase5b-gemini-extraction.ts`)

| Test Suite | Assertions | Status |
| :--- | :--- | :--- |
| **Canonical Extraction Structure** | Valid JSON adhering to schema | **PASS** |
| **Epistemic Truth Assignment** | `CONFIRMED`, `UNKNOWN`, `INFERRED` correctly categorized | **PASS** |
| **Zero Numeric Hallucination** | "Budget depends on area" preserves `min: null, max: null` | **PASS** |
| **Multi-Intent Requirements** | Dual requirements (3 BHK + Farmhouse) preserved in array | **PASS** |
| **Speaker Attribution** | Unconfirmed agent suggestions (e.g. 4 BHK) rejected | **PASS** |
| **Deterministic Idempotency** | Duplicate calls return `EXISTING_EXTRACTION` & audit event | **PASS** |
| **Forced Re-extraction** | `forceReextract: true` executes new extraction | **PASS** |
| **Error Handling** | Missing/empty transcripts return clean error actions | **PASS** |
| **Provider Failure & Malformed JSON** | Clean fallback and failure audit logging | **PASS** |
| **Runtime Schema Validation** | Rejection of illegal truth levels | **PASS** |
| **Transcript Immutability** | `call_transcripts` record remains 100% byte-for-byte identical | **PASS** |
| **Audit Events** | `EXTRACTION_STARTED`, `EXTRACTION_COMPLETED`, `EXTRACTION_DUPLICATE`, `EXTRACTION_FAILED` | **PASS** |
| **Retrieval Services** | Query by call, transcript, and lead | **PASS** |

**Regression Test Status:**
- `npm run test:phase4a`: **15/15 PASS**
- `npm run test:phase4b`: **15/15 PASS**
- `npm run test:phase5a`: **28/28 PASS**
- `npm run test:phase5b`: **63/63 PASS**
