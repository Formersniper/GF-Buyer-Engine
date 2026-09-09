/**
 * GrowthForge Buyer Intelligence Engine - Sarvam Voice API Client
 *
 * SPECIFICATION:
 * - Direct Sarvam Instant Outbound API integration.
 * - Endpoint: POST https://apps.sarvam.ai/api/outbounds/v1/orgs/{org_id}/workspaces/{workspace_id}/outbounds
 * - Authenticated via `X-API-Key` header.
 * - Server-side secrets only; never exposes keys to browser or logs.
 * - Maps exact `app_config`, `connection_config`, `agent_variables`, `user_config`, and `webhook_config`.
 */

import { SarvamError, SarvamErrorCode, mapHttpErrorToSarvamError } from './sarvamErrors';

export interface SarvamClientConfig {
  apiKey?: string;
  baseUrl?: string;
  orgId?: string;
  workspaceId?: string;
  agentId?: string;
  agentVersion?: string | number;
  connectionId?: string;
  agentPhoneNumber?: string;
  timeoutMs?: number;
}

export interface SarvamOutboundPayload {
  toPhoneNumber: string;
  recipientName?: string;
  leadId?: string;
  enquiryType?: string;
  systemPrompt?: string;
  initialMessage?: string;
  webhookUrl?: string;
  customVariables?: Record<string, string>;
  orgId?: string;
  workspaceId?: string;
  agentId?: string;
  agentVersion?: string | number;
  connectionId?: string;
  agentPhoneNumber?: string;
}

export interface SarvamOutboundResponse {
  externalCallId: string;
  status: string;
  provider: 'sarvam';
  targetPhoneMasked: string;
  rawResponse?: Record<string, unknown>;
}

export interface SarvamCallTelemetry {
  externalCallId: string;
  status: string;
  durationSeconds: number;
  startedAt?: string | null;
  endedAt?: string | null;
  transcript?: string | null;
  recordingUrl?: string | null;
  failureReason?: string | null;
  rawResponse?: Record<string, unknown>;
}

export class SarvamClient {
  private apiKey: string;
  private baseUrl: string;
  private orgId: string;
  private workspaceId: string;
  private agentId: string;
  private agentVersion: string | number;
  private connectionId: string;
  private agentPhoneNumber: string;
  private timeoutMs: number;

  constructor(config?: SarvamClientConfig) {
    this.apiKey = config?.apiKey !== undefined ? config.apiKey : (process.env.SARVAM_API_KEY || '');
    
    let rawBase = config?.baseUrl !== undefined ? config.baseUrl : (process.env.SARVAM_BASE_URL || 'https://apps.sarvam.ai');
    rawBase = rawBase.replace(/\/$/, '');
    if (rawBase.includes('/api/')) {
      try {
        const parsed = new URL(rawBase);
        this.baseUrl = `${parsed.protocol}//${parsed.host}`;
      } catch {
        this.baseUrl = rawBase.split('/api')[0] || 'https://apps.sarvam.ai';
      }
    } else {
      this.baseUrl = rawBase;
    }

    this.orgId = config?.orgId !== undefined ? config.orgId : (process.env.SARVAM_ORG_ID || '01a074ea-647b-7549-9a87-cb4a09a65faa');
    this.workspaceId = config?.workspaceId !== undefined ? config.workspaceId : (process.env.SARVAM_WORKSPACE_ID || '01a074ea-6481-766d-a3f3-c42aef343735');
    this.agentId = config?.agentId !== undefined ? config.agentId : (process.env.SARVAM_AGENT_ID || 'Growthforge-ae0789e1-56b8');
    this.agentVersion = config?.agentVersion !== undefined ? config.agentVersion : (process.env.SARVAM_AGENT_VERSION || '2');
    this.connectionId = config?.connectionId !== undefined ? config.connectionId : (process.env.SARVAM_CONNECTION_ID || '0174b928-7c-cdaf00f5-ff9a');
    this.agentPhoneNumber = config?.agentPhoneNumber !== undefined ? config.agentPhoneNumber : (process.env.SARVAM_AGENT_PHONE_NUMBER || '+918064266255');
    this.timeoutMs = config?.timeoutMs || 15000;
  }

