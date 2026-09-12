/**
 * GrowthForge Buyer Intelligence Engine - Central Production Configuration Hardening (Phase 8A.10)
 *
 * Provides authoritative environment classification, fail-fast production startup validation,
 * bounds checking, secret boundary enforcement, and sanitized health diagnostics.
 *
 * CRITICAL SECURITY INVARIANT:
 * No production startup is allowed with missing, unvalidated, or development-default credentials.
 * No secret values are EVER included in error messages, logs, or diagnostic payloads.
 */

import { logger } from '../services/security/logger';

// ==========================================
// 1. ENVIRONMENT CLASSIFICATION
// ==========================================

export type EnvClassification =
  | 'PUBLIC_BROWSER_SAFE'
  | 'SERVER_ONLY'
  | 'SECRET'
  | 'BUILD_TOOL';

export interface EnvVarDefinition {
  name: string;
  classification: EnvClassification;
  requiredInProduction: boolean;
  sensitive: boolean;
  description: string;
  allowedInBrowser: boolean;
}

export const ENV_INVENTORY: Record<string, EnvVarDefinition> = {
  NODE_ENV: {
    name: 'NODE_ENV',
    classification: 'SERVER_ONLY',
    requiredInProduction: true,
    sensitive: false,
    description: 'Runtime environment tier (production, development, test)',
    allowedInBrowser: false,
  },
  APP_URL: {
    name: 'APP_URL',
    classification: 'SERVER_ONLY',
    requiredInProduction: true,
    sensitive: false,
    description: 'Authoritative canonical base URL for the application (must be HTTPS in production)',
    allowedInBrowser: false,
  },
  PORT: {
    name: 'PORT',
    classification: 'SERVER_ONLY',
    requiredInProduction: false,
    sensitive: false,
    description: 'Server listening port (standard 3000)',
    allowedInBrowser: false,
  },
  CORS_ALLOWED_ORIGINS: {
    name: 'CORS_ALLOWED_ORIGINS',
    classification: 'SERVER_ONLY',
    requiredInProduction: false,
    sensitive: false,
    description: 'Comma-separated list of allowed browser origins for authenticated CORS requests (no wildcard in prod)',
    allowedInBrowser: false,
  },
  VITE_SUPABASE_URL: {
    name: 'VITE_SUPABASE_URL',
    classification: 'PUBLIC_BROWSER_SAFE',
    requiredInProduction: false,
    sensitive: false,
    description: 'Client-side Supabase project URL endpoint',
    allowedInBrowser: true,
  },
  VITE_SUPABASE_ANON_KEY: {
    name: 'VITE_SUPABASE_ANON_KEY',
    classification: 'PUBLIC_BROWSER_SAFE',
    requiredInProduction: false,
    sensitive: false,
    description: 'Client-side Supabase public anon key with RLS enforcement',
    allowedInBrowser: true,
  },
  SUPABASE_URL: {
    name: 'SUPABASE_URL',
    classification: 'SERVER_ONLY',
    requiredInProduction: true,
    sensitive: false,
    description: 'Server-side Supabase API endpoint',
    allowedInBrowser: false,
  },
  SUPABASE_ANON_KEY: {
    name: 'SUPABASE_ANON_KEY',
    classification: 'SERVER_ONLY',
    requiredInProduction: true,
    sensitive: false,
    description: 'Server-side Supabase anon public key',
    allowedInBrowser: false,
  },
  SUPABASE_SERVICE_ROLE_KEY: {
    name: 'SUPABASE_SERVICE_ROLE_KEY',
    classification: 'SECRET',
    requiredInProduction: true,
    sensitive: true,
    description: 'Server-only administrative key bypassing RLS (NEVER in browser)',
    allowedInBrowser: false,
  },
  GEMINI_API_KEY: {
    name: 'GEMINI_API_KEY',
    classification: 'SECRET',
    requiredInProduction: true,
    sensitive: true,
    description: 'Google Gemini GenAI API key for structured extraction (NEVER in browser)',
    allowedInBrowser: false,
  },
  GEMINI_MODEL: {
    name: 'GEMINI_MODEL',
    classification: 'SERVER_ONLY',
    requiredInProduction: false,
    sensitive: false,
    description: 'Model identifier for Gemini operations',
    allowedInBrowser: false,
  },
  GEMINI_EXTRACTION_MODEL: {
    name: 'GEMINI_EXTRACTION_MODEL',
    classification: 'SERVER_ONLY',
    requiredInProduction: false,
    sensitive: false,
    description: 'Specific extraction model override for Phase 5B',
    allowedInBrowser: false,
  },
  VOICE_MODE: {
    name: 'VOICE_MODE',
    classification: 'SERVER_ONLY',
    requiredInProduction: true,
    sensitive: false,
    description: 'Voice execution provider mode (must be REAL in production)',
    allowedInBrowser: false,
  },
  VOICE_PROVIDER: {
    name: 'VOICE_PROVIDER',
    classification: 'SERVER_ONLY',
    requiredInProduction: false,
    sensitive: false,
    description: 'Voice provider implementation ("sarvam")',
    allowedInBrowser: false,
  },
  VOICE_WEBHOOK_SECRET: {
    name: 'VOICE_WEBHOOK_SECRET',
    classification: 'SECRET',
    requiredInProduction: true,
    sensitive: true,
    description: 'Shared secret for HMAC / timing-safe webhook callback authentication',
    allowedInBrowser: false,
  },
  SARVAM_API_KEY: {
    name: 'SARVAM_API_KEY',
    classification: 'SECRET',
    requiredInProduction: true,
    sensitive: true,
    description: 'Sarvam AI telephonic qualification API key (NEVER in browser)',
    allowedInBrowser: false,
  },
  SARVAM_BASE_URL: {
    name: 'SARVAM_BASE_URL',
    classification: 'SERVER_ONLY',
    requiredInProduction: false,
    sensitive: false,
    description: 'Base URL for Sarvam API (default https://apps.sarvam.ai)',
    allowedInBrowser: false,
  },
  SARVAM_ORG_ID: {
    name: 'SARVAM_ORG_ID',
    classification: 'SERVER_ONLY',
    requiredInProduction: true,
    sensitive: false,
    description: 'Sarvam Organization UUID',
    allowedInBrowser: false,
  },
  SARVAM_WORKSPACE_ID: {
    name: 'SARVAM_WORKSPACE_ID',
    classification: 'SERVER_ONLY',
    requiredInProduction: true,
    sensitive: false,
    description: 'Sarvam Workspace UUID',
    allowedInBrowser: false,
  },
  SARVAM_AGENT_ID: {
    name: 'SARVAM_AGENT_ID',
    classification: 'SERVER_ONLY',
    requiredInProduction: true,
    sensitive: false,
    description: 'Sarvam Published Agent identifier',
    allowedInBrowser: false,
  },
  SARVAM_AGENT_VERSION: {
    name: 'SARVAM_AGENT_VERSION',
    classification: 'SERVER_ONLY',
    requiredInProduction: true,
    sensitive: false,
    description: 'Sarvam Published Agent version',
    allowedInBrowser: false,
  },
  SARVAM_CONNECTION_ID: {
    name: 'SARVAM_CONNECTION_ID',
    classification: 'SERVER_ONLY',
    requiredInProduction: true,
    sensitive: false,
    description: 'Sarvam SIP / Telephony connection ID',
    allowedInBrowser: false,
  },
  SARVAM_AGENT_PHONE_NUMBER: {
    name: 'SARVAM_AGENT_PHONE_NUMBER',
    classification: 'SERVER_ONLY',
    requiredInProduction: true,
    sensitive: false,
    description: 'Sarvam assigned outbound caller phone number (E.164)',
    allowedInBrowser: false,
  },
  SCOUT_PATH: {
    name: 'SCOUT_PATH',
    classification: 'SERVER_ONLY',
    requiredInProduction: false,
    sensitive: false,
    description: 'Filesystem path to Scout submodule',
    allowedInBrowser: false,
  },
  SCOUT_API_URL: {
    name: 'SCOUT_API_URL',
    classification: 'SERVER_ONLY',
    requiredInProduction: false,
    sensitive: false,
    description: 'Scout service API URL endpoint',
    allowedInBrowser: false,
  },
  PYTHON_BIN: {
    name: 'PYTHON_BIN',
    classification: 'SERVER_ONLY',
    requiredInProduction: false,
    sensitive: false,
    description: 'Path to python runtime binary for Scout integration',
    allowedInBrowser: false,
  },
  LOG_LEVEL: {
    name: 'LOG_LEVEL',
    classification: 'SERVER_ONLY',
    requiredInProduction: false,
    sensitive: false,
    description: 'Minimum logging level (DEBUG, INFO, WARN, ERROR, SECURITY)',
    allowedInBrowser: false,
  },
  LOG_REDACTION_ENABLED: {
    name: 'LOG_REDACTION_ENABLED',
    classification: 'SERVER_ONLY',
    requiredInProduction: true,
    sensitive: false,
    description: 'Mandatory PII and secret log redaction flag (cannot be false in production)',
    allowedInBrowser: false,
  },
  ENABLE_DEBUG_LOGS: {
    name: 'ENABLE_DEBUG_LOGS',
    classification: 'SERVER_ONLY',
    requiredInProduction: false,
    sensitive: false,
    description: 'Enables verbose debug logs (strictly prohibited in production)',
    allowedInBrowser: false,
  },
  RATE_LIMIT_ENABLED: {
    name: 'RATE_LIMIT_ENABLED',
    classification: 'SERVER_ONLY',
    requiredInProduction: false,
    sensitive: false,
    description: 'Global rate-limiting enabler flag',
    allowedInBrowser: false,
  },
  GLOBAL_REQUESTS_PER_MINUTE: {
    name: 'GLOBAL_REQUESTS_PER_MINUTE',
    classification: 'SERVER_ONLY',
    requiredInProduction: false,
    sensitive: false,
    description: 'Global inbound request rate limit per minute',
    allowedInBrowser: false,
  },
  TENANT_REQUESTS_PER_MINUTE: {
    name: 'TENANT_REQUESTS_PER_MINUTE',
    classification: 'SERVER_ONLY',
    requiredInProduction: false,
    sensitive: false,
    description: 'Per-tenant inbound request rate limit per minute',
    allowedInBrowser: false,
  },
  MAX_SARVAM_CALLS_PER_TENANT_PER_HOUR: {
    name: 'MAX_SARVAM_CALLS_PER_TENANT_PER_HOUR',
    classification: 'SERVER_ONLY',
    requiredInProduction: false,
    sensitive: false,
    description: 'Cost safeguard limit on outbound Sarvam calls per tenant per hour',
    allowedInBrowser: false,
  },
  MAX_SARVAM_CALLS_PER_TENANT_PER_DAY: {
    name: 'MAX_SARVAM_CALLS_PER_TENANT_PER_DAY',
    classification: 'SERVER_ONLY',
    requiredInProduction: false,
    sensitive: false,
    description: 'Cost safeguard limit on outbound Sarvam calls per tenant per day',
    allowedInBrowser: false,
  },
  MAX_GEMINI_OPS_PER_TENANT_PER_HOUR: {
    name: 'MAX_GEMINI_OPS_PER_TENANT_PER_HOUR',
    classification: 'SERVER_ONLY',
    requiredInProduction: false,
    sensitive: false,
    description: 'Cost safeguard limit on Gemini AI operations per tenant per hour',
    allowedInBrowser: false,
  },
  MAX_ENRICHMENTS_PER_TENANT_PER_HOUR: {
    name: 'MAX_ENRICHMENTS_PER_TENANT_PER_HOUR',
    classification: 'SERVER_ONLY',
    requiredInProduction: false,
    sensitive: false,
    description: 'Cost safeguard limit on Scout enrichments per tenant per hour',
    allowedInBrowser: false,
  },
  MAX_ACTIVE_SARVAM_CALL_DISPATCHES: {
    name: 'MAX_ACTIVE_SARVAM_CALL_DISPATCHES',
    classification: 'SERVER_ONLY',
    requiredInProduction: false,
    sensitive: false,
    description: 'Concurrency cap on concurrent active Sarvam calls across system (1-1000)',
    allowedInBrowser: false,
  },
  MAX_ACTIVE_GEMINI_OPERATIONS: {
    name: 'MAX_ACTIVE_GEMINI_OPERATIONS',
    classification: 'SERVER_ONLY',
    requiredInProduction: false,
    sensitive: false,
    description: 'Concurrency cap on concurrent active Gemini extractions (1-1000)',
    allowedInBrowser: false,
  },
  MAX_ACTIVE_SCOUT_OPERATIONS: {
    name: 'MAX_ACTIVE_SCOUT_OPERATIONS',
    classification: 'SERVER_ONLY',
    requiredInProduction: false,
    sensitive: false,
    description: 'Concurrency cap on concurrent active Scout enrichments (1-1000)',
    allowedInBrowser: false,
  },
  IDEMPOTENCY_TTL_SECONDS: {
    name: 'IDEMPOTENCY_TTL_SECONDS',
    classification: 'SERVER_ONLY',
    requiredInProduction: false,
    sensitive: false,
    description: 'Time-to-live for idempotency records in seconds',
    allowedInBrowser: false,
  },
};

