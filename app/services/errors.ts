export enum ExternalProviderErrorType {
  CONFIGURATION = 'CONFIGURATION',
  AUTHENTICATION = 'AUTHENTICATION',
  AUTHORIZATION = 'AUTHORIZATION',
  RATE_LIMIT = 'RATE_LIMIT',
  TIMEOUT = 'TIMEOUT',
  NETWORK = 'NETWORK',
  VALIDATION = 'VALIDATION',
  PROVIDER_5XX = 'PROVIDER_5XX',
  UNKNOWN = 'UNKNOWN',
}

export class ExternalProviderError extends Error {
  constructor(
    public provider: string,
    public type: ExternalProviderErrorType,
    message: string,
    public details?: any,
    public originalError?: any
  ) {
    super(`[${provider}] ${type}: ${message}`);
    this.name = 'ExternalProviderError';
  }
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: {
    provider: string;
    maxAttempts: number;
    baseDelayMs: number;
    shouldRetry: (error: any) => boolean;
  }
): Promise<T> {
  let attempt = 1;
  while (true) {
    try {
      return await operation();
    } catch (error: any) {
      if (attempt >= options.maxAttempts || !options.shouldRetry(error)) {
        throw error;
      }
      const delay = options.baseDelayMs * Math.pow(2, attempt - 1);
      console.warn(`[${options.provider}] Retry ${attempt}/${options.maxAttempts} in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      attempt++;
    }
  }
}

export async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  provider: string
): Promise<T> {
  return Promise.race([
    operation,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new ExternalProviderError(provider, ExternalProviderErrorType.TIMEOUT, `Operation timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}
