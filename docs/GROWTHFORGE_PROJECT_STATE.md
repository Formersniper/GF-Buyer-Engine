# GROWTHFORGE PROJECT STATE & ARCHITECTURAL BASELINE

> **READ THIS DOCUMENT BEFORE MODIFYING ANY CODE.**  
> **The commit hashes in this document are authoritative checkpoints.**

---

## 1. PRODUCT & CORE MISSION

- **Product:** GrowthForge Buyer Intelligence / Qualified Lead Generation Engine
- **Primary Market:** Real-estate brokers, builders, and property developers.
- **Core Product Thesis:** GrowthForge is **NOT** a generic CRM. Its sole architectural purpose is to convert noisy, public, and unstructured lead signals into verified, high-intent real-estate buyer opportunities, matching them against actual inventory, and delivering those qualified buyers deterministically to external client commercial systems.
- **Core Truth Model:**
  - `KNOWN`: Empirically validated public or historical fact.
  - `INFERRED`: AI/heuristic recommendation derived from signals.
  - `CONFIRMED`: First-party intent validated directly by the buyer via voice/interaction.
  - `UNKNOWN`: Insufficient evidence.
  *Public intelligence or AI inferences must never be represented as confirmed buyer intent.*

---

## 2. SYSTEM ARCHITECTURE & DATA FLOW

### Canonical System Architecture
```
Enterprise UI
  → Control Plane
    → Master Agent
      → Agent Registry
        → Specialized Business Agents
          → n8n Execution / Orchestration Layer
            → Business Systems
              → Result / Impact Layer
```

### Buyer Intelligence Pipeline
```
Raw Lead
  → Lead Resolver
    → Scout Enrichment
      → Buyer Signal Analysis
        → Call Eligibility
          → Voice Qualification (First-Party Intent)
            → Call Transcript Ingestion
              → Gemini Structured Extraction
                → Buyer Qualification
                  → Buyer Scoring (Composite Score & Priority Tiers)
                    → Project / Inventory Matching
                      → Broker Handoff Package Assembly
                        → CRM / Webhook Dispatch
                          → Commercial Outcome
```

---

## 3. PHASE HISTORY & COMMIT CHECKPOINTS

**CURRENT_PHASE:** Phase 9.2
**CURRENT_STATUS:** FROZEN

**NEXT_MILESTONE:**
Phase 9.3 — TO BE DEFINED

- **Phase 9.2 (Client Onboarding + Lead Intake):**
  - **Purpose:** Implement real-world client onboarding, project and inventory setup, API-key secured inbound lead intake, CSV intake hardening, RLS table isolation, and CRM configuration.
  - **Client Onboarding Capability:**
    - Real-estate project catalog setup with name, developer, location, configuration, pricing, and amenities.
    - Project inventory unit configuration with unit numbers, floor plans, pricing, and availability states.
    - Intake source configuration with API key provisioning, inbound webhook endpoints, and CSV batch templates.
    - CRM export configuration wrapper with endpoint URL, auth type, headers, and target systems.
  - **Inbound Lead Intake Capability:**
    - Canonical HTTP POST route (`/api/v1/inbound/lead`) for real-time lead ingestion from portals, landing pages, and lead providers.
    - Transport idempotency using `webhook_events` tracking `source_event_id` and payload hashing to prevent duplicate lead processing.
    - Canonical resolution boundary: Every inbound lead flows through `resolveLead()` for phone/email normalization, identity reconciliation, and deduplication.
    - Pipeline boundary preserved: Inbound webhook stages leads into canonical storage without triggering or creating duplicate `pipeline_executions`. Voice qualification and durable pipeline progression boundaries remain completely intact.
  - **API-Key Authentication & Tenant Scoping:**
    - API keys are hashed with SHA-256 (`api_key_hash`) and verified against the tenant record; plaintext keys are never stored or logged.
    - Tenant context (`req.auth.tenant_id`) is strictly bound to the authenticated API key or verified JWT; requests attempting to override `tenant_id` via body or query parameters fail closed.
  - **CSV Intake Hardening:**
    - Replaced unrestricted full-table scans with targeted, tenant-scoped phone and email lookups (`findExistingByContactInfo`).
    - Enforced tenant boundaries during batch row normalization and deduplication.
  - **RLS Hardening (Migration `013_harden_001_rls.sql`):**
    - Enabled RLS and dropped permissive public policies across all 10 core tables: `leads`, `lead_enrichment`, `calls`, `buyer_profiles`, `buyer_preferences`, `projects`, `project_matches`, `buyer_scores`, `lead_events`, `webhook_events`.
    - Enforced tenant-scoped policies checking `auth.jwt() -> 'app_metadata' ->> 'tenant_id' = tenant_id` with regex UUID validation. Missing or invalid claims fail closed.
  - **Verified Limitations:**
    - Automatic voice qualification calls are not triggered upon inbound intake; inbound leads remain in `INGESTED` / `DISPATCHED` staged state pending call scheduling.
    - CRM export configurations wrap and configure dispatch endpoints but do not add unrequested generic CRM contact management tools.
  - **Test Suite Verification:**
    - `tests/phase92-lead-intake.ts`: PASS (100% verification across API auth, webhook idempotency, CSV intake, and RLS hardening)
    - Full regression suites (8B.7.9, 8B.7.8, 8B.7.5, 8B.7.4, 8B.7.3, 8B.6.3, 8B.6.2, 8B.6.1): PASS (100%)
  - **Status:** **FROZEN**

