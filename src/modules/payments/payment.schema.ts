import { z } from 'zod';

export const checkoutSchema = z.object({
  consultationId: z.string().uuid('Invalid consultation ID format (must be UUID)'),
  paymentMethod: z
    .enum(['UPI', 'CARD', 'NETBANKING', 'WALLET'])
    .optional()
    .default('UPI'),
});

export const simulateWebhookSchema = z.object({
  transactionReference: z
    .string({ required_error: 'transactionReference is required' })
    .trim()
    .min(5, 'transactionReference must be at least 5 characters'),
  event: z.enum(['PAYMENT_SUCCESS', 'PAYMENT_FAILED'], {
    required_error: 'event must be either PAYMENT_SUCCESS or PAYMENT_FAILED',
  }),
  failureReason: z
    .string()
    .trim()
    .max(500, 'failureReason cannot exceed 500 characters')
    .optional(),
});

export const paymentIdParamSchema = z.object({
  id: z.string().uuid('Invalid payment ID format (must be UUID)'),
});
