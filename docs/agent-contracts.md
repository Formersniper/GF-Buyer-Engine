# GrowthForge Gemini Agent Contracts

## 1. Overview

Gemini is responsible for reasoning, structured fact extraction, score calculations, and match evaluation. Application state transitions, access control, and database persistence are controlled deterministically by application logic.

---

## 2. Agent 1: GF Buyer Signal Agent

- **Objective**: Determine whether public signals and raw lead data suggest real-estate purchasing interest or high home-buying capacity.
- **Input**:
  - `leadId`: string
  - `identity`: BuyerIdentity
  - `source`: string
  - `enrichments`: LeadEnrichmentRow[]
- **Output Schema**:
  ```json
  {
    "buyer_candidate": true,
    "possible_interests": ["Luxury High-Rise", "Golf Course Extension Road"],
    "public_signals": [
      {
        "signal": "Senior Technology Leader at Gurgaon Tech Park",
        "source": "Scout / LinkedIn",
        "confidence": 0.90
      }
    ],
    "unknown_fields": ["budget", "timeline", "preferred_configuration"],
    "recommended_questions": ["What configuration are you planning to upgrade to?"],
    "confidence": 0.85
  }
  ```

---

## 3. Agent 2: GF Conversation Extraction Agent

- **Objective**: Parse phone call transcripts into normalized, granular buyer facts.
- **Input**:
  - `leadId`: string
  - `transcript`: string
  - `priorContext`: Partial<GFBuyerLead>
- **Output Schema**:
  ```json
  {
    "leadId": "GF-2026-000001",
    "facts": [
      {
        "attribute": "configuration",
        "value": "4 BHK",
        "source": "voice_call",
        "confidence": 0.98,
        "is_explicit": true,
        "truth_level": "CONFIRMED",
        "quote": "We are specifically looking for a spacious 4 BHK."
      }
    ],
    "buying_intent_updates": {
      "configuration": "4 BHK",
      "interested": true
    },
    "unresolved_ambiguities": [],
    "confidence": 0.95
  }
  ```

---

## 4. Agent 3: GF Buyer Qualification Agent

- **Objective**: Synthesize all available evidence (raw, public enrichment, and conversation) to evaluate overall intent readiness.
- **Input**:
  - `lead`: GFBuyerLead
  - `transcriptSummary`: string
  - `enrichments`: LeadEnrichmentRow[]
- **Output Schema**:
  ```json
  {
    "intent_score": 94,
    "qualification": "HOT",
    "confidence": 0.93,
    "recommended_action": "Direct Partner Handoff for Private DLF Arbour Experience Walkthrough",
    "reason": {
      "summary": "High-intent buyer with confirmed 4 BHK requirement, self-funded budget, and 3-6 month timeline.",
      "buying_readiness": "Immediate (active site tour readiness)",
      "financial_clarity": "Strong (self-funded / pre-approved)",
      "key_drivers": ["Family upgrade", "Low-density privacy"],
      "risks_or_blockers": []
    }
  }
  ```

---

## 5. Agent 4: GF Scoring Agent

### Scoring Weights (V1 Default):
- **Buyer Intent**: 25%
- **Budget Clarity**: 15%
- **Location Clarity**: 15%
- **Timeline**: 15%
- **Project Fit**: 10%
- **Decision Authority**: 10%
- **Contactability**: 5%
- **Data Freshness**: 5%

### Qualification Thresholds:
- **HOT**: 90 – 100
- **WARM**: 70 – 89
- **NURTURE**: 0 – 69

---

## 6. Agent 5: GF Project Matching Agent

### Project Matching Weights (V1 Default):
- **Budget**: 25%
- **Location**: 25%
- **Configuration**: 15%
- **Property Type**: 10%
- **Purpose**: 10%
- **Timeline**: 5%
- **Preferences**: 5%
- **Project Attributes**: 5%

- **Guiding Principle**: An AI project match is an algorithmically identified fit — it does **not** become a confirmed buyer preference until explicitly acknowledged or accepted by the buyer.
