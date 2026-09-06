/**
 * GrowthForge Raw Lead Ingestion & Resolution Service
 * 
 * FROZEN ARCHITECTURE CONTRACT:
 * - Accepts simple raw CSV input (name, phone, email, source).
 * - Campaign-agnostic: does NOT require project, developer, budget, location, or campaign.
 * - Generates canonical GF Lead ID (e.g. GF-2026-000001).
 * - Distinguishes KNOWN fields (from raw_lead) from UNKNOWN fields (to be discovered).
 */

import {
  GFBuyerLead,
  DataTruthLevel,
  AttributeSource,
  FieldProvenance,
} from '../../types/buyerLead';
import { WORKFLOW_STATES } from '../../types/workflow';

export interface RawLeadRowInput {
  name?: string;
  phone?: string;
  email?: string;
  source?: string;
  location?: string;
  [key: string]: string | undefined;
}

export interface IngestionBatchResult {
  totalParsed: number;
  validLeads: GFBuyerLead[];
  errors: Array<{ row: number; error: string; raw: RawLeadRowInput }>;
}

let leadCounter = 1;

export function generateLeadId(sequenceNumber?: number): string {
  const year = new Date().getFullYear();
  const num = sequenceNumber ?? leadCounter++;
  const padded = String(num).padStart(6, '0');
  return `GF-${year}-${padded}`;
}

export function createFieldProvenance<T>(
  value: T,
  source: AttributeSource = 'raw_lead',
  truth_level: DataTruthLevel = 'KNOWN',
  confidence: number = 1.0,
  evidence?: string
): FieldProvenance<T> {
  return {
    value,
    source,
    truth_level,
    confidence,
    updated_at: new Date().toISOString(),
    evidence,
  };
}

/**
 * Transforms raw input row into Canonical GF Buyer Lead
 */
export function initializeCanonicalLead(
  input: RawLeadRowInput,
  sequence?: number
): GFBuyerLead {
  const leadId = generateLeadId(sequence);
  const now = new Date().toISOString();
  const fullName = (input.name || '').trim();
  const phone = (input.phone || '').trim();
  const email = (input.email || '').trim();
  const rawSource = (input.source || 'csv_upload').trim();
  const location = (input.location || '').trim();

  const provenanceFields: Record<string, FieldProvenance> = {
    full_name: createFieldProvenance(fullName, 'raw_lead', fullName ? 'KNOWN' : 'UNKNOWN'),
    phone: createFieldProvenance(phone, 'raw_lead', phone ? 'KNOWN' : 'UNKNOWN'),
    email: createFieldProvenance(email, 'raw_lead', email ? 'KNOWN' : 'UNKNOWN'),
    location: createFieldProvenance(location, 'raw_lead', location ? 'KNOWN' : 'UNKNOWN'),
  };

  return {
    lead_id: leadId,

    identity: {
      full_name: fullName,
      phone: phone,
      email: email,
      location: location,
      residence: '',
      profession: '',
      company: '',
    },

    buying_intent: {
      interested: false,
      property_type: '',
      configuration: '',
      purpose: '',

      budget: {
        min: null,
        max: null,
        currency: 'INR',
      },

      preferred_locations: [],

      timeline: '',
      financing: '',
      decision_maker: null,

      requirements: [],
      preferences: [],
    },

    project_intelligence: {
      top_matches: [],

      preferred_project: {
        project_id: null,
        project_name: null,
        confidence: 0,
        selection_basis: '',
      },
    },

    lead_intelligence: {
      source: rawSource,
      intent_score: 0,
      qualification: 'UNQUALIFIED',
      confidence: 0,
      recommended_action: 'Awaiting Public Enrichment and Calling Eligibility Check',
    },

    provenance: {
      consent_status: 'DIRECT_INQUIRY',
      consent_source: rawSource,
      consent_timestamp: now,
      fields: provenanceFields,
    },

    workflow: {
      status: WORKFLOW_STATES.RAW,
      last_event: 'Raw lead ingested via CSV intake',
      updated_at: now,
    },
  };
}

/**
 * Basic CSV Parser supporting standard CSV format
 */
export function parseCSVLeads(csvText: string): IngestionBatchResult {
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return { totalParsed: 0, validLeads: [], errors: [] };
  }

  // Parse header
  const headerLine = lines[0];
  const headers = headerLine.split(',').map((h) => h.trim().toLowerCase().replace(/^["']|["']$/g, ''));

  const validLeads: GFBuyerLead[] = [];
  const errors: Array<{ row: number; error: string; raw: RawLeadRowInput }> = [];

  for (let i = 1; i < lines.length; i++) {
    const rowLine = lines[i];
    if (!rowLine.trim()) continue;

    // Simple comma parsing handling quoted values
    const rawValues: string[] = [];
    let insideQuotes = false;
    let currentVal = '';

    for (let charIndex = 0; charIndex < rowLine.length; charIndex++) {
      const char = rowLine[charIndex];
      if (char === '"') {
        insideQuotes = !insideQuotes;
      } else if (char === ',' && !insideQuotes) {
        rawValues.push(currentVal.trim().replace(/^["']|["']$/g, ''));
        currentVal = '';
      } else {
        currentVal += char;
      }
    }
    rawValues.push(currentVal.trim().replace(/^["']|["']$/g, ''));

    const rowData: RawLeadRowInput = {};
    headers.forEach((h, idx) => {
      rowData[h] = rawValues[idx] || '';
    });

    // Validation: must have at least name or phone or email
    const name = rowData.name || rowData['full name'] || rowData.fullname || '';
    const phone = rowData.phone || rowData['phone number'] || rowData.mobile || '';
    const email = rowData.email || rowData['email address'] || '';
    const source = rowData.source || 'csv_upload';
    const location = rowData.location || rowData.city || '';

    if (!name && !phone && !email) {
      errors.push({
        row: i + 1,
        error: 'Row missing name, phone, and email identifier',
        raw: rowData,
      });
      continue;
    }

    const lead = initializeCanonicalLead({
      name,
      phone,
      email,
      source,
      location,
    });

    validLeads.push(lead);
  }

  return {
    totalParsed: lines.length - 1,
    validLeads,
    errors,
  };
}
