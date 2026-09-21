import { prisma } from '../../config/database';
import { CacheService, CacheKeys, CACHE_TTL } from '../../utils/cache';
import { AuditService } from '../audit/audit.service';
import {
  NotFoundError,
  ConflictError,
  ForbiddenError,
  BadRequestError,
} from '../../utils/errors';
import { z } from 'zod';
import {
  createSlotsSchema,
  doctorSlotsQuerySchema,
} from './availability.schema';
import crypto from 'crypto';

type CreateSlotsInput = z.infer<typeof createSlotsSchema>;
type DoctorSlotsQuery = z.infer<typeof doctorSlotsQuerySchema>;

export class AvailabilityService {
  /**
   * Helper to format public-safe slot.
   */
  public static formatSlot(slot: any) {
    return {
      id: slot.id,
      doctorId: slot.doctorId,
      startTime: slot.startTime,
      endTime: slot.endTime,
      status: slot.status,
      createdAt: slot.createdAt,
    };
  }

  /**
   * Batch create availability slots for the authenticated doctor.
   * Ensures:
   * 1. User has an active, verified doctor profile.
   * 2. Overlap check against existing database slots:
   *    (existing.startTime < new.endTime AND existing.endTime > new.startTime)
   * 3. Executes atomically in a transaction.
   * 4. Invalidates Redis availability cache for this doctor.
   * 5. Audit logs slot creation.
   */
  public static async createSlots(
    userId: string,
    data: CreateSlotsInput,
    ipAddress?: string,
    userAgent?: string
  ) {
    // 1. Fetch doctor profile for this user
    const doctor = await prisma.doctor.findUnique({
      where: { userId },
    });

    if (!doctor) {
      throw new ForbiddenError('Only registered doctors can manage availability slots');
    }

    const doctorId = doctor.id;
    const now = new Date();

    // 2. Validate all submitted slots are in the future
    for (const slot of data.slots) {
      const start = new Date(slot.startTime);
      if (start.getTime() <= now.getTime()) {
        throw new BadRequestError(`Slot start time ${slot.startTime} cannot be in the past`);
      }
    }

    // 3. Find bounding time range of proposed batch for efficient querying
    const startTimes = data.slots.map((s) => new Date(s.startTime).getTime());
    const endTimes = data.slots.map((s) => new Date(s.endTime).getTime());
    const minBatchStart = new Date(Math.min(...startTimes));
    const maxBatchEnd = new Date(Math.max(...endTimes));

    // 4. Perform atomic transaction: fetch active existing slots in bounding box and verify overlaps
    const createdSlots = await prisma.$transaction(async (tx) => {
      // Query existing non-cancelled slots for this doctor that could potentially overlap
      const candidateSlots = await tx.availabilitySlot.findMany({
        where: {
          doctorId,
          status: {
            in: ['AVAILABLE', 'LOCKED', 'BOOKED'],
          },
          startTime: {
            lt: maxBatchEnd,
          },
          endTime: {
            gt: minBatchStart,
          },
        },
      });

      // Strict interval overlap check for each proposed slot:
      // Overlap occurs IF AND ONLY IF:
      // existing.startTime < new.endTime AND existing.endTime > new.startTime
      for (const newSlot of data.slots) {
        const newStart = new Date(newSlot.startTime);
        const newEnd = new Date(newSlot.endTime);

        const overlapping = candidateSlots.find((existing) => {
          return existing.startTime < newEnd && existing.endTime > newStart;
        });

        if (overlapping) {
          throw new ConflictError(
            `Slot interval [${newSlot.startTime} - ${newSlot.endTime}] overlaps with existing slot [${overlapping.startTime.toISOString()} - ${overlapping.endTime.toISOString()}] (Status: ${overlapping.status})`
          );
        }
      }

      // No overlaps detected - insert all slots in batch
      const slotsToCreate = data.slots.map((s) => ({
        doctorId,
        startTime: new Date(s.startTime),
        endTime: new Date(s.endTime),
        status: 'AVAILABLE' as const,
      }));

      // Create slots
      await tx.availabilitySlot.createMany({
        data: slotsToCreate,
      });

      // Fetch created slots to return
      return await tx.availabilitySlot.findMany({
        where: {
          doctorId,
          startTime: { in: slotsToCreate.map((s) => s.startTime) },
          status: 'AVAILABLE',
        },
        orderBy: { startTime: 'asc' },
      });
    });

    // 5. Invalidate doctor availability cache in Redis
    await CacheService.invalidateDoctorSlots(doctorId);

    // 6. Audit log
    await AuditService.log({
      userId,
      action: 'AVAILABILITY_SLOTS_CREATED',
      resource: 'AvailabilitySlot',
      ipAddress,
      userAgent,
      details: {
        doctorId,
        slotsCount: createdSlots.length,
        timeRange: { minStart: minBatchStart, maxEnd: maxBatchEnd },
      },
    });

    return createdSlots.map(AvailabilityService.formatSlot);
  }

