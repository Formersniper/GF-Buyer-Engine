# Canonical GrowthForge Buyer Lead Specification

## 1. Frozen Schema Contract

All agents, repositories, and UI views communicate using the single canonical contract below. No agent is permitted to create custom or fragmented versions of this structure.

```json
{
  "lead_id": "GF-2026-000001",

  "identity": {
    "full_name": "Rahul Sharma",
    "phone": "+91 98110 44219",
    "email": "rahul.sharma@example.com",
    "location": "Gurgaon",
    "residence": "DLF Phase 5",
    "profession": "VP of Engineering",
    "company": "Fintech Global"
  },

  "buying_intent": {
    "interested": true,
    "property_type": "Residential Apartment",
    "configuration": "4 BHK",
    "purpose": "Self Use",

    "budget": {
      "min": 70000000,
      "max": 90000000,
      "currency": "INR"
    },

    "preferred_locations": ["Golf Course Extension Road", "Sector 63"],

    "timeline": "3 to 6 months",
    "financing": "Self-funded",
    "decision_maker": true,

    "requirements": ["Gated luxury community", "High floor with open view"],
    "preferences": ["Low tower density", "2+ EV parking bays"]
  },

  "project_intelligence": {
    "top_matches": [
      {
        "project_id": "proj-001",
        "project_name": "The Arbour by DLF",
        "match_score": 94,
        "buyer_confirmed": true,
        "reason": {
          "summary": "Direct fit for 4 BHK luxury requirement and Sector 63 corridor."
        }
      }
    ],

    "preferred_project": {
      "project_id": "proj-001",
      "project_name": "The Arbour by DLF",
      "confidence": 0.94,
      "selection_basis": "Direct alignment across 4 BHK luxury requirement, Sector 63 micro-market, and immediate financial readiness."
    }
  },

  "lead_intelligence": {
    "source": "Direct Portal Inquiry",
    "intent_score": 94,
    "qualification": "HOT",
    "confidence": 0.93,
    "recommended_action": "Direct Partner Handoff for Private DLF Arbour Experience Walkthrough"
  },

  "provenance": {
    "consent_status": "EXPLICIT_OPT_IN",
    "consent_source": "Inquiry Form + OTP Verified",
    "consent_timestamp": "2026-09-01T09:15:00Z",

    "fields": {
      "full_name": {
        "value": "Rahul Sharma",
        "source": "raw_lead",
        "truth_level": "KNOWN",
        "confidence": 1.0,
        "updated_at": "2026-09-01T09:15:00Z"
      },
      "budget": {
        "value": "₹7–9 Cr",
        "source": "voice_call",
        "truth_level": "CONFIRMED",
        "confidence": 0.96,
        "updated_at": "2026-09-01T11:45:00Z"
      }
    }
  },

  "workflow": {
    "status": "HOT",
    "last_event": "Qualification completed: Scored 94/100, Matched to DLF Arbour",
    "updated_at": "2026-09-02T14:35:00Z"
  }
}
```

---

## 2. Data-Truth Rules

Every critical buyer attribute must be tracked with its exact epistemic certainty level:

| Truth Level | Description | Example Sources |
|-------------|-------------|-----------------|
| `KNOWN` | Explicitly supplied directly by the initial lead input. | CSV row fields (`name`, `phone`, `email`). |
| `INFERRED` | Deduced by Gemini AI or Scout public enrichment heuristics. | LinkedIn profile match, estimated budget bracket from occupation. |
| `CONFIRMED` | Explicitly verified, confirmed, or stated by the buyer during conversational interaction. | Spoken response in voice qualification call ("I am looking for a 4 BHK under 8 Cr"). |
| `UNKNOWN` | Attribute has not yet been discovered or asked. | Budget before calling, timeline before qualification. |

### Core Epistemic Guarantees:
1. **Never convert `INFERRED` into `CONFIRMED` without direct evidence.**
2. **Never overwrite `CONFIRMED` buyer data with subsequent `INFERRED` assumptions.**
3. **Never fabricate missing information.** If a property type or timeline was not stated, it remains `UNKNOWN`.
