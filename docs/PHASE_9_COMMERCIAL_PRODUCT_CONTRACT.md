# GROWTHFORGE BUYER INTELLIGENCE ENGINE
## PHASE 9.0: COMMERCIAL PRODUCT CONTRACT & ARCHITECTURAL SPECIFICATION

**Document Version:** 1.0.0  
**Phase:** 9.0 (Commercial Product Contract)  
**Status:** COMPLETE / FROZEN BASELINE  
**Authoritative Baseline Commit:** `5c070c981ff281b520b389fb5dc14b2a57384105`  
**Target Repository:** `Formersniper/GF-Buyer-Engine`  
**Execution Runtime:** Express + Vite / TypeScript / Supabase PostgreSQL  

---

## EXECUTIVE SUMMARY

GrowthForge is not a generic CRM, contact database, or marketing automation tool. GrowthForge is a **Buyer Intelligence and Qualification Engine** specifically engineered for high-velocity real-estate organizations.

It solves the single most acute operational bottleneck in real-estate sales: **sales agent burnout and revenue loss caused by manually chasing unvetted, uncontactable, or unqualified digital leads**.

GrowthForge automates the ingestion of raw, noisy leads, performs ethical public background enrichment, conducts natural first-party voice qualification conversations, deterministically extracts verified buyer requirements with strict quotation evidence, computes objective 8-dimension buyer scores, matches buyers against client inventory, and delivers sales-ready buyer dossiers directly to sales teams under strict SLA deadlines.

This document defines the binding commercial and functional contract for the first client-testable version (V1) of GrowthForge.

```
RAW REAL-ESTATE LEADS (Facebook / Google / Portals / CSV)
                            ↓
             [Lead Normalization & Deduplication]
                            ↓
             [Public Intelligence (OSINT / Scout)]   (truth_level: INFERRED)
                            ↓
             [Deterministic Eligibility & Consent]
                            ↓
          [Automated Conversational Voice Call]
                            ↓
           [Verbatim Extraction & Evidence]         (truth_level: CONFIRMED)
                            ↓
          [Deterministic Buyer Qualification]        (QUALIFIED / NURTURE / REVIEW)
                            ↓
         [Deterministic 8-Dimension Scoring]        (Score 0-100, Tiers 1-4, SLA)
                            ↓
       [Catalog Project / Inventory Matching]        (AI_RECOMMENDED, buyer_confirmed: false)
                            ↓
        [Canonical Broker Handoff Package]          (Dossier + CRM Dispatch)
                            ↓
              ACTIONABLE BROKER REVENUE
```

---

## PART 1: READ-ONLY PRODUCT & ARCHITECTURAL AUDIT

GrowthForge possesses a complete, hardened, and verified production backend. The commercial contract is grounded directly in existing, tested software services:

| Architectural Component | Source Module | Existing Operational Capabilities |
| :--- | :--- | :--- |
| **Lead Normalization & Ingestion** | `app/services/leads/leadResolver.ts` | E.164 phone normalization, email sanitization, deterministic duplicate detection (phone/email), stable ID generation (`GF-YYYY-NNNNNN`), ambiguity quarantine. |
| **Public Enrichment (Scout)** | `app/services/scout/scoutAdapter.ts` | Subprocess bridge to Python OSINT engine (`/scout`), queries public profiles (LinkedIn, employment, seniority, social footprint). Strictly tags data with `truth_level: 'INFERRED'`. |
| **Deterministic Call Eligibility** | `app/services/calls/callEligibility.ts` | Policy `CALL_ELIGIBILITY_V1`: Validates phone syntax (rejects repetitive/dummy sequences), enforces explicit consent status, cooldown intervals, and maximum attempt caps before calling. |
| **Voice Provider & Webhook** | `app/services/voice/sarvamVoiceProvider.ts`<br>`app/services/voice/sarvamWebhook.ts` | Outbound telephony via Sarvam AI API, cryptographic webhook HMAC verification, call lifecycle tracking (`call.started`, `call.completed`), deduplicated event recording. |
| **Transcript Ingestion** | `app/services/voice/transcriptIngestionService.ts` | Transcript completeness checks, duration verification, speaker turn parsing (`Agent` vs `User`), persistent storage in `call_transcripts`. |
| **Conversation Extraction** | `app/services/gemini/conversationExtractionService.ts`<br>`app/services/gemini/geminiExtractionProvider.ts` | Gemini-powered extraction of structured buyer intelligence with mandatory verbatim quote evidence for every extracted requirement. |
| **Buyer Qualification** | `app/services/qualification/buyerQualificationService.ts`<br>`app/services/qualification/qualificationRules.ts` | Deterministic rules engine evaluating 9 core dimensions (active intent, budget, location, configuration, purpose, timeline, financing, decision maker). Assigns `QUALIFIED`, `PARTIALLY_QUALIFIED`, `NURTURE`, or `REQUIRES_REVIEW`. |
| **Buyer Scoring & Prioritization** | `app/services/scoring/buyerScoringService.ts`<br>`app/services/scoring/scoringRules.ts` | Deterministic 8-dimension weighted scoring (0-100), classification into `TIER_1_HOT` (15m SLA), `TIER_2_WARM` (120m SLA), `TIER_3_NURTURE` (24h SLA), and `TIER_4_REVIEW`. |
| **Inventory Matching** | `app/services/matching/projectMatchingService.ts`<br>`app/services/matching/projectMatchingRules.ts` | Deterministic catalog matching against property type, budget, location, and configuration. Enforces epistemic invariant: recommendations are stamped `buyer_confirmed: false` and `recommendation_status: 'AI_RECOMMENDED'`. |
| **Broker Handoff & Dispatch** | `app/services/handoff/brokerHandoffService.ts`<br>`app/services/handoff/crmAdapter.ts` | Canonical `BrokerHandoffPackage` assembly, CRM role routing, SLA assignment, webhook dispatch with SSRF protection, idempotency tracking (`PENDING`, `SENT`, `FAILED`). |
| **Durable Execution & Recovery** | `app/services/pipeline/buyerPipelineCoordinator.ts`<br>`app/services/pipeline/pipelineRecoveryWorker.ts` | 7-stage deterministic pipeline coordinator backed by PostgreSQL `pipeline_executions`, atomic `claim_pipeline_execution` RPC, lease-token fencing, exponential backoff, and crash recovery. |