- **Phase 9.1 (Commercial Buyer Intelligence Workspace):**
  - **Purpose:** Implement the Commercial Buyer Intelligence Workspace.
  - **Implemented:**
    - Overview Dashboard
    - SLA Priority Queue
    - All Buyers
    - Buyer Dossier
    - Project Inventory
    - Commercial navigation
    - Provenance/truth badges
    - Canonical scoring/qualification/SLA consumption
  - **Verification:** Epistemic presentation correctly displays CONFIRMED, KNOWN, INFERRED, UNKNOWN, and AI_RECOMMENDED. Tenant isolation preserved. Regression suites passed.
  - **Status:** **FROZEN**

- **Phase 8B.4 (Database & RLS Hardening):**  
  - Controlled database/RLS remediation, CASE-guarded UUID validation, multi-tenant app_metadata verification.
  - Status: **FROZEN**
  - Commit SHA: `b1b14fd4448f6011eeaa73c9239aef6ea26b2d90`

- **Phase 8B.5.2 (Hardened Webhook Dispatch Adapter):**  
  - Hardened `WebhookBrokerHandoffChannel` implementation with SSRF boundary controls, DNS preflight validation, private/cloud IP blocking, redirect rejection, credential masking.
  - Status: **COMPLETE**
  - Commit SHA: `b1d603cf0c2bcc4c6775a19b788484449c073030`

- **Phase 8B.5.3 (Production Webhook Handoff Integration):**  
  - Integrated `WebhookBrokerHandoffChannel` into `BrokerHandoffService.dispatchHandoff`.
  - Enforced fail-closed behavior for unconfigured/disabled/invalid CRM endpoints (eliminated silent Mock fallback under `dryRun=false`).
  - Status: **COMPLETE**
  - Commit SHA: `4b09a57ef6a84d2eb7c55e5f90ab226ed42e20c5`

- **Phase 8B.5.4 (Production Security Review & E2E Verification):**  
  - Security review of tenant authorization semantics, end-to-end webhook dispatch audit, and idempotency verification.
  - Status: **FROZEN**
  - Commit SHA: `18bdcf8c9c79f340acbeb4cc6f7d84f60dbce92d`

