/**
 * GrowthForge Buyer Intelligence Engine - Authentication Schema & Types
 *
 * Defines the core authentication context, user roles, error codes, and responses
 * for identity verification (Supabase JWT and Tenant API Keys).
 */

export type UserRole = 'OWNER' | 'ADMIN' | 'SALES' | 'VIEWER' | 'PLATFORM_ADMIN';

export type AuthMethod = 'JWT' | 'API_KEY';

export interface AuthContext {
  userId: string;
  email?: string;
  tenantId?: string;
  role?: UserRole;
  isPlatformAdmin: boolean;
  authMethod: AuthMethod;
}

export type AuthErrorCode =
  | 'AUTH_REQUIRED'
  | 'INVALID_TOKEN_FORMAT'
  | 'INVALID_TOKEN'
  | 'EXPIRED_TOKEN'
  | 'INVALID_API_KEY_FORMAT'
  | 'INVALID_API_KEY'
  | 'FORBIDDEN';

export interface AuthErrorResponse {
  success: false;
  error: {
    code: AuthErrorCode;
    message: string;
  };
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}
