import { Router } from 'express';
import { AdminController } from './admin.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/rbac.middleware';
import { validateQuery } from '../../middleware/validate.middleware';
import {
  analyticsOverviewQuerySchema,
  analyticsUtilizationQuerySchema,
  auditLogsQuerySchema,
} from './admin.schema';
import { UserRole } from '@prisma/client';

const router = Router();

// All admin routes strictly enforce authentication and ADMIN role
router.use(authenticate, requireRole([UserRole.ADMIN]));

/**
 * GET /api/v1/admin/analytics/overview
 * System-wide KPIs and aggregate consultation / financial metrics
 */
router.get(
  '/analytics/overview',
  validateQuery(analyticsOverviewQuerySchema),
  AdminController.getOverview
);

/**
 * GET /api/v1/admin/analytics/utilization
 * Doctor utilization and specialization distribution metrics
 */
router.get(
  '/analytics/utilization',
  validateQuery(analyticsUtilizationQuerySchema),
  AdminController.getUtilization
);

/**
 * GET /api/v1/admin/audit-logs
 * Paginated governance audit trail
 */
router.get(
  '/audit-logs',
  validateQuery(auditLogsQuerySchema),
  AdminController.getAuditLogs
);

export default router;