// ==========================================
// 2. FORBIDDEN VITE VARIABLES
// ==========================================

export const FORBIDDEN_VITE_PREFIXES = [
  'VITE_SUPABASE_SERVICE_ROLE_KEY',
  'VITE_GEMINI_API_KEY',
  'VITE_SARVAM_API_KEY',
  'VITE_VOICE_WEBHOOK_SECRET',
  'VITE_SECRET',
  'VITE_PRIVATE',
];

// ==========================================
// 3. VALIDATION TYPES & ERROR CLASS
// ==========================================

export class ProductionConfigError extends Error {
  public readonly code = 'INVALID_PRODUCTION_CONFIG';
  public readonly errors: string[];

  constructor(errors: string[]) {
    super(`Production configuration validation failed with ${errors.length} error(s):\n - ${errors.join('\n - ')}`);
    this.name = 'ProductionConfigError';
    this.errors = errors;
  }
}

export interface ConfigValidationResult {
  valid: boolean;
  environment: 'production' | 'development' | 'test';
  errors: string[];
  warnings: string[];
  sanitizedConfig: Record<string, string | number | boolean | null>;
}

// Helper: safe integer bounds check
function validateBoundedInt(
  val: string | undefined,
  name: string,
  min: number,
  max: number,
  errors: string[]
): number | null {
  if (!val || val.trim() === '') return null;
  const num = Number(val);
  if (!Number.isInteger(num) || isNaN(num)) {
    errors.push(`${name} must be a valid integer, received: "${val}"`);
    return null;
  }
  if (num < min || num > max) {
    errors.push(`${name} must be between ${min} and ${max}, received: ${num}`);
    return null;
  }
  return num;
}

