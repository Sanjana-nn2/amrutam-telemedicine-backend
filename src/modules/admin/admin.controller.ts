import { Request, Response, NextFunction } from 'express';
import { AdminService } from './admin.service';
import {
  AnalyticsOverviewQuery,
  AnalyticsUtilizationQuery,
  AuditLogsQuery,
} from './admin.schema';

export class AdminController {
  public static getOverview = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const overview = await AdminService.getAnalyticsOverview(
        req.query as unknown as AnalyticsOverviewQuery
      );

      res.status(200).json({
        success: true,
        data: overview,
      });
    } catch (error) {
      next(error);
    }
  };

  public static getUtilization = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const utilization = await AdminService.getAnalyticsUtilization(
        req.query as unknown as AnalyticsUtilizationQuery
      );

      res.status(200).json({
        success: true,
        data: utilization,
      });
    } catch (error) {
      next(error);
    }
  };

  public static getAuditLogs = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const auditLogs = await AdminService.getAuditLogs(
        req.query as unknown as AuditLogsQuery
      );

      res.status(200).json({
        success: true,
        data: auditLogs.logs,
        pagination: auditLogs.pagination,
      });
    } catch (error) {
      next(error);
    }
  };
}
