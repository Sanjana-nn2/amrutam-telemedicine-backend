import { AdminService } from '../../src/modules/admin/admin.service';
import {
  analyticsOverviewQuerySchema,
  analyticsUtilizationQuerySchema,
  auditLogsQuerySchema,
} from '../../src/modules/admin/admin.schema';
import { prisma } from '../../src/config/database';

jest.mock('../../src/config/database', () => ({
  prisma: {
    consultation: {
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    payment: {
      findMany: jest.fn(),
    },
    doctor: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    availabilitySlot: {
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    auditLog: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

describe('Phase 5: Admin Analytics & Governance Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Validation Schemas', () => {
    it('should validate overview query parameters with valid dates', () => {
      const parsed = analyticsOverviewQuerySchema.parse({
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-01-31T23:59:59.000Z',
      });
      expect(parsed.startDate).toBe('2026-01-01T00:00:00.000Z');
    });

    it('should reject invalid ISO date formats in query', () => {
      expect(() =>
        analyticsOverviewQuerySchema.parse({
          startDate: 'not-a-date',
        })
      ).toThrow();
    });

    it('should enforce pagination bounds in audit logs schema', () => {
      const parsed = auditLogsQuerySchema.parse({
        page: 2,
        limit: 25,
        action: 'CONSULTATION_BOOKED',
      });
      expect(parsed.page).toBe(2);
      expect(parsed.limit).toBe(25);

      // limit cannot exceed 50
      expect(() => auditLogsQuerySchema.parse({ limit: 100 })).toThrow();
      // page cannot be < 1
      expect(() => auditLogsQuerySchema.parse({ page: 0 })).toThrow();
    });
  });

  describe('Admin Analytics Overview Aggregation', () => {
    it('should compute overview KPIs accurately from database aggregations', async () => {
      (prisma.consultation.count as jest.Mock).mockResolvedValue(50);
      (prisma.consultation.groupBy as jest.Mock).mockResolvedValue([
        { status: 'COMPLETED', _count: { id: 30 } },
        { status: 'CONFIRMED', _count: { id: 10 } },
        { status: 'CANCELLED', _count: { id: 5 } },
        { status: 'PENDING_PAYMENT', _count: { id: 5 } },
      ]);
      (prisma.payment.findMany as jest.Mock).mockResolvedValue([
        { amount: '750.00' },
        { amount: '500.00' },
        { amount: '1000.00' },
      ]);
      (prisma.doctor.count as jest.Mock).mockResolvedValue(12);
      (prisma.availabilitySlot.count as jest.Mock)
        .mockResolvedValueOnce(100) // totalSlots
        .mockResolvedValueOnce(40); // occupiedSlots

      const overview = await AdminService.getAnalyticsOverview({});

      expect(overview.totalConsultations).toBe(50);
      expect(overview.completedConsultations).toBe(30);
      expect(overview.consultationCountsByStatus.COMPLETED).toBe(30);
      expect(overview.consultationCountsByStatus.CONFIRMED).toBe(10);
      expect(overview.totalSuccessfulRevenue.amount).toBe(2250.00);
      expect(overview.activeVerifiedDoctors).toBe(12);
      expect(overview.slotBookingOccupancy.totalSlots).toBe(100);
      expect(overview.slotBookingOccupancy.occupiedSlots).toBe(40);
      expect(overview.slotBookingOccupancy.occupancyRatePercentage).toBe(40);
    });
  });

  describe('Doctor & Slot Utilization Metrics', () => {
    it('should calculate doctor utilization rates and popular specializations without N+1 queries', async () => {
      (prisma.doctor.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'doc-1',
          specialization: 'Kayachikitsa',
          user: { name: 'Dr. Sharma', email: 'doc1@example.com' },
          consultations: [
            { id: 'c1', status: 'COMPLETED' },
            { id: 'c2', status: 'COMPLETED' },
            { id: 'c3', status: 'CANCELLED' },
          ],
          availabilitySlots: [
            { id: 's1', status: 'BOOKED' },
            { id: 's2', status: 'BOOKED' },
            { id: 's3', status: 'AVAILABLE' },
            { id: 's4', status: 'AVAILABLE' },
          ],
        },
      ]);

      (prisma.availabilitySlot.groupBy as jest.Mock).mockResolvedValue([
        { status: 'AVAILABLE', _count: { id: 50 } },
        { status: 'BOOKED', _count: { id: 30 } },
        { status: 'LOCKED', _count: { id: 10 } },
        { status: 'CANCELLED', _count: { id: 10 } },
      ]);

      const utilization = await AdminService.getAnalyticsUtilization({ limit: 10 });

      expect(utilization.doctorUtilization).toHaveLength(1);
      const docStat = utilization.doctorUtilization[0];
      expect(docStat.totalConsultations).toBe(3);
      expect(docStat.completedConsultations).toBe(2);
      expect(docStat.completionRatePercentage).toBe(66.67);
      expect(docStat.totalSlots).toBe(4);
      expect(docStat.bookedSlots).toBe(2);
      expect(docStat.slotUtilizationRatePercentage).toBe(50);

      expect(utilization.popularSpecializations).toEqual([
        { specialization: 'Kayachikitsa', consultationCount: 3 },
      ]);
      expect(utilization.slotUtilization.AVAILABLE).toBe(50);
      expect(utilization.slotUtilization.BOOKED).toBe(30);
    });
  });

  describe('Admin Audit Log Query', () => {
    it('should return paginated audit logs with search filters', async () => {
      (prisma.auditLog.count as jest.Mock).mockResolvedValue(45);
      (prisma.auditLog.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'log-1',
          action: 'CONSULTATION_BOOKED',
          resource: 'consultation',
          userId: 'user-1',
          createdAt: new Date(),
          user: { id: 'user-1', name: 'Patient', email: 'p@example.com', role: 'PATIENT' },
        },
      ]);

      const res = await AdminService.getAuditLogs({
        page: 1,
        limit: 10,
        action: 'BOOKED',
      });

      expect(res.pagination.total).toBe(45);
      expect(res.pagination.totalPages).toBe(5);
      expect(res.logs).toHaveLength(1);
      expect(res.logs[0].action).toBe('CONSULTATION_BOOKED');
    });
  });
});