// ==========================================
// 4. CENTRAL VALIDATION FUNCTION
// ==========================================

export function validateProductionConfig(
  env: Record<string, string | undefined> = process.env,
  options?: { isProductionOverride?: boolean }
): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const sanitizedConfig: Record<string, string | number | boolean | null> = {};

  // 1. Validate NODE_ENV
  const rawNodeEnv = (env.NODE_ENV || 'development').trim().toLowerCase();
  const validEnvs = ['development', 'test', 'production'];
  if (!validEnvs.includes(rawNodeEnv)) {
    errors.push(`Unsupported NODE_ENV: "${rawNodeEnv}". Expected one of: ${validEnvs.join(', ')}.`);
  }

  const effectiveEnv = (options?.isProductionOverride ? 'production' : rawNodeEnv) as
    | 'production'
    | 'development'
    | 'test';
  const isProduction = effectiveEnv === 'production';

  sanitizedConfig.environment = effectiveEnv;

  // 2. Check for forbidden VITE_* variables leaking secrets
  for (const forbidden of FORBIDDEN_VITE_PREFIXES) {
    if (env[forbidden] && env[forbidden]!.trim().length > 0) {
      errors.push(`Forbidden browser secret exposure: "${forbidden}" is set in environment. Server secrets must never use VITE_ prefix.`);
    }
  }

  // Also check for any env key starting with VITE_ that contains secret keywords
  for (const key of Object.keys(env)) {
    if (key.startsWith('VITE_')) {
      const upper = key.toUpperCase();
      if (
        upper.includes('SERVICE_ROLE') ||
        upper.includes('WEBHOOK_SECRET') ||
        upper.includes('PRIVATE_KEY')
      ) {
        errors.push(`Forbidden browser secret exposure: "${key}" must not be exposed to frontend via VITE_ prefix.`);
      }
    }
  }

  // 3. Validate Rate Limiting & Concurrency configuration bounds
  validateBoundedInt(env.GLOBAL_REQUESTS_PER_MINUTE, 'GLOBAL_REQUESTS_PER_MINUTE', 1, 100000, errors);
  validateBoundedInt(env.TENANT_REQUESTS_PER_MINUTE, 'TENANT_REQUESTS_PER_MINUTE', 1, 100000, errors);
  validateBoundedInt(env.MAX_SARVAM_CALLS_PER_TENANT_PER_HOUR, 'MAX_SARVAM_CALLS_PER_TENANT_PER_HOUR', 1, 10000, errors);
  validateBoundedInt(env.MAX_SARVAM_CALLS_PER_TENANT_PER_DAY, 'MAX_SARVAM_CALLS_PER_TENANT_PER_DAY', 1, 50000, errors);
  validateBoundedInt(env.MAX_GEMINI_OPS_PER_TENANT_PER_HOUR, 'MAX_GEMINI_OPS_PER_TENANT_PER_HOUR', 1, 50000, errors);
  validateBoundedInt(env.MAX_ENRICHMENTS_PER_TENANT_PER_HOUR, 'MAX_ENRICHMENTS_PER_TENANT_PER_HOUR', 1, 50000, errors);
  validateBoundedInt(env.IDEMPOTENCY_TTL_SECONDS, 'IDEMPOTENCY_TTL_SECONDS', 1, 604800, errors);

  // Concurrency bounds: must be bounded between 1 and 1000 to prevent denial of service or resource exhaustion
  validateBoundedInt(env.MAX_ACTIVE_SARVAM_CALL_DISPATCHES, 'MAX_ACTIVE_SARVAM_CALL_DISPATCHES', 1, 1000, errors);
  validateBoundedInt(env.MAX_ACTIVE_GEMINI_OPERATIONS, 'MAX_ACTIVE_GEMINI_OPERATIONS', 1, 1000, errors);
  validateBoundedInt(env.MAX_ACTIVE_SCOUT_OPERATIONS, 'MAX_ACTIVE_SCOUT_OPERATIONS', 1, 1000, errors);

  // 4. Production-specific rigorous constraints
  if (isProduction) {
    // A. APP_URL validation
    const appUrl = env.APP_URL?.trim();
    if (!appUrl) {
      errors.push('APP_URL is required in production.');
    } else {
      try {
        const parsed = new URL(appUrl);
        if (parsed.protocol !== 'https:') {
          errors.push(`APP_URL must use HTTPS protocol in production. Received: "${parsed.protocol}//"`);
        }
        const hostname = parsed.hostname.toLowerCase();
        if (
          hostname === 'localhost' ||
          hostname === '127.0.0.1' ||
          hostname === 'growthforge.local' ||
          hostname.endsWith('.local')
        ) {
          errors.push(`APP_URL must not point to localhost, local loopback, or development domain in production: "${hostname}"`);
        }
        sanitizedConfig.app_url = appUrl;
      } catch {
        errors.push(`APP_URL is not a valid absolute URL: "${appUrl}"`);
      }
    }

    // B. CORS allowed origins
    const corsOrigins = env.CORS_ALLOWED_ORIGINS?.trim();
    if (corsOrigins === '*') {
      errors.push('CORS_ALLOWED_ORIGINS cannot be wildcard ("*") in production environment.');
    }

    // C. Supabase credentials
    const supabaseUrl = env.SUPABASE_URL?.trim();
    if (!supabaseUrl) {
      errors.push('SUPABASE_URL is required in production.');
    } else {
      try {
        const parsed = new URL(supabaseUrl);
        if (parsed.protocol !== 'https:') {
          errors.push(`SUPABASE_URL must use HTTPS in production. Received: "${parsed.protocol}//"`);
        }
        if (parsed.hostname.includes('your-project')) {
          errors.push('SUPABASE_URL contains placeholder value "your-project".');
        }
        sanitizedConfig.supabase_host = parsed.hostname;
      } catch {
        errors.push(`SUPABASE_URL is not a valid URL: "${supabaseUrl}"`);
      }
    }

    const supabaseAnon = env.SUPABASE_ANON_KEY?.trim();
    if (!supabaseAnon || supabaseAnon.includes('your-anon-key') || supabaseAnon.length < 20) {
      errors.push('SUPABASE_ANON_KEY is missing, placeholder, or invalid in production.');
    }

    const supabaseService = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!supabaseService || supabaseService.includes('your-service-role') || supabaseService.length < 20) {
      errors.push('SUPABASE_SERVICE_ROLE_KEY is missing, placeholder, or invalid in production.');
    }

    // D. Gemini API Key
    const geminiKey = env.GEMINI_API_KEY?.trim();
    if (!geminiKey || geminiKey.includes('your-gemini') || geminiKey.length < 10) {
      errors.push('GEMINI_API_KEY is missing or invalid in production.');
    }

    // E. Sarvam Voice credentials
    const voiceMode = (env.VOICE_MODE || '').trim().toUpperCase();
    if (voiceMode !== 'REAL') {
      errors.push(`VOICE_MODE must be "REAL" in production. Mock voice provider is strictly forbidden. Received: "${voiceMode}"`);
    }

    const sarvamKey = env.SARVAM_API_KEY?.trim();
    if (!sarvamKey || sarvamKey.includes('your-sarvam') || sarvamKey.length < 10) {
      errors.push('SARVAM_API_KEY is missing or invalid in production.');
    }

    const sarvamOrg = env.SARVAM_ORG_ID?.trim();
    if (!sarvamOrg || sarvamOrg === '01a074ea-647b-7549-9a87-cb4a09a65faa') {
      errors.push('SARVAM_ORG_ID is missing or using development default in production.');
    }

    const sarvamWorkspace = env.SARVAM_WORKSPACE_ID?.trim();
    if (!sarvamWorkspace || sarvamWorkspace === '01a074ea-6481-766d-a3f3-c42aef343735') {
      errors.push('SARVAM_WORKSPACE_ID is missing or using development default in production.');
    }

    const sarvamAgent = env.SARVAM_AGENT_ID?.trim();
    if (!sarvamAgent || sarvamAgent === 'Growthforge-ae0789e1-56b8') {
      errors.push('SARVAM_AGENT_ID is missing or using development default in production.');
    }

    const sarvamVersion = env.SARVAM_AGENT_VERSION?.trim();
    if (!sarvamVersion) {
      errors.push('SARVAM_AGENT_VERSION is required in production.');
    }

    const sarvamConn = env.SARVAM_CONNECTION_ID?.trim();
    if (!sarvamConn || sarvamConn === '0174b928-7c-cdaf00f5-ff9a') {
      errors.push('SARVAM_CONNECTION_ID is missing or using development default in production.');
    }

    const sarvamPhone = env.SARVAM_AGENT_PHONE_NUMBER?.trim();
    if (!sarvamPhone || sarvamPhone === '+918064266255') {
      errors.push('SARVAM_AGENT_PHONE_NUMBER is missing or using development default in production.');
    } else if (!/^\+[1-9]\d{7,14}$/.test(sarvamPhone.replace(/[\s-]/g, ''))) {
      errors.push(`SARVAM_AGENT_PHONE_NUMBER must be in valid E.164 format. Received: "${sarvamPhone}"`);
    }

    // F. Webhook Secret (minimum 16 characters for cryptographic HMAC strength)
    const webhookSecret = env.VOICE_WEBHOOK_SECRET?.trim();
    if (!webhookSecret) {
      errors.push('VOICE_WEBHOOK_SECRET is required in production for authenticating voice callbacks.');
    } else if (webhookSecret.length < 16) {
      errors.push('VOICE_WEBHOOK_SECRET must be at least 16 characters in production for cryptographic security.');
    }

    // G. Logging & Redaction Controls
    const redactionFlag = env.LOG_REDACTION_ENABLED?.trim().toLowerCase();
    if (redactionFlag === 'false') {
      errors.push('LOG_REDACTION_ENABLED cannot be disabled in production. Redaction is mandatory.');
    }

    const debugLogs = env.ENABLE_DEBUG_LOGS?.trim().toLowerCase();
    if (debugLogs === 'true') {
      errors.push('ENABLE_DEBUG_LOGS cannot be enabled in production environment.');
    }

    const logLevel = (env.LOG_LEVEL || 'INFO').trim().toUpperCase();
    if (logLevel === 'DEBUG') {
      errors.push('LOG_LEVEL cannot be set to DEBUG in production. Use INFO, WARN, or ERROR.');
    }
  } else {
    // Non-production checks / warnings
    if (env.ENABLE_DEBUG_LOGS === 'true') {
      warnings.push('Debug logging is active in non-production mode.');
    }
  }

  return {
    valid: errors.length === 0,
    environment: effectiveEnv,
    errors,
    warnings,
    sanitizedConfig,
  };
}