**Audit Conclusion:** GrowthForge does NOT need additional backend execution machinery to support its commercial contract. The core engine is functional, resilient, and verified against live PostgreSQL.

---

## PART 2: COMMERCIAL THESIS

### The Core Problem in Real Estate Sales
Real estate brokers and developers spend massive budgets on digital ads (Meta, Google, property portals). For every 1,000 raw leads generated:
- **60% to 75%** are uncontactable, junk, wrong numbers, or casual tire-kickers.
- Highly paid sales agents spend **4 to 6 hours daily** dialing unresponsive numbers rather than advising genuine buyers.
- High-intent, affluent buyers slip through the cracks because first contact takes hours or days, causing leads to go cold or buy from faster competitors.
- Brokers lack structured intelligence on call pickup: they don't know the buyer's real budget, whether they are the final decision-maker, or which inventory fits them before dialing.

### GrowthForge Value Proposition
GrowthForge delivers:
1. **Immediate First-Party Voice Outreach:** Engaging leads within minutes of submission via natural, localized voice interaction.
2. **Strict Verification Over AI Guesswork:** Distinguishing buyer-confirmed facts from marketing assumptions.
3. **Actionable Sales Dossiers:** Delivering ranked, scored, and matched leads directly to brokers with guaranteed SLA response windows.
4. **Massive Sales Productivity:** Increasing sales agent high-value conversation time by 3x–5x.

### Answering the Core Commercial Questions
- **WHO PAYS?** Real-estate channel partners, brokerage firms, and builder/developer sales organizations.
- **FOR WHAT?** Vetted, high-intent, scored Qualified Buyers with structured requirements and matched inventory, delivered with zero manual qualification effort by the sales team.
- **WHAT DO THEY GIVE GROWTHFORGE?** Raw digital lead inputs (via webhook, CSV upload, or CRM sync) and their active project catalog (locations, configurations, price bands).
- **WHAT DOES GROWTHFORGE DO?** Normalizes data, enriches public background, conducts conversational voice qualification, extracts verified requirements with transcript evidence, computes objective scores, matches inventory, and packages the complete dossier.
- **WHAT DO THEY RECEIVE?** A structured Buyer Dossier delivered via webhook/CRM/dashboard with verified budget, timeline, location, decision authority, matched projects, and dispatch SLA.
- **HOW DO WE MEASURE VALUE?** Qualified Buyer Output Rate, cost per qualified lead, reduction in sales agent qualification hours, and conversion to site visits.

---

## PART 3: INITIAL IDEAL CUSTOMER PROFILE (ICP)

### Customer Category Evaluation Matrix

| Category | Operational Profile | Lead Volume / Mo | Qualification Pain | Integration Complexity | Pilot Suitability | Commercial Outcome |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **A. Mid-Sized Brokerages** (15-50 agents) | Active sales desks, high inbound ad spend, struggling with agent attrition and lead leakage. | 1,500 – 5,000 | **HIGH:** Agents cherry-pick leads; follow-up is inconsistent. | **LOW-MEDIUM:** Standard webhooks, Google Sheets, or basic CRM (LeadSquared, Salesforce, HubSpot). | **VERY HIGH:** Agile decision making, founder/partner access, urgent pain. | Immediate boost in agent meetings and closed bookings. |
| **B. Channel Partners (CPs)** (Large regional aggregators) | Run dedicated lead-generation campaigns for multiple tier-1 developers; commission-driven. | 3,000 – 15,000 | **CRITICAL:** High cost-per-lead; urgent need to filter out noise to protect developer relationships. | **LOW-MEDIUM:** Webhooks from Meta/Google ads directly into GrowthForge. | **VERY HIGH:** Highest willingness to pay for verified buyer velocity. | Dramatic increase in developer site-visit confirmations. |
| **C. Builders / Developers** (In-house sales teams) | Corporate sales machinery, centralized call centers, strict compliance standards. | 5,000 – 25,000+ | **HIGH:** High overhead on junior tele-calling teams with low qualification fidelity. | **HIGH:** Long enterprise procurement, complex custom CRM integrations. | **MEDIUM (Later):** Slower pilot setup, complex security audits. | Massive reduction in tele-calling payroll overhead. |
| **D. Property Consultants** (Boutique luxury) | High-touch, ultra-high-net-worth focus, low lead volume, bespoke advisory. | 50 – 200 | **LOW:** Prefer personal human outreach from the first touchpoint. | **LOW:** Manual workflows. | **LOW:** Volume too small to justify automated voice qualification. | Poor fit for automated voice workflows. |
| **E. Large Broker Franchises** (100+ agents) | Decentralized offices, fragmented franchisee workflows, slow software adoption. | 10,000+ | **HIGH:** Significant lead waste across distributed offices. | **VERY HIGH:** Multi-tier management permissions, legacy software inertia. | **LOW (Phase 10+):** Too slow for rapid pilot validation. | High lifetime value, but unsuitable for V1 testing. |
| **F. Small Independent Brokers** (1-3 agents) | Solopreneurs, referral-driven, minimal advertising budget. | < 50 | **LOW:** Handle leads personally via WhatsApp and phone. | **NEGLIGIBLE:** No CRM. | **POOR:** Insufficient lead volume, price sensitive. | Churn risk high; no scalable ROI. |

