import { Request, Response, NextFunction } from 'express';
import { PaymentService } from './payment.service';

export class PaymentController {
  /**
   * POST /api/v1/payments/checkout
   * Initiates payment checkout (PATIENT only, requires Idempotency-Key)
   */
  public static async checkout(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const idempotencyKey = req.header('Idempotency-Key') || undefined;

      const result = await PaymentService.checkout(
        userId,
        req.body,
        idempotencyKey,
        req.ip,
        req.get('user-agent')
      );

      res.status(201).json({
        success: true,
        ...result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/payments/simulate-webhook
   * Simulates payment gateway webhook (SUCCESS / FAILURE) with SAGA compensation
   */
  public static async simulateWebhook(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await PaymentService.simulateWebhook(
        req.body,
        req.ip,
        req.get('user-agent')
      );

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}
