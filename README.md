# GrowthForge Buyer Intelligence Engine

Transforming raw, campaign-agnostic real-estate leads into structured, AI-qualified property buyers and matching them with high-fit real-estate projects.

---

## 1. Phase 1 Architecture Foundation

This codebase represents **Phase 1** of the 5-day master build. In accordance with the Frozen Architecture Contract:
- **Application Shell & Navigation**: 5 views (Lead Import, Processing, Qualified Buyers, Buyer Detail, Project Matches).
- **Canonical Type System**: Strict implementations of `GFBuyerLead`, `BuyerIdentity`, `BuyingIntent`, `ProjectIntelligence`, `LeadIntelligence`, `Provenance`, and `Workflow`.
- **Epistemic Data-Truth Model**: Tracks all fields across `KNOWN`, `INFERRED`, `CONFIRMED`, and `UNKNOWN`.
- **Workflow State Machine**: 16-stage deterministic state engine (`RAW` through `HANDOFF`) with strict transition controls and failure handling.
- **Supabase Persistence Abstraction**: Typed repositories with dual-mode support (Supabase PostgreSQL system of record + in-memory fallback store).
- **Service Boundaries**:
  - `ScoutAdapter`: Isolated Python scraping boundary (`/scout`).
  - `VoiceProvider`: Telephony abstraction with technical calling eligibility gate.
  - `Gemini Agents`: Typed contracts for Buyer Signal, Conversation Extraction, Buyer Qualification, Scoring, and Project Matching.
- **Controlled Seed Catalog**: Realistic luxury & premium project catalog and pre-qualified leads for demo testing.

---

## 2. Directory Structure

```text
├── src/
│   ├── types/
│   │   ├── buyerLead.ts       # Canonical GF Buyer Lead & related schemas
│   │   ├── workflow.ts        # Workflow state machine & allowed transitions
│   │   └── index.ts
│   ├── services/
│   │   ├── supabase/
│   │   │   ├── client.ts      # Client-safe Supabase configuration
│   │   │   └── repositories/  # Typed database repositories
│   │   ├── scout/
│   │   │   └── scoutAdapter.ts # Scout enrichment boundary
│   │   ├── voice/
│   │   │   └── voiceProvider.ts # Voice calling boundary & eligibility gate
│   │   ├── workflow/
│   │   │   └── stateMachine.ts # Deterministic state machine controller
│   │   ├── leads/
│   │   │   └── leadIngestion.ts # Raw CSV ingestion & GF-ID generator
│   │   └── data/
│   │       └── seedData.ts    # Seed projects & demo pipeline leads
│   ├── agents/
│   │   └── interfaces.ts      # Gemini AI agent service contracts
│   ├── components/            # UI components and view layouts
│   ├── App.tsx                # Primary view shell and router
│   └── main.tsx
├── docs/
│   ├── architecture.md        # Master architecture contract
│   ├── buyer-schema.md        # Canonical GF schema & Data-Truth rules
│   └── agent-contracts.md     # Gemini agent prompt & output contracts
├── scout/                     # Python Scout scraping subsystem (Phase 3)
├── .env.example               # Environment variables specification
└── README.md
```

---

## 3. Getting Started

### Prerequisites
- Node.js 18+
- npm

### Installation & Execution
```bash
# Install dependencies
npm install

# Start local development server (port 3000)
npm run dev

# Run TypeScript type checker
npm run lint

# Build production bundle
npm run build
```

---

## 4. Environment Configuration

Copy `.env.example` to `.env`:
```bash
# Supabase PostgreSQL Database (System of Record)
VITE_SUPABASE_URL="https://your-project.supabase.co"
VITE_SUPABASE_ANON_KEY="your-anon-key"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"

# Gemini AI Key (Injected automatically in AI Studio)
GEMINI_API_KEY="your-gemini-key"

# Scout Adapter
SCOUT_API_URL="http://localhost:8000"

# Voice Provider
VOICE_PROVIDER="generic"
VOICE_API_KEY="your-voice-key"
```

---

## 5. Next Steps (Phase 2 & Beyond)

- **Phase 2**: Supabase SQL migrations, server-side REST/edge functions, live database persistence, and deduplication logic.
- **Phase 3**: Scout Python subsystem integration into `/scout` and live public profile scraping.
- **Phase 4**: Provider-neutral Voice AI execution, telephony webhooks, and live speech-to-text transcript processing.
- **Phase 5**: Gemini structured generation, automated qualification, scoring calculations, and dynamic project catalog matching.
