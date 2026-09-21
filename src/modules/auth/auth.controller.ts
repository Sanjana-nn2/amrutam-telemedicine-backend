import { Request, Response, NextFunction } from 'express';
import { AuthService } from './auth.service';

export class AuthController {
  public static async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await AuthService.register(req.body, req.ip, req.headers['user-agent']);
      res.status(201).json({
        success: true,
        ...result,
        correlationId: req.correlationId,
      });
    } catch (error) {
      next(error);
    }
  }

  public static async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await AuthService.login(req.body, req.ip, req.headers['user-agent']);
      res.status(200).json({
        success: true,
        ...result,
        correlationId: req.correlationId,
      });
    } catch (error) {
      next(error);
    }
  }

  public static async refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { refreshToken } = req.body;
      const result = await AuthService.refresh(refreshToken, req.ip, req.headers['user-agent']);
      res.status(200).json({
        success: true,
        message: 'Tokens refreshed successfully',
        ...result,
        correlationId: req.correlationId,
      });
    } catch (error) {
      next(error);
    }
  }

  public static async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { refreshToken } = req.body;
      const result = await AuthService.logout(
        refreshToken,
        req.user?.id,
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

  public static async mfaSetup(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const result = await AuthService.mfaSetup(userId);
      res.status(200).json({
        success: true,
        ...result,
        correlationId: req.correlationId,
      });
    } catch (error) {
      next(error);
    }
  }

  public static async mfaVerify(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const { token } = req.body;
      const result = await AuthService.mfaVerify(userId, token);
      res.status(200).json({
        ...result,
        correlationId: req.correlationId,
      });
    } catch (error) {
      next(error);
    }
  }

  public static async mfaValidate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { mfaToken, token } = req.body;
      const result = await AuthService.mfaValidate(
        mfaToken,
        token,
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
