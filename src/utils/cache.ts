import { redisClient, isRedisConnected } from '../config/redis';
import { logger } from '../utils/logger';

/**
 * Default TTL configuration (in seconds) for application domains.
 */
export const CACHE_TTL = {
  DOCTOR_LIST: 120, // 2 minutes for search queries
  DOCTOR_PROFILE: 600, // 10 minutes for public doctor profile
  SLOTS_AVAILABILITY: 60, // 1 minute for doctor available slots
};

/**
 * Cache key generators adhering to a strict, deterministic namespace format.
 * Format: amrutam:<domain>:<identifier>:<filters>
 */
export const CacheKeys = {
  doctorProfile: (doctorId: string) => `amrutam:doctor:profile:${doctorId}`,
  doctorList: (queryHash: string) => `amrutam:doctor:list:${queryHash}`,
  doctorSlots: (doctorId: string, queryHash: string) => `amrutam:slots:${doctorId}:${queryHash}`,
  slotsPatternForDoctor: (doctorId: string) => `amrutam:slots:${doctorId}:*`,
  doctorListPattern: () => `amrutam:doctor:list:*`,
};

/**
 * Production Cache-Aside Manager.
 * All operations are fail-safe: any Redis connection interruption or command failure
 * logs a warning and gracefully resolves to null / bypasses caching, ensuring the API
 * continues operating reliably with direct PostgreSQL queries.
 */
export class CacheService {
  /**
   * Get cached data by key.
   * Returns parsed JSON object or null on cache-miss or Redis unavailability.
   */
  public static async get<T>(key: string): Promise<T | null> {
    if (!redisClient || !isRedisConnected) {
      return null;
    }

    try {
      const cached = await redisClient.get(key);
      if (!cached) {
        return null;
      }
      return JSON.parse(cached) as T;
    } catch (err) {
      logger.warn(`Redis Cache GET failed for key "${key}", falling back to DB:`, {
        error: err instanceof Error ? err.message : err,
      });
      return null;
    }
  }

  /**
   * Set cache with a TTL (in seconds).
   * Fails silently if Redis is down.
   */
  public static async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!redisClient || !isRedisConnected) {
      return;
    }

    try {
      const serialized = JSON.stringify(value);
      await redisClient.setex(key, ttlSeconds, serialized);
    } catch (err) {
      logger.warn(`Redis Cache SET failed for key "${key}":`, {
        error: err instanceof Error ? err.message : err,
      });
    }
  }

  /**
   * Deletes a specific cache key.
   */
  public static async del(key: string): Promise<void> {
    if (!redisClient || !isRedisConnected) {
      return;
    }

    try {
      await redisClient.del(key);
    } catch (err) {
      logger.warn(`Redis Cache DEL failed for key "${key}":`, {
        error: err instanceof Error ? err.message : err,
      });
    }
  }

  /**
   * Invalidates keys matching a pattern (e.g. `amrutam:slots:doc-123:*`).
   * Uses non-blocking SCAN to avoid freezing Redis in production.
   */
  public static async delByPattern(pattern: string): Promise<void> {
    if (!redisClient || !isRedisConnected) {
      return;
    }

    try {
      let cursor = '0';
      do {
        const [nextCursor, keys] = await redisClient.scan(cursor, 'MATCH', pattern, 'COUNT', 50);
        cursor = nextCursor;
        if (keys.length > 0) {
          await redisClient.del(...keys);
        }
      } while (cursor !== '0');
    } catch (err) {
      logger.warn(`Redis Cache DEL pattern failed for "${pattern}":`, {
        error: err instanceof Error ? err.message : err,
      });
    }
  }

  /**
   * Invalidates all cache entries related to a doctor when their profile or status changes:
   * 1. Individual doctor profile cache
   * 2. All doctor directory search result caches
   */
  public static async invalidateDoctorProfile(doctorId: string): Promise<void> {
    await Promise.all([
      this.del(CacheKeys.doctorProfile(doctorId)),
      this.delByPattern(CacheKeys.doctorListPattern()),
    ]);
  }

  /**
   * Invalidates all availability slot caches for a specific doctor when slots are created/cancelled.
   */
  public static async invalidateDoctorSlots(doctorId: string): Promise<void> {
    await this.delByPattern(CacheKeys.slotsPatternForDoctor(doctorId));
  }
}