- **Phase 8B.6.1 (Production Buyer Pipeline Coordinator):**
  - **Purpose:** Close the post-call orchestration gap by composing the existing production services into a deterministic buyer-intelligence pipeline.
  - **Implemented flow:** Transcript Availability / Ingestion → Conversation Extraction → Buyer Qualification → Buyer Scoring → Project / Inventory Matching → Broker Handoff Generation
  - **Implementation:**
    - BuyerPipelineCoordinator added.
    - Existing extraction, qualification, scoring, matching, and handoff services are orchestrated rather than reimplemented.
    - Deterministic sequential execution.
    - Downstream stages halt on upstream failure.
    - Existing idempotency mechanisms are preserved.
    - Tenant isolation is preserved.
    - Correlation/request identifiers are propagated.
    - Audit/stage progression is observable through existing mechanisms.
    - AI inference is not promoted to buyer confirmation.
    - Buyer-stated facts preserve appropriate CONFIRMED provenance.
    - Public/Scout intelligence remains INFERRED.
    - Project recommendations remain buyer_confirmed=false and recommendation_status=AI_RECOMMENDED unless an explicit future verification mechanism changes that state.
    - No Sarvam webhook auto-progression was implemented in 8B.6.1.
    - No new database tables or migrations were introduced.
    - No Supabase schema changes were made.
    - No generic CRM functionality was introduced.
    - No Phase 8B.6.2 functionality was implemented.
  - **Files introduced / modified in 8B.6.1:**
    - `app/services/pipeline/buyerPipelineCoordinator.ts`
    - `app/services/pipeline/index.ts`
    - `app/services/workflow/index.ts`
    - `package.json`
    - `tests/phase8b6-pipeline-coordinator.ts`
  - **Verification:**
    - Phase 8B.6.1 coordinator test suite: 10 Passed, 0 Failed.
    - Typecheck: PASS.
    - Lint: PASS.
    - Production build: PASS.
    - Diff check: PASS.
    - Tenant isolation: VERIFIED.
    - Idempotency: VERIFIED.
    - Failure handling: VERIFIED.
    - Truth/provenance preservation: VERIFIED.
    - AI recommendation boundary: VERIFIED.
    - Database changes: NONE.
    - Webhook modification: NONE.
  - **Test Environment Finding:** The Phase 8B.6.1 integration test suite uses live Supabase data and currently does not contain teardown/cleanup logic. Test-created artifacts may therefore persist in the database and may require manual cleanup.
  - Status: **FROZEN**
  - Commit SHA: `934409dad4b7c18a41c22703bc0048b16f24e3b7`

- **Phase 8B.7.4 (Durable Recovery Worker):**
  - Durable background worker for recovery and crash resilience with atomic claims, lease fencing, exponential retry backoff, and PostgREST schema-cache error remediation.
  - Status: **FROZEN**

- **Phase 8B.7.8 (Service-Role Alignment & Graceful Worker Shutdown):**
  - Service-role admin client enforced for background worker and recovery operations under RLS, eliminated silent anonymous fallback, preserved tenant boundaries, and implemented bounded signal handling (SIGTERM/SIGINT).
  - Status: **FROZEN**

- **Phase 8B.7.9 (Live Multi-Worker Claim / Lease / Fencing Concurrency Verification):**
  - Real multi-worker concurrency, atomic claim, lease reclamation, zombie worker fencing, and tenant isolation verified against live Supabase PostgreSQL.
  - Status: **FROZEN**
  - Verified Production Baseline Commit SHA: `ecdc9b970a40076388fcf1d61991503f7173a128`

- **Phase 8B.7.10 (Final Production Verification & Freeze):**
  - Final production verification across all database, security, runtime, pipeline, regression, quality, and observability invariants against live Supabase PostgreSQL. All test artifacts cleaned up. Baseline frozen.
  - Status: **FROZEN**

---

## 4. SUBSYSTEM IMPLEMENTATION DETAILS

### A. Webhook Channel Adapter (`app/services/handoff/channels/brokerHandoffChannel.ts`)
- **HTTP POST:** Delivers canonical `BrokerHandoffPackage`.
- **SSRF Hardening:**
  - Strict protocol enforcement (`http:`, `https:`).
  - Explicit blacklist: `localhost`, `loopback`, `metadata.google.internal`, `metadata.google`, `instance-metadata`.
  - DNS preflight resolution against blocked ranges: RFC1918 private IPv4 (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), loopback (`127.0.0.0/8`), link-local (`169.254.0.0/16`), multicast, IPv6 (`::1`, `fe80::/10`, `fc00::/7`, `ff00::/8`).
  - `redirect: 'error'` to strictly prevent redirect-based SSRF.
