import Redis from 'ioredis';
import { env } from './env';
import { logger } from '../utils/logger';

let redisClient: Redis | null = null;
let isRedisConnected = false;

try {
  redisClient = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    retryStrategy(times) {
      if (times > 3) {
        logger.warn('Redis reconnection retries exhausted. Running in degraded cache-disabled mode.');
        return null;
      }
      return Math.min(times * 100, 2000);
    },
    lazyConnect: true,
    enableOfflineQueue: false,
  });

  redisClient.on('connect', () => {
    isRedisConnected = true;
    logger.info('Connected to Redis server');
  });

  redisClient.on('ready', () => {
    isRedisConnected = true;
    logger.info('Redis connection ready');
  });

  redisClient.on('error', (err) => {
    isRedisConnected = false;
    logger.warn(`Redis connection notice (running without cache): ${err.message}`);
  });

  redisClient.on('close', () => {
    isRedisConnected = false;
  });
} catch (err) {
  logger.warn('Could not initialize Redis client instance, running without cache:', err);
}

export const connectRedis = async (): Promise<void> => {
  if (!redisClient) return;
  try {
    await redisClient.connect();
  } catch (err) {
    logger.warn('Could not connect to Redis at startup (optional service). Continuing in cache-fallback mode.');
  }
};

export const disconnectRedis = async (): Promise<void> => {
  if (redisClient && isRedisConnected) {
    try {
      await redisClient.quit();
      logger.info('Redis connection closed cleanly');
    } catch (err) {
      logger.error('Error closing Redis connection:', err);
    }
  }
};

export const checkRedisHealth = async (): Promise<{ status: 'up' | 'down'; latencyMs?: number }> => {
  if (!redisClient) {
    return { status: 'down' };
  }
  try {
    const start = Date.now();
    await redisClient.ping();
    return { status: 'up', latencyMs: Date.now() - start };
  } catch {
    return { status: 'down' };
  }
};

export { redisClient, isRedisConnected };
