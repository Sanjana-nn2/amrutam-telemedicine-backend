import client from 'prom-client';
import { prisma } from '../../config/database';
import { redisClient } from '../../config/redis';

// Create a custom Prometheus registry
export const register = new client.Registry();

// Enable collection of default Node.js runtime metrics
client.collectDefaultMetrics({
  register,
  prefix: 'amrutam_node_',
});

/**
 * Total HTTP Requests Counter
 * High-cardinality labels (IDs, tokens, emails) are strictly avoided.
 */
export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests received by the application',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

/**
 * HTTP Request Duration Histogram
 * Suitable for measuring p50, p95, p99 latency distributions.
 */
export const httpRequestDurationSeconds = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

/**
 * Database Connection Health Status Gauge
 * 1 = connected/healthy, 0 = degraded/disconnected
 */
export const dbConnectionGauge = new client.Gauge({
  name: 'amrutam_db_connection_status',
  help: 'PostgreSQL database connection status (1 = healthy, 0 = degraded)',
  registers: [register],
});

/**
 * Redis Connection Health Status Gauge
 * 1 = connected/healthy, 0 = degraded/disconnected
 */
export const redisConnectionGauge = new client.Gauge({
  name: 'amrutam_redis_connection_status',
  help: 'Redis cache connection status (1 = healthy, 0 = degraded)',
  registers: [register],
});

/**
 * Active Consultations Gauge by Status
 */
export const activeConsultationsGauge = new client.Gauge({
  name: 'amrutam_active_consultations_total',
  help: 'Number of active consultations by status',
  labelNames: ['status'],
  registers: [register],
});

/**
 * Normalizes HTTP route path to prevent high-cardinality metric label explosion.
 * Replaces UUIDs and numerical IDs with `:id`.
 */
export const normalizeRoute = (rawPath: string): string => {
  if (!rawPath || rawPath === '/') return '/';

  // Strip query parameters
  const pathWithoutQuery = rawPath.split('?')[0];

  return pathWithoutQuery
    // Replace standard UUID v4/v5 patterns with :id
    .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, ':id')
    // Replace hex references or IDs like CNS-20260921-1234 or PAY-SIM-1234
    .replace(/(CNS|PAY-SIM)-[A-Za-z0-9-]+/g, ':id')
    // Replace numeric segments
    .replace(/\/\d+(\/|$)/g, '/:id$1')
    // Remove trailing slash if not root
    .replace(/\/+$/, '') || '/';
};

/**
 * Updates dynamic health gauges on metric scrape
 */
export const updateHealthGauges = async (): Promise<void> => {
  // Check Database
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbConnectionGauge.set(1);
  } catch {
    dbConnectionGauge.set(0);
  }

  // Check Redis
  try {
    if (redisClient && redisClient.status === 'ready') {
      redisConnectionGauge.set(1);
    } else {
      redisConnectionGauge.set(0);
    }
  } catch {
    redisConnectionGauge.set(0);
  }
};
