import { Request, Response, NextFunction } from 'express';
import {
  httpRequestsTotal,
  httpRequestDurationSeconds,
  normalizeRoute,
} from '../modules/observability/metrics';

/**
 * Express middleware to record Prometheus metrics for incoming HTTP requests.
 * Tracks total requests and request durations with normalized path labels.
 */
export const metricsMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  // Do not track the /metrics endpoint itself to avoid recursion
  if (req.path === '/metrics') {
    return next();
  }

  const startTime = process.hrtime();

  res.on('finish', () => {
    const diff = process.hrtime(startTime);
    const durationSeconds = diff[0] + diff[1] / 1e9;

    // Use req.route?.path if available, otherwise normalize req.originalUrl/path
    const route = req.route ? `${req.baseUrl || ''}${req.route.path}` : normalizeRoute(req.originalUrl || req.path);
    const method = req.method;
    const statusCode = res.statusCode.toString();

    // Increment request count
    httpRequestsTotal.inc({
      method,
      route,
      status_code: statusCode,
    });

    // Observe duration
    httpRequestDurationSeconds.observe(
      {
        method,
        route,
        status_code: statusCode,
      },
      durationSeconds
    );
  });

  next();
};
