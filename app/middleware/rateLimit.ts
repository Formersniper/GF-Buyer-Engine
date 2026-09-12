import { Request, Response, NextFunction } from 'express';
import { supabaseDataService } from '../services/supabase/repositories';
export class RateLimitError extends Error {
  public statusCode = 429;
  constructor(message: string, public details: any) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export function rateLimit(operation: string, maxRequests: number, windowSeconds: number = 60) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Identity can be tenantId (for authenticated users) or IP address (for unauthenticated)
      // Since requireAuth middleware runs before this for protected routes, req.user will be populated.
      // We will assume req.user is set by requireAuth.
      
      const user = (req as any).user;
      let targetId = 'global';
      
      if (user && user.tenant_id) {
        targetId = user.tenant_id;
      } else {
        // Fallback to IP address if unauthenticated
        targetId = req.ip || req.socket.remoteAddress || 'global';
      }

      // Check Rate Limit using security repo
      const rl = await supabaseDataService.security.checkAndIncrementRateLimit(targetId, operation, windowSeconds, maxRequests);
      
      // Set Headers
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - rl.count));
      
      if (!rl.allowed) {
        throw new RateLimitError('Rate limit exceeded. Please back off and retry.', { operation, targetId, windowSeconds, maxRequests });
      }
      
      next();
    } catch (err) {
      next(err);
    }
  };
}
