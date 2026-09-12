/**
 * GrowthForge Buyer Intelligence Engine - Centralized Structured Logger (Phase 8A.9)
 *
 * SPECIFICATION:
 * - Emits structured JSON events with standardized telemetry fields.
 * - Enforces automatic PII masking & secret redaction on every logged event.
 * - Protects against log injection (newline/control character neutralization).
 * - Integrates with Ambient Correlation Context (requestId, correlationId, tenantId).
 * - Safe production level defaults (DEBUG disabled unless explicitly enabled).
 */

import { redactPII, redactSecretsInString } from './piiRedaction';
import { getCorrelationContext } from './correlationContext';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'SECURITY';

const LOG_LEVEL_HIERARCHY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  SECURITY: 4,
};

export interface StructuredLogEvent {
  timestamp: string;
  level: LogLevel;
  service: string;
  operation: string;
  tenant_id?: string;
  correlation_id?: string;
  request_id?: string;
  duration_ms?: number;
  status?: string;
  error_category?: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface LogEventOptions {
  service?: string;
  operation?: string;
  tenant_id?: string;
  correlation_id?: string;
  request_id?: string;
  duration_ms?: number;
  status?: string;
  error_category?: string;
  data?: Record<string, unknown>;
}

export class StructuredLogger {
  private logBuffer: StructuredLogEvent[] = [];
  private maxBufferSize = 200;

  /**
   * Resolves the active minimum log level.
   */
  public getMinLogLevel(): LogLevel {
    const envLevel = (process.env.LOG_LEVEL || 'INFO').toUpperCase() as LogLevel;
    if (envLevel in LOG_LEVEL_HIERARCHY) {
      return envLevel;
    }
    return 'INFO';
  }

  /**
   * Checks if debug logging is enabled.
   */
  public isDebugEnabled(): boolean {
    if (process.env.ENABLE_DEBUG_LOGS === 'true') {
      return true;
    }
    if (process.env.NODE_ENV === 'test') {
      return true;
    }
    return this.getMinLogLevel() === 'DEBUG' && process.env.NODE_ENV !== 'production';
  }

  /**
   * Checks if a specific log level should be emitted.
   */
  public shouldLog(level: LogLevel): boolean {
    if (level === 'DEBUG' && !this.isDebugEnabled()) {
      return false;
    }
    const minLevel = this.getMinLogLevel();
    return LOG_LEVEL_HIERARCHY[level] >= LOG_LEVEL_HIERARCHY[minLevel];
  }

  /**
   * Sanitizes string to prevent log injection / newline injection attacks.
   */
  private sanitizeStringForLog(str: string): string {
    return str
      .replace(/[\r\n\t]/g, ' ')
      .replace(/[\x00-\x1F\x7F]/g, '');
  }

  /**
   * Emits a structured log event.
   */
  public log(level: LogLevel, message: string, options: LogEventOptions = {}): StructuredLogEvent | null {
    if (!this.shouldLog(level)) {
      return null;
    }

    const context = getCorrelationContext();
    const cleanMessage = redactSecretsInString(this.sanitizeStringForLog(message));

    // Ensure data payload is deeply sanitized and PII-redacted
    const sanitizedData = options.data
      ? (redactPII(options.data) as Record<string, unknown>)
      : undefined;

    const event: StructuredLogEvent = {
      timestamp: new Date().toISOString(),
      level,
      service: options.service || context.service || 'growthforge-buyer-engine',
      operation: options.operation || context.operation || 'generic_operation',
      tenant_id: options.tenant_id || context.tenantId || undefined,
      correlation_id: options.correlation_id || context.correlationId || undefined,
      request_id: options.request_id || context.requestId || undefined,
      ...(options.duration_ms !== undefined ? { duration_ms: options.duration_ms } : {}),
      ...(options.status ? { status: options.status } : {}),
      ...(options.error_category ? { error_category: options.error_category } : {}),
      message: cleanMessage,
      ...(sanitizedData ? { data: sanitizedData } : {}),
    };

    // Buffer for testing / inspection
    this.logBuffer.push(event);
    if (this.logBuffer.length > this.maxBufferSize) {
      this.logBuffer.shift();
    }

    // Output formatted structured JSON to stdout / stderr
    const serialized = JSON.stringify(event);
    if (level === 'ERROR' || level === 'SECURITY') {
      process.stderr.write(serialized + '\n');
    } else {
      process.stdout.write(serialized + '\n');
    }

    return event;
  }

  public debug(message: string, options?: LogEventOptions): StructuredLogEvent | null {
    return this.log('DEBUG', message, options);
  }

  public info(message: string, options?: LogEventOptions): StructuredLogEvent | null {
    return this.log('INFO', message, options);
  }

  public warn(message: string, options?: LogEventOptions): StructuredLogEvent | null {
    return this.log('WARN', message, options);
  }

  public error(message: string, options?: LogEventOptions): StructuredLogEvent | null {
    return this.log('ERROR', message, options);
  }

  public security(message: string, options?: LogEventOptions): StructuredLogEvent | null {
    return this.log('SECURITY', message, options);
  }

  /**
   * Helper for auditing operational events with safe metadata.
   */
  public logAuditEvent(
    eventType: string,
    metadata: Record<string, unknown>,
    options?: LogEventOptions
  ): StructuredLogEvent | null {
    return this.log('INFO', `Audit event: ${eventType}`, {
      ...options,
      operation: options?.operation || eventType,
      status: 'AUDIT_EMITTED',
      data: metadata,
    });
  }

  /**
   * Testing & Diagnostics inspection methods.
   */
  public getRecentLogs(): StructuredLogEvent[] {
    return [...this.logBuffer];
  }

  public clearLogBuffer(): void {
    this.logBuffer = [];
  }
}

export const logger = new StructuredLogger();