- **Header & Injection Protection:**
  - CRLF rejection regex: `!/[\r\n]/.test(...)`.
  - Forbidden header filtering: drops `Host`, `Content-Length`, `Connection`, `Transfer-Encoding`, `Upgrade`, `TE`, `Keep-Alive`, `Via`, `HTTP2-Settings`, and `Proxy-*`.
  - Enforced `Content-Type: application/json`.
- **Timeouts & Redaction:**
  - 5000ms timeout via `AbortController` returning canonical message `"Request timed out after 5000ms"`.
  - Credential masking: Bearer tokens and secret keys redacted from errors and logs.
  - Dry-run mode (`dry_run: true`) executes zero outbound network operations.
- **Hardening Tests:** `tests/test-webhook-channel.ts` (18/18 PASS).

### B. Broker Handoff Service (`app/services/handoff/brokerHandoffService.ts`)
- **Routing Decision Tree (`options.dryRun=false`):**
  - Active `destination_type === 'WEBHOOK'` and valid `endpoint_url` → Dispatches live HTTP request via `WebhookBrokerHandoffChannel`.
  - `dry_run_mode === true` or `options.dryRun === true` → Routes to `MockBrokerHandoffChannel` (zero network calls).
  - Missing CRM configuration → `FAILED` (`CRM webhook configuration is missing`).
  - Disabled CRM configuration (`is_enabled: false`) → `FAILED` (`CRM webhook configuration is disabled`).
  - Missing endpoint URL → `FAILED` (`CRM webhook endpoint is missing`).
  - Invalid/unparseable endpoint URL → `FAILED` (`CRM webhook endpoint is invalid`).
  - Unsupported destination type → `FAILED` (`CRM destination type is unsupported`).
  - **No silent Mock fallback exists for production configurations.**
- **Integration Tests:** `tests/test-webhook-integration.ts` (14/14 PASS).

---

## 5. SECURITY & TENANT AUTHORIZATION AUDIT (PHASE 8B.5.4)

### A. RLS Security Baseline
- `broker_handoffs` table RLS uses `auth.jwt() -> app_metadata ->> 'tenant_id'` with top-level `tenant_id` fallback.
- CASE-guarded UUID format validation ensures invalid or non-UUID tokens fail closed without SQL cast exceptions.
- RLS validation suite (`tests/test-rls.ts`): 7/7 PASS across valid tenants, cross-tenant isolation, missing claims, null claims, and malformed UUIDs.
- Webhook RLS DB suite (`tests/security-webhook-rls-db.ts`): 12/12 PASS.
- Repository tenant scoping suite (`tests/security-repository-tenant-scoping.ts`): 12/12 PASS.

### B. Tenant Scope Semantics & Defense-in-Depth Finding
- **Current Behavior:** In `BrokerHandoffService.dispatchHandoff`:
  - CRM configuration lookup enforces strict tenant filtering: `isPlatformAdmin: false` and `c.tenant_id === tenantId`.
  - Downstream update and event calls (`updateDispatchStatus`, `updateStatus`, `appendLeadEvent`) pass `tenantScope = { tenantId, isPlatformAdmin: true }`.
- **Safety Assessment:** The execution path is verified **SAFE** because:
  1. `tenantId` is authoritatively derived from the stored database handoff record (`handoff.tenant_id`).
  2. The external caller cannot inject or spoof an arbitrary `tenantId`.
  3. All database operations strictly target the specific verified `handoffId` and associated `leadId`.
  4. Cross-tenant E2E tests confirmed Tenant A cannot dispatch using Tenant B's endpoint.
- **Technical Debt & Future Hardening:** In repository helper methods, `isPlatformAdmin: true` bypasses SQL-level `.eq('tenant_id', scope.tenantId)` filtering. As a defense-in-depth improvement in a future refactor, these calls should be updated to `{ tenantId, isPlatformAdmin: false }`.

---

## 6. END-TO-END VERIFICATION & RETRY SEMANTICS