### Selection Rationale
- **PRIMARY ICP (V1 Target): Channel Partners & Mid-Sized Brokerages (15–50 agents)**
  - *Operational Criteria:* Handling 1,000 to 5,000 paid digital leads monthly from Facebook, Google Ads, and 99acres/Housing; burning cash on manual dialing; fast decision cycles (<2 weeks); standard webhook integration needs; highly motivated by site-visit conversions.
- **SECONDARY ICP:** Builder/Developer In-House Sales Teams (Phase 9.6+ pilots once standard reporting and compliance are hardened).
- **OUT OF SCOPE ICP:** Small independent brokers (<50 leads/mo, low budget) and large enterprise franchises (lengthy procurement, custom IT roadblocks).

---

## PART 4: PRIMARY COMMERCIAL USE CASE

### The One-Sentence Formula
> **"GrowthForge helps mid-sized real-estate brokerages and channel partners turn unvetted digital marketing leads into verified, scored buyer dossiers matched to active inventory."**

### Operational Workflow Breakdown
1. **Trigger:** A new digital lead is captured from a Meta ad campaign, Google PPC landing page, or portal webhook.
2. **Customer Input:** Lead name, phone number, source campaign metadata, and tenant project inventory catalog.
3. **Automated GrowthForge Actions:**
   - Cleans and normalizes contact details; checks duplicate cache.
   - Enriches public background profile via Scout (employment, seniority) with `INFERRED` truth level.
   - Verifies phone format and consent eligibility (`CALL_ELIGIBILITY_V1`).
   - Initiates conversational voice call via Sarvam Voice AI.
   - Ingests transcript, extracts requirements with verbatim evidence.
   - Deterministically evaluates qualification rules and 8-dimension buyer score.
   - Matches confirmed requirements against client inventory (`AI_RECOMMENDED`).
   - Packages canonical `BrokerHandoffPackage`.
4. **Human Involvement:** Zero manual human labor required during qualification. Sales agents engage *only after* the handoff package is generated and delivered.
5. **Customer Output:** A structured Buyer Dossier delivered via webhook/CRM with verified budget, timeline, location, decision authority, matched projects, and dispatch SLA.
6. **Measurable Business Result:** Sales agents focus 100% of their calling time on Tier 1 and Tier 2 verified buyers, doubling first-week site-visit bookings.

---

## PART 5: CUSTOMER INPUT CONTRACT

To process a lead through GrowthForge, the client organization must provide a defined minimum payload.

### Data Input Specifications

| Field Category | Field Name | Type | Mandatory? | Description & Validation |
| :--- | :--- | :--- | :--- | :--- |
| **Required** | `name` | String | YES | Lead name (trimmed, minimum 2 characters). |
| **Required** | `phone` | String | YES | Raw phone number. Must parse into valid callable format (E.164 syntax, non-repetitive). |
| **Required** | `source` | String | YES | Ingestion channel (e.g., `facebook_ads`, `google_ppc`, `portal_99acres`, `csv_import`). |
| **Required** | `tenant_id` | UUID | YES | Authenticated client organization boundary. |
| **Optional** | `email` | String | NO | Contact email (normalized to lowercase; RFC syntax validated). |
| **Optional** | `campaign_id` | String | NO | Marketing campaign identifier for attribution. |
| **Optional** | `adset_name` | String | NO | Ad group or creative title. |
| **Optional** | `declared_project` | String | NO | Specific project referenced in the original ad creative. |
| **Optional** | `declared_budget` | String | NO | Stated budget from form submission (treated as preliminary, unconfirmed). |
| **Derived** | `lead_id` | String | SYSTEM | Deterministic GrowthForge identifier (`GF-YYYY-NNNNNN`). |
| **Derived** | `phone_normalized` | String | SYSTEM | Standardized E.164 international format. |
| **Derived** | `duplicate_hash` | String | SYSTEM | Hash of normalized phone/email for idempotent deduplication. |
| **Derived** | `eligibility_status` | Enum | SYSTEM | Evaluation result from `CALL_ELIGIBILITY_V1`. |

