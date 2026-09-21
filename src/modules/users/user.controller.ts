import { Request, Response, NextFunction } from 'express';
import { UserService } from './user.service';

export class UserController {
  public static async getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await UserService.getMe(req.user!.id);
      res.status(200).json({
        success: true,
        data: result,
        correlationId: req.correlationId,
      });
    } catch (error) {
      next(error);
    }
  }

  public static async updateProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await UserService.updateProfile(
        req.user!.id,
        req.body,
        req.ip,
        req.headers['user-agent']
      );
      res.status(200).json({
        success: true,
        ...result,
        correlationId: req.correlationId,
      });
    } catch (error) {
      next(error);
    }
  }

  public static async getUserById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const result = await UserService.getUserById(id, req.user!.id);
      res.status(200).json({
        success: true,
        data: result,
        correlationId: req.correlationId,
      });
    } catch (error) {
      next(error);
    }
  }

  public static async updateUserStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { isActive } = req.body;
      const result = await UserService.updateUserStatus(
        id,
        isActive,
        req.user!.id,
        req.ip,
        req.headers['user-agent']
      );
      res.status(200).json({
        success: true,
        ...result,
        correlationId: req.correlationId,
      });
    } catch (error) {
      next(error);
    }
  }
}
