/**
 * GrowthForge Buyer Intelligence Engine - Phase 5F Broker Handoff Delivery Adapters
 *
 * Source of Truth: Formersniper/GF-Buyer-Engine
 * Defines provider-neutral delivery channel boundaries and safe mock implementation.
 *
 * SAFETY INVARIANT: Default operation is strictly MOCK / DRY-RUN.
 * No real WhatsApp, SMS, email, or third-party CRM modifications are executed.
 */

import crypto from 'crypto';
import { promises as dnsPromises } from 'dns';
import { BrokerHandoffPackage, DispatchResult, BrokerDispatchStatus } from '../../../schemas/handoff';
import { logger } from '../../security/logger';

export interface BrokerHandoffChannel {
  readonly channelName: string;
  dispatch(handoff: BrokerHandoffPackage, options?: { dryRun?: boolean }): Promise<DispatchResult>;
}

export class MockBrokerHandoffChannel implements BrokerHandoffChannel {
  public readonly channelName = 'MOCK_SALES_CHANNEL';
  private dispatchedPayloads: Map<string, { handoff: BrokerHandoffPackage; dispatchedAt: string }> = new Map();

  /**
   * Safe mock dispatch of sales handoff package.
   */
  public async dispatch(
    handoff: BrokerHandoffPackage,
    options: { dryRun?: boolean } = { dryRun: true }
  ): Promise<DispatchResult> {
    const isDryRun = options.dryRun !== false; // Default to true
    const now = new Date().toISOString();
    const dispatchId = `mock-dispatch-${Date.now()}-${handoff.handoff_id.slice(0, 8)}`;

    // Store in mock delivery registry
    this.dispatchedPayloads.set(handoff.handoff_id, {
      handoff,
      dispatchedAt: now,
    });

    return {
      success: true,
      dispatch_id: dispatchId,
      channel: this.channelName,
      status: 'SENT',
      delivered_at: now,
      dry_run: isDryRun,
      message: `[MOCK_DISPATCH_SUCCESS] Handoff ${handoff.handoff_id} safely dispatched to ${handoff.routing_decision.assigned_team} (${handoff.routing_decision.assigned_role}) with SLA ${handoff.routing_decision.sla_minutes}m. No real external side-effects produced.`,
    };
  }

  public getDispatchedHandoff(handoffId: string) {
    return this.dispatchedPayloads.get(handoffId) || null;
  }

  public clear() {
    this.dispatchedPayloads.clear();
  }
}

export const mockBrokerHandoffChannel = new MockBrokerHandoffChannel();

// Forbidden header keys that tenants cannot override
const FORBIDDEN_HEADERS = new Set([
  'content-type',
  'host',
  'content-length',
  'connection',
  'transfer-encoding',
  'upgrade',
  'te',
  'keep-alive',
  'via',
  'http2-settings',
]);

/**
 * SSRF Helper - Evaluates if a given IP address belongs to standard private/internal/reserved subnets.
 */
export function isPrivateIP(ip: string): boolean {
  // Check IPv4
  const ipv4Match = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4Match) {
    const [, aStr, bStr, cStr, dStr] = ipv4Match;
    const a = parseInt(aStr, 10);
    const b = parseInt(bStr, 10);
    const c = parseInt(cStr, 10);
    const d = parseInt(dStr, 10);

    if (a > 255 || b > 255 || c > 255 || d > 255) return true; // Invalid, treat as private/unsupported

    // Loopback
    if (a === 127) return true;
    // Private Network (RFC 1918)
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    // Link-local
    if (a === 169 && b === 254) return true;
    // Unspecified / Broadcast / Multicast / Reserved
    if (a === 0 || a >= 224) return true;

    return false;
  }

  // Check IPv6 (strip bracket encapsulation if present from URLs)
  const cleanIp = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');

  // Loopback & Unspecified
  if (cleanIp === '::1' || cleanIp === '::' || cleanIp === '0:0:0:0:0:0:0:1' || cleanIp === '0:0:0:0:0:0:0:0') {
    return true;
  }

  // Check prefixes (Link-Local, ULA, Multicast)
  if (cleanIp.startsWith('fe8') || cleanIp.startsWith('fe9') || cleanIp.startsWith('fea') || cleanIp.startsWith('feb')) {
    return true;
  }
  if (cleanIp.startsWith('fc') || cleanIp.startsWith('fd')) {
    return true;
  }
  if (cleanIp.startsWith('ff')) {
    return true;
  }

  return false;
}