### Epistemic Data Classifications
- **CUSTOMER-PROVIDED:** Raw lead form submissions (name, phone, ad source, stated intent).
- **PUBLIC / INFERRED:** Public OSINT enrichment from Scout (employer name, job title, industry seniority). Must NEVER be represented as buyer-confirmed facts.
- **BUYER-CONFIRMED:** Explicit statements articulated by the buyer during conversational voice qualification, backed by exact transcript quotation evidence.
- **AI-RECOMMENDED:** Algorithmic project matches, scoring tiers, and recommended next actions. Stamped strictly with `buyer_confirmed: false`.

---

## PART 6: BUYER QUALIFICATION CONTRACT

### Deterministic Definition of a "Qualified Buyer"
In the GrowthForge commercial contract, a lead is stamped **`QUALIFIED`** if and only if all mandatory qualification criteria are confirmed with empirical evidence.

### Qualification Dimensions Matrix

| Dimension | Mandatory for `QUALIFIED`? | Qualification Rule & Requirement | Disqualification Criteria |
| :--- | :--- | :--- | :--- |
| **1. Active Intent** | **MANDATORY** | Buyer confirms active interest in buying residential or commercial property. | Explicit statement of "wrong number", "not interested", "already purchased", or looking *only* to rent. |
| **2. Budget Clarity** | **MANDATORY** | Buyer provides a numeric budget or bounded range (min/max) with identified currency. | Complete refusal to state budget or expressing an unrealistic budget for the target market. |
| **3. Location Preference** | **MANDATORY** | At least one specific city, micro-market, or locality confirmed. | Stating an out-of-scope geographical region where client has zero inventory. |
| **4. Timeline** | **MANDATORY** | Expressed purchase horizon within 0–6 months (Immediate, 1-3 months, 3-6 months). | Vague "distant future" (> 12 months) or "just looking casually with no plan". |
| **5. Decision Authority** | **MANDATORY** | Buyer confirms they are the primary decision maker or joint decision maker with spouse/family. | Minor or third party with zero financial or purchase authority. |
| **6. Property Type** | SUPPORTING | Preferred category (Apartment, Villa, Plot, Commercial). | N/A (defaults to general residential if intent is strong). |
| **7. Configuration** | SUPPORTING | Unit specification (e.g., 2 BHK, 3 BHK, 4 BHK). | N/A. |
| **8. Purpose** | SUPPORTING | End-use vs Investment. | N/A. |
| **9. Financing** | SUPPORTING | Self-funded vs Home Loan required. | N/A. |

### Canonical Qualification Statuses
1. **`QUALIFIED`:** All 5 mandatory dimensions satisfied with empirical evidence. Lead is immediately prioritized for sales agent handoff.
2. **`PARTIALLY_QUALIFIED`:** Active intent is confirmed, but 1 or 2 supporting dimensions (e.g., specific configuration or exact timeline) remain unresolved. Routed to sales desk with missing data callouts.
3. **`NURTURE`:** Buyer has long-term intent (>6–12 months) or unready budget. Diverted away from senior sales agents into automated follow-up workflows.
4. **`REQUIRES_REVIEW`:** Conflicting statements detected in transcript, audio quality degraded, or contradictory public data. Diverted to sales supervisor audit.

---

## PART 7: TRUTH & PROVENANCE CONTRACT

GrowthForge enforces strict epistemic integrity. Marketing claims or AI inferences must never contaminate empirical facts.

```
       [CONFIRMED]
 (First-party verified with
   transcript quotation)
            ▲
            │  (Overrides & Validates)
            │
         [KNOWN]
 (Customer-provided lead record)
            ▲
            │  (Provides Context)
            │
        [INFERRED]
 (Public OSINT / Scout / Estimates)
            ▲
            │  (Initial Exploration)
            │
        [UNKNOWN]
   (Missing / Unaddressed)
```

### Epistemic Truth Levels
1. **`CONFIRMED`:** The buyer explicitly stated this information during first-party voice qualification.
   - *Requirement:* Must contain verbatim quotation evidence referencing the call transcript.
   - *Example:* `budget: { min: 15000000, max: 20000000, truth_level: 'CONFIRMED', evidence: "I am looking between 1.5 to 2 crores" }`.
2. **`KNOWN`:** Data provided directly by the client in the initial lead payload.
   - *Example:* Lead source `facebook_campaign_gurgaon_launch`.
3. **`INFERRED`:** Background information gathered from public web sources (Scout) or algorithmic estimation.
   - *Rule:* Scout job titles or seniority levels remain `INFERRED`. They cannot be used to artificially claim a buyer confirmed their budget.
4. **`UNKNOWN`:** Required dimensions not discussed or answered evasively during the call.
5. **`AI_RECOMMENDED`:** Applied to all project matches and system suggestions.
   - *Strict Invariant:* `buyer_confirmed` is ALWAYS `false`.

---

## PART 8: BUYER SCORE CONTRACT

GrowthForge scores buyers using a deterministic, 8-dimension weighted model (0–100 points). The score reflects commercial readiness, verified clarity, and closing probability.

### Deterministic Scoring Weight Distribution

