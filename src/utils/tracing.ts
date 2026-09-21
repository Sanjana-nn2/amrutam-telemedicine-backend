import { Request } from 'express';
import crypto from 'crypto';
import { logger } from './logger';

export interface TraceContext {
  traceId: string;
  spanId: string;
  correlationId: string;
  sampled: boolean;
}

/**
 * Extracts or generates OpenTelemetry-compatible W3C TraceContext headers.
 * Supports W3C standard `traceparent` (version-traceid-parentid-traceflags).
 */
export const extractTraceContext = (req: Request): TraceContext => {
  const correlationId = (req.header('x-correlation-id') || req.correlationId || crypto.randomUUID()) as string;
  const traceparent = req.header('traceparent');

  let traceId = '';
  let spanId = '';
  let sampled = true;

  if (traceparent) {
    const parts = traceparent.trim().split('-');
    if (parts.length === 4 && parts[0] === '00' && parts[1].length === 32 && parts[2].length === 16) {
      traceId = parts[1];
      spanId = parts[2];
      sampled = parts[3] === '01';
    }
  }

  if (!traceId) {
    // Generate new 16-byte (32-hex) trace ID and 8-byte (16-hex) span ID
    traceId = crypto.randomBytes(16).toString('hex');
    spanId = crypto.randomBytes(8).toString('hex');
  }

  return {
    traceId,
    spanId,
    correlationId,
    sampled,
  };
};

/**
 * Executes an operation within a traced boundary and logs structured trace data.
 * When OpenTelemetry Node SDK is enabled in production via @opentelemetry/sdk-node,
 * this can seamlessly forward to the active OpenTelemetry tracer.
 */
export const traceSpan = async <T>(
  spanName: string,
  attributes: Record<string, unknown>,
  operation: () => Promise<T>
): Promise<T> => {
  const spanId = crypto.randomBytes(8).toString('hex');
  const startTime = Date.now();

  try {
    const result = await operation();
    const durationMs = Date.now() - startTime;

    logger.debug(`[TraceSpan] ${spanName} succeeded`, {
      spanId,
      durationMs,
      attributes,
    });

    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    logger.error(`[TraceSpan] ${spanName} failed`, {
      spanId,
      durationMs,
      attributes,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
};
