/**
 * GrowthForge Buyer Intelligence Engine - PII Redaction & Secret Masking Utilities (Phase 8A.9)
 *
 * SPECIFICATION:
 * - Defense-in-depth sanitization for PII and secrets in logs, diagnostics, and external payloads.
 * - Enforces deterministic masking for phone numbers, email addresses, names, financial identifiers, and transcripts.
 * - Guarantees that production error responses never leak stack traces, database internals, or API credentials.
 */

export interface PiiRedactionOptions {
  maskPhone?: boolean;
  maskEmail?: boolean;
  maskName?: boolean;
  redactSecrets?: boolean;
  redactTranscripts?: boolean;
  redactUrls?: boolean;
  maxDepth?: number;
}

const DEFAULT_OPTIONS: PiiRedactionOptions = {
  maskPhone: true,
  maskEmail: true,
  maskName: true,
  redactSecrets: true,
  redactTranscripts: true,
  redactUrls: true,
  maxDepth: 6,
};

// ==========================================
// 1. SPECIFIC VALUE MASKERS
// ==========================================

/**
 * Masks phone numbers retaining minimal trailing digits (last 3-4 digits).
 * e.g. "+91 98765 43210" -> "+91*****3210", "9876543210" -> "******3210"
 */
export function maskPhone(phone?: string | null): string {
  if (!phone || typeof phone !== 'string') return '';
  const trimmed = phone.trim();
  if (trimmed.length === 0) return '';

  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');

  if (digits.length <= 4) {
    return '*'.repeat(trimmed.length);
  }

  const visibleDigits = 4;
  const countryCodeMatch = trimmed.match(/^(\+\d{1,3})\s?/);
  const countryPrefix = countryCodeMatch ? `${countryCodeMatch[1]} ` : (hasPlus ? '+' : '');
  const trailing = digits.slice(-visibleDigits);
  const maskedCount = Math.max(3, digits.length - visibleDigits - (countryCodeMatch ? countryCodeMatch[1].length - 1 : 0));

  return `${countryPrefix}${'*'.repeat(maskedCount)}${trailing}`;
}

/**
 * Masks email addresses retaining minimal diagnostic form.
 * e.g. "anupam.saini@gmail.com" -> "a***i@gmail.com", "a@example.com" -> "a***@example.com"
 */
export function maskEmail(email?: string | null): string {
  if (!email || typeof email !== 'string') return '';
  const trimmed = email.trim();
  const atIndex = trimmed.indexOf('@');
  if (atIndex <= 0) return '***@***';

  const username = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);

  let maskedUser: string;
  if (username.length <= 2) {
    maskedUser = `${username[0]}***`;
  } else {
    maskedUser = `${username[0]}***${username[username.length - 1]}`;
  }

  return `${maskedUser}@${domain}`;
}

/**
 * Masks full names to prevent personal identity exposure in logs.
 * e.g. "Rajesh Kumar" -> "R*** K***"
 */
export function maskName(name?: string | null): string {
  if (!name || typeof name !== 'string') return '[REDACTED_NAME]';
  const trimmed = name.trim();
  if (trimmed.length === 0) return '[REDACTED_NAME]';

  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    return parts[0].length <= 2 ? `${parts[0][0]}***` : `${parts[0][0]}***${parts[0][parts[0].length - 1]}`;
  }
  return parts.map((p) => (p.length > 0 ? `${p[0]}***` : '***')).join(' ');
}

// ==========================================
// 2. SECRET PATTERNS & KEY NAMES
// ==========================================

const SECRET_KEY_PATTERNS = [
  /^.*(password|passwd|pwd|credential).*$/i,
  /^.*(secret|webhook_secret|signing_secret).*$/i,
  /^.*(api_?key|apikey).*$/i,
  /^.*(auth|authorization|bearer).*$/i,
  /^.*(token|jwt|access_token|refresh_token|id_token).*$/i,
  /^.*(service_?role|service_?role_?key).*$/i,
  /^.*(cookie|set_?cookie|session).*$/i,
  /^.*(private_?key|privkey).*$/i,
  /^.*(credit_?card|card_?number|cvv|cvc).*$/i,
  /^.*(ssn|aadhaar|pan_?card|pan_?number).*$/i,
];

const TRANSCRIPT_KEY_PATTERNS = [
  /^.*(transcript|transcript_text|transcript_turns|turn_by_turn|conversation_turns|dialogue).*$/i,
  /^.*(raw_text|raw_transcript|audio_url|recording_url).*$/i,
];