| Dimension | Max Points | Evaluation Basis | Evidence Source |
| :--- | :---: | :--- | :--- |
| **Buyer Intent** | **25 pts** | Active purchase interest vs passive browsing. | Confirmed transcript quotation. |
| **Budget Clarity** | **15 pts** | Concrete numeric range stated and realistic. | Confirmed budget figures. |
| **Location Clarity** | **15 pts** | Specific micro-market or sector identified. | Confirmed location preference. |
| **Timeline Urgency** | **15 pts** | Buying within 0–3 months (15 pts) vs 3–6 months (10 pts). | Confirmed timeline statement. |
| **Project Fit** | **10 pts** | High alignment with active client inventory. | Catalog match score. |
| **Decision Authority** | **10 pts** | Sole or joint decision maker. | Confirmed decision maker. |
| **Contactability** | **5 pts** | Call connected on attempt 1; valid duration. | Telephony metadata. |
| **Data Freshness** | **5 pts** | Recency of lead submission (<24 hours). | Lead timestamp. |
| **TOTAL** | **100 pts** | **Deterministic Sum of Awarded Points** | **Structured Audit Breakdown** |

### Classification Tiers & Commercial SLAs

```
SCORE: 80 - 100 ────► TIER 1 (HOT)      ───► SLA: 15 Minutes  ───► Senior Sales Advisor
SCORE: 60 - 79  ────► TIER 2 (WARM)     ───► SLA: 2 Hours    ───► Inbound Sales Specialist
SCORE: 40 - 59  ────► TIER 3 (NURTURE)  ───► SLA: 24 Hours   ───► Automated Drip Workflow
SCORE: < 40     ────► TIER 4 (REVIEW)   ───► SLA: Supervisor ───► Intelligence Audit Desk
```

### Commercial Interpretation for Sales Teams
- **TIER 1 (HOT):** High-intent buyer with confirmed budget, immediate timeline, and decision power. Guaranteed 15-minute response SLA. Assigned exclusively to top-tier closers.
- **TIER 2 (WARM):** Legitimate buyer with 3–6 month timeline or minor requirement flexibility. 2-hour response SLA.
- **TIER 3 (NURTURE):** Real buyer with distant horizon (>6 months). Kept out of sales agent queues; routed to WhatsApp/email automated nurture.
- **TIER 4 (REVIEW):** Inconclusive or ambiguous. Evaluated by sales manager before discarding.

---

## PART 9: MATCHING CONTRACT

GrowthForge evaluates confirmed buyer criteria against the client's inventory catalog.

### Matching Inputs
1. **Buyer Criteria:** Confirmed budget range, preferred locations, property type, and configuration.
2. **Client Catalog:** Project inventory records containing location, micro-market, price range, unit configurations, completion status (ready-to-move vs under-construction), and developer credentials.

### Invariant Rules
- **Rule 1 (AI Recommendation Boundary):** Every project match generated by the engine is explicitly tagged `recommendation_status: 'AI_RECOMMENDED'`.
- **Rule 2 (No False Commitment):** Every match record has `buyer_confirmed: false`. The engine matches inventory to buyer requirements; it does not claim the buyer agreed to buy that project.
- **Rule 3 (Fit Bands):**
  - `HIGH_FIT` (Score ≥ 80%): Exact match on location, configuration, and within budget bounds.
  - `MODERATE_FIT` (Score 60%–79%): Matched on configuration and budget, adjacent micro-market.
  - `LOW_FIT` (Score < 60%): Partial budget or configuration overlap.
- **Rule 4 (Broker Action):** Matches provide conversational ammunition for the broker's pitch call.

---

## PART 10: BROKER HANDOFF CONTRACT

The **`BrokerHandoffPackage`** is the core commercial deliverable of GrowthForge. It assembles all upstream intelligence into a single, sales-ready dossier.

### Mandatory Fields in Handoff Package
1. **Buyer Profile:** Name, normalized phone, verified email (if available), location.
2. **Public Context (Inferred):** Current employer, job title, estimated seniority (from Scout).
3. **Qualification Summary:** Overall status (`QUALIFIED`), reason codes, qualification timestamp.
4. **Confirmed Requirements:**
   - Budget range (Min/Max, Currency, Verbatim quotation).
   - Preferred locations (List of micro-markets, Verbatim quotation).
   - Property type & configuration (e.g., 3 BHK Apartment).
   - Timeline & purchase horizon.
   - Purpose (End-use vs Investment).
   - Decision authority confirmation.
5. **Score & Priority:** Composite score (0–100), Tier classification (`TIER_1_HOT`), SLA deadline timestamp.
6. **Matched Inventory:** Top 3 ranked project recommendations with fit explanations.
7. **Actionable Next Step:** Explicit guidance for the broker (e.g., *"Call immediately to present Project Emerald 3 BHK within 1.8 Cr budget"*).
8. **Call Recording & Transcript Reference:** Link to audio recording and complete structured transcript for full context.

---

## PART 11: MINIMUM CUSTOMER-FACING OUTPUT (V1 BUYER DOSSIER)

In V1, clients inspect and action leads through the GrowthForge Buyer Intelligence Workspace and receiving CRMs.

