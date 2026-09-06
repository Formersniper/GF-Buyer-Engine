# GrowthForge Buyer Intelligence Engine

Transforming raw, campaign-agnostic real-estate leads into structured, AI-qualified property buyers and matching them with high-fit real-estate projects.

---

## 1. Phase 1 — Supabase Foundation & Lead Ingestion

This codebase implements **Phase 1** of the GrowthForge Buyer Intelligence Engine:
- **Supabase Database (System of Record)**: Full PostgreSQL migration (`supabase/migrations/001_initial_schema.sql`) with 9 relational tables, indexes, updated_at triggers, and Row Level Security.
- **Repository Abstraction Layer**: Typed `SupabaseDataService` exposing repository patterns for leads, enrichments, calls, profiles, preferences, projects, matches, scores, and events, with dual-mode Supabase + fallback in-memory support.
- **Canonical GF Buyer Lead Mapping**: `mapToGFBuyerLead()` bridges normalized relational rows to the single authoritative `GFBuyerLead` domain contract.
- **Lead Resolver & Deduplication**:
  - Cleans, trims, and normalizes phone numbers (E.164/+91 standard) and emails.
  - Generates stable canonical GrowthForge Lead IDs (`GF-YYYY-NNNNNN`).
  - Deterministic deduplication prioritizes phone matches, then email matches, and flags identity conflicts as `REQUIRES_REVIEW`.
- **CSV Ingestion Pipeline**: Ingests raw CSVs, validates rows, records row-level errors, persists leads and immutable audit events to `lead_events`, and returns detailed ingestion summaries.
- **Lead Import UI**: Interactive interface supporting drag-and-drop CSV upload, live summary metrics (Total Rows, Accepted, Created, Updated, Duplicates, Invalid, Errors), and dossier inspection.
- **Automated Verification Suite**: 39 automated tests covering ID generation, normalization, parsing, deduplication, state transitions, and end-to-end repository persistence.

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
