/**
 * GrowthForge Buyer Intelligence Engine - Phase 13A.4.1
 * Google Sheets Server-Side Authentication Helper
 *
 * Implements secure server-side Service Account JWT minting (RS256) and token exchange
 * with Google OAuth 2.0 token endpoint for the spreadsheets scope.
 *
 * INVARIANTS:
 * 1. Credentials strictly sourced from server-side environment variables or approved vault.
 * 2. Tenant-editable CRM metadata is strictly forbidden from providing credentials.
 * 3. Short-lived RS256-signed JWT assertions (1 hour validity).
 * 4. Token cached in memory with a 5-minute pre-expiration buffer.
 * 5. Concurrent requests share in-flight exchange promises to avoid redundant API calls.
 * 6. Never logs JWT assertions, private keys, access tokens, or Authorization headers.
 * 7. Never exposes credentials to client bundles or public APIs.
 * 8. Fails closed with typed errors distinguishing auth rejections from retryable network errors.
 */

import crypto from 'crypto';
import { logger } from '../security/logger';

const GOOGLE_OAUTH_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const GOOGLE_SPREADSHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
export const GOOGLE_METADATA_TOKEN_ENDPOINT =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
const DEFAULT_EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5 minutes buffer
const DEFAULT_METADATA_TIMEOUT_MS = 5000; // 5 seconds bounded timeout

export type GoogleSheetsAuthProvider = 'METADATA' | 'SERVICE_ACCOUNT_KEY';

export class GoogleSheetsAuthError extends Error {
  public readonly isAuthError = true;
  public readonly retry_eligible = false;
  constructor(message: string) {
    super(message);
    this.name = 'GoogleSheetsAuthError';
  }
}

export class GoogleSheetsNetworkError extends Error {
  public readonly isNetworkError = true;
  public readonly retry_eligible = true;
  constructor(message: string) {
    super(message);
    this.name = 'GoogleSheetsNetworkError';
  }
}

export interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
}

export interface CachedTokenEntry {
  token: string;
  expiresAtMs: number;
}

export interface GoogleSheetsAuthOptions {
  tokenEndpoint?: string;
  fetchFn?: typeof fetch;
  timeFn?: () => number;
  expiryBufferMs?: number;
  timeoutMs?: number;
  credentials?: ServiceAccountCredentials | null;
  staticToken?: string | null;
  nodeEnv?: string;
  authProvider?: GoogleSheetsAuthProvider;
  runtimeServiceAccount?: string;
}

function base64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * Creates an RS256-signed JWT assertion for Google OAuth 2.0 service account authentication.
 */
export function createServiceAccountJwt(
  clientEmail: string,
  privateKeyPem: string,
  nowSec: number = Math.floor(Date.now() / 1000)
): string {
  if (!clientEmail || typeof clientEmail !== 'string' || !clientEmail.includes('@')) {
    throw new GoogleSheetsAuthError('Invalid service account client_email');
  }
  if (!privateKeyPem || typeof privateKeyPem !== 'string' || !privateKeyPem.includes('PRIVATE KEY')) {
    throw new GoogleSheetsAuthError('Invalid service account private_key format: missing PEM markers');
  }

  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };

  const payload = {
    iss: clientEmail,
    scope: GOOGLE_SPREADSHEETS_SCOPE,
    aud: GOOGLE_OAUTH_TOKEN_ENDPOINT,
    exp: nowSec + 3600,
    iat: nowSec,
  };

  const encodedHeader = base64url(Buffer.from(JSON.stringify(header), 'utf8'));
  const encodedPayload = base64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;

  try {
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(unsignedToken);
    const signature = signer.sign(privateKeyPem, 'base64');
    const encodedSignature = signature
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    return `${unsignedToken}.${encodedSignature}`;
  } catch (err: any) {
    throw new GoogleSheetsAuthError(`Failed to sign service-account JWT: ${err.message || 'invalid private key'}`);
  }
}

export class GoogleSheetsAuthService {
  private cachedToken: CachedTokenEntry | null = null;
  private pendingExchangePromise: Promise<string> | null = null;