const PHONE_KEY_PATTERNS = [
  /^.*(phone|phone_number|mobile|telephone|caller_number|callee_number|target_phone).*$/i,
];

const EMAIL_KEY_PATTERNS = [
  /^.*(email|email_address|contact_email|buyer_email).*$/i,
];

const NAME_KEY_PATTERNS = [
  /^.*(full_name|buyer_name|contact_name|first_name|last_name|customer_name).*$/i,
  /^name$/i,
];

const ADDRESS_KEY_PATTERNS = [
  /^.*(address|street_address|home_address|residence_address).*$/i,
];

// Regex for string content pattern matching
const JWT_PATTERN = /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g;
const BEARER_PATTERN = /Bearer\s+[a-zA-Z0-9_\-\.=:_+/]+/gi;
const GENERIC_API_KEY_PATTERN = /(?:sk_live_|AIza|sarvam_|sbp_|key_)[a-zA-Z0-9_\-]{16,}/gi;
const BASIC_AUTH_PATTERN = /Basic\s+[a-zA-Z0-9+/=]+/gi;
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
const PHONE_PATTERN = /(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/g;

/**
 * Scans a string for embedded secrets, Bearer tokens, JWTs, and API keys, replacing them with [REDACTED_SECRET].
 */
export function redactSecretsInString(text: string): string {
  if (!text || typeof text !== 'string') return text;

  let sanitized = text
    .replace(BEARER_PATTERN, 'Bearer [REDACTED_TOKEN]')
    .replace(BASIC_AUTH_PATTERN, 'Basic [REDACTED_AUTH]')
    .replace(JWT_PATTERN, '[REDACTED_JWT]')
    .replace(GENERIC_API_KEY_PATTERN, '[REDACTED_API_KEY]');

  // Redact known environment variable secret values if present in runtime
  const knownSecrets = [
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.GEMINI_API_KEY,
    process.env.SARVAM_API_KEY,
    process.env.VOICE_WEBHOOK_SECRET,
  ].filter((s): s is string => typeof s === 'string' && s.length >= 6);

  for (const secret of knownSecrets) {
    if (sanitized.includes(secret)) {
      sanitized = sanitized.split(secret).join('[REDACTED_SECRET]');
    }
  }

  return sanitized;
}

// ==========================================
// 3. DEEP OBJECT PII REDACTION
// ==========================================

/**
 * Deeply redacts PII and secrets from any JavaScript object, array, or primitive.
 */
export function redactPII<T>(
  input: T,
  options: PiiRedactionOptions = DEFAULT_OPTIONS,
  depth: number = 0,
  seen: WeakSet<object> = new WeakSet()
): T {
  if (input === null || input === undefined) {
    return input;
  }

  const maxDepth = options.maxDepth ?? 6;
  if (depth > maxDepth) {
    return '[MAX_DEPTH_REACHED]' as unknown as T;
  }

  // Primitive strings
  if (typeof input === 'string') {
    let result = options.redactSecrets !== false ? redactSecretsInString(input) : input;
    if (options.maskEmail !== false && EMAIL_PATTERN.test(result)) {
      result = result.replace(EMAIL_PATTERN, (match) => maskEmail(match));
    }
    return result as unknown as T;
  }

  // Primitive numbers, booleans, functions, symbols
  if (typeof input !== 'object') {
    return input;
  }

  // Cyclic reference protection
  if (seen.has(input)) {
    return '[CIRCULAR_REFERENCE]' as unknown as T;
  }
  seen.add(input);

  // Handle Error instances
  if (input instanceof Error) {
    const sanitizedError: Record<string, unknown> = {
      name: input.name,
      message: redactSecretsInString(input.message),
    };
    if (process.env.NODE_ENV !== 'production' && process.env.ENABLE_DEBUG_LOGS === 'true') {
      sanitizedError.stack = redactSecretsInString(input.stack || '');
    }
    return sanitizedError as unknown as T;
  }

  // Handle Arrays
  if (Array.isArray(input)) {
    return input.map((item) => redactPII(item, options, depth + 1, seen)) as unknown as T;
  }

  // Handle Plain Objects
  const output: Record<string, unknown> = {};
  const entries = Object.entries(input as Record<string, unknown>);

  for (const [key, value] of entries) {
    const lowerKey = key.toLowerCase();

    // 1. Secret Keys -> Redact completely
    if (options.redactSecrets !== false && SECRET_KEY_PATTERNS.some((p) => p.test(lowerKey))) {
      output[key] = '[REDACTED_SECRET]';
      continue;
    }

    // 2. Transcript Keys -> Redact raw conversational content
    if (options.redactTranscripts !== false && TRANSCRIPT_KEY_PATTERNS.some((p) => p.test(lowerKey))) {
      if (typeof value === 'string') {
        output[key] = `[REDACTED_TRANSCRIPT (${value.length} chars)]`;
      } else if (Array.isArray(value)) {
        output[key] = `[REDACTED_TRANSCRIPT_TURNS (${value.length} turns)]`;
      } else {
        output[key] = '[REDACTED_TRANSCRIPT]';
      }
      continue;
    }

    // 3. Phone Keys -> Mask Phone
    if (options.maskPhone !== false && PHONE_KEY_PATTERNS.some((p) => p.test(lowerKey))) {
      output[key] = typeof value === 'string' ? maskPhone(value) : '[REDACTED_PHONE]';
      continue;
    }

    // 4. Email Keys -> Mask Email
    if (options.maskEmail !== false && EMAIL_KEY_PATTERNS.some((p) => p.test(lowerKey))) {
      output[key] = typeof value === 'string' ? maskEmail(value) : '[REDACTED_EMAIL]';
      continue;
    }

    // 5. Name Keys -> Mask Name
    if (options.maskName !== false && NAME_KEY_PATTERNS.some((p) => p.test(lowerKey))) {
      output[key] = typeof value === 'string' ? maskName(value) : '[REDACTED_NAME]';
      continue;
    }

    // 6. Address Keys -> Redact
    if (ADDRESS_KEY_PATTERNS.some((p) => p.test(lowerKey))) {
      output[key] = '[REDACTED_ADDRESS]';
      continue;
    }

    // Recurse for nested objects/arrays
    output[key] = redactPII(value, options, depth + 1, seen);
  }

  return output as T;
}

// ==========================================
// 4. PROVIDER PAYLOAD & ERROR SANITIZATION
// ==========================================

/**
 * Sanitizes external provider payloads (Gemini, Sarvam, Scout) for safe logging & observability.
 */
export function sanitizeProviderPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') {
    return { payload: String(payload) };
  }

  return redactPII(payload, {
    maskPhone: true,
    maskEmail: true,
    maskName: true,
    redactSecrets: true,
    redactTranscripts: true,
    redactUrls: true,
  }) as Record<string, unknown>;
}

