import { withRetry, defaultIsRetryable } from '../../src/utils/retry';
import { BadRequestError, NotFoundError, ConflictError } from '../../src/utils/errors';

describe('Phase 4: Retry Utility with Exponential Backoff + Jitter', () => {
  it('should resolve immediately if operation succeeds on first attempt', async () => {
    const fn = jest.fn().mockResolvedValue('success');
    const result = await withRetry(fn, { maxAttempts: 3, initialDelayMs: 10, jitter: false });

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry transient errors (e.g. Prisma write conflict P2034) and succeed', async () => {
    const transientError = new Error('Prisma write conflict');
    (transientError as any).code = 'P2034';

    const fn = jest
      .fn()
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce('retry-success');

    const result = await withRetry(fn, {
      maxAttempts: 3,
      initialDelayMs: 5,
      maxDelayMs: 50,
      jitter: false,
      operationName: 'testPrismaRetry',
    });

    expect(result).toBe('retry-success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should retry network errors (e.g. ECONNRESET, ETIMEDOUT)', async () => {
    const networkError = new Error('Connection reset by peer');
    (networkError as any).code = 'ECONNRESET';

    const fn = jest
      .fn()
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce('network-success');

    const result = await withRetry(fn, {
      maxAttempts: 3,
      initialDelayMs: 5,
      jitter: false,
    });

    expect(result).toBe('network-success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should NEVER retry client validation, auth, or domain business errors', async () => {
    const badRequest = new BadRequestError('Invalid input payload');
    const notFound = new NotFoundError('Doctor not found');
    const conflict = new ConflictError('Slot already booked');

    expect(defaultIsRetryable(badRequest)).toBe(false);
    expect(defaultIsRetryable(notFound)).toBe(false);
    expect(defaultIsRetryable(conflict)).toBe(false);

    const fn = jest.fn().mockRejectedValue(badRequest);

    await expect(
      withRetry(fn, { maxAttempts: 3, initialDelayMs: 5, jitter: false })
    ).rejects.toThrow('Invalid input payload');

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should throw lastError when maxAttempts is exhausted', async () => {
    const transientError = new Error('Temporary gateway timeout');
    (transientError as any).statusCode = 504;

    const fn = jest.fn().mockRejectedValue(transientError);

    await expect(
      withRetry(fn, { maxAttempts: 3, initialDelayMs: 5, jitter: false })
    ).rejects.toThrow('Temporary gateway timeout');

    expect(fn).toHaveBeenCalledTimes(3);
  });
});
