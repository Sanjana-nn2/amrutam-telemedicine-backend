import { PrescriptionService } from '../../src/modules/prescriptions/prescription.service';
import { createPrescriptionSchema } from '../../src/modules/prescriptions/prescription.schema';
import { prisma } from '../../src/config/database';
import { UserRole, ConsultationStatus } from '@prisma/client';
import {
  ForbiddenError,
  ConflictError,
  NotFoundError,
  BadRequestError,
} from '../../src/utils/errors';
import { encrypt, decrypt } from '../../src/utils/encryption';

jest.mock('../../src/config/database', () => ({
  prisma: {
    doctor: {
      findUnique: jest.fn(),
    },
    consultation: {
      findUnique: jest.fn(),
    },
    prescription: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  },
}));

jest.mock('../../src/utils/asyncJob', () => ({
  jobQueue: {
    enqueue: jest.fn().mockResolvedValue('job-123'),
  },
  JobTypes: {
    NOTIFICATION_PRESCRIPTION_ISSUED: 'NOTIFICATION_PRESCRIPTION_ISSUED',
  },
}));

describe('Phase 5: Prescription Management Unit Tests', () => {
  const doctorUserId = '11111111-1111-4111-8111-111111111111';
  const doctorId = '22222222-2222-4222-8222-222222222222';
  const patientUserId = '33333333-3333-4333-8333-333333333333';
  const otherPatientUserId = '44444444-4444-4444-8444-444444444444';
  const consultationId = '55555555-5555-4555-8555-555555555555';
  const prescriptionId = '66666666-6666-4666-8666-666666666666';

  const validPrescriptionInput = {
    consultationId,
    diagnosis: 'Pitta-Kapha vitiation leading to acid peptic disease',
    medications: [
      {
        name: 'Avipattikar Churna',
        dosage: '3g',
        frequency: 'Twice daily before meals',
        duration: '15 days',
        instructions: 'Take with warm water or honey',
      },
      {
        name: 'Kamadudha Rasa',
        dosage: '250mg',
        frequency: 'Once daily in the morning',
        duration: '15 days',
      },
    ],
    lifestyleAdvice: 'Avoid sour, spicy, and deep-fried foods. Drink plenty of tender coconut water.',
    followUpDate: new Date(Date.now() + 7 * 86400000).toISOString(),
    digitalSignature: 'DIGISIGN-DOC-AYUSH-2026-001',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Validation Schema', () => {
    it('should successfully validate valid prescription payload', () => {
      const parsed = createPrescriptionSchema.parse(validPrescriptionInput);
      expect(parsed.consultationId).toBe(consultationId);
      expect(parsed.medications).toHaveLength(2);
    });

    it('should reject payload with empty medications array', () => {
      expect(() =>
        createPrescriptionSchema.parse({
          ...validPrescriptionInput,
          medications: [],
        })
      ).toThrow();
    });

    it('should reject payload with invalid consultationId format', () => {
      expect(() =>
        createPrescriptionSchema.parse({
          ...validPrescriptionInput,
          consultationId: 'not-a-uuid',
        })
      ).toThrow();
    });

    it('should reject payload with short diagnosis', () => {
      expect(() =>
        createPrescriptionSchema.parse({
          ...validPrescriptionInput,
          diagnosis: 'ab',
        })
      ).toThrow();
    });
  });

  describe('Prescription Creation Authorization & Clinical State', () => {
    it('should allow assigned doctor to create prescription for own COMPLETED consultation', async () => {
      (prisma.doctor.findUnique as jest.Mock).mockResolvedValue({
        id: doctorId,
        isVerified: true,
        user: { isActive: true },
      });

      (prisma.consultation.findUnique as jest.Mock).mockResolvedValue({
        id: consultationId,
        doctorId,
        patientId: patientUserId,
        status: ConsultationStatus.COMPLETED,
        prescription: null,
      });

      (prisma.prescription.create as jest.Mock).mockImplementation(({ data }) => ({
        id: prescriptionId,
        ...data,
        doctor: {
          id: doctorId,
          specialization: 'Ayurveda',
          licenseNumber: 'LIC-1234',
          user: { email: 'sharma@amrutam.co.in', profile: { firstName: 'Dr.', lastName: 'Sharma' } },
        },
        patient: {
          id: patientUserId,
          email: 'patient@example.com',
          profile: { firstName: 'Patient', lastName: 'Name' },
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      const result = await PrescriptionService.createPrescription(
        doctorUserId,
        validPrescriptionInput
      );

      expect(result.id).toBe(prescriptionId);
      expect(result.diagnosis).toBe(validPrescriptionInput.diagnosis);
      expect(result.medications).toHaveLength(2);
      expect(prisma.prescription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            consultationId,
            doctorId,
            patientId: patientUserId,
            // Diagnosis must be stored encrypted (AES-256-GCM format iv:tag:cipher)
            diagnosis: expect.stringMatching(/^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$/i),
          }),
        })
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'PRESCRIPTION_CREATED',
            resource: 'prescription',
          }),
        })
      );
    });

    it('should allow assigned doctor to create prescription for IN_PROGRESS consultation', async () => {
      (prisma.doctor.findUnique as jest.Mock).mockResolvedValue({
        id: doctorId,
        isVerified: true,
        user: { isActive: true },
      });

      (prisma.consultation.findUnique as jest.Mock).mockResolvedValue({
        id: consultationId,
        doctorId,
        patientId: patientUserId,
        status: ConsultationStatus.IN_PROGRESS,
        prescription: null,
      });

      (prisma.prescription.create as jest.Mock).mockImplementation(({ data }) => ({
        id: prescriptionId,
        ...data,
        doctor: {
          id: doctorId,
          specialization: 'Ayurveda',
          licenseNumber: 'LIC-1234',
          user: { email: 'sharma@amrutam.co.in', profile: { firstName: 'Dr.', lastName: 'Sharma' } },
        },
        patient: { id: patientUserId, email: 'patient@example.com', profile: { firstName: 'Patient', lastName: 'Name' } },
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      const result = await PrescriptionService.createPrescription(
        doctorUserId,
        validPrescriptionInput
      );
      expect(result.id).toBe(prescriptionId);
    });

    it('should reject unrelated doctor with ForbiddenError', async () => {
      (prisma.doctor.findUnique as jest.Mock).mockResolvedValue({
        id: doctorId,
        isVerified: true,
        user: { isActive: true },
      });

      (prisma.consultation.findUnique as jest.Mock).mockResolvedValue({
        id: consultationId,
        doctorId: 'different-doctor-id', // Consultation assigned to someone else
        patientId: patientUserId,
        status: ConsultationStatus.COMPLETED,
        prescription: null,
      });

      await expect(
        PrescriptionService.createPrescription(doctorUserId, validPrescriptionInput)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should reject if consultation is in inappropriate clinical state (e.g. PENDING_PAYMENT)', async () => {
      (prisma.doctor.findUnique as jest.Mock).mockResolvedValue({
        id: doctorId,
        isVerified: true,
        user: { isActive: true },
      });

      (prisma.consultation.findUnique as jest.Mock).mockResolvedValue({
        id: consultationId,
        doctorId,
        patientId: patientUserId,
        status: ConsultationStatus.PENDING_PAYMENT,
        prescription: null,
      });

      await expect(
        PrescriptionService.createPrescription(doctorUserId, validPrescriptionInput)
      ).rejects.toThrow(BadRequestError);
    });

    it('should reject duplicate prescription for the same consultation with ConflictError', async () => {
      (prisma.doctor.findUnique as jest.Mock).mockResolvedValue({
        id: doctorId,
        isVerified: true,
        user: { isActive: true },
      });

      (prisma.consultation.findUnique as jest.Mock).mockResolvedValue({
        id: consultationId,
        doctorId,
        patientId: patientUserId,
        status: ConsultationStatus.COMPLETED,
        prescription: { id: 'existing-prescription-id' }, // Already exists!
      });

      await expect(
        PrescriptionService.createPrescription(doctorUserId, validPrescriptionInput)
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('Prescription Retrieval & PHI Access Control', () => {
    const rawDiagnosis = 'Deep Pitta imbalance';
    const encryptedDiag = encrypt(rawDiagnosis);
    const encryptedMeds = encrypt(JSON.stringify([{ name: 'Neem', dosage: '500mg' }]));

    const mockStoredPrescription = {
      id: prescriptionId,
      consultationId,
      doctorId,
      patientId: patientUserId,
      diagnosis: encryptedDiag,
      medications: { encrypted: encryptedMeds },
      lifestyleAdvice: null,
      followUpDate: null,
      digitalSignature: 'SIG-123',
      createdAt: new Date(),
      updatedAt: new Date(),
      doctor: {
        id: doctorId,
        userId: doctorUserId,
        specialization: 'Ayurveda',
        licenseNumber: 'LIC-1',
        user: { email: 'sharma@amrutam.co.in', profile: { firstName: 'Dr.', lastName: 'Sharma' } },
      },
      patient: {
        id: patientUserId,
        email: 'patient@example.com',
        profile: { firstName: 'Patient', lastName: 'Name' },
      },
      consultation: {
        id: consultationId,
        consultationNumber: 'CNS-001',
        status: 'COMPLETED',
        scheduledAt: new Date(),
      },
    };

    it('should allow patient owner to view their own decrypted prescription', async () => {
      (prisma.prescription.findUnique as jest.Mock).mockResolvedValue(mockStoredPrescription);

      const result = await PrescriptionService.getPrescriptionById(
        prescriptionId,
        patientUserId,
        UserRole.PATIENT
      );

      expect(result.id).toBe(prescriptionId);
      expect(result.diagnosis).toBe(rawDiagnosis);
      expect(result.medications).toEqual([{ name: 'Neem', dosage: '500mg' }]);
    });

    it('should allow assigned doctor to view prescription', async () => {
      (prisma.prescription.findUnique as jest.Mock).mockResolvedValue(mockStoredPrescription);

      const result = await PrescriptionService.getPrescriptionById(
        prescriptionId,
        doctorUserId,
        UserRole.DOCTOR
      );

      expect(result.id).toBe(prescriptionId);
      expect(result.diagnosis).toBe(rawDiagnosis);
    });

    it('should allow ADMIN to view prescription for governance audit', async () => {
      (prisma.prescription.findUnique as jest.Mock).mockResolvedValue(mockStoredPrescription);

      const result = await PrescriptionService.getPrescriptionById(
        prescriptionId,
        'admin-user-id',
        UserRole.ADMIN
      );

      expect(result.id).toBe(prescriptionId);
      expect(result.diagnosis).toBe(rawDiagnosis);
    });

    it('should reject unauthorized patient attempting to view another patient prescription with ForbiddenError', async () => {
      (prisma.prescription.findUnique as jest.Mock).mockResolvedValue(mockStoredPrescription);

      await expect(
        PrescriptionService.getPrescriptionById(
          prescriptionId,
          otherPatientUserId,
          UserRole.PATIENT
        )
      ).rejects.toThrow(ForbiddenError);
    });
  });
});
