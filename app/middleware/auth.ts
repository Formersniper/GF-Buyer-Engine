/**
 * GrowthForge Buyer Intelligence Engine - Authentication Middleware (Phase 8A.1)
 *
 * Provides cryptographic/authoritative token and API key validation using Supabase Auth.
 * Enforces fail-closed authentication boundaries, explicit role authorization,
 * and typed request context populating req.auth.
 *
 * CRITICAL SECURITY RULE:
 * NEVER TRUST x-tenant-id AS AUTHORITY.
 * A request with x-tenant-id without verified Bearer token or API key is rejected (401).
 */

import { Request, Response, NextFunction } from 'express';
import {
  AuthContext,
  UserRole,
  AuthErrorCode,
  AuthErrorResponse,
} from '../schemas/auth';
import { getSupabaseClient } from '../services/supabase/client';

// ==========================================
// 1. ROLE HIERARCHY & AUTHORIZATION
// ==========================================

const ROLE_LEVELS: Record<UserRole, number> = {
  VIEWER: 1,
  SALES: 2,
  ADMIN: 3,
  OWNER: 4,
  PLATFORM_ADMIN: 5,
};

export function hasRequiredRole(currentRole: UserRole | undefined, requiredRole: UserRole): boolean {
  if (!currentRole) return false;
  if (currentRole === 'PLATFORM_ADMIN') return true;
  return (ROLE_LEVELS[currentRole] ?? 0) >= (ROLE_LEVELS[requiredRole] ?? 0);
}

// ==========================================
// 2. JWT AUTHENTICATOR INTERFACE & PROVIDER
// ==========================================

export interface JwtAuthenticator {
  validateJwt(token: string): Promise<AuthContext | null>;
}

export class SupabaseJwtAuthenticator implements JwtAuthenticator {
  public async validateJwt(token: string): Promise<AuthContext | null> {
    if (!token || typeof token !== 'string' || token.trim() === '') {
      return null;
    }

    const client = getSupabaseClient();
    if (!client) {
      // In disconnected mode / no Supabase client, cannot authoritatively validate JWT
      return null;
    }

    try {
      const { data, error } = await client.auth.getUser(token);
      if (error || !data || !data.user) {
        return null;
      }

      const user = data.user;
      const appMetadata = (user.app_metadata as Record<string, unknown>) || {};
      const userMetadata = (user.user_metadata as Record<string, unknown>) || {};

      const isPlatformAdmin = Boolean(
        appMetadata.is_platform_admin === true ||
        appMetadata.role === 'PLATFORM_ADMIN' ||
        userMetadata.is_platform_admin === true ||
        userMetadata.role === 'PLATFORM_ADMIN'
      );

      const rawRole = (appMetadata.role || userMetadata.role) as UserRole | undefined;
      const role: UserRole = isPlatformAdmin
        ? 'PLATFORM_ADMIN'
        : (rawRole && ROLE_LEVELS[rawRole] ? rawRole : 'SALES');

      return {
        userId: user.id,
        email: user.email,
        tenantId: undefined, // Resolved via memberships in Phase 8A.2
        role,
        isPlatformAdmin,
        authMethod: 'JWT',
      };
    } catch {
      return null;
    }
  }
}

// ==========================================
// 3. API KEY AUTHENTICATOR INTERFACE & PROVIDER
// ==========================================

export interface ApiKeyAuthenticator {
  validateApiKey(apiKey: string): Promise<AuthContext | null>;
}

export class DefaultApiKeyAuthenticator implements ApiKeyAuthenticator {
  public async validateApiKey(_apiKey: string): Promise<AuthContext | null> {
    // Phase 8A.1: The tenant_api_keys table and hashing schema are scheduled for Phase 8A.2.
    // In Phase 8A.1, this operates in fail-closed mode: no plaintext or mock keys are accepted.
    return null;
  }
}

// Pluggable authenticators for testing & customization
let activeJwtAuthenticator: JwtAuthenticator = new SupabaseJwtAuthenticator();
let activeApiKeyAuthenticator: ApiKeyAuthenticator = new DefaultApiKeyAuthenticator();

export function getJwtAuthenticator(): JwtAuthenticator {
  return activeJwtAuthenticator;
}

export function setJwtAuthenticator(authenticator: JwtAuthenticator): void {
  activeJwtAuthenticator = authenticator;
}

export function resetJwtAuthenticator(): void {
  activeJwtAuthenticator = new SupabaseJwtAuthenticator();
}

export function getApiKeyAuthenticator(): ApiKeyAuthenticator {
  return activeApiKeyAuthenticator;
}

