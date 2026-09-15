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
  - Status: **READY TO FREEZE / VERIFIED**

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

```
CURRENT_PHASE: Phase 8B.5.4
CURRENT_STATUS: READY TO FREEZE
LAST_CODE_COMMIT: 4b09a57ef6a84d2eb7c55e5f90ab226ed42e20c5
NEXT_ACTION: Final freeze verification and definition of next milestone
```