/**
 * SSRF Helper - Parses endpoint URL and validates against private networks or internal metadata targets.
 *
 * NOTE ON DNS REBINDING (TOCTOU):
 * Pre-validation resolves hostname to IP and verifies it is not in private/reserved ranges.
 * If a malicious DNS authority returns a public IP during pre-validation and alternates to a
 * private IP upon the subsequent fetch socket connection, a window exists.
 * To mitigate this without pulling in heavy non-standard network abstractions:
 * - Direct IPs and cloud metadata hosts are statically blocked upfront
 * - redirects are strictly rejected ('redirect: error') to prevent 3xx pivoting
 * - DNS lookup pre-flight validates IP before fetch
 */
export async function validateEndpointUrl(endpointUrl: string): Promise<{ parsedUrl: URL; resolvedIp: string }> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(endpointUrl);
  } catch (err) {
    throw new Error('Invalid endpoint URL structure');
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS schemes are permitted');
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  // Hostname blacklist before resolution
  const blacklist = [
    'localhost',
    'loopback',
    'metadata.google.internal',
    'metadata.google',
    'instance-metadata',
  ];
  if (blacklist.some(b => hostname === b || hostname.endsWith('.' + b))) {
    throw new Error('SSRF Protection: Private/Reserved domain rejected');
  }

  // If host is directly an IP, validate it
  if (/^[0-9.]+$/.test(hostname) || hostname.includes(':')) {
    if (isPrivateIP(hostname)) {
      throw new Error('SSRF Protection: Private IP address rejected');
    }
    return { parsedUrl, resolvedIp: hostname };
  }

  // DNS lookup
  let resolvedIp: string;
  try {
    const lookupResult = await dnsPromises.lookup(parsedUrl.hostname, { all: false });
    resolvedIp = lookupResult.address;
  } catch (err) {
    throw new Error('SSRF Protection: Hostname resolution failed');
  }

  if (isPrivateIP(resolvedIp)) {
    throw new Error('SSRF Protection: Resolved IP address is in a private/internal range');
  }

  return { parsedUrl, resolvedIp };
}

/**
 * Production Webhook Channel Adapter for Sales Handoff Delivery.
 * Features strict SSRF protection, authorization header injection, 5000ms timeout bounds,
 * and fail-safe credential sanitization.
 */
export class WebhookBrokerHandoffChannel implements BrokerHandoffChannel {
  public readonly channelName = 'WEBHOOK_SALES_CHANNEL';

  constructor(
    private readonly endpointUrl: string,
    private readonly metadata: Record<string, unknown> | null = null
  ) {}

  public async dispatch(
    handoff: BrokerHandoffPackage,
    options: { dryRun?: boolean } = { dryRun: true }
  ): Promise<DispatchResult> {
    const isDryRun = options.dryRun !== false; // Default to true
    const now = new Date().toISOString();
    const dispatchId = crypto.randomUUID();

    if (isDryRun) {
      return {
        success: true,
        dispatch_id: `dry-run-${dispatchId}`,
        channel: this.channelName,
        status: 'SENT',
        delivered_at: now,
        dry_run: true,
        message: `[DRY_RUN_SUCCESS] Webhook dispatch simulated to ${this.sanitizeUrlForLogs(this.endpointUrl)}. No real HTTP request sent.`,
      };
    }

    const startTime = Date.now();
    let parsedUrl: URL;
    let resolvedIp: string;

    // SSRF Validation
    try {
      const validation = await validateEndpointUrl(this.endpointUrl);
      parsedUrl = validation.parsedUrl;
      resolvedIp = validation.resolvedIp;
    } catch (err: any) {
      logger.error('[SSRF REJECTION] Outbound webhook blocked by SSRF Protection:', {
        service: 'broker-dispatch',
        operation: 'dispatch_webhook',
        error_category: 'SECURITY_VIOLATION',
        data: {
          channel: this.channelName,
          endpoint_sanitized: this.sanitizeUrlForLogs(this.endpointUrl),
          error: err.message,
        },
      });

      return {
        success: false,
        dispatch_id: dispatchId,
        channel: this.channelName,
        status: 'FAILED',
        delivered_at: now,
        dry_run: false,
        error: `SSRF Rejection: ${err.message}`,
        retry_eligible: false,
      };
    }

    // Build headers securely with strict restrictions
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.metadata) {
      // 1. Explicit controlled authentication credentials
      const bearerToken = this.metadata.bearer_token || this.metadata.bearerToken || this.metadata.token;
      if (typeof bearerToken === 'string' && !/[\r\n]/.test(bearerToken)) {
        headers['Authorization'] = `Bearer ${bearerToken.trim()}`;
      }

      const apiKey = this.metadata.api_key || this.metadata.apiKey;
      if (typeof apiKey === 'string' && !/[\r\n]/.test(apiKey)) {
        headers['X-API-Key'] = apiKey.trim();
      }

      const webhookSecret = this.metadata.webhook_secret || this.metadata.webhookSecret || this.metadata.secret;
      if (typeof webhookSecret === 'string' && !/[\r\n]/.test(webhookSecret)) {
        headers['X-Webhook-Secret'] = webhookSecret.trim();
      }

      // 2. Safe custom headers from metadata.headers
      if (this.metadata.headers && typeof this.metadata.headers === 'object' && !Array.isArray(this.metadata.headers)) {
        for (const [key, val] of Object.entries(this.metadata.headers)) {
          if (typeof val !== 'string') continue;
          const trimmedKey = key.trim();
          const lowerKey = trimmedKey.toLowerCase();

          // Prevent CRLF header injection
          if (/[\r\n]/.test(trimmedKey) || /[\r\n]/.test(val)) continue;

          // Block forbidden protocol headers (Content-Type, Host, Content-Length, Connection, etc.)
          if (FORBIDDEN_HEADERS.has(lowerKey)) continue;

          // Block proxy headers
          if (lowerKey.startsWith('proxy-')) continue;

          // Block attempts to inject or override security credentials via arbitrary headers
          if (lowerKey === 'authorization' || lowerKey === 'x-api-key' || lowerKey === 'x-webhook-secret') {
            continue;
          }

          headers[trimmedKey] = val;
        }
      }
    }

