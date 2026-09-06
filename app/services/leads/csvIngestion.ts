/**
 * GrowthForge Buyer Intelligence Engine - CSV Ingestion Service
 *
 * Flow:
 * CSV Content -> Parse -> Validate -> Normalize -> Resolve & Deduplicate -> Persist -> Return Import Summary
 */

import { supabaseDataService } from '../supabase/repositories';
import { resolveLead, RawLeadRecordInput } from './leadResolver';
import { Lead } from '../../schemas/database';

export interface CSVRowError {
  row: number;
  message: string;
  data?: Record<string, unknown>;
}

export interface ImportSummary {
  total_rows: number;
  accepted: number;
  created: number;
  updated: number;
  duplicates: number;
  invalid: number;
  errors: CSVRowError[];
  createdLeads: Lead[];
}

/**
 * Parses raw CSV string into an array of header-mapped objects.
 * Handles quoted cells with commas, newlines, and trims whitespace.
 */
export function parseCSV(csvText: string): Array<Record<string, string>> {
  if (!csvText || !csvText.trim()) return [];

  const lines = csvText.trim().split(/\r\n|\n|\r/);
  if (lines.length < 2) return [];

  // Parse header line
  const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase().trim().replace(/['"]/g, ''));

  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine) continue;

    const values = parseCSVLine(rawLine);
    const rowObj: Record<string, string> = {};

    headers.forEach((header, index) => {
      rowObj[header] = values[index] ? values[index].trim() : '';
    });

    rows.push(rowObj);
  }

  return rows;
}

/**
 * Parses a single CSV line honoring double quotes.
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"' || char === "'") {
      if (inQuotes && line[i + 1] === char) {
        current += char;
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

/**
 * Ingests a CSV string, parses, validates, deduplicates, and saves leads to Supabase.
 */
export async function ingestCSVLeads(csvContent: string): Promise<ImportSummary> {
  const parsedRows = parseCSV(csvContent);

  const summary: ImportSummary = {
    total_rows: parsedRows.length,
    accepted: 0,
    created: 0,
    updated: 0,
    duplicates: 0,
    invalid: 0,
    errors: [],
    createdLeads: [],
  };

  if (parsedRows.length === 0) {
    summary.errors.push({
      row: 0,
      message: 'CSV file is empty or missing headers.',
    });
    return summary;
  }

  // Fetch all existing leads from Supabase repository for accurate deduplication
  const existingLeads = await supabaseDataService.leads.listLeads();

  for (let i = 0; i < parsedRows.length; i++) {
    const rowNumber = i + 2; // 1-indexed including header row
    const row = parsedRows[i];

    // Map possible header aliases
    const name = row['name'] || row['full_name'] || row['fullname'] || row['buyer_name'] || row['customer_name'] || '';
    const phone = row['phone'] || row['phone_number'] || row['mobile'] || row['contact'] || '';
    const email = row['email'] || row['email_address'] || '';
    const source = row['source'] || row['lead_source'] || row['channel'] || 'CSV_IMPORT';
    const source_reference = row['source_reference'] || row['reference'] || row['campaign'] || null;

    const rawInput: RawLeadRecordInput = {
      name,
      phone,
      email,
      source,
      source_reference,
    };

    try {
      const resolution = resolveLead(rawInput, existingLeads);

      if (resolution.outcome === 'INVALID') {
        summary.invalid++;
        summary.errors.push({
          row: rowNumber,
          message: resolution.validationErrors.join(' ') || 'Row failed validation.',
          data: row,
        });
        continue;
      }

      if (resolution.outcome === 'DUPLICATE') {
        summary.duplicates++;
        summary.accepted++;

        // Append deduplication event in lead_events
        if (resolution.matchedExistingLead) {
          await supabaseDataService.leadEvents.appendLeadEvent({
            lead_id: resolution.matchedExistingLead.id,
            event_type: 'DUPLICATE_INGESTION_DETECTED',
            event_data: {
              raw_input: rawInput,
              source: resolution.normalized.source,
              timestamp: new Date().toISOString(),
            },
          });
        }
        continue;
      }

      if (resolution.outcome === 'AMBIGUOUS') {
        summary.accepted++;
        summary.created++;

        // Create lead in REQUIRES_REVIEW status
        const created = await supabaseDataService.leads.createLead({
          lead_id: resolution.leadId,
          name: resolution.normalized.name,
          phone: resolution.normalized.phone,
          email: resolution.normalized.email,
          source: resolution.normalized.source,
          source_reference: resolution.normalized.source_reference,
          status: 'REQUIRES_REVIEW',
        });

        await supabaseDataService.leadEvents.appendLeadEvent({
          lead_id: created.id,
          event_type: 'AMBIGUOUS_IDENTITY_FLAGGED',
          event_data: {
            conflicting_lead_id: resolution.matchedExistingLead?.lead_id,
            reasons: resolution.validationErrors,
          },
        });

        existingLeads.push(created);
        summary.createdLeads.push(created);
        continue;
      }

      // NEW Lead
      const created = await supabaseDataService.leads.createLead({
        lead_id: resolution.leadId,
        name: resolution.normalized.name,
        phone: resolution.normalized.phone,
        email: resolution.normalized.email,
        source: resolution.normalized.source,
        source_reference: resolution.normalized.source_reference,
        status: 'RAW',
      });

      // Log initial ingestion event
      await supabaseDataService.leadEvents.appendLeadEvent({
        lead_id: created.id,
        event_type: 'LEAD_INGESTED',
        event_data: {
          source: resolution.normalized.source,
          source_reference: resolution.normalized.source_reference,
          ingestion_method: 'CSV',
          raw_name: rawInput.name,
        },
      });

      existingLeads.push(created);
      summary.createdLeads.push(created);
      summary.accepted++;
      summary.created++;
    } catch (err) {
      summary.errors.push({
        row: rowNumber,
        message: err instanceof Error ? err.message : 'Unknown database persistence error.',
        data: row,
      });
    }
  }

  return summary;
}