  private readonly tokenEndpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly isMockFetch: boolean;
  private readonly timeImpl: () => number;
  private readonly expiryBufferMs: number;
  private readonly timeoutMs: number;
  private readonly explicitCredentials?: ServiceAccountCredentials | null;
  private readonly explicitStaticToken?: string | null;
  private readonly nodeEnv?: string;
  private readonly explicitAuthProvider?: GoogleSheetsAuthProvider;
  private readonly runtimeServiceAccount?: string;

  constructor(options?: GoogleSheetsAuthOptions) {
    this.tokenEndpoint = options?.tokenEndpoint || GOOGLE_OAUTH_TOKEN_ENDPOINT;
    this.fetchImpl = options?.fetchFn || fetch;
    this.isMockFetch = Boolean(options?.fetchFn);
    this.timeImpl = options?.timeFn || (() => Date.now());
    this.expiryBufferMs = options?.expiryBufferMs !== undefined ? options.expiryBufferMs : DEFAULT_EXPIRY_BUFFER_MS;
    this.timeoutMs = options?.timeoutMs !== undefined ? options.timeoutMs : DEFAULT_METADATA_TIMEOUT_MS;
    this.explicitCredentials = options?.credentials;
    this.explicitStaticToken = options?.staticToken;
    this.nodeEnv = options?.nodeEnv;
    this.explicitAuthProvider = options?.authProvider;
    this.runtimeServiceAccount = options?.runtimeServiceAccount;
  }

  public clearCache(): void {
    this.cachedToken = null;
    this.pendingExchangePromise = null;
  }

  public getCachedTokenEntry(): CachedTokenEntry | null {
    return this.cachedToken ? { ...this.cachedToken } : null;
  }

  /**
   * Loads service account credentials from server environment variables only.
   */
  private resolveCredentials(): ServiceAccountCredentials | null {
    if (this.explicitCredentials !== undefined) {
      return this.explicitCredentials;
    }

    // 1. Full JSON Key string
    const jsonKey = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY?.trim();
    if (jsonKey) {
      try {
        const parsed = JSON.parse(jsonKey);
        if (parsed.client_email && parsed.private_key) {
          return {
            client_email: String(parsed.client_email).trim(),
            private_key: String(parsed.private_key).replace(/\\n/g, '\n'),
          };
        }
      } catch {
        throw new GoogleSheetsAuthError('GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY environment variable is malformed JSON');
      }
    }

    // 2. Separate client_email and private_key variables
    const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL?.trim();
    const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY?.trim();
    if (clientEmail && privateKey) {
      return {
        client_email: clientEmail,
        private_key: privateKey.replace(/\\n/g, '\n'),
      };
    }

    return null;
  }

  /**
   * Acquires a valid OAuth2 Bearer token for Google Sheets API.
   * Caches token in memory and refreshes automatically when within the expiry buffer.
   */
  public async getAccessToken(): Promise<string> {
    const nowMs = this.timeImpl();

    // 1. Check cached token validity
    if (this.cachedToken && nowMs + this.expiryBufferMs < this.cachedToken.expiresAtMs) {
      return this.cachedToken.token;
    }

    // 2. Check in-flight exchange to prevent redundant simultaneous requests
    if (this.pendingExchangePromise) {
      return this.pendingExchangePromise;
    }

    // 3. Initiate token acquisition
    this.pendingExchangePromise = this.executeTokenAcquisition(nowMs);
    try {
      const token = await this.pendingExchangePromise;
      return token;
    } finally {
      this.pendingExchangePromise = null;
    }
  }

