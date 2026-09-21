import { prisma } from '../../config/database';
import {
  AnalyticsOverviewQuery,
  AnalyticsUtilizationQuery,
  AuditLogsQuery,
} from './admin.schema';
import { ConsultationStatus, SlotStatus, PaymentStatus } from '@prisma/client';

export class AdminService {
  /**
   * Generates high-level system analytics overview using efficient database aggregations.
   * Prevents N+1 queries and omits patient PII/PHI.
   */
  public static async getAnalyticsOverview(query: AnalyticsOverviewQuery) {
    const dateFilter: Record<string, unknown> = {};

    if (query.startDate || query.endDate) {
      dateFilter.createdAt = {
        ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
        ...(query.endDate ? { lte: new Date(query.endDate) } : {}),
      };
    }

    // 1. Total consultations
    const totalConsultations = await prisma.consultation.count({
      where: dateFilter,
    });

    // 2. Consultation counts grouped by status
    const statusGroups = await prisma.consultation.groupBy({
      by: ['status'],
      where: dateFilter,
      _count: { id: true },
    });

    const consultationCountsByStatus: Record<string, number> = {
      [ConsultationStatus.PENDING_PAYMENT]: 0,
      [ConsultationStatus.CONFIRMED]: 0,
      [ConsultationStatus.IN_PROGRESS]: 0,
      [ConsultationStatus.COMPLETED]: 0,
      [ConsultationStatus.CANCELLED]: 0,
      [ConsultationStatus.NO_SHOW]: 0,
    };

    statusGroups.forEach((group) => {
      consultationCountsByStatus[group.status] = group._count.id;
    });

    const completedConsultations = consultationCountsByStatus[ConsultationStatus.COMPLETED] || 0;

    // 3. Total successful revenue aggregation
    const paymentFilter: Record<string, unknown> = {
      status: PaymentStatus.SUCCESS,
      ...(dateFilter.createdAt ? { createdAt: dateFilter.createdAt } : {}),
    };

    const successfulPayments = await prisma.payment.findMany({
      where: paymentFilter,
      select: { amount: true },
    });

    const totalRevenue = successfulPayments.reduce(
      (sum, p) => sum + parseFloat(p.amount.toString()),
      0
    );

    // 4. Active and verified doctors
    const activeVerifiedDoctors = await prisma.doctor.count({
      where: {
        isVerified: true,
        user: { isActive: true },
      },
    });

    // 5. Slot booking & occupancy rate
    const totalSlots = await prisma.availabilitySlot.count();
    const occupiedSlots = await prisma.availabilitySlot.count({
      where: {
        status: { in: [SlotStatus.BOOKED, SlotStatus.LOCKED] },
      },
    });

    const slotBookingOccupancyRate =
      totalSlots > 0 ? Number(((occupiedSlots / totalSlots) * 100).toFixed(2)) : 0;

    return {
      totalConsultations,
      consultationCountsByStatus,
      completedConsultations,
      totalSuccessfulRevenue: {
        amount: Number(totalRevenue.toFixed(2)),
        currency: 'INR',
      },
      activeVerifiedDoctors,
      slotBookingOccupancy: {
        totalSlots,
        occupiedSlots,
        occupancyRatePercentage: slotBookingOccupancyRate,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Computes doctor utilization, specialization trends, and slot metrics.
   */
  public static async getAnalyticsUtilization(query: AnalyticsUtilizationQuery) {
    const doctorFilter: Record<string, unknown> = {};
    if (query.doctorId) {
      doctorFilter.id = query.doctorId;
    }

    const doctors = await prisma.doctor.findMany({
      where: doctorFilter,
      include: {
        user: {
          select: {
            email: true,
            profile: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        consultations: {
          select: { id: true, status: true, scheduledAt: true },
        },
        availabilitySlots: {
          select: { id: true, status: true },
        },
      },
      take: query.limit,
    });

    const doctorUtilization = doctors.map((doc) => {
      const totalConsultations = doc.consultations.length;
      const completed = doc.consultations.filter(
        (c) => c.status === ConsultationStatus.COMPLETED
      ).length;
      const totalSlots = doc.availabilitySlots.length;
      const bookedSlots = doc.availabilitySlots.filter(
        (s) => s.status === SlotStatus.BOOKED
      ).length;

      const doctorName = doc.user.profile
        ? `${doc.user.profile.firstName} ${doc.user.profile.lastName}`.trim()
        : doc.user.email;

      return {
        doctorId: doc.id,
        doctorName,
        specialization: doc.specialization,
        totalConsultations,
        completedConsultations: completed,
        completionRatePercentage:
          totalConsultations > 0 ? Number(((completed / totalConsultations) * 100).toFixed(2)) : 0,
        totalSlots,
        bookedSlots,
        slotUtilizationRatePercentage:
          totalSlots > 0 ? Number(((bookedSlots / totalSlots) * 100).toFixed(2)) : 0,
      };
    });

    // Specialization aggregation
    const specializationsMap: Record<string, number> = {};
    doctors.forEach((d) => {
      specializationsMap[d.specialization] =
        (specializationsMap[d.specialization] || 0) + d.consultations.length;
    });

    const popularSpecializations = Object.entries(specializationsMap)
      .map(([specialization, consultationCount]) => ({
        specialization,
        consultationCount,
      }))
      .sort((a, b) => b.consultationCount - a.consultationCount);

    // Global slot utilization breakdown
    const slotBreakdown = await prisma.availabilitySlot.groupBy({
      by: ['status'],
      _count: { id: true },
    });

    const slotUtilization: Record<string, number> = {
      [SlotStatus.AVAILABLE]: 0,
      [SlotStatus.LOCKED]: 0,
      [SlotStatus.BOOKED]: 0,
      [SlotStatus.CANCELLED]: 0,
    };

    slotBreakdown.forEach((group) => {
      slotUtilization[group.status] = group._count.id;
    });

    return {
      doctorUtilization,
      popularSpecializations,
      slotUtilization,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Retrieves paginated audit logs for system governance.
   * Strips any sensitive credentials or tokens.
   */
  public static async getAuditLogs(query: AuditLogsQuery) {
    const where: Record<string, unknown> = {};

    if (query.userId) where.userId = query.userId;
    if (query.action) where.action = { contains: query.action, mode: 'insensitive' };
    if (query.resource) where.resource = { contains: query.resource, mode: 'insensitive' };

    if (query.startDate || query.endDate) {
      where.createdAt = {
        ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
        ...(query.endDate ? { lte: new Date(query.endDate) } : {}),
      };
    }

    const skip = (query.page - 1) * query.limit;

    const [total, rawLogs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              role: true,
              profile: {
                select: {
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
        },
      }),
    ]);

    const logs = rawLogs.map((log) => {
      let userName = 'System';
      if (log.user) {
        userName = log.user.profile
          ? `${log.user.profile.firstName} ${log.user.profile.lastName}`.trim()
          : log.user.email;
      }
      return {
        ...log,
        user: log.user
          ? {
              id: log.user.id,
              name: userName,
              email: log.user.email,
              role: log.user.role,
            }
          : null,
      };
    });

    return {
      logs,
      pagination: {
        total,
        page: query.page,
        limit: query.limit,
        totalPages: Math.ceil(total / query.limit) || 1,
      },
    };
  }
}
