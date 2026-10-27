/**
 * GrowthForge Buyer Intelligence Engine - Phase 13A.2 Google Sheets Delivery Channel
 *
 * Implements BrokerHandoffChannel to deliver qualified buyer intelligence packages
 * directly to a tenant-authorized Google Spreadsheet.
 *
 * INVARIANTS:
 * 1. Strictly respects dry-run mode (zero external HTTP requests).
 * 2. Neutralizes spreadsheet formula injection (=, +, -, @) on untrusted inputs.
 * 3. Enforces idempotency via Column A lookup before appending rows.
 * 4. Strictly validates Google Sheets API host (prevents SSRF / arbitrary host redirection).
 * 5. Reconciles ambiguous writes on network timeout without generating duplicate rows.
 * 6. Never logs phone numbers or API secrets.
 */

import crypto from 'crypto';
import {
  BrokerHandoffPackage,
  DispatchResult,
  BuyerRequirementHandoff,
} from '../../../schemas/handoff';
import { BrokerHandoffChannel } from './brokerHandoffChannel';
import { logger } from '../../security/logger';
import { googleSheetsAuthService, GoogleSheetsAuthService } from '../googleSheetsAuthService';

const GOOGLE_SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const SPREADSHEET_ID_REGEX = /^[a-zA-Z0-9-_]{20,100}$/;

export interface GoogleSheetsChannelConfig {
  spreadsheetId: string;
  sheetName?: string;
  accessToken?: string | null;
  authService?: GoogleSheetsAuthService;
}

/**
 * Formula Injection Protection:
 * Neutralizes characters (=, +, -, @, \t, \r) that spreadsheet software interprets as formula commands.
 * Pure signed numbers (e.g. -50, +100) are converted to JavaScript Numbers.
 */
export function sanitizeCell(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return value;

  const rawStr = String(value);
  if (!rawStr) return '';

  const trimmed = rawStr.trim();
  if (!trimmed) {
    if (rawStr.includes('\t') || rawStr.includes('\r')) {
      return `'${rawStr}`;
    }
    return '';
  }

  const rawFirstChar = rawStr.charAt(0);
  const trimmedFirstChar = trimmed.charAt(0);

  const isFormulaTrigger =
    rawFirstChar === '\t' ||
    rawFirstChar === '\r' ||
    trimmedFirstChar === '=' ||
    trimmedFirstChar === '+' ||
    trimmedFirstChar === '-' ||
    trimmedFirstChar === '@' ||
    trimmedFirstChar === '\t' ||
    trimmedFirstChar === '\r';

  if (isFormulaTrigger) {
    // If trimmed string is a simple negative number like "-50" or "-3.14"
    if (/^-\d{1,12}(\.\d+)?$/.test(trimmed)) {
      return Number(trimmed);
    }
    // Prefix with single quote to display as literal text in Google Sheets
    return `'${rawStr}`;
  }

  return trimmed;
}

/**
 * Formats buyer requirement budget into readable currency representation without fabricating values.
 */
export function formatBudget(req?: BuyerRequirementHandoff): string {
  if (!req || (req.budget_min === null && req.budget_max === null)) {
    return 'UNKNOWN';
  }
  const currency = req.currency || 'INR';
  if (req.budget_min !== null && req.budget_max !== null) {
    if (currency === 'INR') {
      const minCr = parseFloat((req.budget_min / 10000000).toFixed(2));
      const maxCr = parseFloat((req.budget_max / 10000000).toFixed(2));
      return `₹${minCr} Cr - ₹${maxCr} Cr`;
    }
    return `${req.budget_min} - ${req.budget_max} ${currency}`;
  }
  if (req.budget_min !== null) {
    return `Min ${req.budget_min} ${currency}`;
  }
  if (req.budget_max !== null) {
    return `Max ${req.budget_max} ${currency}`;
  }
  return 'UNKNOWN';
}

/**
 * Formats a BrokerHandoffPackage into the canonical 20-column Google Sheets row.
 */