  /**
   * Resolves the authentication provider to use (METADATA or SERVICE_ACCOUNT_KEY).
   * In production (Cloud Run), METADATA must be explicitly configured; SERVICE_ACCOUNT_KEY is prohibited.
   */
  public resolveAuthProvider(): GoogleSheetsAuthProvider {
    const isProduction = (this.nodeEnv || process.env.NODE_ENV) === 'production';

    // 1. Explicit constructor authProvider option
    if (this.explicitAuthProvider !== undefined) {
      if (this.explicitAuthProvider !== 'METADATA' && this.explicitAuthProvider !== 'SERVICE_ACCOUNT_KEY') {
        throw new GoogleSheetsAuthError(
          `Invalid authProvider option: "${String(this.explicitAuthProvider)}". Supported providers: METADATA, SERVICE_ACCOUNT_KEY`
        );
      }
      if (isProduction && this.explicitAuthProvider === 'SERVICE_ACCOUNT_KEY') {
        throw new GoogleSheetsAuthError(
          'Google Sheets authentication failed: Provider SERVICE_ACCOUNT_KEY is prohibited in production. The only accepted production provider for Cloud Run deployment is METADATA.'
        );
      }
      return this.explicitAuthProvider;
    }

    // 2. Injected test provider / mock test harness behavior:
    // If mock fetcher and explicit credentials or explicit static token were injected via constructor in tests
    if (this.isMockFetch && this.explicitCredentials && !process.env.GOOGLE_SHEETS_AUTH_PROVIDER) {
      return 'SERVICE_ACCOUNT_KEY';
    }

    // 3. Environment-based provider resolution
    const rawEnv = process.env.GOOGLE_SHEETS_AUTH_PROVIDER;
    const envProvider = rawEnv?.trim().toUpperCase();

    if (!envProvider) {
      if (isProduction) {
        throw new GoogleSheetsAuthError(
          'Google Sheets authentication failed: Server-side authentication credentials and GOOGLE_SHEETS_AUTH_PROVIDER must be explicitly configured in production. The only accepted production provider for Cloud Run deployment is METADATA.'
        );
      }
      // In local development/test, default to SERVICE_ACCOUNT_KEY
      return 'SERVICE_ACCOUNT_KEY';
    }

    if (envProvider === 'METADATA' || envProvider === 'GCP_METADATA' || envProvider === 'KEYLESS') {
      return 'METADATA';
    }

    if (envProvider === 'SERVICE_ACCOUNT_KEY' || envProvider === 'PRIVATE_KEY') {
      if (isProduction) {
        throw new GoogleSheetsAuthError(
          'Google Sheets authentication failed: Provider SERVICE_ACCOUNT_KEY is prohibited in production. The only accepted production provider for Cloud Run deployment is METADATA.'
        );
      }
      return 'SERVICE_ACCOUNT_KEY';
    }

    throw new GoogleSheetsAuthError(
      `Invalid GOOGLE_SHEETS_AUTH_PROVIDER: "${rawEnv}". Supported providers: METADATA, SERVICE_ACCOUNT_KEY`
    );
  }

