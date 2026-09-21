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
import { UserRole, ConsultationStatus } from '@prisma/client';
import { z } from 'zod';
import {
  bookConsultationSchema,
  updateConsultationStatusSchema,
  consultationQuerySchema,
} from './consultation.schema';

type BookConsultationInput = z.infer<typeof bookConsultationSchema>;
type UpdateStatusInput = z.infer<typeof updateConsultationStatusSchema>;
type ConsultationQuery = z.infer<typeof consultationQuerySchema>;

/**
 * Explicit State Transition Matrix governing consultation lifecycles.
 * Maps: currentStatus -> targetStatus -> Allowed UserRoles
 */
export const ALLOWED_TRANSITIONS: Record<
  ConsultationStatus,
  Partial<Record<ConsultationStatus, UserRole[]>>
> = {
  PENDING_PAYMENT: {
    CONFIRMED: [UserRole.ADMIN], // System payment webhook confirms; Admin can override
    CANCELLED: [UserRole.PATIENT, UserRole.ADMIN],
  },
  CONFIRMED: {
    IN_PROGRESS: [UserRole.DOCTOR, UserRole.ADMIN],
    CANCELLED: [UserRole.PATIENT, UserRole.DOCTOR, UserRole.ADMIN],
    NO_SHOW: [UserRole.DOCTOR, UserRole.ADMIN],
  },
  IN_PROGRESS: {
    COMPLETED: [UserRole.DOCTOR, UserRole.ADMIN],
    CANCELLED: [UserRole.DOCTOR, UserRole.ADMIN],
  },
  COMPLETED: {}, // Terminal state
  CANCELLED: {}, // Terminal state
  NO_SHOW: {},   // Terminal state
};

export class ConsultationService {
  /**
   * Public-safe consultation response formatting
   */
  public static formatConsultation(c: any) {
    return {
      id: c.id,
      consultationNumber: c.consultationNumber,
      patientId: c.patientId,
      doctorId: c.doctorId,
      slotId: c.slotId,
      status: c.status,
      chiefComplaint: c.chiefComplaint,
      notes: c.notes,
      meetingLink: c.meetingLink,
      scheduledAt: c.scheduledAt,
      startedAt: c.startedAt,
      endedAt: c.endedAt,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      doctor: c.doctor
        ? {
            id: c.doctor.id,
            specialization: c.doctor.specialization,
            consultationFee:
              typeof c.doctor.consultationFee === 'object' && c.doctor.consultationFee !== null
                ? Number(c.doctor.consultationFee)
                : c.doctor.consultationFee,
            user: c.doctor.user
              ? {
                  firstName: c.doctor.user.profile?.firstName || 'Doctor',
                  lastName: c.doctor.user.profile?.lastName || '',
                  email: c.doctor.user.email,
                }
              : undefined,
          }
        : undefined,
      patient: c.patient
        ? {
            id: c.patient.id,
            firstName: c.patient.profile?.firstName || 'Patient',
            lastName: c.patient.profile?.lastName || '',
            email: c.patient.email,
          }
        : undefined,
      slot: c.slot
        ? {
            id: c.slot.id,
            startTime: c.slot.startTime,
            endTime: c.slot.endTime,
            status: c.slot.status,
          }
        : undefined,
      payments: c.payments
        ? c.payments.map((p: any) => ({
            id: p.id,
            amount: Number(p.amount),
            currency: p.currency,
            status: p.status,
            transactionReference: p.transactionReference,
            createdAt: p.createdAt,
          }))
        : undefined,
    };
  }