Deterministic local receiver validation proved:
1. **Single Delivery:** Initial dispatch triggers exactly one HTTP POST request.
2. **Payload & Credential Isolation:** Full canonical `BrokerHandoffPackage` received intact with `Content-Type: application/json`. Tokens are present only in headers (`Authorization: Bearer ...`), never in body.
3. **Database State Updates:** Successful delivery updates `broker_handoffs.dispatch_status = 'SENT'`, recording `dispatch_id` and `last_attempt_at`.
4. **Idempotency:** A duplicate dispatch call on a `SENT` or `ACKNOWLEDGED` record returns `status: 'IGNORED_DUPLICATE'` and suppresses network dispatch. Audit event `DISPATCH_DUPLICATE` is logged.
5. **Force Redispatch:** Setting `forceRedispatch: true` explicitly bypasses deduplication to re-trigger delivery.
6. **Retry Mapping:**
   - `4xx` responses → `FAILED`, `retry_eligible: false`.
   - `5xx` responses → `FAILED`, `retry_eligible: true`.
   - Timeouts & socket errors → `FAILED`, `retry_eligible: true`.

---

## 7. DATABASE & MIGRATION STATE

- **System of Record:** Supabase PostgreSQL.
- **Core Tables:** `tenants`, `tenant_memberships`, `leads`, `broker_handoffs`, `crm_configurations`, `lead_events`, `buyer_scores`, `buyer_qualifications`, `project_matches`.
- **Migration Status:** Phases 8B.5.2, 8B.5.3, and 8B.5.4 required **ZERO** database migrations.
- **Policy Invariant:** Existing RLS policies remain unaltered and active.

---

## 8. TEST SUITE MATRIX

| Test Suite | File | Results |
| :--- | :--- | :--- |
| Webhook Channel Hardening | `tests/test-webhook-channel.ts` | **18 / 18 PASS** |
| Webhook Channel Integration | `tests/test-webhook-integration.ts` | **14 / 14 PASS** |
| Real Supabase RLS | `tests/test-rls.ts` | **7 / 7 PASS** |
| Repository Tenant Scoping | `tests/security-repository-tenant-scoping.ts` | **12 / 12 PASS** |
| Webhook Database RLS | `tests/security-webhook-rls-db.ts` | **12 / 12 PASS** |
| Phase 8B.4 Dispatch Monitoring | `tests/phase8b4-dispatch-monitoring.ts` | **6 / 6 PASS** |
| TypeScript Typecheck | `npx tsc --noEmit` | **PASS (0 errors)** |
| Production Applet Build | `npm run build` | **PASS (Vite + esbuild)** |
| ESLint Validation | `npm run lint` | **PASS** |

### Known Legacy Test
- `tests/phase8b3-crm-dispatch.ts`: Tests deprecated Phase 8B.3 behavior where an unsupported destination type under `dryRun=false` fell back to Mock. Under Phase 8B.5 fail-closed requirements, this is intentionally unsupported. **Do not modify this legacy test or restore fallback behavior.**

---

## 9. KNOWN RISKS & OPERATIONAL BOUNDARIES

1. **DNS Rebinding TOCTOU:** A theoretical race window exists between preflight DNS resolution and native `fetch` connection. Mitigated by redirect blocking and 5-second socket aborts.
2. **Sub-millisecond Concurrency:** Concurrent dispatches initiated within milliseconds before initial database status commit could read `PENDING`. Application-level idempotency covers standard retries; database advisory locks may be evaluated if high-concurrency duplicates occur.
3. **Defense-in-Depth Tenant Scope:** Refactoring `{ tenantId, isPlatformAdmin: false }` into mutation methods will be addressed in a scheduled cleanup.
4. **Scheduled Retries:** Automatic background polling/retry worker does not yet run as a daemon; retries operate deterministically via the existing state machine and API triggers.

---

## 10. PRODUCT BOUNDARY INVARIANTS

GrowthForge **MUST NOT** be extended into:
- A generic multi-tenant CRM or contact management suite.
- A Kanban board for sales rep task tracking.
- An arbitrary broker allocation or round-robin call center tool.

The product boundary remains strictly:  
**Buyer Signal Intelligence → Rigorous Qualification → Inventory Matching → Commercial Handoff.**

---

## 11. REPOSITORY SYNCHRONIZATION PROTOCOL

