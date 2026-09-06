# Supabase System of Record

## Architectural Invariants
1. **Authoritative State Store**: Supabase (PostgreSQL) is the sole system of record for all lead dossiers, qualification sessions, enriched signals, scores, project matches, and audit event logs.
2. **Repository Boundary**: Direct database or SQL calls are strictly forbidden in UI components. All persistence and reads must pass through the typed repository interfaces defined in `app/services/supabase/repositories.ts`.
3. **Immutable Event Audit**: All workflow transitions and status changes must log an immutable entry to `lead_events`.

## Core Tables (9 Entities):
1. `leads`: Primary lead identity, consent, and workflow status.
2. `lead_enrichment`: Scout OSINT and public data payload.
3. `calls`: Telephony metadata, recordings, and raw transcripts.
4. `buyer_profiles`: Structured buyer facts (epistemic truth levels).
5. `buyer_preferences`: Location affinity and project requirements.
6. `projects`: Controlled developer inventory catalog.
7. `project_matches`: Algorithmic project match results and dimension scores.
8. `buyer_scores`: Composite intent scores and component breakdowns.
9. `lead_events`: Append-only audit trail of pipeline actions.
