import { prisma } from '../../config/database';
import { logger } from '../../utils/logger';

export interface AuditLogParams {
  userId?: string | null;
  action: string;
  resource: string;
  resourceId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  details?: Record<string, unknown> | null;
}

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
  'cookie',
];

/**
 * Recursively strips sensitive fields from details metadata.
 */
const sanitizeDetails = (obj: unknown): unknown => {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(sanitizeDetails);
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (SENSITIVE_KEYS.some((sensitive) => lower.includes(sensitive))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeDetails(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
};

export class AuditService {
  /**
   * Logs a security or state-changing action to the audit_logs table.
   * Runs safely in the background without blocking the primary HTTP response.
   */
  public static async log(params: AuditLogParams): Promise<void> {
    try {
      const sanitizedDetails = params.details ? (sanitizeDetails(params.details) as any) : undefined;

      await prisma.auditLog.create({
        data: {
          userId: params.userId ?? null,
          action: params.action,
          resource: params.resource,
          resourceId: params.resourceId ?? null,
          ipAddress: params.ipAddress ?? null,
          userAgent: params.userAgent ?? null,
          details: sanitizedDetails ?? undefined,
        },
      });

      logger.info(`[AUDIT] ${params.action} on ${params.resource}${params.resourceId ? `:${params.resourceId}` : ''}`, {
        userId: params.userId,
        action: params.action,
        resource: params.resource,
      });
    } catch (error) {
      // Never crash the primary request if audit logging fails (e.g. database network hiccup)
      logger.error('Failed to write audit log entry to database:', {
        action: params.action,
        resource: params.resource,
        error: error instanceof Error ? error.message : error,
      });
    }
  }
}
