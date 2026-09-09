/**
 * GrowthForge Buyer Intelligence Engine - Sarvam Voice Error Codes & Mapping
 *
 * SPECIFICATION:
 * Explicit provider error codes mapped to sanitized, secure client messages.
 * Never exposes raw internal credentials, tokens, or unsanitized payloads.
 */

export enum SarvamErrorCode {
  CONFIG_ERROR = 'SARVAM_CONFIG_ERROR',
  AUTH_ERROR = 'SARVAM_AUTH_ERROR',
  BAD_REQUEST = 'SARVAM_BAD_REQUEST',
  RATE_LIMITED = 'SARVAM_RATE_LIMITED',
  UNAVAILABLE = 'SARVAM_UNAVAILABLE',
  TIMEOUT = 'SARVAM_TIMEOUT',
  PROVIDER_ERROR = 'SARVAM_PROVIDER_ERROR',
  INVALID_RESPONSE = 'SARVAM_INVALID_RESPONSE',
  SUCCESS = 'SARVAM_SUCCESS',
}

export interface SanitizedProviderError {
  code: SarvamErrorCode;
  message: string;
  statusCode?: number;
  retryable: boolean;
}

export class SarvamError extends Error {
  constructor(
    public readonly code: SarvamErrorCode,
    message: string,
    public readonly statusCode?: number,
    public readonly providerRawError?: unknown
  ) {
    super(message);
    this.name = 'SarvamError';
  }

  toSanitized(): SanitizedProviderError {
    const isRetryable =
      this.code === SarvamErrorCode.RATE_LIMITED ||
      this.code === SarvamErrorCode.TIMEOUT ||
      this.code === SarvamErrorCode.UNAVAILABLE;

    return {
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      retryable: isRetryable,
    };
  }
}

/**
 * Maps HTTP status codes or runtime errors to standardized SarvamError instances.
 */
export function mapHttpErrorToSarvamError(
  statusCode: number,
  responseBody?: unknown,
  customContext?: string
): SarvamError {
  let message = customContext || 'Sarvam API operation failed';
  let details = '';

  if (typeof responseBody === 'object' && responseBody !== null) {
    const rec = responseBody as Record<string, unknown>;
    const rawDetail = rec.detail || rec.error || rec.message;
    if (typeof rawDetail === 'object') {
      details = JSON.stringify(rawDetail);
    } else if (rawDetail !== undefined) {
      details = String(rawDetail);
    }
  } else if (typeof responseBody === 'string') {
    details = responseBody;
  }

  // Remove any sensitive substrings if present in error message
  details = details.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]');
  details = details.replace(/[a-f0-9]{32,64}/gi, '[REDACTED_KEY]');

  if (statusCode === 401 || statusCode === 403) {
    return new SarvamError(
      SarvamErrorCode.AUTH_ERROR,
      `Authentication failed with Sarvam API (${statusCode}): ${details || 'Invalid API subscription key or unauthorized access'}`,
      statusCode,
      responseBody
    );
  }

  if (statusCode === 400 || statusCode === 422) {
    return new SarvamError(
      SarvamErrorCode.BAD_REQUEST,
      `Bad request to Sarvam API (${statusCode}): ${details || 'Invalid outbound parameters or malformed request payload'}`,
      statusCode,
      responseBody
    );
  }

  if (statusCode === 429) {
    return new SarvamError(
      SarvamErrorCode.RATE_LIMITED,
      `Sarvam rate limit exceeded (${statusCode}). Please back off and retry.`,
      statusCode,
      responseBody
    );
  }

  if (statusCode >= 500 && statusCode <= 504) {
    return new SarvamError(
      SarvamErrorCode.UNAVAILABLE,
      `Sarvam telephony service unavailable (${statusCode}): ${details || 'Service temporarily offline'}`,
      statusCode,
      responseBody
    );
  }

  return new SarvamError(
    SarvamErrorCode.PROVIDER_ERROR,
    `${message} (${statusCode}): ${details || 'Unknown provider error'}`,
    statusCode,
    responseBody
  );
}
