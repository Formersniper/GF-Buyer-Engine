# GrowthForge Lead Intake & Resolution Pipeline

## 1. Overview
The Lead Intake layer is campaign-agnostic and processes raw lead batches from CSV imports, API webhooks, or direct forms. It normalizes identity attributes, enforces deterministic deduplication, generates canonical GrowthForge Lead IDs, persists records to Supabase, and outputs structured ingestion metrics.

---

## 2. Ingestion Lifecycle

```text
CSV File / Webhook Payload
          ↓
     CSV Parser
  (Handles quotes, commas, missing headers)
          ↓
     Validation
  (Requires name + phone or email)
          ↓
   Lead Normalizer
  (Trims whitespace, lowercases email, E.164 phone)
          ↓
    Lead Resolver & Deduplication
  (Priority 1: Phone match | Priority 2: Email match)
          ↓
   Supabase PostgreSQL Persistence
  (Inserts into `leads`, logs to `lead_events`)
          ↓
 Canonical GF Buyer Lead Mapping
  (Hydrates normalized records into domain dossier)
          ↓
  UI Summary & Pipeline Presentation
```

---

## 3. CSV Format Specifications

### Minimum Accepted Headers
| Column | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Full contact name (e.g., `Manish Malhotra`) |
| `phone` | string | Yes* | Phone number (*At least phone or email required) |
| `email` | string | Yes* | Email address (*At least phone or email required) |
| `source` | string | Optional | Lead source channel (default: `CSV_IMPORT`) |
| `source_reference` | string | Optional | Campaign ID or tracking code (e.g. `IG_LUXURY_01`) |

### Supported Header Aliases
- Name: `name`, `full_name`, `fullname`, `buyer_name`, `customer_name`
- Phone: `phone`, `phone_number`, `mobile`, `contact`
- Email: `email`, `email_address`
- Source: `source`, `lead_source`, `channel`

---

## 4. Normalization Rules

1. **Names**:
   - Strips leading/trailing whitespace and collapses multiple interior spaces into a single space.
2. **Emails**:
   - Lowercases all characters and validates against RFC 5322 regex.
3. **Phone Numbers**:
   - Strips non-numeric delimiters (spaces, parentheses, dashes).
   - Standardizes Indian 10-digit mobile numbers to international format: `+91XXXXXXXXXX`.
   - Preserves explicit international `+` prefixes.

---

## 5. Deduplication & Conflict Resolution

- **Primary Priority**: Phone Number Match.
- **Secondary Priority**: Email Address Match.

### Resolution Outcomes:
1. `NEW`: No matching phone or email found. Creates new lead with status `RAW` and assigned `GF-YYYY-NNNNNN` identifier.
2. `DUPLICATE`: Matches existing contact. Preserves existing canonical `lead_id` and logs a `DUPLICATE_INGESTION_DETECTED` event in `lead_events`.
3. `AMBIGUOUS`: Phone or email matches an existing record, but the contact name differs substantially (e.g., different person using a shared corporate landline). Lead is created with status `REQUIRES_REVIEW` and flagged for manual operator resolution.
4. `INVALID`: Row is missing both phone and email, or fields fail syntax validation. Row is rejected and recorded in the error log.

---

## 6. Output Summary Interface

```typescript
export interface ImportSummary {
  total_rows: number;
  accepted: number;
  created: number;
  updated: number;
  duplicates: number;
  invalid: number;
  errors: Array<{
    row: number;
    message: string;
    data?: Record<string, unknown>;
  }>;
  createdLeads: Lead[];
}
```
