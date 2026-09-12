/**
 * GrowthForge Buyer Intelligence Engine - Production Security Headers & CORS Middleware (Phase 8A.10)
 *
 * Implements strict HTTP security headers and environment-aware CORS boundaries.
 * In production:
 *  - Wildcard origins ('*') are strictly disallowed for authenticated API requests
 *  - Explicit origin whitelisting via CORS_ALLOWED_ORIGINS or canonical APP_URL
 *  - Standard HSTS, MIME sniffing protection, and referrer control
 *  - Does NOT break server-to-server webhook callbacks (which have no browser Origin header)
 */

import { Request, Response, NextFunction } from 'express';

export interface CorsOptions {
  allowedOrigins?: string[];
  isProduction?: boolean;
}

/**
 * Parses and normalizes allowed CORS origins.
 */
export function resolveAllowedOrigins(env: Record<string, string | undefined> = process.env): string[] {
  const origins: string[] = [];

  if (env.CORS_ALLOWED_ORIGINS) {
    const split = env.CORS_ALLOWED_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter((o) => o.length > 0);
    origins.push(...split);
  }

  if (env.APP_URL) {
    try {
      const parsed = new URL(env.APP_URL);
      if (!origins.includes(parsed.origin)) {
        origins.push(parsed.origin);
      }
    } catch {
      // Handled in productionConfig validation
    }
  }

  return origins;
}

/**
 * Express middleware for setting defense-in-depth HTTP security headers.
 */
export function securityHeaders() {
  const isProd = process.env.NODE_ENV === 'production';

  return (req: Request, res: Response, next: NextFunction): void => {
    // 1. Prevent MIME-sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // 2. Referrer policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // 3. Permissions Policy (align with application audio/voice requirements)
    res.setHeader('Permissions-Policy', 'microphone=(self), camera=(), geolocation=()');

    // 4. Strict Transport Security (HSTS) in production
    if (isProd) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    // 5. Framing control:
    // In production, restrict framing. Note: in development, allow embedding for AI Studio preview iframe.
    if (isProd) {
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    }

    next();
  };
}

/**
 * Express middleware for production-hardened CORS enforcement.
 */
export function corsMiddleware(options?: CorsOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;
    const isProd = options?.isProduction ?? process.env.NODE_ENV === 'production';
    const allowedOrigins = options?.allowedOrigins ?? resolveAllowedOrigins();

    // If no Origin header (e.g., server-to-server webhook callback, CLI, curl), pass through cleanly
    if (!origin) {
      next();
      return;
    }

    let isAllowed = false;

    if (isProd) {
      // In production: strict match against allowed origins (wildcards prohibited)
      isAllowed = allowedOrigins.includes(origin);
    } else {
      // In development/test: allow localhost, 127.0.0.1, or matching origins
      if (
        origin.startsWith('http://localhost:') ||
        origin.startsWith('https://localhost:') ||
        origin.startsWith('http://127.0.0.1:') ||
        origin.startsWith('https://127.0.0.1:') ||
        allowedOrigins.includes(origin) ||
        allowedOrigins.includes('*') ||
        allowedOrigins.length === 0
      ) {
        isAllowed = true;
      }
    }

    if (isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader(
        'Access-Control-Allow-Methods',
        'GET, POST, PUT, PATCH, DELETE, OPTIONS'
      );
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Authorization, Content-Type, x-api-key, x-request-id, x-correlation-id, x-tenant-id, x-sarvam-signature, x-webhook-secret'
      );
      res.setHeader('Access-Control-Max-Age', '86400');
    } else if (isProd) {
      // In production, if origin is rejected and preflight, return 403 Forbidden
      if (req.method === 'OPTIONS') {
        res.status(403).json({
          error: 'CORS policy violation: origin not allowed.',
        });
        return;
      }
    }

    // Handle preflight OPTIONS response for allowed origins
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
  };
}