1. Develop exclusively within the defined scope.
2. Run focused tests and verify zero regressions.
3. Validate types (`tsc --noEmit`), lint (`npm run lint`), and build (`npm run build`).
4. Inspect `git diff` to confirm zero unrelated changes or credential leaks.
5. Create singular, descriptive commits.
6. Push directly to `origin/main` without rebase, amend, or force push.
7. Verify `HEAD === origin/main` with `ahead = 0`, `behind = 0`, and a clean working tree.
8. Apply Supabase migrations only when structurally required.
9. GitHub represents the authoritative source code history; Supabase represents the authoritative data state.

---

## 12. CURRENT REPOSITORY STATUS

```yaml
CURRENT_PHASE: Phase 9.0
CURRENT_STATUS: COMPLETE (Product Contract & Commercial Architecture)
LAST_FROZEN_PHASE: Phase 8B.7.10
NEXT_PHASE: Phase 9.1 — Commercial UX / Buyer Intelligence Workspace
```

### Phase 9.0 — Commercial Product Contract (COMPLETE)
- **Authoritative Contract Document:** `docs/PHASE_9_COMMERCIAL_PRODUCT_CONTRACT.md`
- **Objective:** Defined and frozen the commercial and functional contract for the first client-testable version of GrowthForge Buyer Intelligence.
- **Architectural Scope:** Zero modifications to frozen Phase 8B execution engine, database schema, or migrations.
- **Key Commercial Decisions:**
  - **Primary ICP:** Mid-Sized Real-Estate Brokerages & Channel Partners (15–50 agents, 1,000–5,000 raw digital leads/month).
  - **Core Product Formula:** "GrowthForge helps mid-sized real-estate brokerages and channel partners turn unvetted digital marketing leads into verified, scored buyer dossiers matched to active inventory."
  - **Truth Contract:** Strict enforcement of `CONFIRMED` (verbatim transcript evidence) vs `INFERRED` (public Scout enrichment) vs `AI_RECOMMENDED` (inventory matches with `buyer_confirmed: false`).
  - **Value Metric:** Verified Qualified Buyer Output Rate; hybrid pricing hypothesis (Platform Subscription + Per-Qualified-Buyer fee).
  - **Pilot Contract:** 30-day, 1,000-lead pilot program targeting 2–3 channel partners.

### Verified Production Baseline
- **Phase 8B.7.9 Baseline Commit:** `ecdc9b970a40076388fcf1d61991503f7173a128`
- **Phase 8B.7.10 Freeze Commit:** (Current commit — Final documentation freeze commit)
- **Production Verification Status:** **PASSED**

### Verified Production Invariants (Live Supabase / PostgreSQL Environment)
The following invariants were comprehensively verified against the live production Supabase/PostgreSQL database and runtime:
1. **Migrations 011 and 012 Applied:** Durable `pipeline_executions` schema and atomic `claim_pipeline_execution` RPC.
2. **Durable Execution Schema:** 19 required columns, foreign keys, timestamps, and unique idempotency constraint `(tenant_id, idempotency_key)`.
3. **RLS Enforcement:** Unauthenticated anonymous client access is strictly denied (401 / permission denied).
4. **Atomic RPC Execution:** `claim_pipeline_execution` functions correctly via PostgreSQL `FOR UPDATE SKIP LOCKED`.
5. **Live Multi-Worker Claim Concurrency:** Concurrent workers serialized safely; zero duplicate claims.
6. **Lease Reclamation:** Expired leases automatically reclaimed by active workers with incremented `attempt_count`.
7. **Lease-Token Fencing:** Zombie workers presenting stale tokens are fenced out with 0 rows mutated; legitimate worker mutations succeed.
8. **Tenant Isolation:** Cross-tenant reads and mutations rejected; coordinator enforces tenant boundary checks.
9. **Service-Role Execution Privileges:** Background worker and recovery processes utilize non-downgrading service-role client while preserving tenant boundaries.
10. **Graceful Worker Shutdown:** SIGTERM and SIGINT stop polling intervals and drain active executions with bounded timeouts without hanging.
11. **Complete Buyer Pipeline Progression:** Deterministic sequence: Transcript Validation → Extraction → Qualification → Scoring → Matching → Handoff Generation → Dispatch → Terminal COMPLETED.
12. **Webhook Idempotency:** Deterministic deduplication on `(event_id, provider_call_id)` in `webhook_events`.
13. **CRM Dispatch:** Synchronous handoff dispatch to configured webhook channel with SSRF boundary controls.
14. **Audit & Observability:** Correlation and request IDs propagated throughout all pipeline stages; structured audit logs written to `lead_events`.
15. **Test Artifact Cleanup:** All verification test fixtures deleted in reverse foreign-key order; zero orphaned test artifacts remain.