export function setApiKeyAuthenticator(authenticator: ApiKeyAuthenticator): void {
  activeApiKeyAuthenticator = authenticator;
}

export function resetApiKeyAuthenticator(): void {
  activeApiKeyAuthenticator = new DefaultApiKeyAuthenticator();
}

// ==========================================
// 4. SANITIZED AUTH ERROR HELPER
// ==========================================

export function sendAuthError(
  res: Response,
  statusCode: 401 | 403,
  code: AuthErrorCode,
  message: string
): Response {
  const response: AuthErrorResponse = {
    success: false,
    error: {
      code,
      message,
    },
  };
  return res.status(statusCode).json(response);
}

// ==========================================
// 5. REQUIRE AUTH MIDDLEWARE
// ==========================================

export function requireAuth() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // If request already has validated auth context
    if (req.auth) {
      next();
      return;
    }

    const authHeader = req.headers.authorization;
    const apiKeyHeader = req.headers['x-api-key'];

    // 1. Evaluate Bearer Token
    if (authHeader !== undefined) {
      if (typeof authHeader !== 'string') {
        sendAuthError(res, 401, 'INVALID_TOKEN_FORMAT', 'Authorization header must be a string.');
        return;
      }

      const trimmedHeader = authHeader.trim();
      if (!trimmedHeader.startsWith('Bearer ') && !trimmedHeader.startsWith('bearer ')) {
        sendAuthError(res, 401, 'INVALID_TOKEN_FORMAT', 'Authorization header must follow Bearer <token> format.');
        return;
      }

      const token = trimmedHeader.slice(7).trim();
      if (!token) {
        sendAuthError(res, 401, 'INVALID_TOKEN_FORMAT', 'Bearer token must not be empty.');
        return;
      }

      const authContext = await getJwtAuthenticator().validateJwt(token);
      if (!authContext) {
        sendAuthError(res, 401, 'INVALID_TOKEN', 'Authentication token is invalid or expired.');
        return;
      }

      req.auth = authContext;
      next();
      return;
    }

    // 2. Evaluate API Key
    if (apiKeyHeader !== undefined) {
      const apiKey = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;
      if (typeof apiKey !== 'string' || !apiKey.trim()) {
        sendAuthError(res, 401, 'INVALID_API_KEY_FORMAT', 'API key must be a non-empty string.');
        return;
      }

      const authContext = await getApiKeyAuthenticator().validateApiKey(apiKey.trim());
      if (!authContext) {
        sendAuthError(res, 401, 'INVALID_API_KEY', 'API key is invalid or not configured.');
        return;
      }

      req.auth = authContext;
      next();
      return;
    }

    // 3. Neither Bearer Token nor API Key provided -> 401 Auth Required
    // Note: Presence of x-tenant-id alone NEVER authenticates a request
    sendAuthError(res, 401, 'AUTH_REQUIRED', 'Authentication required.');
  };
}

// ==========================================
// 6. REQUIRE ROLE MIDDLEWARE
// ==========================================

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      sendAuthError(res, 401, 'AUTH_REQUIRED', 'Authentication required.');
      return;
    }

    if (req.auth.isPlatformAdmin) {
      next();
      return;
    }

    const userRole = req.auth.role;
    if (!userRole) {
      sendAuthError(res, 403, 'FORBIDDEN', 'User has no assigned role.');
      return;
    }

    // Check if user has one of the allowed roles or a higher role in hierarchy
    const hasRolePermission = allowedRoles.some((allowedRole) =>
      hasRequiredRole(userRole, allowedRole)
    );

    if (!hasRolePermission) {
      sendAuthError(res, 403, 'FORBIDDEN', 'User does not possess the required role for this operation.');
      return;
    }

    next();
  };
}

// ==========================================
// 7. OPTIONAL AUTH MIDDLEWARE
// ==========================================

export function optionalAuth() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (req.auth) {
      next();
      return;
    }

    const authHeader = req.headers.authorization;
    const apiKeyHeader = req.headers['x-api-key'];

    if (authHeader && typeof authHeader === 'string' && authHeader.trim().toLowerCase().startsWith('bearer ')) {
      const token = authHeader.trim().slice(7).trim();
      if (token) {
        const authContext = await getJwtAuthenticator().validateJwt(token);
        if (authContext) {
          req.auth = authContext;
        }
      }
    } else if (apiKeyHeader) {
      const apiKey = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;
      if (typeof apiKey === 'string' && apiKey.trim()) {
        const authContext = await getApiKeyAuthenticator().validateApiKey(apiKey.trim());
        if (authContext) {
          req.auth = authContext;
        }
      }
    }

    next();
  };
}