  /**
   * Atomic, Concurrency-Safe Appointment Booking.
   * Executed in a PostgreSQL transaction:
   * 1. Validates doctor exists & is verified.
   * 2. Validates slot belongs to doctor, is in future, and is AVAILABLE.
   * 3. Executes atomic conditional update with optimistic lockVersion:
   *    UPDATE availability_slots SET status = 'LOCKED', lock_version = lock_version + 1
   *    WHERE id = slotId AND status = 'AVAILABLE' AND lock_version = currentVersion;
   * 4. Creates exactly ONE consultation with unique consultationNumber in PENDING_PAYMENT state.
   * 5. Database constraint Consultation.slotId UNIQUE guarantees absolute single-slot integrity.
   */
  public static async bookConsultation(
    patientId: string,
    data: BookConsultationInput,
    ipAddress?: string,
    userAgent?: string
  ) {
    const consultation = await prisma.$transaction(
      async (tx) => {
        // 1. Validate doctor exists and is verified
        const doctor = await tx.doctor.findUnique({
          where: { id: data.doctorId },
          include: {
            user: {
              select: {
                id: true,
                isActive: true,
                email: true,
                profile: { select: { firstName: true, lastName: true } },
              },
            },
          },
        });

        if (!doctor) {
          throw new NotFoundError(`Doctor with ID ${data.doctorId} not found`);
        }

        if (!doctor.isVerified) {
          throw new BadRequestError('Doctor is not verified for consultations');
        }

        if (!doctor.user.isActive) {
          throw new BadRequestError('Doctor account is currently inactive');
        }

        // 2. Validate availability slot
        const slot = await tx.availabilitySlot.findUnique({
          where: { id: data.slotId },
        });

        if (!slot) {
          throw new NotFoundError(`Availability slot with ID ${data.slotId} not found`);
        }

        if (slot.doctorId !== data.doctorId) {
          throw new BadRequestError('Slot does not belong to the specified doctor');
        }

        if (slot.status !== 'AVAILABLE') {
          throw new ConflictError(
            `Slot is not available for booking (current status: ${slot.status})`
          );
        }

        const now = new Date();
        if (slot.startTime <= now) {
          throw new BadRequestError('Cannot book an availability slot in the past');
        }

        // 3. Concurrency Protection: Atomic Conditional Update
        // Ensures only ONE concurrent request can successfully change status from AVAILABLE to LOCKED.
        // Row-level locks in PostgreSQL serialize the update statement.
        const updateResult = await tx.availabilitySlot.updateMany({
          where: {
            id: data.slotId,
            doctorId: data.doctorId,
            status: 'AVAILABLE',
            lockVersion: slot.lockVersion,
          },
          data: {
            status: 'LOCKED',
            lockVersion: { increment: 1 },
          },
        });

        if (updateResult.count === 0) {
          throw new ConflictError(
            'Slot booking conflict: The slot was booked or locked by another request concurrently'
          );
        }

        // 4. Generate deterministic, unique consultation reference: CNS-YYYYMMDD-HEX
        const datePrefix = now.toISOString().slice(0, 10).replace(/-/g, '');
        const randomHex = crypto.randomBytes(3).toString('hex').toUpperCase();
        const consultationNumber = `CNS-${datePrefix}-${randomHex}`;

        // 5. Create exactly ONE consultation record in PENDING_PAYMENT state
        const created = await tx.consultation.create({
          data: {
            consultationNumber,
            patientId,
            doctorId: data.doctorId,
            slotId: data.slotId,
            status: 'PENDING_PAYMENT',
            chiefComplaint: data.chiefComplaint,
            scheduledAt: slot.startTime,
          },
          include: {
            doctor: {
              include: {
                user: {
                  select: {
                    id: true,
                    email: true,
                    profile: { select: { firstName: true, lastName: true } },
                  },
                },
              },
            },
            patient: {
              select: {
                id: true,
                email: true,
                profile: { select: { firstName: true, lastName: true } },
              },
            },
            slot: true,
          },
        });

        return created;
      },
      {
        maxWait: 5000,
        timeout: 10000,
      }
    );

    // Invalidate Redis cache for doctor availability
    await CacheService.invalidateDoctorSlots(data.doctorId);

    // Audit log
    await AuditService.log({
      userId: patientId,
      action: 'CONSULTATION_BOOKED',
      resource: 'Consultation',
      resourceId: consultation.id,
      ipAddress,
      userAgent,
      details: {
        consultationNumber: consultation.consultationNumber,
        doctorId: data.doctorId,
        slotId: data.slotId,
        scheduledAt: consultation.scheduledAt,
      },
    });

    return this.formatConsultation(consultation);
  }

