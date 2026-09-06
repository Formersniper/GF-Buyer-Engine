# GrowthForge Supabase PostgreSQL Database Architecture

## 1. System of Record Overview
Supabase PostgreSQL acts as the single source of truth for the GrowthForge Buyer Intelligence Engine. All lead profiles, enrichment feeds, telephony logs, extracted buyer intent facts, scoring metrics, project matching calculations, and audit history events are persisted across 9 relational tables.

---

## 2. Table Definitions & Constraints

### 1. `leads`
Stores core lead contact identities, acquisition channels, and high-level workflow lifecycle status.
- `id` (UUID, PK, `gen_random_uuid()`): Internal system UUID.
- `lead_id` (TEXT, UNIQUE, NOT NULL): Canonical stable human-readable identifier (`GF-YYYY-NNNNNN`).
- `name` (TEXT): Full name of the lead contact.
- `phone` (TEXT): Normalized phone number (E.164 compatible storage).
- `email` (TEXT): Normalized lowercase email address.
- `source` (TEXT): Ingestion source channel (e.g., `CSV_IMPORT`, `META_ADS`, `PARTNER_REFERRAL`).
- `source_reference` (TEXT): Campaign ID or external referral token.
- `status` (TEXT, DEFAULT `'RAW'`): Current workflow stage from the 16 canonical + 6 failure states.
- `created_at` (TIMESTAMPTZ, DEFAULT `now()`): Creation timestamp.
- `updated_at` (TIMESTAMPTZ, DEFAULT `now()`): Automated trigger-updated timestamp.

### 2. `lead_enrichment`
Stores Scout OSINT and public data discovery payloads.
- `id` (UUID, PK): Record identifier.
- `lead_id` (UUID, FK -> `leads.id` ON DELETE CASCADE): Associated lead record.
- `platform` (TEXT): Discovery channel (e.g. `linkedin`, `mca_director`, `twitter`).
- `username` / `profile_url` / `full_name` / `bio` / `website` / `company` / `location` (TEXT).
- `raw_data` (JSONB): Full unmodified scraper output payload.
- `enriched_data` (JSONB): Structured synthesized entity facts.
- `source_confidence` (NUMERIC): Quality score (0.0 to 1.0).
- `created_at` (TIMESTAMPTZ).

### 3. `calls`
Telephony qualification sessions and transcripts.
- `id` (UUID, PK): Session UUID.
- `lead_id` (UUID, FK -> `leads.id` ON DELETE CASCADE): Associated lead record.
- `provider` (TEXT): Neutral provider identifier (e.g. `sarvam`, `twilio`, `vapi`).
- `provider_call_id` (TEXT): Provider session token.
- `status` (TEXT): Call status (`INITIATED`, `RINGING`, `CONNECTED`, `COMPLETED`, `FAILED`, `NO_ANSWER`).
- `attempt_number` (INTEGER, DEFAULT 1).
- `started_at` / `ended_at` (TIMESTAMPTZ).
- `duration_seconds` (INTEGER).
- `transcript` (TEXT): Full raw audio transcript text.
- `recording_url` (TEXT): Secure audio recording URI.
- `call_outcome` (TEXT): Disposition (`INTERESTED`, `NOT_INTERESTED`, `CALLBACK_REQUESTED`).
- `call_metadata` (JSONB): Detailed telephony telemetry.
- `created_at` (TIMESTAMPTZ).

### 4. `buyer_profiles`
Structured buying intent facts extracted with epistemic truth levels.
- `id` (UUID, PK).
- `lead_id` (UUID, UNIQUE, FK -> `leads.id` ON DELETE CASCADE): 1-to-1 profile constraint.
- `property_interest` (BOOLEAN): Confirmed interest in purchasing real estate.
- `property_type` (TEXT): E.g., `Apartment`, `Villa`, `Plot`, `Penthouse`.
- `configuration` (TEXT): E.g., `3 BHK`, `4 BHK`, `Duplex`.
- `purpose` (TEXT): `Self-use` vs `Investment`.
- `budget_min` / `budget_max` (NUMERIC): INR numeric range bounds.
- `currency` (TEXT, DEFAULT `'INR'`).
- `preferred_locations` (JSONB): Array of targeted micro-markets.
- `timeline` (TEXT): E.g., `Immediate`, `3-6 months`, `Under construction`.
- `financing` (TEXT): `Self-funded` vs `Home Loan pre-approved`.
- `decision_maker` (BOOLEAN): Whether the contact makes the final buying decision.
- `requirements` (JSONB): Mandatory buyer criteria.
- `preferences` (JSONB): Soft buyer preferences.
- `qualification_status` (TEXT): `HOT`, `WARM`, `NURTURE`, `UNQUALIFIED`.
- `intent_score` (NUMERIC): Intent score (0 to 100).
- `confidence_score` (NUMERIC): Statistical confidence.
- `created_at` / `updated_at` (TIMESTAMPTZ).