export interface SanitizedClientError {
  success: false;
  error: {
    code: string;
    message: string;
    request_id?: string;
  };
}

export interface SanitizedInternalError {
  error_category: string;
  error_code: string;
  message: string;
  technical_summary?: string;
}

/**
 * Normalizes any internal/provider error into a strict, client-safe error response
 * that never leaks stack traces, database schema details, or API keys.
 */
export function sanitizeClientError(err: unknown, requestId?: string): SanitizedClientError {
  let message = 'An unexpected error occurred. Please try again later.';
  let code = 'INTERNAL_SERVER_ERROR';

  if (err instanceof Error) {
    const rawMsg = err.message;
    // Map known safe domain errors
    if (rawMsg.includes('Unauthorized') || rawMsg.includes('AUTH_REQUIRED') || rawMsg.includes('INVALID_TOKEN')) {
      code = 'UNAUTHORIZED';
      message = 'Authentication required';
    } else if (rawMsg.includes('Forbidden') || rawMsg.includes('FORBIDDEN') || rawMsg.includes('INSUFFICIENT_ROLE')) {
      code = 'FORBIDDEN';
      message = 'You do not have permission to perform this action';
    } else if (rawMsg.includes('Rate limit exceeded') || rawMsg.includes('RATE_LIMIT_EXCEEDED') || rawMsg.includes('Quota exceeded')) {
      code = 'RATE_LIMIT_EXCEEDED';
      message = 'Rate limit exceeded. Please retry later.';
    } else if (rawMsg.includes('not found') || rawMsg.includes('NOT_FOUND')) {
      code = 'NOT_FOUND';
      message = redactSecretsInString(rawMsg);
    } else if (rawMsg.includes('validation') || rawMsg.includes('is required') || rawMsg.includes('Invalid input')) {
      code = 'BAD_REQUEST';
      message = redactSecretsInString(rawMsg);
    } else if (rawMsg.includes('already in progress') || rawMsg.includes('Duplicate key conflict') || rawMsg.includes('LOCKED')) {
      code = 'CONFLICT';
      message = 'Operation is currently locked or already in progress';
    }
  }

  return {
    success: false,
    error: {
      code,
      message,
      ...(requestId ? { request_id: requestId } : {}),
    },
  };
}