```
================================================================================
GROWTHFORGE BUYER INTELLIGENCE DOSSIER                         LEAD: GF-2026-004812
================================================================================

[BUYER PROFILE]
Name:             Rahul Sharma
Phone:            +91 98112 XXXXX (Verified Callable)
Public Signal:    VP of Engineering, Tier-1 Tech Firm (INFERRED)

[STATUS & PRIORITY]
Qualification:    QUALIFIED (Active Buyer)
Score:            88 / 100 [TIER 1 - HOT]
Response SLA:     15 Minutes (Deadline: 14:35 IST)
Assigned Route:   Senior Sales Desk (Immediate Outbound)

--------------------------------------------------------------------------------
[CONFIRMED FIRST-PARTY REQUIREMENTS] (Evidence-Backed)
--------------------------------------------------------------------------------
• Budget:         ₹1.75 Cr – ₹2.25 Cr [CONFIRMED]
                  Evidence: "We have a pre-approved loan and can go up to 2.2 crores."
• Location:       Golf Course Extension Road, Gurgaon [CONFIRMED]
                  Evidence: "Looking specifically around Sector 62 or 65."
• Configuration:  3 BHK + Servant [CONFIRMED]
• Timeline:       Immediate / 30-45 Days [CONFIRMED]
                  Evidence: "Our current lease ends next month, ready to book."
• Decision Maker: Self & Spouse [CONFIRMED]

--------------------------------------------------------------------------------
[RECOMMENDED INVENTORY MATCHES] (AI Recommended • Not Buyer Committed)
--------------------------------------------------------------------------------
1. M3M Golfestate (Sector 65) ──────── [HIGH FIT: 94%]
   • 3 BHK Luxury (2,150 sq.ft) @ ₹2.10 Cr
   • Reason: Matches exact location, configuration, and budget ceiling.

2. Smart World The Edition (Sector 66) ─ [HIGH FIT: 88%]
   • 3.5 BHK (2,050 sq.ft) @ ₹1.95 Cr
   • Reason: Immediate possession, within target micro-market.

--------------------------------------------------------------------------------
[ACTION GUIDANCE FOR BROKER]
"Buyer is highly motivated with immediate timeline. Pitch M3M Golfestate unit
#1402. Emphasize ready possession and clubhouse amenities."
================================================================================
```

---

## PART 12: COMMERCIAL SUCCESS METRICS

### 1. North Star Metric
> **Verified Qualified Buyer Output Rate (%):**  
> `(Total QUALIFIED Buyer Dossiers Produced / Total Raw Leads Ingested) × 100`  
> *Target:* Transform typical 5%–8% human qualification rates into **20%–35%** actionable buyer delivery.

### 2. Primary Operational Metrics
- **Contact Rate (%):** Calls connected / calls attempted. (Target: > 45% on fresh leads).
- **First-Contact Latency:** Time elapsed between lead form submission and automated qualification call. (Target: < 5 minutes).
- **Qualification Fidelity:** % of GrowthForge `QUALIFIED` leads verified as genuinely qualified by sales agents on follow-up. (Target: > 90%).
- **SLA Adherence (%):** % of Tier 1 leads contacted by sales agents within the 15-minute SLA window. (Target: > 85%).
- **Site-Visit Conversion Rate (%):** % of GrowthForge handoffs resulting in physical or virtual site visits. (Target: 2x baseline).

### 3. Secondary Metrics
- Enrichment success rate (Scout profile matches).
- Telephony cost per lead.
- Duplicate and junk lead rejection rate.

---

## PART 13: COMMERCIAL UNIT OF VALUE & PRICING HYPOTHESIS

GrowthForge charges for **sales-ready buyer outcomes**, not software seats or passive contact storage.

### Explicit Epistemic Boundary
- **PRICING HYPOTHESIS (To Be Tested in Pilots):**
  - Model: Hybrid Platform Fee + Per-Qualified-Lead (PQL) Fee.
  - *Base Platform Fee:* $500 – $1,500 / month (includes tenant isolation, inventory matching, CRM webhooks, and core dashboard).
  - *Usage / Value Fee:* $15 – $35 per `QUALIFIED` Buyer Dossier delivered.
  - *Junk Lead Protection:* $0 charged for uncontactable, wrong number, or disqualified leads.
- **VALIDATED PRICE:** **NONE.** No pricing model is represented as market-validated fact until pilot commercial contracts are signed and executed.

### Margin Drivers & Unit Economics
- Cost of Telephony (Sarvam AI / SIP trunking): ~$0.08 – $0.15 per completed call.
- Cost of LLM Extraction (Gemini 2.5 Flash): ~$0.005 per extraction.
- Cost of Public Enrichment (Scout OSINT): ~$0.01 per lead.
- **Gross Margin Potential:** **75% – 85%** on qualified outcomes.

---

## PART 14: COMMERCIAL PILOT CONTRACT (V1 PILOT SPECIFICATION)

### Pilot Structure
- **Target Pilot Cohort:** 2 to 3 mid-sized channel partners or developer sales desks.
- **Pilot Duration:** 30 Calendar Days.
- **Lead Volume:** 1,000 raw inbound leads per client.

### Shared Responsibilities Matrix
- **Client Responsibilities:**
  - Route live digital lead stream (Meta/Google ads) to GrowthForge webhook.
  - Upload active project inventory catalog (minimum 5 active projects).
  - Ensure sales agents follow up on Tier 1 leads within the 15-minute SLA.
  - Provide weekly feedback on site-visit conversions and lead quality.
