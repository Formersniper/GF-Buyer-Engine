# GROWTHFORGE BUYER INTELLIGENCE ENGINE — MASTER CONTEXT & HANDOFF SPECIFICATION

**Repository**: `Formersniper/GF-Buyer-Engine`  
**Current Milestone**: Phase 5C Complete & Verified  
**Next Milestone**: Phase 5D — Buyer Scoring & Prioritization  
**Timestamp**: 2026-09-10  
**Status**: 100% Green Test Suite (167/167 assertions passing)  

---

## 1. Executive Summary & Product Objective

GrowthForge is an end-to-end, enterprise-grade **Buyer Intelligence & AI Qualification Engine** for high-velocity real estate sales operations (specifically optimized for high-demand corridors like Vrindavan, Tier-1/2 Indian real estate).

The system automates the complete lifecycle:
1. **Lead Ingestion & Identity Normalization** (Phase 1–3)
2. **Deterministic Call Eligibility Verification** (Phase 4A)
3. **Outbound Conversational Voice Calling via Sarvam AI** (Phase 4B)
4. **Immutable Transcript Ingestion** (Phase 5A)
5. **Epistemic Structured Intelligence Extraction via Gemini 2.5** (Phase 5B)
6. **Deterministic Multi-Dimension Buyer Qualification** (Phase 5C)
7. **Buyer Scoring, Ranking & Velocity Prioritization** (Phase 5D - Next)
8. **Inventory & Project Matching** (Phase 5E - Upcoming)

---

## 2. End-to-End Pipeline Flow

```
Lead Ingestion (API/CSV/Webhook)
        ↓
Data Cleansing, Identity & Phone Sanitization (E.164)
        ↓
Lead Enrichment & Verification
        ↓
Phase 4A: Call Eligibility Verification (TCPA/Consent/DND/State Check)
        ↓ (If ELIGIBLE -> CALL_PENDING)
Phase 4B: Sarvam AI Voice Agent Integration (Hindi/English/Hinglish)
        ↓ (Call completed / webhook received)
Phase 5A: Transcript Ingestion Service (`call_transcripts` table, MD5 hash, idempotent)
        ↓ (TRANSCRIPT_INGESTED event)
Phase 5B: Gemini 2.5 Structured Intelligence Extraction (`conversation_extractions` table)
        ↓ (EXTRACTION_COMPLETED event)
Phase 5C: Deterministic Qualification Engine (`buyer_qualifications` table)
        ↓ (QUALIFICATION_COMPLETED event -> QUALIFIED | PARTIALLY_QUALIFIED | NURTURE | REQUIRES_REVIEW)
Phase 5D: Buyer Scoring & Prioritization Engine (Deferred / Next)
        ↓
Phase 5E: Project & Inventory Matching Engine (Deferred)
```

---

## 3. Database Schema & Architecture (Supabase / PostgreSQL)

### Tables & Migrations:

1. **`leads`** (`supabase/migrations/001_initial_schema.sql`)
   - Primary key: `id` (UUID)
   - Unique identifier: `lead_id` (e.g. `GF-LEAD-XXX`)
   - Fields: `name`, `phone`, `email`, `source`, `source_reference`, `status`, `workflow_state`, `enrichment_data`, `created_at`, `updated_at`.
   - Authoritative workflow statuses: `RAW`, `ENRICHING`, `ENRICHED`, `ENRICHMENT_FAILED`, `CALL_PENDING`, `CALL_INITIATED`, `CALL_IN_PROGRESS`, `CALL_COMPLETED`, `CALL_FAILED`, `QUALIFIED`, `PARTIALLY_QUALIFIED`, `NURTURE`, `REQUIRES_REVIEW`, `DISQUALIFIED`.

2. **`lead_events`** (`supabase/migrations/001_initial_schema.sql`)
   - Append-only audit trail logging every state transition, eligibility decision, webhook event, extraction, and qualification.
   - Fields: `id`, `lead_id`, `event_type`, `payload`, `created_at`.

3. **`calls`** (`supabase/migrations/001_initial_schema.sql`)
   - Telephony records tracking outbound sessions.
   - Fields: `id`, `lead_id`, `provider` (`sarvam`), `provider_call_id`, `status` (`PENDING`, `INITIATED`, `IN_PROGRESS`, `COMPLETED`, `FAILED`, `BUSY`, `NO_ANSWER`), `duration_seconds`, `started_at`, `ended_at`, `cost`, `recording_url`, `metadata`.

4. **`call_transcripts`** (`supabase/migrations/002_call_transcripts.sql`)
   - Immutable conversational transcripts captured from voice provider webhooks or streams.
   - Fields: `id`, `lead_id`, `call_id`, `provider_call_id`, `interaction_id`, `transcript_text`, `transcript_turns` (JSONB), `language`, `duration_seconds`, `source`, `ingestion_status`, `content_hash` (MD5 idempotency), `captured_at`.
   - Unique constraint on `(call_id, content_hash)`.

5. **`conversation_extractions`** (`supabase/migrations/003_conversation_extractions.sql`)
   - Epistemic structured intelligence extracted by Gemini Flash.
   - Fields: `id`, `lead_id`, `call_id`, `transcript_id`, `provider_call_id`, `interaction_id`, `model`, `prompt_version`, `schema_version`, `extraction_status`, `extracted_data` (JSONB), `raw_gemini_response` (JSONB), `error_message`, `created_at`.
   - Unique constraint on `(transcript_id, schema_version, prompt_version)`.

