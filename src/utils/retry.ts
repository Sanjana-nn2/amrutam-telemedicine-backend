import { logger } from './logger';

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  jitter?: boolean;
  operationName?: string;
  isRetryable?: (error: any) => boolean;
}

/**
 * Checks if an error is considered transient and safe to retry.
 * By default:
 * - Network failures (ECONNRESET, ETIMEDOUT, ECONNREFUSED)
 * - Prisma transaction conflict/deadlock (P2034) or connection timeouts (P1001, P1002)
 * - HTTP status 408, 429, 502, 503, 504
 * - Explicitly DOES NOT retry business rule / auth / validation errors (400, 401, 403, 404, 409, 422).
 */
export function defaultIsRetryable(error: any): boolean {
  if (!error) return false;

  // Never retry known client domain errors (validation, auth, business conflict)
  const statusCode = error.statusCode || error.status;
  if (statusCode && statusCode >= 400 && statusCode < 500 && statusCode !== 408 && statusCode !== 429) {
    return false;
  }

  // Prisma transient error codes
  if (error.code === 'P2034' || error.code === 'P1001' || error.code === 'P1002') {
    return true;
  }

  // Network and socket errors
  const code = error.code || error.cause?.code;
  if (['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)) {
    return true;
  }

  // Transient HTTP gateway/service errors
  if (statusCode === 408 || statusCode === 429 || statusCode === 502 || statusCode === 503 || statusCode === 504) {
    return true;
  }

  return false;
}

/**
 * Reusable retry utility executing operations with Exponential Backoff + Jitter.
 */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 100,
    maxDelayMs = 3000,
    factor = 2,
    jitter = true,
    operationName = 'operation',
    isRetryable = defaultIsRetryable,
  } = options;

  let lastError: any;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation(attempt);
    } catch (error: any) {
      lastError = error;

      // Check if error is retryable and we have attempts remaining
      if (attempt >= maxAttempts || !isRetryable(error)) {
        throw error;
      }

      // Calculate exponential backoff delay: delay = min(maxDelay, initialDelay * factor^(attempt - 1))
      const calculatedDelay = Math.min(
        maxDelayMs,
        initialDelayMs * Math.pow(factor, attempt - 1)
      );

      // Apply full jitter: random value between 0 and calculatedDelay
      const waitMs = jitter
        ? Math.floor(Math.random() * calculatedDelay)
        : Math.floor(calculatedDelay);

      logger.warn(`Retry attempt ${attempt}/${maxAttempts} for [${operationName}] after ${waitMs}ms backoff`, {
        operation: operationName,
        attempt,
        waitMs,
        error: error instanceof Error ? error.message : String(error),
        errorCode: error.code || error.statusCode,
      });

      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  throw lastError;
}