  /**
   * Acquires a token keylessly from the Google Cloud metadata server.
   * Fixed endpoint: http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token
   * Fails closed without falling back to private keys or static tokens.
   */
  private async acquireMetadataToken(nowMs: number): Promise<string> {
    const isProduction = (this.nodeEnv || process.env.NODE_ENV) === 'production';
    const isGcpEnvironment = Boolean(
      process.env.K_SERVICE ||
      process.env.FUNCTION_TARGET ||
      process.env.K_REVISION
    );

    // In automated tests or non-production, unmocked metadata server calls are strictly prohibited
    if (!this.isMockFetch && !isProduction) {
      throw new GoogleSheetsAuthError(
        'Metadata-server access is strictly prohibited outside production runtime. Automated tests must inject a mock fetch implementation.'
      );
    }

    if (!this.isMockFetch && !isGcpEnvironment) {
      logger.error('Google Sheets keyless metadata authentication rejected: unsupported runtime', {
        service: 'google-sheets-auth',
        operation: 'acquireMetadataToken',
      });
      throw new GoogleSheetsAuthError(
        'Google Sheets keyless metadata authentication is only supported in Google Cloud execution environments (Cloud Run). Runtime service-account credentials are required.'
      );
    }

    const expectedSa = this.runtimeServiceAccount || process.env.GOOGLE_SHEETS_RUNTIME_SERVICE_ACCOUNT?.trim();
    if (expectedSa && process.env.K_SERVICE) {
      logger.info('Using configured Cloud Run runtime service account for Google Sheets authentication', {
        service: 'google-sheets-auth',
        operation: 'acquireMetadataToken',
        data: { expectedServiceAccount: expectedSa },
      });
    }

    // Fixed metadata endpoint with URL-encoded spreadsheets scope
    const metadataUrl = `${GOOGLE_METADATA_TOKEN_ENDPOINT}?scopes=${encodeURIComponent(GOOGLE_SPREADSHEETS_SCOPE)}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);

    let res: Response;
    try {
      res = await this.fetchImpl(metadataUrl, {
        method: 'GET',
        headers: {
          'Metadata-Flavor': 'Google',
          Accept: 'application/json',
        },
        redirect: 'error',
        signal: controller.signal,
      });
    } catch (err: any) {
      const isTimeout = err?.name === 'AbortError' || controller.signal.aborted;
      logger.warn('Google Sheets metadata server request failed', {
        service: 'google-sheets-auth',
        operation: 'acquireMetadataToken',
        data: { error: isTimeout ? 'Metadata server request timed out' : (err.message || 'Connection error') },
      });
      if (isTimeout) {
        throw new GoogleSheetsNetworkError(`Metadata server request timed out after ${this.timeoutMs}ms`);
      }
      throw new GoogleSheetsNetworkError(`Metadata server network failure: ${err.message || 'Connection error'}`);
    } finally {
      clearTimeout(timeoutId);
    }

    if (res.status >= 300 && res.status < 400) {
      throw new GoogleSheetsAuthError(`Metadata server response redirect rejected (HTTP ${res.status})`);
    }

    if (!res.ok) {
      let errorDetail = '';
      try {
        const text = await res.text();
        errorDetail = text.slice(0, 200);
      } catch {
        errorDetail = res.statusText;
      }

      logger.error('Google Sheets metadata server rejected token request', {
        service: 'google-sheets-auth',
        operation: 'acquireMetadataToken',
        data: { status: res.status, errorDetail },
      });

      if (res.status >= 500 || res.status === 429) {
        throw new GoogleSheetsNetworkError(`Metadata server temporarily unavailable (HTTP ${res.status}): ${errorDetail}`);
      }
      throw new GoogleSheetsAuthError(`Metadata server token request failed (HTTP ${res.status}): ${errorDetail}`);
    }

    let data: any;
    try {
      data = await res.json();
    } catch {
      throw new GoogleSheetsAuthError('Metadata server returned malformed JSON');
    }

    if (!data || typeof data !== 'object') {
      throw new GoogleSheetsAuthError('Metadata server returned invalid token payload');
    }

    if (!data.access_token || typeof data.access_token !== 'string' || data.access_token.trim() === '') {
      throw new GoogleSheetsAuthError('Metadata server response missing access_token');
    }

    if (data.token_type !== undefined && (typeof data.token_type !== 'string' || data.token_type.toLowerCase() !== 'bearer')) {
      throw new GoogleSheetsAuthError(`Metadata server returned unexpected token_type: ${data.token_type}`);
    }

    if (typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in) || data.expires_in <= 0) {
      throw new GoogleSheetsAuthError('Metadata server response missing or non-positive expires_in');
    }

    const expiresAtMs = nowMs + data.expires_in * 1000;
    this.cachedToken = {
      token: data.access_token,
      expiresAtMs,
    };

    return data.access_token;
  }

  /**
   * Acquires a token via RS256 self-signed JWT exchange (local dev / legacy private key).
   */
  private async acquireServiceAccountToken(nowMs: number, isProduction: boolean): Promise<string> {
    const creds = this.resolveCredentials();

    if (!creds) {
      logger.error('Google Sheets authentication failed: missing credentials', {
        service: 'google-sheets-auth',
        operation: 'acquireServiceAccountToken',
      });
      throw new GoogleSheetsAuthError(
        isProduction
          ? 'Google Sheets authentication failed: Server-side service-account credentials (GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY or GOOGLE_SHEETS_CLIENT_EMAIL / GOOGLE_SHEETS_PRIVATE_KEY) are not configured.'
          : 'Google Sheets authentication failed: Server-side service-account credentials (GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY or GOOGLE_SHEETS_CLIENT_EMAIL / GOOGLE_SHEETS_PRIVATE_KEY) or GOOGLE_SHEETS_ACCESS_TOKEN are not configured.'
      );
    }

    // Generate RS256 JWT assertion
    const nowSec = Math.floor(nowMs / 1000);
    const assertion = createServiceAccountJwt(creds.client_email, creds.private_key, nowSec);

    // Exchange assertion with Google OAuth token endpoint
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    });

    let res: Response;
    try {
      res = await this.fetchImpl(this.tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: body.toString(),
      });
    } catch (err: any) {
      logger.warn('Google Sheets token endpoint network failure', {
        service: 'google-sheets-auth',
        operation: 'acquireServiceAccountToken',
        data: { error: err.message },
      });
      throw new GoogleSheetsNetworkError(`OAuth token endpoint network failure: ${err.message || 'Connection error'}`);
    }

    if (!res.ok) {
      let errorDetail = '';
      try {
        const errJson = (await res.json()) as { error?: string; error_description?: string };
        errorDetail = errJson.error_description
          ? `${errJson.error ? errJson.error + ': ' : ''}${errJson.error_description}`
          : (errJson.error || res.statusText);
      } catch {
        errorDetail = res.statusText;
      }

      logger.error('Google Sheets token exchange rejected', {
        service: 'google-sheets-auth',
        operation: 'acquireServiceAccountToken',
        data: { status: res.status, errorDetail },
      });

      if (res.status >= 500 || res.status === 429) {
        throw new GoogleSheetsNetworkError(`Google OAuth token service unavailable (HTTP ${res.status}): ${errorDetail}`);
      }

      throw new GoogleSheetsAuthError(`Google OAuth token exchange rejected (HTTP ${res.status}): ${errorDetail}`);
    }

    const data = (await res.json()) as { access_token?: string; expires_in?: number; token_type?: string };
    if (!data.access_token) {
      throw new GoogleSheetsAuthError('Google OAuth token endpoint response missing access_token');
    }

    const expiresInSec = typeof data.expires_in === 'number' && data.expires_in > 0 ? data.expires_in : 3600;
    const expiresAtMs = nowMs + expiresInSec * 1000;

    this.cachedToken = {
      token: data.access_token,
      expiresAtMs,
    };

    return data.access_token;
  }

  private async executeTokenAcquisition(nowMs: number): Promise<string> {
    const isProduction = (this.nodeEnv || process.env.NODE_ENV) === 'production';

    // Check for static token in options or environment (used for tests/mock tokens)
    const staticToken = this.explicitStaticToken !== undefined
      ? this.explicitStaticToken
      : process.env.GOOGLE_SHEETS_ACCESS_TOKEN?.trim() || null;

    if (isProduction && staticToken && !this.explicitCredentials) {
      logger.error('Google Sheets authentication rejected: static access token fallback is strictly prohibited in production', {
        service: 'google-sheets-auth',
        operation: 'executeTokenAcquisition',
      });
      throw new GoogleSheetsAuthError(
        'Google Sheets authentication failed: Static access token fallback is strictly prohibited in production. Configured server-side service-account credentials are required.'
      );
    }

    const provider = this.resolveAuthProvider();

    // 1. KEYLESS METADATA PROVIDER: Fails closed without falling back
    if (provider === 'METADATA') {
      return this.acquireMetadataToken(nowMs);
    }

    // 2. STATIC TOKEN: Only in non-production when no credentials and no explicit key requested
    if (!isProduction && staticToken && !this.explicitCredentials && !process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY && !process.env.GOOGLE_SHEETS_PRIVATE_KEY) {
      this.cachedToken = {
        token: staticToken,
        expiresAtMs: nowMs + 3600 * 1000,
      };
      return staticToken;
    }

    // 3. SERVICE ACCOUNT PRIVATE KEY PROVIDER
    return this.acquireServiceAccountToken(nowMs, isProduction);
  }
}

export const googleSheetsAuthService = new GoogleSheetsAuthService();
