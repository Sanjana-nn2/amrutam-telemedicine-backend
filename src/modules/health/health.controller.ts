import { Request, Response } from 'express';
import { prisma } from '../../config/database';
import { checkRedisHealth } from '../../config/redis';

export class HealthController {
  public static async live(req: Request, res: Response): Promise<void> {
    res.status(200).json({
      status: 'UP',
      uptimeSeconds: process.uptime(),
      timestamp: new Date().toISOString(),
      correlationId: req.correlationId,
    });
  }

  public static async ready(req: Request, res: Response): Promise<void> {
    const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};

    // 1. Check PostgreSQL
    const dbStart = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = {
        status: 'UP',
        latencyMs: Date.now() - dbStart,
      };
    } catch (err) {
      checks.database = {
        status: 'DOWN',
        latencyMs: Date.now() - dbStart,
        error: err instanceof Error ? err.message : 'Database check failed',
      };
    }

    // 2. Check Redis
    const redisHealth = await checkRedisHealth();
    checks.redis = {
      status: redisHealth.status === 'up' ? 'UP' : 'DEGRADED',
      latencyMs: redisHealth.latencyMs,
      ...(redisHealth.status !== 'up' ? { notice: 'Redis offline - in-memory fallback active' } : {}),
    };

    const isDatabaseReady = checks.database.status === 'UP';
    // If database is up, server is ready (Redis is an optional cache layer)
    const overallStatus = isDatabaseReady ? 'READY' : 'NOT_READY';
    const statusCode = isDatabaseReady ? 200 : 503;

    res.status(statusCode).json({
      status: overallStatus,
      timestamp: new Date().toISOString(),
      correlationId: req.correlationId,
      checks,
    });
  }
}