  /**
   * Get consultations with strict role-based isolation & pagination.
   */
  public static async getConsultations(
    userId: string,
    userRole: UserRole,
    query: ConsultationQuery
  ) {
    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (query.status) {
      where.status = query.status;
    }

    // Role-based isolation
    if (userRole === UserRole.PATIENT) {
      where.patientId = userId;
    } else if (userRole === UserRole.DOCTOR) {
      // Find doctor profile for this user
      const doctor = await prisma.doctor.findUnique({
        where: { userId },
      });
      if (!doctor) {
        throw new ForbiddenError('Doctor profile not found for this account');
      }
      where.doctorId = doctor.id;
    }
    // ADMIN has unrestricted view across all consultations

    const [total, consultations] = await Promise.all([
      prisma.consultation.count({ where }),
      prisma.consultation.findMany({
        where,
        orderBy: { scheduledAt: 'desc' },
        skip,
        take: limit,
        include: {
          doctor: {
            include: {
              user: {
                select: {
                  id: true,
                  email: true,
                  profile: { select: { firstName: true, lastName: true } },
                },
              },
            },
          },
          patient: {
            select: {
              id: true,
              email: true,
              profile: { select: { firstName: true, lastName: true } },
            },
          },
          slot: true,
          payments: true,
        },
      }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: consultations.map(this.formatConsultation),
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }

  /**
   * Get single consultation by ID with authorization verification.
   * Never exposes consultation data to unrelated users.
   */
  public static async getConsultationById(
    consultationId: string,
    userId: string,
    userRole: UserRole
  ) {
    const consultation = await prisma.consultation.findUnique({
      where: { id: consultationId },
      include: {
        doctor: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                profile: { select: { firstName: true, lastName: true } },
              },
            },
          },
        },
        patient: {
          select: {
            id: true,
            email: true,
            profile: { select: { firstName: true, lastName: true } },
          },
        },
        slot: true,
        payments: true,
      },
    });

    if (!consultation) {
      throw new NotFoundError(`Consultation with ID ${consultationId} not found`);
    }

    // Access authorization check
    if (userRole === UserRole.PATIENT && consultation.patientId !== userId) {
      throw new ForbiddenError('You are not authorized to view this consultation');
    }

    if (userRole === UserRole.DOCTOR) {
      const doctor = await prisma.doctor.findUnique({ where: { userId } });
      if (!doctor || consultation.doctorId !== doctor.id) {
        throw new ForbiddenError('You are not authorized to view this consultation');
      }
    }

