import { Router } from 'express';
import { PaymentController } from './payment.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/rbac.middleware';
import { requireIdempotency } from '../../middleware/idempotency.middleware';
import { validate } from '../../middleware/validate.middleware';
import { UserRole } from '@prisma/client';
import { checkoutSchema, simulateWebhookSchema } from './payment.schema';

const router = Router();

/**
 * Initiate checkout (PATIENT only, requires Idempotency-Key)
 */
router.post(
  '/checkout',
  authenticate,
  requireRole(UserRole.PATIENT),
  requireIdempotency({ required: true }),
  validate(checkoutSchema, 'body'),
  PaymentController.checkout
);

/**
 * Simulate payment gateway webhook callback (Idempotent SAGA state updates)
 */
router.post(
  '/simulate-webhook',
  validate(simulateWebhookSchema, 'body'),
  PaymentController.simulateWebhook
);

export default router;
