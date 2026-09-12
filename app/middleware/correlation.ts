/**
 * GrowthForge Buyer Engine - Correlation & Error Sanitization Middleware (Phase 8A.9)
 *
 * SPECIFICATION:
 * - Attaches request_id and correlation_id to every incoming HTTP request.
 * - Injects X-Request-Id and X-Correlation-Id response headers.
 * - Wraps request pipeline inside AsyncLocalStorage correlation context.
 * - Sanitizes all HTTP error responses, ensuring no stack traces or secrets are leaked to clients.
 */

import { Request, Response, NextFunction } from 'express';
import {
  generateUUID,
  runWithCorrelationContext,
} from '../services/security/correlationContext';
import { sanitizeClientError } from '../services/security/piiRedaction';
import { logger } from '../services/security/logger';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      correlationId?: string;
    }
  }
}

function sanitizeHeaderValue(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (trimmed.length === 0 || trimmed.length > 64) return null;
  if (!/^[a-zA-Z0-9_\-\.]+$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Express middleware to attach and propagate request and correlation IDs.
 */
export function correlationMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const rawReqId = req.headers['x-request-id'];
    const rawCorrId = req.headers['x-correlation-id'];

    const requestId = sanitizeHeaderValue(rawReqId) || generateUUID();
    const correlationId = sanitizeHeaderValue(rawCorrId) || generateUUID();

    req.requestId = requestId;
    req.correlationId = correlationId;

    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Correlation-Id', correlationId);

    const authTenantId = (req as any).auth?.tenantId;

    runWithCorrelationContext(
      {
        requestId,
        correlationId,
        tenantId: authTenantId,
        service: 'http-api',
        operation: `${req.method} ${req.path}`,
      },
      async () => {
        next();
      }
    );
  };
}

/**
 * Global Express error handling middleware ensuring fail-safe sanitized client error output.
 */
export function sanitizedErrorHandler() {
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const requestId = req.requestId || generateUUID();
    const correlationId = req.correlationId;
    const authTenantId = (req as any).auth?.tenantId;

    // Log structured internal error
    logger.error('Unhandled HTTP request error', {
      service: 'http-api',
      operation: `${req.method} ${req.path}`,
      request_id: requestId,
      correlation_id: correlationId,
      tenant_id: authTenantId,
      error_category: 'HTTP_SERVER_ERROR',
      data: {
        error: err instanceof Error ? err.message : String(err),
      },
    });

    const sanitized = sanitizeClientError(err, requestId);
    const statusCode = sanitized.error.code === 'UNAUTHORIZED' ? 401
      : sanitized.error.code === 'FORBIDDEN' ? 403
      : sanitized.error.code === 'RATE_LIMIT_EXCEEDED' ? 429
      : sanitized.error.code === 'NOT_FOUND' ? 404
      : sanitized.error.code === 'BAD_REQUEST' ? 400
      : sanitized.error.code === 'CONFLICT' ? 409
      : 500;

    res.status(statusCode).json(sanitized);
  };
}
