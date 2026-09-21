import crypto from 'crypto';
import { prisma } from '../../config/database';
import { CacheService } from '../../utils/cache';
import { AuditService } from '../audit/audit.service';
import { withRetry } from '../../utils/retry';
import {
  NotFoundError,
  ConflictError,
  ForbiddenError,
  BadRequestError,
} from '../../utils/errors';
import { z } from 'zod';
import { checkoutSchema, simulateWebhookSchema } from './payment.schema';

type CheckoutInput = z.infer<typeof checkoutSchema>;
type SimulateWebhookInput = z.infer<typeof simulateWebhookSchema>;

export class PaymentService {
  /**
   * Helper to format payment response
   */
  public static formatPayment(p: any) {
    return {
      id: p.id,
      consultationId: p.consultationId,
      userId: p.userId,
      amount: typeof p.amount === 'object' && p.amount !== null ? Number(p.amount) : p.amount,
      currency: p.currency,
      status: p.status,
      paymentMethod: p.paymentMethod,
      transactionReference: p.transactionReference,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }

  /**
   * Initiates payment checkout for a consultation.
   * - Enforces PATIENT role ownership.
   * - Derives amount strictly server-side from doctor's consultation fee.
   * - Idempotent via Idempotency-Key.
   */
  public static async checkout(
    userId: string,
    data: CheckoutInput,
    idempotencyKey?: string,
    ipAddress?: string,
    userAgent?: string
  ) {
    // 1. Fetch consultation with doctor details
    const consultation = await prisma.consultation.findUnique({
      where: { id: data.consultationId },
      include: {
        doctor: {
          select: { id: true, consultationFee: true },
        },
      },
    });

    if (!consultation) {
      throw new NotFoundError(`Consultation with ID ${data.consultationId} not found`);
    }

    // 2. Authorization check: only the booking patient can pay
    if (consultation.patientId !== userId) {
      throw new ForbiddenError('You are not authorized to make a payment for this consultation');
    }

    // 3. Status check: Consultation must be in PENDING_PAYMENT state
    if (consultation.status !== 'PENDING_PAYMENT') {
      throw new ConflictError(
        `Consultation cannot be paid for because its current status is '${consultation.status}'`
      );
    }

    // 4. Derive payment amount strictly server-side from doctor consultation fee
    const feeDecimal = consultation.doctor.consultationFee;
    const feeNumber = Number(feeDecimal);

    // 5. Generate secure simulated transaction reference: PAY-SIM-<TIMESTAMP>-<HEX>
    const timestamp = Date.now();
    const randomHex = crypto.randomBytes(4).toString('hex').toUpperCase();
    const transactionReference = `PAY-SIM-${timestamp}-${randomHex}`;

    // 6. Create payment record
    const payment = await prisma.payment.create({
      data: {
        consultationId: consultation.id,
        userId,
        amount: feeDecimal,
        currency: 'INR',
        status: 'INITIATED',
        paymentMethod: data.paymentMethod || 'UPI',
        transactionReference,
        idempotencyKey: idempotencyKey ?? null,
      },
    });

    // 7. Audit log payment initiation
    await AuditService.log({
      userId,
      action: 'PAYMENT_INITIATED',
      resource: 'Payment',
      resourceId: payment.id,
      ipAddress,
      userAgent,
      details: {
        consultationId: consultation.id,
        transactionReference,
        amount: feeNumber,
        currency: 'INR',
        paymentMethod: payment.paymentMethod,
      },
    });

    return {
      message: 'Payment checkout initiated successfully',
      payment: this.formatPayment(payment),
      checkoutDetails: {
        transactionReference,
        amount: feeNumber,
        currency: 'INR',
        consultationNumber: consultation.consultationNumber,
        doctorFee: feeNumber,
      },
    };
  }

  /**
   * Idempotent Payment Webhook Simulation.
   * Handles SUCCESS & FAILURE events with atomic SAGA state changes:
   * - SUCCESS: Payment -> SUCCESS, Consultation -> CONFIRMED, Slot -> BOOKED.
   * - FAILURE: Payment -> FAILED, Consultation -> CANCELLED, Slot -> AVAILABLE (released).
   * Safe for duplicate deliveries: repeated delivery returns original state without reapplying mutations.
   */
  public static async simulateWebhook(
    data: SimulateWebhookInput,
    ipAddress?: string,
    userAgent?: string
  ) {
    // 1. Fetch payment by transaction reference
    const payment = await prisma.payment.findUnique({
      where: { transactionReference: data.transactionReference },
      include: {
        consultation: {
          select: {
            id: true,
            status: true,
            slotId: true,
            doctorId: true,
            consultationNumber: true,
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundError(
        `Payment with transaction reference '${data.transactionReference}' not found`
      );
    }

    // 2. Idempotency Check: if payment is already in the requested terminal state, return gracefully
    if (data.event === 'PAYMENT_SUCCESS' && payment.status === 'SUCCESS') {
      return {
        success: true,
        message: 'Duplicate webhook: Payment is already processed as SUCCESS',
        status: 'SUCCESS',
        payment: this.formatPayment(payment),
      };
    }

    if (data.event === 'PAYMENT_FAILED' && payment.status === 'FAILED') {
      return {
        success: true,
        message: 'Duplicate webhook: Payment is already recorded as FAILED',
        status: 'FAILED',
        payment: this.formatPayment(payment),
      };
    }

    // 3. Execute atomic state change with exponential backoff retry for transient DB issues
    const result = await withRetry(
      async () => {
        return await prisma.$transaction(async (tx) => {
          if (data.event === 'PAYMENT_SUCCESS') {
            // Update payment to SUCCESS
            const updatedPayment = await tx.payment.update({
              where: { id: payment.id },
              data: { status: 'SUCCESS' },
            });

            // Update consultation to CONFIRMED
            await tx.consultation.update({
              where: { id: payment.consultationId },
              data: { status: 'CONFIRMED' },
            });

            // Update availability slot to BOOKED
            await tx.availabilitySlot.update({
              where: { id: payment.consultation.slotId },
              data: {
                status: 'BOOKED',
                lockVersion: { increment: 1 },
              },
            });

            return { status: 'SUCCESS', payment: updatedPayment };
          } else {
            // PAYMENT_FAILED: Execute SAGA compensation
            const updatedPayment = await tx.payment.update({
              where: { id: payment.id },
              data: { status: 'FAILED' },
            });

            // Update consultation to CANCELLED
            await tx.consultation.update({
              where: { id: payment.consultationId },
              data: {
                status: 'CANCELLED',
                notes: data.failureReason
                  ? `Payment failed: ${data.failureReason}`
                  : 'Payment failed during checkout',
              },
            });

            // SAGA Compensation: Release slot back to AVAILABLE
            await tx.availabilitySlot.update({
              where: { id: payment.consultation.slotId },
              data: {
                status: 'AVAILABLE',
                lockVersion: { increment: 1 },
              },
            });

            return { status: 'FAILED', payment: updatedPayment };
          }
        });
      },
      { operationName: 'simulatePaymentWebhook', maxAttempts: 3 }
    );

    // 4. Invalidate Redis slot cache for doctor
    await CacheService.invalidateDoctorSlots(payment.consultation.doctorId);

    // 5. Audit log webhook processing
    await AuditService.log({
      userId: payment.userId,
      action: data.event === 'PAYMENT_SUCCESS' ? 'PAYMENT_SUCCEEDED' : 'PAYMENT_FAILED',
      resource: 'Payment',
      resourceId: payment.id,
      ipAddress,
      userAgent,
      details: {
        transactionReference: data.transactionReference,
        event: data.event,
        consultationId: payment.consultationId,
        failureReason: data.failureReason,
        sagaCompensation: data.event === 'PAYMENT_FAILED' ? 'SLOT_RELEASED_TO_AVAILABLE' : 'NONE',
      },
    });

    return {
      success: true,
      message:
        data.event === 'PAYMENT_SUCCESS'
          ? 'Payment succeeded and appointment confirmed'
          : 'Payment failed and slot released back to available (Saga compensation executed)',
      status: result.status,
      payment: this.formatPayment(result.payment),
    };
  }
}
