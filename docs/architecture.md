# GrowthForge Buyer Intelligence Engine — Architecture Specification

## 1. Product Overview

The **GrowthForge Buyer Intelligence Engine** transforms raw, campaign-agnostic real-estate leads into structured, AI-qualified property buyers, and matches those qualified buyers to high-fit real-estate projects from a curated inventory catalog.

Eventual paying customers:
- Real-estate brokers
- Builders & developers
- Channel partners
- Property consultants

People being qualified:
- Real-estate property buyers

---

## 2. Core Transformation Pipeline

```text
RAW LEAD
  ↓
LEAD RESOLUTION (Deduplication, Canonization, GF-ID assignment)
  ↓
PUBLIC ENRICHMENT (Scout Python Subsystem)
  ↓
BUYER SIGNAL ANALYSIS (Gemini Buyer Signal Agent)
  ↓
CALL ELIGIBILITY (Consent, Attempt Thresholds, Cooldown Gate)
  ↓
VOICE QUALIFICATION (Provider-neutral Telephony Interface)
  ↓
TRANSCRIPT & OUTCOME
  ↓
STRUCTURED BUYER EXTRACTION (Gemini Conversation Extraction Agent)
  ↓
BUYER QUALIFICATION (Gemini Buyer Qualification Agent)
  ↓
BUYER SCORING (HOT: 90–100, WARM: 70–89, NURTURE: 0–69)
  ↓
PROJECT / INVENTORY MATCHING (Gemini Project Matching Agent)
  ↓
QUALIFIED BUYER
  ↓
CLIENT HANDOFF
```

---

## 3. Subsystem Architecture & Frozen Boundaries

```text
                    GROWTHFORGE BUYER ENGINE
                              │
                              ▼
                     GOOGLE AI STUDIO UI
                              │
                              ▼
                       LEAD ORCHESTRATOR
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
          ▼                   ▼                   ▼
      LEAD INTAKE        SCOUT ENGINE          VOICE AI
          │                   │                   │
          │                   ▼                   ▼
          │             PUBLIC SIGNALS      BUYER CONVERSATION
          │                   │                   │
          └───────────────────┼───────────────────┘
                              ▼
                            GEMINI
                              │
           ┌──────────────────┼──────────────────┐
           │                  │                  │
           ▼                  ▼                  ▼
      EXTRACTION        QUALIFICATION       MATCHING
           │                  │                  │
           └──────────────────┼──────────────────┘
                              ▼
                           SUPABASE
                              │
                ┌─────────────┼─────────────┐
                ▼             ▼             ▼
             BUYERS        PROJECTS        EVENTS
                │
                ▼
         CLIENT DISTRIBUTION
```

### Component Isolation Boundaries:

1. **Scout (/scout)**:
   - Python-based public scraping and enrichment engine (derived from `kiryano/Scout`).
   - Resides in `/scout`.
   - Never rewritten in TypeScript.
   - Frontend and backend communicate with Scout **only** through the `ScoutAdapter` service boundary (`scrapeProfile`, `enrichLead`, `bulkScrape`).

2. **Voice Provider (Provider-Neutral)**:
   - Neutral abstraction (`IVoiceProvider`) with `startCall`, `getCallStatus`, `processWebhook`, `getTranscript`, `endCall`.
   - Protected by a technical **Calling Eligibility Gate** before invocation.
   - Asynchronous execution model: does not block the UI while calls execute.

3. **Gemini Agents**:
   - 5 dedicated agents with machine-readable JSON schemas:
     - `BuyerSignalAgent`
     - `ConversationExtractionAgent`
     - `BuyerQualificationAgent`
     - `ScoringAgent`
     - `ProjectMatchingAgent`
   - Strict hallucination controls: AI reasons; deterministic application logic manages state transitions.

4. **Supabase PostgreSQL**:
   - System of record for persistent storage.
   - 8 core tables: `leads`, `lead_enrichment`, `calls`, `buyer_profiles`, `buyer_preferences`, `projects`, `project_matches`, `buyer_scores`, `lead_events`.
