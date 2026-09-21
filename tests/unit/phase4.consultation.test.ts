import {
  ConsultationService,
  ALLOWED_TRANSITIONS,
} from '../../src/modules/consultations/consultation.service';
import { PaymentService } from '../../src/modules/payments/payment.service';
import {
  bookConsultationSchema,
  updateConsultationStatusSchema,
} from '../../src/modules/consultations/consultation.schema';
import { checkoutSchema } from '../../src/modules/payments/payment.schema';
import { prisma } from '../../src/config/database';
import { UserRole, ConsultationStatus } from '@prisma/client';
import {
  NotFoundError,
  ConflictError,
  ForbiddenError,
  BadRequestError,
} from '../../src/utils/errors';

jest.mock('../../src/config/database', () => ({
  prisma: {
    $transaction: jest.fn(),
    doctor: {
      findUnique: jest.fn(),
    },
    availabilitySlot: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    consultation: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    payment: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  },
}));

jest.mock('../../src/utils/cache', () => ({
  CacheService: {
    invalidateDoctorSlots: jest.fn().mockResolvedValue(true),
  },
}));

describe('Phase 4: Consultation Booking, Lifecycle & Payment Saga Unit Tests', () => {
  const mockDoctorId = '11111111-1111-4111-8111-111111111111';
  const mockSlotId = '22222222-2222-4222-8222-222222222222';
  const mockPatientId = '33333333-3333-4333-8333-333333333333';
  const mockConsultationId = '44444444-4444-4444-8444-444444444444';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('A. Booking Validation Schema', () => {
    it('should validate complete and correct booking input', () => {
      const valid = bookConsultationSchema.parse({
        doctorId: mockDoctorId,
        slotId: mockSlotId,
        chiefComplaint: 'Severe migraine and fever for 3 days',
      });
      expect(valid.doctorId).toBe(mockDoctorId);
      expect(valid.slotId).toBe(mockSlotId);
    });

    it('should reject invalid UUIDs and short complaints', () => {
      expect(() =>
        bookConsultationSchema.parse({
          doctorId: 'not-a-uuid',
          slotId: mockSlotId,
          chiefComplaint: 'head',
        })
      ).toThrow();
    });
  });

  describe('C. Booking Unavailable Slot & D. Wrong Doctor Slot', () => {
    it('should reject booking if slot does not belong to the doctor', async () => {
      (prisma.$transaction as jest.Mock).mockImplementation(async (callback) => {
        const tx = {
          doctor: {
            findUnique: jest.fn().mockResolvedValue({
              id: mockDoctorId,
              isVerified: true,
              user: { isActive: true },
            }),
          },
          availabilitySlot: {
            findUnique: jest.fn().mockResolvedValue({
              id: mockSlotId,
              doctorId: 'another-doctor-id',
              status: 'AVAILABLE',
              startTime: new Date(Date.now() + 86400000),
            }),
          },
        };
        return await callback(tx);
      });

      await expect(
        ConsultationService.bookConsultation(mockPatientId, {
          doctorId: mockDoctorId,
          slotId: mockSlotId,
          chiefComplaint: 'Ayurvedic consultation',
        })
      ).rejects.toThrow('Slot does not belong to the specified doctor');
    });

    it('should reject booking if slot status is not AVAILABLE', async () => {
      (prisma.$transaction as jest.Mock).mockImplementation(async (callback) => {
        const tx = {
          doctor: {
            findUnique: jest.fn().mockResolvedValue({
              id: mockDoctorId,
              isVerified: true,
              user: { isActive: true },
            }),
          },
          availabilitySlot: {
            findUnique: jest.fn().mockResolvedValue({
              id: mockSlotId,
              doctorId: mockDoctorId,
              status: 'BOOKED',
              startTime: new Date(Date.now() + 86400000),
            }),
          },
        };
        return await callback(tx);
      });

      await expect(
        ConsultationService.bookConsultation(mockPatientId, {
          doctorId: mockDoctorId,
          slotId: mockSlotId,
          chiefComplaint: 'Ayurvedic consultation',
        })
      ).rejects.toThrow('Slot is not available for booking');
    });
  });

  describe('E. Consultation Lifecycle Transitions & Matrix Rules', () => {
    it('should allow valid transitions according to ALLOWED_TRANSITIONS', () => {
      // PENDING_PAYMENT -> CONFIRMED (ADMIN)
      expect(ALLOWED_TRANSITIONS.PENDING_PAYMENT.CONFIRMED).toContain(UserRole.ADMIN);
      // PENDING_PAYMENT -> CANCELLED (PATIENT, ADMIN)
      expect(ALLOWED_TRANSITIONS.PENDING_PAYMENT.CANCELLED).toContain(UserRole.PATIENT);
      // CONFIRMED -> IN_PROGRESS (DOCTOR, ADMIN)
      expect(ALLOWED_TRANSITIONS.CONFIRMED.IN_PROGRESS).toContain(UserRole.DOCTOR);
      // IN_PROGRESS -> COMPLETED (DOCTOR, ADMIN)
      expect(ALLOWED_TRANSITIONS.IN_PROGRESS.COMPLETED).toContain(UserRole.DOCTOR);
    });

    it('should reject invalid lifecycle transitions with ConflictError', async () => {
      (prisma.consultation.findUnique as jest.Mock).mockResolvedValue({
        id: mockConsultationId,
        status: ConsultationStatus.COMPLETED,
        patientId: mockPatientId,
        doctorId: mockDoctorId,
        slotId: mockSlotId,
      });

      await expect(
        ConsultationService.updateStatus(
          mockConsultationId,
          mockPatientId,
          UserRole.ADMIN,
          { status: ConsultationStatus.IN_PROGRESS }
        )
      ).rejects.toThrow(ConflictError);
    });

    it('should reject transitions by unauthorized roles with ForbiddenError', async () => {
      (prisma.consultation.findUnique as jest.Mock).mockResolvedValue({
        id: mockConsultationId,
        status: ConsultationStatus.CONFIRMED,
        patientId: mockPatientId,
        doctorId: mockDoctorId,
        slotId: mockSlotId,
      });

      // Patient cannot mark consultation IN_PROGRESS
      await expect(
        ConsultationService.updateStatus(
          mockConsultationId,
          mockPatientId,
          UserRole.PATIENT,
          { status: ConsultationStatus.IN_PROGRESS }
        )
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('F. Consultation Access Control', () => {
    it('should prevent unrelated patient from accessing consultation details', async () => {
      (prisma.consultation.findUnique as jest.Mock).mockResolvedValue({
        id: mockConsultationId,
        patientId: mockPatientId,
        doctorId: mockDoctorId,
      });

      await expect(
        ConsultationService.getConsultationById(
          mockConsultationId,
          'unrelated-patient-999',
          UserRole.PATIENT
        )
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('G. Server-Side Payment Fee Calculation & Checkout', () => {
    it('should derive payment amount strictly from doctor consultation fee', async () => {
      const mockFee = '750.00';
      (prisma.consultation.findUnique as jest.Mock).mockResolvedValue({
        id: mockConsultationId,
        patientId: mockPatientId,
        status: 'PENDING_PAYMENT',
        consultationNumber: 'CNS-2026-001',
        doctor: {
          id: mockDoctorId,
          consultationFee: mockFee,
        },
      });

      (prisma.payment.create as jest.Mock).mockImplementation(({ data }) => ({
        id: 'pay-123',
        ...data,
      }));

      const result = await PaymentService.checkout(
        mockPatientId,
        { consultationId: mockConsultationId, paymentMethod: 'UPI' }
      );

      expect(result.checkoutDetails.amount).toBe(750);
      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amount: mockFee,
            status: 'INITIATED',
          }),
        })
      );
    });
  });

  describe('H & I. Payment Webhook Success & Failure SAGA Compensation', () => {
    it('H. PAYMENT_SUCCESS: transitions payment->SUCCESS, consultation->CONFIRMED, slot->BOOKED', async () => {
      (prisma.payment.findUnique as jest.Mock).mockResolvedValue({
        id: 'pay-1',
        transactionReference: 'PAY-SIM-123',
        status: 'INITIATED',
        consultationId: mockConsultationId,
        consultation: {
          id: mockConsultationId,
          status: 'PENDING_PAYMENT',
          slotId: mockSlotId,
          doctorId: mockDoctorId,
        },
      });

      (prisma.$transaction as jest.Mock).mockImplementation(async (callback) => {
        const tx = {
          payment: { update: jest.fn().mockResolvedValue({ id: 'pay-1', status: 'SUCCESS' }) },
          consultation: { update: jest.fn().mockResolvedValue({ id: mockConsultationId, status: 'CONFIRMED' }) },
          availabilitySlot: { update: jest.fn().mockResolvedValue({ id: mockSlotId, status: 'BOOKED' }) },
        };
        return await callback(tx);
      });

      const res = await PaymentService.simulateWebhook({
        transactionReference: 'PAY-SIM-123',
        event: 'PAYMENT_SUCCESS',
      });

      expect(res.status).toBe('SUCCESS');
      expect(res.message).toContain('Payment succeeded');
    });

    it('I. PAYMENT_FAILED: transitions payment->FAILED, consultation->CANCELLED, slot->AVAILABLE (SAGA release)', async () => {
      (prisma.payment.findUnique as jest.Mock).mockResolvedValue({
        id: 'pay-2',
        transactionReference: 'PAY-SIM-456',
        status: 'INITIATED',
        consultationId: mockConsultationId,
        consultation: {
          id: mockConsultationId,
          status: 'PENDING_PAYMENT',
          slotId: mockSlotId,
          doctorId: mockDoctorId,
        },
      });

      (prisma.$transaction as jest.Mock).mockImplementation(async (callback) => {
        const tx = {
          payment: { update: jest.fn().mockResolvedValue({ id: 'pay-2', status: 'FAILED' }) },
          consultation: { update: jest.fn().mockResolvedValue({ id: mockConsultationId, status: 'CANCELLED' }) },
          availabilitySlot: { update: jest.fn().mockResolvedValue({ id: mockSlotId, status: 'AVAILABLE' }) },
        };
        return await callback(tx);
      });

      const res = await PaymentService.simulateWebhook({
        transactionReference: 'PAY-SIM-456',
        event: 'PAYMENT_FAILED',
        failureReason: 'Insufficient funds in bank account',
      });

      expect(res.status).toBe('FAILED');
      expect(res.message).toContain('slot released back to available');
    });

    it('J. Duplicate webhook delivery returns existing state idempotently', async () => {
      (prisma.payment.findUnique as jest.Mock).mockResolvedValue({
        id: 'pay-3',
        transactionReference: 'PAY-SIM-789',
        status: 'SUCCESS',
        amount: '500.00',
        currency: 'INR',
        consultation: {
          id: mockConsultationId,
          status: 'CONFIRMED',
          slotId: mockSlotId,
          doctorId: mockDoctorId,
        },
      });

      const res = await PaymentService.simulateWebhook({
        transactionReference: 'PAY-SIM-789',
        event: 'PAYMENT_SUCCESS',
      });

      expect(res.message).toContain('Duplicate webhook: Payment is already processed as SUCCESS');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('N. Concurrency Protection Mechanism (10 Concurrent Calls)', () => {
    it('should allow exactly 1 request to succeed and reject 9 with ConflictError when count=0', async () => {
      let attempts = 0;

      // Simulate atomic conditional update: only the first call updates 1 row; subsequent 9 calls update 0 rows
      const atomicUpdateSimulation = jest.fn().mockImplementation(() => {
        attempts++;
        if (attempts === 1) {
          return Promise.resolve({ count: 1 });
        }
        return Promise.resolve({ count: 0 });
      });

      (prisma.$transaction as jest.Mock).mockImplementation(async (callback) => {
        const tx = {
          doctor: {
            findUnique: jest.fn().mockResolvedValue({
              id: mockDoctorId,
              isVerified: true,
              user: { isActive: true },
            }),
          },
          availabilitySlot: {
            findUnique: jest.fn().mockResolvedValue({
              id: mockSlotId,
              doctorId: mockDoctorId,
              status: 'AVAILABLE',
              lockVersion: 0,
              startTime: new Date(Date.now() + 86400000),
            }),
            updateMany: atomicUpdateSimulation,
          },
          consultation: {
            create: jest.fn().mockResolvedValue({
              id: 'cns-unique',
              consultationNumber: 'CNS-2026-001',
              status: 'PENDING_PAYMENT',
              patientId: mockPatientId,
              doctorId: mockDoctorId,
              slotId: mockSlotId,
              scheduledAt: new Date(),
            }),
          },
        };
        return await callback(tx);
      });

      // Launch 10 simultaneous booking attempts against the SAME slot
      const promises = Array.from({ length: 10 }).map((_, i) =>
        ConsultationService.bookConsultation(`patient-${i}`, {
          doctorId: mockDoctorId,
          slotId: mockSlotId,
          chiefComplaint: `Booking attempt ${i}`,
        })
          .then((res) => ({ status: 'fulfilled', value: res }))
          .catch((err) => ({ status: 'rejected', reason: err }))
      );

      const results = await Promise.all(promises);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(9);
      rejected.forEach((r: any) => {
        expect(r.reason).toBeInstanceOf(ConflictError);
        expect(r.reason.message).toContain('Slot booking conflict');
      });
    });
  });
});