- **GrowthForge Responsibilities:**
  - Provide dedicated tenant instance with complete RLS data isolation.
  - Process all leads through voice qualification within 5 minutes of receipt.
  - Deliver structured buyer dossiers directly to client webhook / dashboard.
  - Provide weekly analytical reporting on qualification yield.

### Pilot Success & Exit Criteria
- **Pilot Success Threshold:**
  1. Minimum **20% Qualified Buyer Rate** achieved across 1,000 leads.
  2. Sales team reports **>85% accuracy** on confirmed budget, timeline, and location.
  3. Client achieves at least a **25% increase in site visits** compared to historic manual calling.
- **Exit to Paid Commercial Deployment:** Upon meeting success criteria, pilot converts into standard monthly subscription + PQL contract.

---

## PART 15: V1 PRODUCT BOUNDARY

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       MUST HAVE FOR CLIENT-TESTABLE V1                      │
├─────────────────────────────────────────────────────────────────────────────┤
│ • Tenant Onboarding & Team Invites                                          │
│ • Lead Ingestion (CSV upload & Webhook endpoint)                            │
│ • Phone Normalization, Validation, & Deduplication                          │
│ • Voice Qualification Automation (Sarvam outbound telephony)                │
│ • Structured Requirement Extraction with Transcript Quotations              │
│ • Deterministic Buyer Qualification (QUALIFIED / NURTURE / REVIEW)          │
│ • Deterministic 8-Dimension Scoring (0-100) & 4 Tiers                       │
│ • Project Catalog Management & AI Recommendation Matching                   │
│ • Buyer Dossier View (Profile, Confirmed Requirements, Inferred Signals)     │
│ • Sales Priority Queue with SLA Timers                                      │
│ • Webhook CRM Dispatch (Outbound push to client endpoints)                  │
│ • Basic Commercial Analytics (Funnel: Ingested → Called → Qualified)        │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        SHOULD HAVE AFTER FIRST PILOT                        │
├─────────────────────────────────────────────────────────────────────────────┤
│ • Native two-way HubSpot, Salesforce, and LeadSquared sync                  │
│ • Inbound call qualification support                                        │
│ • Custom qualification rule builder in UI                                   │
│ • Multi-language voice agent selection (Hindi, English, Hinglish, regional) │
│ • Automated WhatsApp summary message to buyer post-call                     │
│ • Agent performance and call audit playback controls                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          EXPLICITLY OUT OF SCOPE                            │
├─────────────────────────────────────────────────────────────────────────────┤
│ ❌ Generic CRM contact management (pipeline kanban, deal stages, tasks)     │
│ ❌ Automated credit card billing / complex stripe subscriptions             │
│ ❌ Native iOS / Android mobile applications                                 │
│ ❌ Marketing campaign builder / ad spend management                         │
│ ❌ Autonomous broker deal negotiation or closing bots                       │
│ ❌ General-purpose arbitrary AI chat assistants                             │
│ ❌ Multi-country property tax calculation engines                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## PART 16: CLIENT-TESTABLE V1 DEFINITION

A build qualifies as **Client-Testable V1** when an external real-estate client can execute all 11 core operational capabilities without engineer intervention:

1. **Client Onboarding:** Administrator logs in, sets up tenant profile, invites sales agents, and inputs CRM webhook URL.
2. **Catalog Ingestion:** Client creates or uploads 3–10 active projects with price ranges, locations, and configurations.
3. **Lead Ingestion:** Client uploads a CSV of 50 raw leads or connects a live Meta Webhook.
4. **Autonomous Voice Qualification:** GrowthForge automatically calls eligible leads and completes qualification dialogues.
5. **Dossier Inspection:** Client views generated Buyer Dossiers showing confirmed budget, timeline, location, and verbatim evidence.
6. **Provenance Verification:** UI clearly distinguishes `CONFIRMED` requirements from `INFERRED` Scout signals.
7. **Score Transparency:** Client sees why a lead scored 85 (HOT) vs 45 (NURTURE) across all 8 dimensions.
8. **Inventory Matching:** Client reviews ranked project matches with explicit `AI_RECOMMENDED` badges.
9. **Priority Queue Execution:** Sales agents see prioritized queue sorted by SLA urgency.
10. **CRM Delivery:** Client's external webhook receives the canonical JSON `BrokerHandoffPackage`.
11. **Performance Visibility:** Dashboard displays lead conversion funnel, qualification rate, and response times.

---

## PART 17: PHASE 9 IMPLEMENTATION ROADMAP

```
Phase 9.0: Commercial Product Contract (FROZEN)
    │
    ▼
Phase 9.1: Commercial UX / Buyer Intelligence Workspace
    │   (Priority Queue, Buyer Dossier, Requirement Breakdown, Provenance UI)
    ▼
Phase 9.2: Client Onboarding + Lead Intake
    │   (Self-serve CSV lead upload, Webhook intake configuration, Duplicate guard)
    ▼
Phase 9.3: Voice Qualification Experience
    │   (Call dispatch controls, audio playback, live call state monitoring)
    ▼
Phase 9.4: Buyer Intelligence & Transparent Scoring
    │   (8-dimension visual score breakdown, qualification reason audits)
    ▼
Phase 9.5: Inventory Matching & Handoff Management
    │   (Catalog manager, recommendation inspector, manual CRM re-dispatch)
    ▼
Phase 9.6: Commercial Analytics & Pilot Dashboard
    │   (Funnel yield, SLA adherence tracker, Cost-per-qualified metric)
    ▼
Phase 9.7: Client-Testable V1 Hardening & Freeze
    │   (E2E client simulation, multi-tenant security verification, production readiness)
```