export function formatHandoffRow(handoff: BrokerHandoffPackage, dispatchedAt: string): Array<string | number | boolean | null> {
  const primaryReq = handoff.requirements?.[0];
  const topProjects = (handoff.project_recommendations || [])
    .slice(0, 3)
    .map((p) => `${p.project_name} (${p.match_score}%)`)
    .join(', ');

  return [
    // Column A: Handoff ID (Unique External Idempotency Key)
    handoff.handoff_id,
    // Column B: Lead ID
    handoff.lead_id,
    // Column C: Lead Name
    sanitizeCell(handoff.primary_buyer_summary?.name || ''),
    // Column D: Contact Phone (Tenant-Authorized Destination Only)
    sanitizeCell(handoff.primary_buyer_summary?.phone || ''),
    // Column E: Lead Source
    sanitizeCell(handoff.external_lead_id || 'UNKNOWN'),
    // Column F: Consent Status
    sanitizeCell(handoff.primary_buyer_summary?.contact_status || 'UNKNOWN'),
    // Column G: Qualification Status
    sanitizeCell(handoff.qualification?.status || 'UNQUALIFIED'),
    // Column H: Buyer Score (Numeric 0-100)
    typeof handoff.priority?.score === 'number' ? handoff.priority.score : 0,
    // Column I: Priority Tier
    sanitizeCell(handoff.priority?.tier || 'TIER_4_REVIEW'),
    // Column J: Property Type
    sanitizeCell(primaryReq?.property_type || ''),
    // Column K: Configuration
    sanitizeCell(primaryReq?.configuration || ''),
    // Column L: Preferred Locations
    sanitizeCell(primaryReq?.preferred_locations?.join(', ') || ''),
    // Column M: Budget Range
    sanitizeCell(formatBudget(primaryReq)),
    // Column N: Timeline
    sanitizeCell(primaryReq?.timeline || ''),
    // Column O: Assigned Team
    sanitizeCell(handoff.routing_decision?.assigned_team || ''),
    // Column P: Assigned Role
    sanitizeCell(handoff.routing_decision?.assigned_role || ''),
    // Column Q: SLA Deadline
    handoff.priority?.sla_deadline || '',
    // Column R: Top Project Matches
    sanitizeCell(topProjects || ''),
    // Column S: Recommended Action
    sanitizeCell(handoff.recommended_action || ''),
    // Column T: Dispatched At
    dispatchedAt,
  ];
}

export class GoogleSheetsBrokerHandoffChannel implements BrokerHandoffChannel {
  public readonly channelName = 'GOOGLE_SHEETS_CHANNEL';
  private readonly spreadsheetId: string;
  private readonly sheetName: string;
  private readonly staticAccessToken: string | null;
  private readonly authService: GoogleSheetsAuthService;
  private readonly fetchImpl: typeof fetch;

  constructor(
    config: GoogleSheetsChannelConfig,
    options?: { fetchFn?: typeof fetch }
  ) {
    const trimmedId = (config.spreadsheetId || '').trim();
    if (!trimmedId) {
      throw new Error('Google Sheets spreadsheet ID is missing');
    }
    if (!SPREADSHEET_ID_REGEX.test(trimmedId)) {
      throw new Error('Google Sheets spreadsheet ID is invalid');
    }

    this.spreadsheetId = trimmedId;
    this.sheetName = (config.sheetName || 'Qualified Leads').trim();
    this.staticAccessToken = config.accessToken !== undefined ? config.accessToken : (process.env.GOOGLE_SHEETS_ACCESS_TOKEN || null);
    this.authService = config.authService || googleSheetsAuthService;
    this.fetchImpl = options?.fetchFn || fetch;
  }

  public async dispatch(
    handoff: BrokerHandoffPackage,
    options: { dryRun?: boolean } = { dryRun: true }
  ): Promise<DispatchResult> {
    const isDryRun = options.dryRun !== false;
    const now = new Date().toISOString();
    const dispatchId = crypto.randomUUID();

    // 1. Dry-Run Mode: Simulation without network access
    if (isDryRun) {
      return {
        success: true,
        dispatch_id: `dry-run-${dispatchId}`,
        channel: this.channelName,
        status: 'SENT',
        delivered_at: now,
        dry_run: true,
        message: `[DRY_RUN_SUCCESS] Google Sheets sync simulated for spreadsheet ${this.spreadsheetId} (Sheet: "${this.sheetName}"). No real API call sent.`,
      };
    }

    // 2. Credential Verification / Server-Side Token Resolution
    let token = this.staticAccessToken;
    if (!token) {
      try {
        token = await this.authService.getAccessToken();
      } catch (err: any) {
        logger.error('Google Sheets dispatch rejected: Missing or invalid credentials', {
          service: 'google-sheets-dispatch',
          operation: 'dispatch',
          data: { spreadsheetId: this.spreadsheetId, sheetName: this.sheetName, error: err.message },
        });
        const isNetwork = Boolean(err?.isNetworkError || err?.retry_eligible);
        return {
          success: false,
          dispatch_id: dispatchId,
          channel: this.channelName,
          status: 'FAILED',
          delivered_at: now,
          dry_run: false,
          error: err.message || 'Missing Google Sheets credentials',
          retry_eligible: isNetwork,
        };
      }
    }

    // 3. Pre-append Idempotency Check (Read Column A)
    const encodedSheet = encodeURIComponent(this.sheetName);
    const readUrl = `${GOOGLE_SHEETS_API_BASE}/${this.spreadsheetId}/values/${encodedSheet}!A:A`;

    let alreadyExists = false;
    try {
      const readRes = await this.fetchImpl(readUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });

      if (readRes.ok) {
        const readData = (await readRes.json()) as { values?: string[][] };
        if (Array.isArray(readData.values)) {
          alreadyExists = readData.values.some((row) => row && row[0] === handoff.handoff_id);
        }
      } else {
        const handledError = this.handleHttpError(readRes.status, 'lookup');
        if (handledError) {
          return {
            success: false,
            dispatch_id: dispatchId,
            channel: this.channelName,
            status: 'FAILED',
            delivered_at: now,
            dry_run: false,
            error: handledError.error,
            retry_eligible: handledError.retry_eligible,
          };
        }
      }
    } catch (err: any) {
      logger.warn('Google Sheets pre-append lookup encountered network issue', {
        service: 'google-sheets-dispatch',
        data: { error: err.message },
      });
      // Network issue during lookup -> non-fatal to proceed to append or retryable failure
      return {
        success: false,
        dispatch_id: dispatchId,
        channel: this.channelName,
        status: 'FAILED',
        delivered_at: now,
        dry_run: false,
        error: `Network failure during sheet lookup: ${err.message}`,
        retry_eligible: true,
      };
    }

