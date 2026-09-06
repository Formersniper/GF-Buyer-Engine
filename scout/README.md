# Scout Public Enrichment Engine (Python)

## Architectural Boundary
This directory is the designated mount point and execution boundary for the **Scout Python Public Enrichment Scraper**.

### Architectural Invariants:
1. **No TypeScript Porting**: The Python Scout source code is executed natively in Python runtime. It must **NOT** be rewritten into TypeScript.
2. **No Logic Duplication**: Web scraping, public registry queries, and OSINT parsing belong exclusively to Scout.
3. **Strict Interface Boundary**: The GrowthForge Buyer Intelligence Engine communicates with Scout strictly through the TypeScript adapter `app/services/scout/scoutAdapter.ts`.

### Interface Contract:
- **Input**: `{ phone?: string, email?: string, full_name?: string, city?: string, location?: string }`
- **Output**: `ScoutEnrichmentResult` (employment, social presence, public director records, data confidence, raw payload)
