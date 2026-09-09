# GrowthForge Buyer Intelligence Engine
## Phase 4B Freeze

**Status:** FROZEN  
**Phase:** Phase 4B — Real Sarvam Voice Agent Telephony Integration  
**Architecture:** Enterprise UI → Control/Workflow Layer → Specialized Business Agents → Voice Services → Supabase System of Record  

---

### Architecture & Pipeline Flow

```text
GrowthForge Lead (leads.status: ENRICHED)
    ↓
Call Eligibility Evaluation (Policy V1)
    ↓
CALL_PENDING
    ↓
CallService.startCall()
    ↓
VoiceProvider Abstraction
    ↓
SarvamVoiceProvider (VOICE_MODE=REAL / VOICE_PROVIDER=sarvam)
    ↓
SarvamClient.startOutboundCall()
    ↓
Sarvam Instant Outbound API (POST /api/outbounds/v1/orgs/{org_id}/workspaces/{workspace_id}/outbounds)
    ↓
Sarvam Webhook Event Stream (call.initiated → call.answered → call.ended)
    ↓
processSarvamWebhook (Dual Correlation via provider_call_id & lead_id)
    ↓
Supabase System of Record (calls & lead_events tables updated; leads.status: QUALIFICATION_IN_PROGRESS)
```

---

### Validated Capabilities (Phase 4B Frozen State)

1. **Provider-Neutral Voice Abstraction**:
   - `VoiceProvider` interface with seamless polymorphic routing.
   - `MockVoiceProvider` for deterministic local development and offline test suites (`initiated = false`, `status = MOCK_READY`).
   - `SarvamVoiceProvider` for production voice agent telephony.

2. **Runtime Configuration & Security**:
   - Dynamic mode resolution: `VOICE_MODE` (`REAL` | `MOCK`) and `VOICE_PROVIDER` (`sarvam` | `mock`).
   - Strict server-side secret management: `SARVAM_API_KEY` is loaded strictly on the backend, never exposed to client bundles or logged in telemetry.
   - PII protection: Phone numbers are masked in all audit event payloads and console logs (`*********2414`).

3. **Real Outbound Call Dispatch**:
   - Recipient phone strictly originates from the canonical GrowthForge lead (`leads.phone` ➔ `targetPhone` ➔ `user_config.user_phone_number`). Zero hard-coded test destinations in application runtime.
   - Exact Sarvam Instant Outbound schema implementation including `app_config` (`app_id`, integer `app_version`, `connection_config`), `user_config`, and `webhook_config`.

4. **Lifecycle & Supabase Audit Stream**:
   - Immutable audit trail in `lead_events`: `CALL_ELIGIBILITY_STARTED` ➔ `CALL_ELIGIBILITY_DECIDED` ➔ `CALL_REQUESTED` ➔ `CALL_PROVIDER_ACCEPTED` ➔ `CALL_COMPLETED`.
   - Authoritative workflow state managed via `leads.status`.
   - Call metadata, duration, and status persisted in `calls` table.

5. **Webhook Ingestion & Idempotency**:
   - Ingests `call.initiated`, `call.answered`, `call.ended` events with automatic GrowthForge canonical state mapping.
   - Dual correlation via `provider_call_id` / `outbound_id` and metadata `lead_id`.
   - Idempotent deduplication: redundant/duplicate webhook deliveries are acknowledged safely (`IGNORED_DUPLICATE`) without state regression or duplicated audit events.

6. **Phase 4A Regression Integrity**:
   - Deterministic call eligibility rules (15/15 unit matrix passing).

---

### Known Limitations Intentionally Deferred to Future Phases

The following capabilities are explicitly deferred and must **NOT** be scaffolded or implemented in Phase 4B:
1. Transcript ingestion
2. Gemini extraction & NLP entity parsing
3. Buyer qualification algorithms
4. Multi-factor buyer scoring
5. Project catalog matching & inventory recommendation
6. Broker handoff & CRM sync
7. Production RLS hardening & tenant isolation
8. Final compliance / regulatory consent hardening
9. Production observability & alerting dashboards

---

### Next Phase
**PHASE 5 — CONVERSATION INTELLIGENCE** (Transcript Ingestion, Extraction, Qualification & Scoring)