6. **`buyer_qualifications`** (`supabase/migrations/004_buyer_qualifications.sql`)
   - Deterministic qualification record evaluating 10 dimensions.
   - Fields: `id`, `lead_id`, `extraction_id`, `qualification_status` (`QUALIFIED`, `PARTIALLY_QUALIFIED`, `NURTURE`, `REQUIRES_REVIEW`, `DISQUALIFIED`), `reason_codes` (text[]), `blocking_fields` (text[]), `follow_up_fields` (text[]), `dimension_assessments` (JSONB), `evidence_refs` (JSONB), `qualification_version`, `rule_version`, `created_at`, `updated_at`.
   - Unique constraint on `(extraction_id, rule_version, qualification_version)`.

---

## 4. Epistemic Truth Model & Intelligence Schema (Phase 5B)

The system rejects binary guesses and enforces 5 strict truth levels:
- **`CONFIRMED`**: Explicitly stated by the buyer in the audio/transcript with exact quote evidence.
- **`KNOWN`**: Known via CRM / historical metadata.
- **`UNKNOWN`**: Explicitly unmentioned or unanswered during the conversation. (Never hallucinated).
- **`INFERRED`**: Logical implication with lower confidence.
- **`CONFLICTED`**: Contradictory statements within the same or across calls.

### Canonical Multi-Requirement Preservation:
The system supports multiple distinct property interests per buyer (e.g. Canonical buyer *Anupam Saini*):
- **Requirement 1**: Residential 3 BHK on Chatti Kila Road, Vrindavan for End Use / Residence. Budget: qualitative ("depends on area"). Timeline: As soon as possible.
- **Requirement 2**: Farmhouse 800–1000 sq yards in Vrindavan for Investment.

---

## 5. Qualification Engine Rules (Phase 5C)

Evaluates 10 distinct dimensions without inventory bias:
1. **Intent**: Active interest confirmed vs disconfirmed.
2. **Property Type**: Primary type identified.
3. **Configuration**: Layout / unit configuration (e.g., 3 BHK).
4. **Location**: Preferred locations confirmed with evidence.
5. **Purpose**: End-use vs investment.
6. **Timeline**: Immediate / ASAP vs distant (2+ years).
7. **Budget**: Confirmed numeric range vs missing/qualitative.
8. **Financing**: Self-funded vs loan required vs unknown.
9. **Decision Maker**: Sole decision maker vs family discussion needed.
10. **Contact Readiness**: Phone validity and communication consent.

### Decision Matrix:
- **`QUALIFIED`**: Intent confirmed + Location confirmed + Requirements confirmed + Numeric Budget confirmed.
- **`PARTIALLY_QUALIFIED`**: Intent & requirements confirmed, but missing commercial/budget clarity (e.g., Anupam Saini: `blocking_fields: ['budget']`, `follow_up_fields: ['budget', 'financing', 'decision_maker']`).
- **`NURTURE`**: Disinterested (`interested: false`), vague exploratory without criteria, or distant timeline (2+ years) with unresolved requirements.
- **`REQUIRES_REVIEW`**: Contradictory extraction data (e.g. `min_budget > max_budget`), invalid schema, or failed extraction.

---

## 6. Verification Status & Test Suite

The system maintains 100% offline and live test suites with zero external mocks required for CI:

| Test Command | Scope | Assertions | Result |
| :--- | :--- | :--- | :--- |
| `npm run test:phase4a` | Call Eligibility Verification Matrix | 15 / 15 | **PASS** |
| `npm run test:phase4b` | Sarvam Voice API & Webhook Integration | 15 / 15 | **PASS** |
| `npm run test:phase5a` | Call Transcript Ingestion & Idempotency | 28 / 28 | **PASS** |
| `npm run test:phase5b` | Gemini 2.5 Structured Intelligence Extraction | 63 / 63 | **PASS** |
| `npm run test:phase5c` | Deterministic Buyer Qualification Engine | 46 / 46 | **PASS** |
| **Total Test Suite** | **All System Phases** | **167 / 167** | **100% PASS** |

---

## 7. Next Immediate Roadmap (Phase 5D & Beyond)

1. **Phase 5D — Buyer Scoring & Prioritization Engine**:
   - Compute deterministic dynamic readiness score (0–100) based on Intent, Commercial Readiness, Velocity/Timeline, and Requirement Clarity.
   - Lead Tier classification: Tier 1 (Hot/Immediate), Tier 2 (Warm/Near-Term), Tier 3 (Nurture/Cold), Tier 4 (Review/Flagged).
   - Priority queue calculation for sales team follow-up dispatch.

2. **Phase 5E — Inventory & Project Matching**:
   - Multi-requirement project recommendation engine matching buyer criteria (location, configuration, budget, land area) against project catalog.

---

## 8. Seamless New Chat Prompt / Instructions

To continue developing in a new chat, use the following prompt:

> *"We are continuing work on GrowthForge Buyer Intelligence Engine (`Formersniper/GF-Buyer-Engine`). Phase 1 through Phase 5C are complete, verified, and locked with 100% test coverage (167/167 tests passing). Please review `/docs/MASTER_PROJECT_CONTEXT.md` and proceed with the next task."*