// ==========================================
// 5. FAIL-FAST STARTUP ENFORCER
// ==========================================

export function enforceProductionConfig(
  env: Record<string, string | undefined> = process.env,
  options?: { isProductionOverride?: boolean }
): ConfigValidationResult {
  const result = validateProductionConfig(env, options);

  if (!result.valid) {
    const isProduction = result.environment === 'production' || options?.isProductionOverride === true;
    if (isProduction) {
      logger.error('Startup halted: production configuration validation failed.', {
        service: 'production-config',
        operation: 'enforceProductionConfig',
        error_category: 'CONFIGURATION_ERROR',
        data: {
          errorCount: result.errors.length,
          errors: result.errors,
        },
      });
      throw new ProductionConfigError(result.errors);
    } else {
      logger.warn('Non-production configuration warnings encountered at startup.', {
        service: 'production-config',
        operation: 'enforceProductionConfig',
        data: {
          warnings: result.warnings,
          nonFatalErrors: result.errors,
        },
      });
    }
  }

  return result;
}

// ==========================================
// 6. SAFE STARTUP HEALTH DIAGNOSTICS
// ==========================================

export interface StartupHealthDiagnostics {
  status: 'READY' | 'DEGRADED' | 'CONFIG_ERROR';
  environment: 'production' | 'development' | 'test';
  timestamp: string;
  checks: {
    supabase: 'READY' | 'CONFIGURED' | 'NOT_CONFIGURED';
    gemini: 'CONFIGURED' | 'MOCK_ALLOWED' | 'NOT_CONFIGURED';
    sarvam: 'CONFIGURED' | 'MOCK_ALLOWED' | 'NOT_CONFIGURED';
    scout: 'READY' | 'OPTIONAL_LOCAL';
    webhook_auth: 'CONFIGURED' | 'NOT_CONFIGURED';
    log_redaction: 'MANDATORY_ACTIVE' | 'ACTIVE';
    cors: 'RESTRICTED' | 'DEVELOPMENT_PERMISSIVE';
  };
}