    // Hard invariant: Content-Type is always application/json
    headers['Content-Type'] = 'application/json';

    // Prepare cancellation controller for timeout
    let isTimedOut = false;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      isTimedOut = true;
      controller.abort();
    }, 5000);

    try {
      const response = await fetch(this.endpointUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(handoff),
        signal: controller.signal,
        redirect: 'error',
      });

      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;

      logger.info('[Webhook Dispatch Completed]', {
        service: 'broker-dispatch',
        operation: 'dispatch_webhook',
        duration_ms: duration,
        status: String(response.status),
        data: {
          dispatch_id: dispatchId,
          channel: this.channelName,
          hostname: parsedUrl.hostname,
          status_code: response.status,
          success: response.ok,
        },
      });

      if (response.ok) {
        return {
          success: true,
          dispatch_id: dispatchId,
          channel: this.channelName,
          status: 'SENT',
          delivered_at: new Date().toISOString(),
          dry_run: false,
          message: `Webhook successfully dispatched to ${parsedUrl.hostname} with status ${response.status}`,
        };
      }

      const isRetryEligible = response.status >= 500;
      return {
        success: false,
        dispatch_id: dispatchId,
        channel: this.channelName,
        status: 'FAILED',
        delivered_at: new Date().toISOString(),
        dry_run: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        retry_eligible: isRetryEligible,
      };

    } catch (err: any) {
      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;
      const isTimeout = isTimedOut || err.name === 'AbortError' || err.name === 'TimeoutError';
      const safeError = isTimeout ? 'Request timed out after 5000ms' : this.getSafeErrorMessage(err);

      logger.error('[Webhook Dispatch Failed]', {
        service: 'broker-dispatch',
        operation: 'dispatch_webhook',
        duration_ms: duration,
        error_category: isTimeout ? 'TIMEOUT_ERROR' : 'NETWORK_ERROR',
        data: {
          dispatch_id: dispatchId,
          channel: this.channelName,
          hostname: parsedUrl.hostname,
          error: safeError,
        },
      });

      return {
        success: false,
        dispatch_id: dispatchId,
        channel: this.channelName,
        status: 'FAILED',
        delivered_at: new Date().toISOString(),
        dry_run: false,
        error: safeError,
        retry_eligible: true, // Network/socket/DNS/timeout failures are always retryable
      };
    }
  }

  private sanitizeUrlForLogs(urlStr: string): string {
    try {
      const url = new URL(urlStr);
      return `${url.protocol}//${url.hostname}${url.pathname}`;
    } catch {
      return 'invalid-url';
    }
  }

  private getSafeErrorMessage(err: any): string {
    if (!err) return 'Unknown error';
    const rawMessage = err.message || String(err);
    let sanitized = rawMessage;
    // Mask URLs and query tokens
    sanitized = sanitized.replace(/https?:\/\/[^\s]+/gi, '[REDACTED_URL]');
    // Mask any potential bearer tokens, secrets, or keys in error strings
    sanitized = sanitized.replace(/(bearer\s+[a-zA-Z0-9_\-\.]+)/gi, 'Bearer [REDACTED]');
    sanitized = sanitized.replace(/([a-zA-Z0-9_-]*(?:key|secret|token|password)[a-zA-Z0-9_-]*\s*[:=]\s*)[^\s,]+/gi, '$1[REDACTED]');
    return sanitized;
  }
}