### Detailed Roadmap Phases

#### Phase 9.1: Commercial UX / Buyer Intelligence Workspace
- **Objective:** Build the primary customer-facing UI for sales teams: Priority Queue, Buyer Dossier, Confirmed Requirements panel, and SLA timers.
- **Input:** Upstream Supabase schema (`leads`, `buyer_scores`, `buyer_qualifications`, `broker_handoffs`).
- **Output:** Clean, high-contrast, responsive Buyer Workspace UI in React.
- **Dependencies:** Phase 9.0 frozen contract.
- **Acceptance Criteria:** Brokers can view, filter, and inspect complete dossiers with evidence quotes.

#### Phase 9.2: Client Onboarding & Lead Intake
- **Objective:** Enable clients to upload CSV leads or configure webhooks with instant validation feedback.
- **Input:** Raw lead CSV files and incoming HTTP POST webhooks.
- **Output:** Ingestion modal, mapping preview, duplicate report, and webhook secret management UI.
- **Dependencies:** Phase 9.1 workspace.
- **Acceptance Criteria:** 100 leads imported via CSV with correct normalization and zero duplicate leaks.

#### Phase 9.3: Voice Qualification Experience
- **Objective:** Provide visual controls for call status, call history, audio recording playback, and full conversation transcripts.
- **Input:** `call_transcripts`, `calls` tables, Sarvam audio URLs.
- **Output:** Audio player component, speaker-separated transcript viewer with quotation highlights.
- **Dependencies:** Phase 9.1, Phase 9.2.
- **Acceptance Criteria:** Sales agents can listen to the exact audio segment confirming budget and timeline.

#### Phase 9.4: Buyer Intelligence & Transparent Scoring
- **Objective:** Build visual breakdown of the 8-dimension scoring engine, SLA countdowns, and qualification status badges.
- **Input:** `buyer_scores` breakdown JSON, `buyer_qualifications` reason codes.
- **Output:** Visual score gauge (0-100), point allocation breakdown, and tier badges (`HOT`, `WARM`, `NURTURE`).
- **Dependencies:** Phase 9.1.
- **Acceptance Criteria:** Client immediately understands why a lead was graded Tier 1 vs Tier 2.

#### Phase 9.5: Inventory Matching & Handoff Management
- **Objective:** Provide project catalog management UI and outbound CRM dispatch status monitors.
- **Input:** `projects` table, `broker_handoffs` dispatch state.
- **Output:** Project catalog editor, match recommendation card with fit percentage, manual re-dispatch button.
- **Dependencies:** Phase 9.1.
- **Acceptance Criteria:** Client can add a project and immediately see it appear as an AI recommendation on fitting dossiers.

#### Phase 9.6: Commercial Analytics & Pilot Reporting
- **Objective:** Deliver executive analytics: Lead Funnel, Qualification Yield Rate, SLA Compliance, and Estimated Cost Saved.
- **Input:** Aggregated database views across `leads`, `calls`, `buyer_qualifications`.
- **Output:** Executive analytics dashboard with date-range filters and CSV export.
- **Dependencies:** Phases 9.1–9.5.
- **Acceptance Criteria:** Displays real-time Qualified Buyer Output Rate and SLA adherence.

#### Phase 9.7: Client-Testable V1 Hardening & Freeze
- **Objective:** Full end-to-end multi-tenant pilot rehearsal, security audit, typecheck, lint, and baseline freeze.
- **Input:** Complete Phase 9 codebase.
- **Output:** Frozen V1 production release tagged for pilot deployment.
- **Dependencies:** Phases 9.1–9.6.
- **Acceptance Criteria:** Zero lint/typecheck errors; end-to-end pilot workflow executes without error.

---

## PART 18: ARCHITECTURAL IMPACT CHECK

### Findings
- **Production Architecture Status:** **NO ARCHITECTURAL CHANGES REQUIRED.**
- The existing frozen Phase 8B production execution architecture (`pipeline_executions`, `claim_pipeline_execution`, `BuyerPipelineCoordinator`, `PipelineRecoveryWorker`, `BrokerHandoffService`) is completely sufficient to support the Phase 9.0 Commercial Product Contract.
- Database schema, RLS policies, migrations, and service-role privileges remain 100% untouched.

---

## PART 19: DOCUMENTATION & TRACEABILITY

- **Authoritative Contract Document:** `docs/PHASE_9_COMMERCIAL_PRODUCT_CONTRACT.md` (This document).
- **Master Project Tracking:** `docs/GROWTHFORGE_PROJECT_STATE.md` updated to reflect Phase 9.0 commencement.

---

## PART 20: TEST & STATIC CODE VERIFICATION

In accordance with strict release policy:
- No application production code files modified.
- No database migrations created or altered.
- All existing static checks (`tsc --noEmit`, `eslint`, production build) verified green.