### 5. `buyer_preferences`
Attribute-level granular buyer preference store.
- `id` (UUID, PK).
- `lead_id` (UUID, FK -> `leads.id` ON DELETE CASCADE).
- `attribute` (TEXT NOT NULL): E.g., `balcony_facing`, `vaastu_compliant`, `ev_charging`.
- `value` (JSONB).
- `source` (TEXT): Origin (`CONVERSATION`, `SCOUT_OSINT`, `DIRECT_FORM`).
- `confidence` (NUMERIC).
- `is_explicit` (BOOLEAN, DEFAULT false).
- `is_verified` (BOOLEAN, DEFAULT false).
- `created_at` (TIMESTAMPTZ).

### 6. `projects`
Controlled developer inventory catalog.
- `id` (UUID, PK).
- `project_code` (TEXT UNIQUE NOT NULL): E.g. `DEMO_PROJECT_001`.
- `project_name` (TEXT NOT NULL).
- `developer_name` (TEXT).
- `city` / `locality` / `micro_market` (TEXT).
- `property_type` (TEXT).
- `configurations` (JSONB): E.g., `["2 BHK", "3 BHK", "4 BHK"]`.
- `price_min` / `price_max` (NUMERIC).
- `possession` (TEXT).
- `project_description` (TEXT).
- `features` (JSONB): Key property highlights.
- `amenities` (JSONB): Clubhouse, pool, sports infrastructure.
- `project_url` (TEXT).
- `status` (TEXT, DEFAULT `'ACTIVE'`).
- `created_at` / `updated_at` (TIMESTAMPTZ).

### 7. `project_matches`
Algorithmic project match results and dimension scores.
- `id` (UUID, PK).
- `lead_id` (UUID, FK -> `leads.id` ON DELETE CASCADE).
- `project_id` (UUID, FK -> `projects.id` ON DELETE CASCADE).
- `match_score` (NUMERIC): Overall composite fit score (0-100).
- `budget_score` / `location_score` / `configuration_score` / `purpose_score` / `preference_score` / `timeline_score` (NUMERIC).
- `buyer_confirmed` (BOOLEAN, DEFAULT false): Invariant: AI match != Buyer confirmation.
- `reason` (JSONB): Explanation summary, highlights, and caveats.
- `created_at` (TIMESTAMPTZ).
- **Constraint**: `UNIQUE (lead_id, project_id)`.

### 8. `buyer_scores`
Composite buyer intent and readiness scores.
- `id` (UUID, PK).
- `lead_id` (UUID, FK -> `leads.id` ON DELETE CASCADE).
- `intent_score` / `budget_score` / `location_score` / `timeline_score` / `decision_score` / `project_fit_score` (NUMERIC).
- `overall_score` (NUMERIC): 0-100 composite index.
- `qualification` (TEXT): `HOT`, `WARM`, `NURTURE`.
- `reason` (JSONB): Dimension breakdown & scoring weights.
- `created_at` (TIMESTAMPTZ).

### 9. `lead_events`
Immutable append-only audit trail.
- `id` (UUID, PK).
- `lead_id` (UUID, FK -> `leads.id` ON DELETE CASCADE).
- `event_type` (TEXT NOT NULL): E.g., `LEAD_INGESTED`, `DUPLICATE_INGESTION_DETECTED`, `STATUS_CHANGED`.
- `event_data` (JSONB): Event payload and metadata.
- `created_at` (TIMESTAMPTZ).

---

## 3. Migration & Seed Execution

1. Apply the initial schema:
   ```bash
   psql -h <host> -U postgres -d postgres -f supabase/migrations/001_initial_schema.sql
   ```
2. Seed sample real estate inventory:
   ```bash
   psql -h <host> -U postgres -d postgres -f supabase/seed/sample-projects.sql
   ```

---

## 4. Row Level Security (RLS)
All 9 tables have RLS enabled. Development MVP policies permit reading and writing across anonymous client connections using standard public keys. In production, policies enforce user role and multi-tenant partition filters.
