import { z } from 'zod';

export const analyticsOverviewQuerySchema = z.object({
  startDate: z.string().datetime({ message: 'startDate must be a valid ISO-8601 date string' }).optional(),
  endDate: z.string().datetime({ message: 'endDate must be a valid ISO-8601 date string' }).optional(),
});

export const analyticsUtilizationQuerySchema = z.object({
  startDate: z.string().datetime({ message: 'startDate must be a valid ISO-8601 date string' }).optional(),
  endDate: z.string().datetime({ message: 'endDate must be a valid ISO-8601 date string' }).optional(),
  doctorId: z.string().uuid('doctorId must be a valid UUID').optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const auditLogsQuerySchema = z.object({
  page: z.coerce.number().int().min(1, 'page must be >= 1').default(1),
  limit: z.coerce.number().int().min(1, 'limit must be >= 1').max(50, 'limit cannot exceed 50').default(20),
  userId: z.string().uuid('userId must be a valid UUID').optional(),
  action: z.string().min(1).max(50).optional(),
  resource: z.string().min(1).max(50).optional(),
  startDate: z.string().datetime({ message: 'startDate must be a valid ISO-8601 date string' }).optional(),
  endDate: z.string().datetime({ message: 'endDate must be a valid ISO-8601 date string' }).optional(),
});

export type AnalyticsOverviewQuery = z.infer<typeof analyticsOverviewQuerySchema>;
export type AnalyticsUtilizationQuery = z.infer<typeof analyticsUtilizationQuerySchema>;
export type AuditLogsQuery = z.infer<typeof auditLogsQuerySchema>;
