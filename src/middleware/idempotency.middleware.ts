import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { prisma } from '../config/database';
import { BadRequestError, ConflictError } from '../utils/errors';
import { logger } from '../utils/logger';

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60; // 24 hours TTL

const SENSITIVE_KEYS = [
  'password',
  'passwordhash',
  'token',
  'accesstoken',
  'refreshtoken',
  'secret',
  'mfasecret',
  'encryptionkey',
  'authorization',
];

/**
 * Deterministically sorts all object keys recursively to ensure payload hash stability.
 */
export function sortKeys(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sortKeys);
  }
  return Object.keys(obj)
    .sort()
    .reduce<Record<string, any>>((acc, key) => {
      acc[key] = sortKeys(obj[key]);
      return acc;
    }, {});
}

/**
 * Strips sensitive credentials and tokens before caching responses.
 */
export function sanitizeResponseBody(data: any): any {
  if (!data || typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map(sanitizeResponseBody);

  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(data)) {
    const lower = k.toLowerCase();
    if (SENSITIVE_KEYS.some((s) => lower.includes(s))) {
      clean[k] = '[REDACTED]';
    } else if (typeof v === 'object' && v !== null) {
      clean[k] = sanitizeResponseBody(v);
    } else {
      clean[k] = v;
    }
  }
  return clean;
}

/**
 * Generates deterministic SHA-256 hash of the request body.
 */
export function hashRequestPayload(body: any): string {
  const sorted = sortKeys(body ?? {});
  return crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}

/**
 * Factory for Idempotency Middleware.
 * Enforces durable PostgreSQL-backed write idempotency on critical endpoints.
 */
export function requireIdempotency(options: { required?: boolean } = { required: true }) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // 1. Extract Idempotency-Key from header
    const rawKey = req.header('Idempotency-Key') || req.header('idempotency-key');

    if (!rawKey || !rawKey.trim()) {
      if (options.required) {
        return next(
          new BadRequestError(
            'Idempotency-Key header is required for this operation. Format: Idempotency-Key: <unique-uuid>'
          )
        );
      }
      return next();
    }

    const idempotencyKey = rawKey.trim();
    const userId = req.user?.id;
    const endpoint = req.originalUrl.split('?')[0];
    const requestHash = hashRequestPayload(req.body);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_SECONDS * 1000);

    try {
      // 2. Check for existing idempotency key in PostgreSQL
      const existing = await prisma.idempotencyKey.findUnique({
        where: { key: idempotencyKey },
      });

      if (existing) {
        // If expired, clean up and allow re-execution
        if (existing.expiresAt <= now) {
          await prisma.idempotencyKey.delete({ where: { key: idempotencyKey } }).catch(() => {});
        } else {
          // Verify user ownership
          if (existing.userId && userId && existing.userId !== userId) {
            throw new ConflictError(
              'This Idempotency-Key has already been used by another account.'
            );
          }

          // Verify endpoint
          if (existing.endpoint !== endpoint) {
            throw new ConflictError(
              'This Idempotency-Key has already been used for a different endpoint.'
            );
          }

          // Verify request payload hash
          if (existing.requestHash !== requestHash) {
            throw new ConflictError(
              'This Idempotency-Key has already been used with a different request payload.'
            );
          }

          // Check if previous request is still in-progress
          if (existing.responseStatus === 0) {
            throw new ConflictError(
              'A request with this Idempotency-Key is currently being processed. Please retry shortly.'
            );
          }

          // Replay cached response
          logger.info(`Replaying cached idempotent response for key: ${idempotencyKey}`);
          res.setHeader('Idempotent-Replay', 'true');
          return res.status(existing.responseStatus).json(existing.responseBody);
        }
      }

      // 3. Insert in-progress record to claim the idempotency key and prevent simultaneous race conditions
      try {
        await prisma.idempotencyKey.create({
          data: {
            key: idempotencyKey,
            userId: userId ?? null,
            endpoint,
            requestHash,
            responseStatus: 0, // 0 denotes IN_PROGRESS
            responseBody: {},
            expiresAt,
          },
        });
      } catch (insertErr: any) {
        // If duplicate key error occurs during concurrent arrival
        if (insertErr.code === 'P2002') {
          throw new ConflictError(
            'A simultaneous request with this Idempotency-Key is already in progress.'
          );
        }
        throw insertErr;
      }

      // 4. Intercept res.json to capture response status and body
      const originalJson = res.json.bind(res);
      let responseSaved = false;

      res.json = function (body: any) {
        if (!responseSaved) {
          responseSaved = true;
          const status = res.statusCode || 200;

          // Only cache successful or legitimate client errors; clean up transient server errors (>= 500)
          if (status < 500) {
            const sanitized = sanitizeResponseBody(body);
            prisma.idempotencyKey
              .update({
                where: { key: idempotencyKey },
                data: {
                  responseStatus: status,
                  responseBody: sanitized,
                },
              })
              .catch((err) => {
                logger.warn('Failed to update idempotency key record after response:', {
                  error: err instanceof Error ? err.message : err,
                  key: idempotencyKey,
                });
              });
          } else {
            // Delete failed 5xx attempt so client can retry safely
            prisma.idempotencyKey
              .delete({ where: { key: idempotencyKey } })
              .catch(() => {});
          }
        }
        return originalJson(body);
      };

      next();
    } catch (err) {
      next(err);
    }
  };
}