  /**
   * Validates that minimal required server credentials are present.
   */
  private ensureConfigured(): void {
    if (!this.apiKey) {
      throw new SarvamError(
        SarvamErrorCode.CONFIG_ERROR,
        'SARVAM_API_KEY is not configured on the server environment.'
      );
    }
  }

  /**
   * Builds standardized headers for Sarvam API requests using X-API-Key.
   */
  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'X-API-Key': this.apiKey,
      'api-subscription-key': this.apiKey,
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  /**
   * Health check / reachability probe (NEVER places outbound calls or returns secrets).
   */
  async checkHealth(): Promise<{
    configured: boolean;
    reachable: boolean;
    agentConfigured: boolean;
    phoneConfigured: boolean;
    connectionConfigured: boolean;
    agentId?: string;
    agentVersion?: string | number;
    agentPhoneNumber?: string;
    latencyMs?: number;
    reason?: string;
  }> {
    const isConfigured = !!this.apiKey;
    const isAgentConfigured = !!this.agentId;
    const isPhoneConfigured = !!this.agentPhoneNumber;
    const isConnectionConfigured = !!this.connectionId;

    if (!isConfigured) {
      return {
        configured: false,
        reachable: false,
        agentConfigured: isAgentConfigured,
        phoneConfigured: isPhoneConfigured,
        connectionConfigured: isConnectionConfigured,
        agentId: this.agentId,
        agentVersion: this.agentVersion,
        agentPhoneNumber: this.agentPhoneNumber,
        reason: 'SARVAM_API_KEY missing in environment',
      };
    }

    const startTime = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const pingUrl = `${this.baseUrl}/api/outbounds/v1/orgs/${this.orgId}/workspaces/${this.workspaceId}/outbounds`;
      const response = await fetch(pingUrl, {
        method: 'OPTIONS',
        headers: this.getHeaders(),
        signal: controller.signal,
      }).catch(async () => {
        return await fetch(this.baseUrl, {
          method: 'HEAD',
          headers: this.getHeaders(),
          signal: controller.signal,
        });
      });

      clearTimeout(timeout);
      const latencyMs = Date.now() - startTime;
      const isReachable = response.status >= 200 && response.status < 500;

      return {
        configured: true,
        reachable: isReachable,
        agentConfigured: isAgentConfigured,
        phoneConfigured: isPhoneConfigured,
        connectionConfigured: isConnectionConfigured,
        agentId: this.agentId,
        agentVersion: this.agentVersion,
        agentPhoneNumber: this.agentPhoneNumber,
        latencyMs,
      };
    } catch (err: unknown) {
      return {
        configured: true,
        reachable: false,
        agentConfigured: isAgentConfigured,
        phoneConfigured: isPhoneConfigured,
        connectionConfigured: isConnectionConfigured,
        agentId: this.agentId,
        agentVersion: this.agentVersion,
        agentPhoneNumber: this.agentPhoneNumber,
        reason: err instanceof Error ? err.message : 'Failed to reach Sarvam endpoint',
      };
    }
  }

  /**
   * Dispatches an outbound call through the current Sarvam Instant Outbound API.
   */
  async startOutboundCall(payload: SarvamOutboundPayload): Promise<SarvamOutboundResponse> {
    this.ensureConfigured();

    if (!payload.toPhoneNumber) {
      throw new SarvamError(
        SarvamErrorCode.BAD_REQUEST,
        'Cannot initiate outbound call: destination phone number is required.'
      );
    }

    const effectiveOrgId = payload.orgId || this.orgId;
    const effectiveWorkspaceId = payload.workspaceId || this.workspaceId;
    const rawAgentId = payload.agentId || this.agentId;
    const effectiveAgentId = rawAgentId.replace(/^GrowthForge-/i, 'Growthforge-');
    const effectiveAgentVersion = payload.agentVersion !== undefined ? payload.agentVersion : this.agentVersion;
    const parsedVersion = parseInt(String(effectiveAgentVersion).replace(/[^0-9]/g, ''), 10);
    const appVersionInt = isNaN(parsedVersion) ? 1 : parsedVersion;

    const effectiveConnectionId = payload.connectionId || this.connectionId;
    const effectiveAgentPhoneNumber = payload.agentPhoneNumber || this.agentPhoneNumber;
    const effectiveLeadId = payload.leadId || payload.customVariables?.lead_id || '';

    // Mask phone for telemetry & logs
    const maskedPhone = payload.toPhoneNumber.slice(-4).padStart(payload.toPhoneNumber.length, '*');

    // Build context agent_variables only if provided
    const hasCustomVariables = !!payload.customVariables && Object.keys(payload.customVariables).length > 0;

    // Determine webhook URL
    const webhookUrl =
      payload.webhookUrl ||
      (process.env.APP_URL ? `${process.env.APP_URL}/api/voice/sarvam/webhook` : undefined) ||
      'https://growthforge.local/api/voice/sarvam/webhook';

    // Build exact Instant Outbound Request Schema
    const requestBody: Record<string, any> = {
      app_config: {
        app_id: effectiveAgentId,
        app_version: appVersionInt,
        app_type: 'agent',
        connection_config: {
          connection_id: effectiveConnectionId,
          agent_phone_number: effectiveAgentPhoneNumber,
        },
        ...(hasCustomVariables ? { agent_variables: payload.customVariables } : {}),
      },
      user_config: {
        user_phone_number: payload.toPhoneNumber,
      },
      webhook_config: {
        url: webhookUrl,
        metadata: {
          lead_id: effectiveLeadId,
        },
      },
    };

    const endpointUrl = `${this.baseUrl}/api/outbounds/v1/orgs/${effectiveOrgId}/workspaces/${effectiveWorkspaceId}/outbounds`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(endpointUrl, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      let responseJson: Record<string, unknown> = {};
      try {
        responseJson = (await response.json()) as Record<string, unknown>;
      } catch {
        throw new SarvamError(
          SarvamErrorCode.INVALID_RESPONSE,
          `Sarvam returned non-JSON response with status ${response.status}`,
          response.status
        );
      }

      if (!response.ok) {
        throw mapHttpErrorToSarvamError(response.status, responseJson, 'Sarvam outbound call request rejected');
      }

      // Extract call / attempt / outbound identifier from Sarvam response
      const externalCallId =
        (responseJson.outbound_id as string) ||
        (responseJson.call_id as string) ||
        (responseJson.attempt_id as string) ||
        (responseJson.id as string) ||
        (responseJson.external_call_id as string) ||
        (responseJson.job_id as string) ||
        (responseJson.session_id as string) ||
        `SARVAM-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

      const initialStatus = (responseJson.status as string) || 'queued';

      return {
        externalCallId,
        status: initialStatus,
        provider: 'sarvam',
        targetPhoneMasked: maskedPhone,
        rawResponse: responseJson,
      };
    } catch (err: unknown) {
      clearTimeout(timeout);

      if (err instanceof SarvamError) {
        throw err;
      }

      if (err instanceof Error && err.name === 'AbortError') {
        throw new SarvamError(
          SarvamErrorCode.TIMEOUT,
          `Sarvam API request timed out after ${this.timeoutMs}ms.`
        );
      }

      throw new SarvamError(
        SarvamErrorCode.PROVIDER_ERROR,
        `Network error communicating with Sarvam: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Retrieves telemetry or status of an existing Sarvam call.
   */
  async getCallTelemetry(externalCallId: string): Promise<SarvamCallTelemetry> {
    this.ensureConfigured();

    const endpointUrl = `${this.baseUrl}/api/outbounds/v1/orgs/${this.orgId}/workspaces/${this.workspaceId}/outbounds/${encodeURIComponent(externalCallId)}`;

    try {
      const response = await fetch(endpointUrl, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw mapHttpErrorToSarvamError(response.status, errJson, 'Failed to retrieve call telemetry');
      }

      const data = (await response.json()) as Record<string, unknown>;

      return {
        externalCallId,
        status: (data.status as string) || 'unknown',
        durationSeconds: Number(data.duration_seconds || data.duration || 0),
        startedAt: (data.started_at as string) || null,
        endedAt: (data.ended_at as string) || null,
        transcript: (data.transcript as string) || null,
        recordingUrl: (data.recording_url as string) || null,
        failureReason: (data.failure_reason as string) || null,
        rawResponse: data,
      };
    } catch (err: unknown) {
      if (err instanceof SarvamError) throw err;
      throw new SarvamError(
        SarvamErrorCode.PROVIDER_ERROR,
        `Failed to fetch Sarvam telemetry for call ${externalCallId}: ${err instanceof Error ? err.message : 'Network failure'}`
      );
    }
  }
}

export const sarvamClient = new SarvamClient();