### Important Known Limitations
1. **Cloud Run Background Polling:** Serverless container environments (Cloud Run) require continuous CPU allocation (`--no-cpu-throttling`) when idle to maintain background worker polling intervals between incoming webhook events.
2. **At-Least-Once External Delivery:** External CRM / webhook delivery remains **AT-LEAST-ONCE** at the network transport boundary.
3. **Receiver-Side Idempotency Required:** Exactly-once external processing is **only** possible when the receiving CRM/broker endpoint provides idempotency using `handoff_id`, `dispatch_id`, or an equivalent mechanism. GrowthForge does not claim to provide exactly-once external CRM processing independently of receiver-side idempotency.
4. **Legacy Static Webhook Event IDs:** Informational legacy static event IDs (`evt-1`, `evt-2`, `evt-3`) exist in `webhook_events` from early development and correctly trigger deterministic duplicate suppression (`IGNORED_DUPLICATE`). They must not be deleted or modified in this freeze operation.

### Recent Completed Milestones
- **Phase 8B.6.2 (Webhook Auto-Progression Hook):** COMPLETE & FROZEN. Sarvam call completion events auto-trigger the BuyerPipelineCoordinator using a fire-and-forget promise wrapper with strict duplication checks.
- **Phase 8B.6.3 (Pipeline Dispatch Completion):** COMPLETE & FROZEN. The pipeline was extended with a synchronous `DISPATCH` stage.
- **Phase 8B.7.1 (Terminal State Contract):** COMPLETE & FROZEN. Pipeline Execution State and CRM Dispatch Outcome are decoupled.
- **Phase 8B.7.2 (Durable Recovery Audit):** COMPLETE & FROZEN. Read-only architecture audit of crash windows and recovery.
- **Phase 8B.7.3 (Durable Pipeline Execution Contract & Persistence):** COMPLETE & FROZEN. Introduces the durable boundary for pipeline execution using `pipeline_executions`.
- **Phase 8B.7.4 (Durable Recovery Worker):** COMPLETE & FROZEN. Background worker, atomic claim RPC, and lease fencing.
- **Phase 8B.7.5 (Crash / Retry / Recovery E2E Verification):** COMPLETE & FROZEN. 15/15 tests passed across crash windows, zombie fencing, and retry backoff.
- **Phase 8B.7.6 & 8B.7.7 (Live Supabase & Worker Runtime Read-Only Audits):** COMPLETE. Confirmed Migrations 011 and 012 applied to live Supabase; identified anonymous client privilege gap for background worker operations under RLS and missing SIGTERM/SIGINT shutdown handling.
- **Phase 8B.7.8 (Service-Role Alignment + Graceful Worker Shutdown):** COMPLETE & FROZEN. Enforced service-role admin client for durable background operations, eliminated silent anonymous fallback, preserved tenant boundaries, and implemented bounded signal handling.

### Phase 8B.7.9 — Live Multi-Worker Claim / Lease / Fencing Concurrency Verification (FROZEN)
- **Live Verification Suite (`tests/phase8b79-live-concurrency.ts`):**
  - Executed directly against the LIVE Supabase PostgreSQL database using multiple independent client instances simulating discrete worker processes and distinct database connections.
  - Comprehensive isolation: uses dedicated test tenants, test leads, and test executions, with verified zero-leak cleanup in reverse foreign-key dependency order.