    if (alreadyExists) {
      return {
        success: true,
        dispatch_id: `dup-${handoff.handoff_id}`,
        channel: this.channelName,
        status: 'IGNORED_DUPLICATE',
        delivered_at: now,
        dry_run: false,
        message: `Handoff ${handoff.handoff_id} already exists in sheet "${this.sheetName}". Duplicate ignored.`,
      };
    }

    // 4. Append Row
    const rowValues = formatHandoffRow(handoff, now);
    const appendUrl = `${GOOGLE_SHEETS_API_BASE}/${this.spreadsheetId}/values/${encodedSheet}!A:T:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

    try {
      const appendRes = await this.fetchImpl(appendUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          values: [rowValues],
        }),
      });

      if (!appendRes.ok) {
        const handledError = this.handleHttpError(appendRes.status, 'append');
        return {
          success: false,
          dispatch_id: dispatchId,
          channel: this.channelName,
          status: 'FAILED',
          delivered_at: now,
          dry_run: false,
          error: handledError.error,
          retry_eligible: handledError.retry_eligible,
        };
      }

      return {
        success: true,
        dispatch_id: dispatchId,
        channel: this.channelName,
        status: 'SENT',
        delivered_at: now,
        dry_run: false,
        message: `Successfully appended handoff row to Google Sheet "${this.sheetName}".`,
      };
    } catch (err: any) {
      // 5. Ambiguous Append Outcome: Reconcile before flagging failure
      const reconciled = await this.reconcileAmbiguousAppend(handoff.handoff_id, token);
      if (reconciled) {
        return {
          success: true,
          dispatch_id: dispatchId,
          channel: this.channelName,
          status: 'SENT',
          delivered_at: now,
          dry_run: false,
          message: `Append succeeded after reconciliation check following network timeout.`,
        };
      }

      return {
        success: false,
        dispatch_id: dispatchId,
        channel: this.channelName,
        status: 'FAILED',
        delivered_at: now,
        dry_run: false,
        error: `Network failure during sheet append: ${err.message}`,
        retry_eligible: true,
      };
    }
  }

  /**
   * Reconciles whether a row was appended despite a client-side socket/timeout exception.
   */
  private async reconcileAmbiguousAppend(handoffId: string, token: string): Promise<boolean> {
    try {
      const encodedSheet = encodeURIComponent(this.sheetName);
      const readUrl = `${GOOGLE_SHEETS_API_BASE}/${this.spreadsheetId}/values/${encodedSheet}!A:A`;
      const res = await this.fetchImpl(readUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });
      if (res.ok) {
        const data = (await res.json()) as { values?: string[][] };
        if (Array.isArray(data.values)) {
          return data.values.some((row) => row && row[0] === handoffId);
        }
      }
    } catch {
      // Re-read also failed -> outcome remains ambiguous
    }
    return false;
  }

  private handleHttpError(
    statusCode: number,
    operation: 'lookup' | 'append'
  ): { error: string; retry_eligible: boolean } {
    switch (statusCode) {
      case 400:
        return {
          error: `Google Sheets API rejected request (400 Bad Request): invalid sheet range or payload format during ${operation}`,
          retry_eligible: false,
        };
      case 401:
        return {
          error: `Google Sheets authentication failed (401 Unauthorized): invalid or expired token`,
          retry_eligible: false,
        };
      case 403:
        return {
          error: `Google Sheets permission denied (403 Forbidden): verify service account has edit access to spreadsheet`,
          retry_eligible: false,
        };
      case 404:
        return {
          error: `Google Sheets spreadsheet or worksheet not found (404 Not Found): check spreadsheetId and sheetName`,
          retry_eligible: false,
        };
      case 429:
        return {
          error: `Google Sheets rate limit exceeded (429 Too Many Requests)`,
          retry_eligible: true,
        };
      case 500:
      case 502:
      case 503:
      case 504:
        return {
          error: `Google Sheets service error (${statusCode})`,
          retry_eligible: true,
        };
      default:
        return {
          error: `Google Sheets API returned unexpected HTTP status ${statusCode} during ${operation}`,
          retry_eligible: statusCode >= 500,
        };
    }
  }
}