    return this.formatConsultation(consultation);
  }

  /**
   * Transition consultation status adhering to the explicit lifecycle matrix.
   * Triggers SAGA compensation (slot release) if cancelled.
   */
  public static async updateStatus(
    consultationId: string,
    userId: string,
    userRole: UserRole,
    data: UpdateStatusInput,
    ipAddress?: string,
    userAgent?: string
  ) {
    const consultation = await prisma.consultation.findUnique({
      where: { id: consultationId },
      include: { slot: true },
    });

    if (!consultation) {
      throw new NotFoundError(`Consultation with ID ${consultationId} not found`);
    }

    // 1. Authorization check
    if (userRole === UserRole.PATIENT && consultation.patientId !== userId) {
      throw new ForbiddenError('You are not authorized to modify this consultation');
    }

    if (userRole === UserRole.DOCTOR) {
      const doctor = await prisma.doctor.findUnique({ where: { userId } });
      if (!doctor || consultation.doctorId !== doctor.id) {
        throw new ForbiddenError('You are not authorized to modify this consultation');
      }
    }

    const currentStatus = consultation.status;
    const targetStatus = data.status;

    // 2. Validate against explicit state transition matrix
    const allowedForCurrent = ALLOWED_TRANSITIONS[currentStatus];
    const allowedRolesForTarget = allowedForCurrent ? allowedForCurrent[targetStatus] : undefined;

    if (!allowedRolesForTarget) {
      throw new ConflictError(
        `Invalid status transition: Cannot change consultation status from '${currentStatus}' to '${targetStatus}'`
      );
    }

    if (!allowedRolesForTarget.includes(userRole)) {
      throw new ForbiddenError(
        `Role '${userRole}' is not permitted to transition consultation from '${currentStatus}' to '${targetStatus}'`
      );
    }

    // 3. Perform atomic update + SAGA compensation if cancelled
    const updatedConsultation = await prisma.$transaction(async (tx) => {
      const updateData: any = {
        status: targetStatus,
        notes: data.notes ?? consultation.notes,
      };

      if (targetStatus === 'IN_PROGRESS' && !consultation.startedAt) {
        updateData.startedAt = new Date();
      }

      if (targetStatus === 'COMPLETED' && !consultation.endedAt) {
        updateData.endedAt = new Date();
      }

      // SAGA Compensation: If transitioning to CANCELLED, release slot back to AVAILABLE
      if (targetStatus === 'CANCELLED') {
        await tx.availabilitySlot.update({
          where: { id: consultation.slotId },
          data: {
            status: 'AVAILABLE',
            lockVersion: { increment: 1 },
          },
        });
      }

      const updated = await tx.consultation.update({
        where: { id: consultationId },
        data: updateData,
        include: {
          doctor: {
            include: {
              user: {
                select: {
                  id: true,
                  email: true,
                  profile: { select: { firstName: true, lastName: true } },
                },
              },
            },
          },
          patient: {
            select: {
              id: true,
              email: true,
              profile: { select: { firstName: true, lastName: true } },
            },
          },
          slot: true,
          payments: true,
        },
      });

      return updated;
    });

    // Invalidate slot cache if slot was released
    if (targetStatus === 'CANCELLED') {
      await CacheService.invalidateDoctorSlots(consultation.doctorId);
    }

    // Audit log
    await AuditService.log({
      userId,
      action: 'CONSULTATION_STATUS_UPDATED',
      resource: 'Consultation',
      resourceId: consultationId,
      ipAddress,
      userAgent,
      details: {
        previousStatus: currentStatus,
        newStatus: targetStatus,
        reason: data.reason,
      },
    });

    return this.formatConsultation(updatedConsultation);
  }

  /**
   * SAGA / Stale Lock Release Background Handler:
   * Releases stale locked slots whose booking was not completed with payment within the timeout window.
   */
  public static async releaseStaleSlotLocks(staleMinutes: number = 15): Promise<number> {
    const threshold = new Date(Date.now() - staleMinutes * 60 * 1000);

    return await withRetry(
      async () => {
        // Find consultations that remain PENDING_PAYMENT past timeout
        const staleConsultations = await prisma.consultation.findMany({
          where: {
            status: 'PENDING_PAYMENT',
            createdAt: { lte: threshold },
          },
          select: { id: true, slotId: true, doctorId: true },
        });

        if (staleConsultations.length === 0) {
          return 0;
        }

        await prisma.$transaction(async (tx) => {
          for (const c of staleConsultations) {
            // Cancel consultation
            await tx.consultation.update({
              where: { id: c.id },
              data: {
                status: 'CANCELLED',
                notes: 'Cancelled automatically due to payment timeout (stale lock release)',
              },
            });

            // Release slot back to AVAILABLE
            await tx.availabilitySlot.update({
              where: { id: c.slotId },
              data: {
                status: 'AVAILABLE',
                lockVersion: { increment: 1 },
              },
            });
          }
        });

        // Invalidate caches
        const uniqueDoctorIds = Array.from(new Set(staleConsultations.map((c) => c.doctorId)));
        await Promise.all(uniqueDoctorIds.map((docId) => CacheService.invalidateDoctorSlots(docId)));

        return staleConsultations.length;
      },
      { operationName: 'releaseStaleSlotLocks', maxAttempts: 3 }
    );
  }
}