- **Verification Results across All Required Invariants:**
  - **TEST A (Concurrent Claim):** Two independent workers concurrently invoked `claim_pipeline_execution` on a single PENDING execution.
    - Exactly one worker claimed the execution; the losing worker received 0 claims.
    - PostgreSQL row-level locking (`FOR UPDATE SKIP LOCKED`) successfully serialized claim attempts.
    - Status transitioned to `RUNNING`.
    - `attempt_count` incremented exactly once (0 -> 1).
    - Result: **PASS**
  - **TEST B (Lease Expiry + Reclaim):** With lease safely set to the past in live PostgreSQL:
    - An independent reclaiming worker successfully claimed the expired execution.
    - `lease_owner` changed to the reclaiming worker.
    - A new, unique `lease_token` was generated.
    - `attempt_count` incremented exactly once for the reclaim (1 -> 2).
    - The original worker's token was confirmed stale.
    - Result: **PASS**
  - **TEST C (Zombie Worker Fencing):** The stale worker attempted a fenced update using its old `lease_token`:
    - Mutation was rejected and affected 0 rows (returned null).
    - The active reclaiming worker's ownership and state remained untampered.
    - Legitimate fenced mutation by the active worker using the current token succeeded immediately.
    - Result: **PASS**
  - **TEST D (Terminal Fencing):** The active worker transitioned execution to `COMPLETED`:
    - Mutation with stale token on the completed execution was rejected (0 rows affected).
    - Database state remained `COMPLETED`.
    - Result: **PASS**
  - **TEST E (Tenant Isolation):** Executions created across isolated tenants:
    - Cross-tenant retrieval via repository returned null.
    - Cross-tenant update was rejected (`Cannot coerce the result to a single JSON object` / not found).
    - Cross-tenant fenced update returned null.
    - `BuyerPipelineCoordinator` rejected cross-tenant execution with `TENANT_ISOLATION_VIOLATION`.
    - Result: **PASS**
  - **TEST F (Attempt Count Integrity):** Sequence tracked from PENDING -> Claim 1 -> Lease Expiry -> Reclaim 2:
    - Initial `attempt_count = 0`.
    - After initial claim: `attempt_count = 1`.
    - After reclaim: `attempt_count = 2`.
    - Zero duplicate increments; zero lost increments.
    - Result: **PASS**
  - **TEST G (Competing Reclaimers):** Two independent workers simultaneously attempted to reclaim an expired execution:
    - Exactly one worker won the reclaim; the other received 0 claims.
    - Exactly one new `lease_token` was generated.
    - `attempt_count` incremented exactly once (2 -> 3).
    - Proved reclaim itself is concurrency-safe under PostgreSQL `FOR UPDATE SKIP LOCKED`.
    - Result: **PASS**
- **Test Suite Matrix:**
  - `tests/phase8b710-production-pipeline-verification.ts`: PASS (ALL INVARIANTS)
  - `tests/phase8b710-live-db-verification.ts`: PASS (ALL INVARIANTS)
  - `tests/phase8b79-live-concurrency.ts`: 7/7 PASS (ALL LIVE DB TESTS)
  - `tests/phase8b78-privilege-shutdown.ts`: 7/7 PASS
  - `tests/phase8b75-crash-recovery-e2e.ts`: 15/15 PASS
  - `tests/phase8b74-recovery-worker.ts`: 9/9 PASS
  - `tests/phase8b74-remediation.ts`: PASS
  - `tests/phase8b73-durable-execution.ts`: 7/7 PASS
  - `tests/phase8b63-pipeline-dispatch.ts`: 5/5 PASS
  - `tests/phase8b62-webhook-auto-progression.ts`: 11/11 PASS
  - `tests/phase8b6-pipeline-coordinator.ts`: 10/10 PASS
  - Typecheck (`tsc --noEmit`): PASS (0 errors)
  - Linter (`npm run lint`): PASS (0 errors)
  - Build (`npm run build`): PASS

**Operational Boundaries & Guarantees:**
- Real multi-worker concurrency on Supabase PostgreSQL is mathematically guaranteed by PostgreSQL `FOR UPDATE SKIP LOCKED` inside `claim_pipeline_execution`.
- Lease token fencing prevents zombie workers from corrupting database state or overwriting subsequent worker progress.
- Service-role credentials remain strictly server-side and are never exposed to browser bundles.
- Service-role access is never used to elevate application permissions; tenant boundaries remain strictly isolated.
- Shutdown drain is strictly bounded; workers never hang indefinitely during container termination.
- Remote CRM delivery maintains at-least-once transport semantics; downstream systems must enforce deduplication on `handoff_id`.
