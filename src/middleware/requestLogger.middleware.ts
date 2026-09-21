import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import { normalizeRoute } from '../modules/observability/metrics';

declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
      startTime?: number;
    }
  }
}

export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const correlationId = (req.headers['x-correlation-id'] as string) || uuidv4();
  req.correlationId = correlationId;
  req.startTime = Date.now();

  res.setHeader('X-Correlation-ID', correlationId);

  res.on('finish', () => {
    const duration = req.startTime ? Date.now() - req.startTime : 0;
    const logData = {
      correlationId,
      method: req.method,
      url: req.originalUrl,
      normalizedPath: normalizeRoute(req.originalUrl || req.path),
      status: res.statusCode,
      durationMs: duration,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    };

    if (res.statusCode >= 500) {
      logger.error(`HTTP Request failed with ${res.statusCode}`, logData);
    } else if (res.statusCode >= 400) {
      logger.warn(`HTTP Client error ${res.statusCode}`, logData);
    } else {
      logger.http(`HTTP ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`, logData);
    }
  });

  next();
};