  /**
   * Get available future slots for a doctor with date range filtering and Redis caching.
   */
  public static async getDoctorSlots(doctorId: string, query: DoctorSlotsQuery) {
    // 1. Verify doctor exists
    const doctor = await prisma.doctor.findUnique({
      where: { id: doctorId },
      select: { id: true, isVerified: true },
    });

    if (!doctor) {
      throw new NotFoundError(`Doctor with ID ${doctorId} not found`);
    }

    // Normalized query hash for deterministic Redis cache key
    const normalizedQuery = {
      sDate: query.startDate || '',
      eDate: query.endDate || '',
      page: query.page,
      limit: query.limit,
    };
    const queryHash = crypto.createHash('sha256').update(JSON.stringify(normalizedQuery)).digest('hex');
    const cacheKey = CacheKeys.doctorSlots(doctorId, queryHash);

    // 2. Try Redis cache
    const cached = await CacheService.get<{
      data: ReturnType<typeof AvailabilityService.formatSlot>[];
      pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
        hasNext: boolean;
        hasPrev: boolean;
      };
    }>(cacheKey);

    if (cached) {
      return cached;
    }

    // 3. Build Prisma where clause
    const now = new Date();
    const where: any = {
      doctorId,
      status: 'AVAILABLE',
      startTime: {
        gt: now, // Must be strictly in the future
      },
    };

    if (query.startDate) {
      const s = new Date(query.startDate);
      // Ensure we don't query slots earlier than now even if startDate is in past
      where.startTime.gte = s > now ? s : now;
    }

    if (query.endDate) {
      const e = new Date(query.endDate);
      where.endTime = {
        lte: e,
      };
    }

    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;

    const [total, slots] = await Promise.all([
      prisma.availabilitySlot.count({ where }),
      prisma.availabilitySlot.findMany({
        where,
        orderBy: { startTime: 'asc' },
        skip,
        take: limit,
      }),
    ]);

    const totalPages = Math.ceil(total / limit);
    const result = {
      data: slots.map(AvailabilityService.formatSlot),
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };

    // 4. Set Redis cache (TTL: 60s)
    await CacheService.set(cacheKey, result, CACHE_TTL.SLOTS_AVAILABILITY);

    return result;
  }

  /**
   * Cancel an availability slot.
   * Ensures:
   * 1. Doctor owns the slot.
   * 2. Only unbooked / unlocked (AVAILABLE) slots can be cancelled.
   * 3. Soft-cancels by marking status = CANCELLED (preserves historical traceability).
   * 4. Invalidates Redis availability cache for this doctor.
   * 5. Audit logs cancellation.
   */
  public static async cancelSlot(
    slotId: string,
    userId: string,
    ipAddress?: string,
    userAgent?: string
  ) {
    // 1. Check doctor profile for this user
    const doctor = await prisma.doctor.findUnique({
      where: { userId },
    });

    if (!doctor) {
      throw new ForbiddenError('Only registered doctors can cancel availability slots');
    }

    // 2. Fetch slot
    const slot = await prisma.availabilitySlot.findUnique({
      where: { id: slotId },
    });

    if (!slot) {
      throw new NotFoundError(`Availability slot with ID ${slotId} not found`);
    }

    // 3. Ownership check
    if (slot.doctorId !== doctor.id) {
      throw new ForbiddenError('You are not authorized to cancel a slot that belongs to another doctor');
    }

    // 4. Status check: Only AVAILABLE slots can be cancelled
    if (slot.status === 'CANCELLED') {
      throw new BadRequestError('This slot is already cancelled');
    }

    if (slot.status === 'BOOKED') {
      throw new BadRequestError('Cannot cancel a slot that is already booked for a consultation. Please initiate appointment cancellation.');
    }

    if (slot.status === 'LOCKED') {
      throw new BadRequestError('Cannot cancel a slot that is currently locked in an active booking session');
    }

    // 5. Update status to CANCELLED
    const updatedSlot = await prisma.availabilitySlot.update({
      where: { id: slotId },
      data: { status: 'CANCELLED' },
    });

    // 6. Invalidate doctor availability cache
    await CacheService.invalidateDoctorSlots(doctor.id);

    // 7. Audit log
    await AuditService.log({
      userId,
      action: 'AVAILABILITY_SLOT_CANCELLED',
      resource: 'AvailabilitySlot',
      resourceId: slotId,
      ipAddress,
      userAgent,
      details: {
        doctorId: doctor.id,
        startTime: slot.startTime,
        endTime: slot.endTime,
      },
    });

    return {
      message: 'Availability slot cancelled successfully',
      slot: AvailabilityService.formatSlot(updatedSlot),
    };
  }
}