export function getStartupHealthStatus(
  env: Record<string, string | undefined> = process.env
): StartupHealthDiagnostics {
  const isProd = (env.NODE_ENV || '').toLowerCase() === 'production';
  const validation = validateProductionConfig(env);

  const supabaseConfigured = Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY);
  const geminiConfigured = Boolean(env.GEMINI_API_KEY && env.GEMINI_API_KEY.length > 5);
  const sarvamConfigured = Boolean(
    env.SARVAM_API_KEY &&
    env.SARVAM_ORG_ID &&
    env.SARVAM_AGENT_ID &&
    env.SARVAM_CONNECTION_ID
  );
  const webhookConfigured = Boolean(
    env.VOICE_WEBHOOK_SECRET && env.VOICE_WEBHOOK_SECRET.length >= 16
  );

  return {
    status: validation.valid ? 'READY' : isProd ? 'CONFIG_ERROR' : 'DEGRADED',
    environment: validation.environment,
    timestamp: new Date().toISOString(),
    checks: {
      supabase: supabaseConfigured ? 'READY' : 'NOT_CONFIGURED',
      gemini: geminiConfigured ? 'CONFIGURED' : isProd ? 'NOT_CONFIGURED' : 'MOCK_ALLOWED',
      sarvam: sarvamConfigured ? 'CONFIGURED' : isProd ? 'NOT_CONFIGURED' : 'MOCK_ALLOWED',
      scout: env.SCOUT_API_URL || env.PYTHON_BIN ? 'READY' : 'OPTIONAL_LOCAL',
      webhook_auth: webhookConfigured ? 'CONFIGURED' : 'NOT_CONFIGURED',
      log_redaction: isProd ? 'MANDATORY_ACTIVE' : 'ACTIVE',
      cors: isProd ? 'RESTRICTED' : 'DEVELOPMENT_PERMISSIVE',
    },
  };
}
