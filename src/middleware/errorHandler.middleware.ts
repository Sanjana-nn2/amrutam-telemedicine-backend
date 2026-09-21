import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import { env } from '../config/env';

interface ErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  correlationId?: string;
  timestamp: string;
}

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const correlationId = req.correlationId;
  let statusCode = 500;
  let errorCode = 'INTERNAL_SERVER_ERROR';
  let message = 'An unexpected internal server error occurred';
  let details: unknown = undefined;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    errorCode = err.constructor.name.replace('Error', '').toUpperCase() || 'APP_ERROR';
    message = err.message;
    details = err.details;
  } else if (err instanceof ZodError) {
    statusCode = 400;
    errorCode = 'VALIDATION_ERROR';
    message = 'Request validation failed';
    details = err.errors.map((e) => ({
      path: e.path.join('.'),
      message: e.message,
    }));
  } else if ('code' in err && typeof (err as { code: unknown }).code === 'string') {
    const prismaErr = err as { code: string; meta?: unknown; message: string };
    if (prismaErr.code === 'P2002') {
      statusCode = 409;
      errorCode = 'UNIQUE_CONSTRAINT_VIOLATION';
      message = 'A resource with this identifier or unique attribute already exists.';
      details = prismaErr.meta;
    } else if (prismaErr.code === 'P2025') {
      statusCode = 404;
      errorCode = 'RECORD_NOT_FOUND';
      message = 'The requested database record does not exist.';
    }
  } else if (err instanceof SyntaxError && 'body' in err) {
    statusCode = 400;
    errorCode = 'MALFORMED_JSON';
    message = 'Invalid JSON payload received';
  }

  logger.error(`[Error Handler] ${errorCode}: ${err.message}`, {
    correlationId,
    statusCode,
    errorCode,
    stack: env.NODE_ENV !== 'production' ? err.stack : undefined,
    path: req.originalUrl,
    method: req.method,
  });

  const responsePayload: ErrorEnvelope = {
    success: false,
    error: {
      code: errorCode,
      message,
      ...(details !== undefined ? { details } : {}),
      ...(env.NODE_ENV !== 'production' && statusCode === 500 ? { debugStack: err.stack } : {}),
    },
    correlationId,
    timestamp: new Date().toISOString(),
  };

  res.status(statusCode).json(responsePayload);
};
