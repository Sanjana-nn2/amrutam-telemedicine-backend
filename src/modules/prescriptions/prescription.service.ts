import { prisma } from '../../config/database';
import { CreatePrescriptionInput, MedicationItem } from './prescription.schema';
import { NotFoundError, ConflictError, ForbiddenError, BadRequestError } from '../../utils/errors';
import { encrypt, decrypt } from '../../utils/encryption';
import { jobQueue, JobTypes } from '../../utils/asyncJob';
import { UserRole, ConsultationStatus } from '@prisma/client';

const formatUserName = (user: {
  email: string;
  profile?: { firstName: string; lastName: string } | null;
}) => {
  if (user.profile) {
    return `${user.profile.firstName} ${user.profile.lastName}`.trim();
  }
  return user.email;
};

export class PrescriptionService {
  /**
   * Creates a medical prescription for a completed or in-progress consultation.
   * DOCTOR role only, restricted to the doctor assigned to the consultation.
   * Encrypts sensitive fields (diagnosis, medications, lifestyle advice) at rest using AES-256-GCM.
   */
  public static async createPrescription(
    userId: string,
    data: CreatePrescriptionInput
  ) {
    // 1. Identify the doctor's profile
    const doctor = await prisma.doctor.findUnique({
      where: { userId },
      select: { id: true, isVerified: true, user: { select: { isActive: true } } },
    });

    if (!doctor) {
      throw new ForbiddenError('Doctor profile not found for the authenticated user');
    }

    if (!doctor.isVerified || !doctor.user.isActive) {
      throw new ForbiddenError('Doctor account is unverified or inactive');
    }

    // 2. Fetch consultation and verify status and ownership
    const consultation = await prisma.consultation.findUnique({
      where: { id: data.consultationId },
      include: { prescription: { select: { id: true } } },
    });

    if (!consultation) {
      throw new NotFoundError('Consultation not found');
    }

    if (consultation.doctorId !== doctor.id) {
      throw new ForbiddenError('You are not authorized to issue a prescription for another doctor\'s consultation');
    }

    // Allowed clinical states: IN_PROGRESS or COMPLETED
    if (
      consultation.status !== ConsultationStatus.IN_PROGRESS &&
      consultation.status !== ConsultationStatus.COMPLETED
    ) {
      throw new BadRequestError(
        `Prescription can only be issued for consultations in IN_PROGRESS or COMPLETED state. Current state: ${consultation.status}`
      );
    }

    if (consultation.prescription) {
      throw new ConflictError('A prescription has already been issued for this consultation');
    }

    // 3. Encrypt sensitive PHI fields using AES-256-GCM
    const encryptedDiagnosis = encrypt(data.diagnosis);
    const encryptedLifestyleAdvice = data.lifestyleAdvice ? encrypt(data.lifestyleAdvice) : null;
    const encryptedMedications = encrypt(JSON.stringify(data.medications));

    // 4. Persist prescription in database
    const prescription = await prisma.prescription.create({
      data: {
        consultationId: data.consultationId,
        doctorId: doctor.id,
        patientId: consultation.patientId,
        diagnosis: encryptedDiagnosis,
        medications: { encrypted: encryptedMedications },
        lifestyleAdvice: encryptedLifestyleAdvice,
        followUpDate: data.followUpDate ? new Date(data.followUpDate) : null,
        digitalSignature: data.digitalSignature,
      },
      include: {
        doctor: {
          select: {
            id: true,
            specialization: true,
            licenseNumber: true,
            user: {
              select: {
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
      },
    });

    // 5. Create audit log without logging sensitive PHI
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'PRESCRIPTION_CREATED',
        resource: 'prescription',
        resourceId: prescription.id,
        details: {
          consultationId: data.consultationId,
          medicationCount: data.medications.length,
          hasFollowUp: !!data.followUpDate,
        },
      },
    });

    // 6. Enqueue asynchronous prescription notification job
    await jobQueue.enqueue(JobTypes.NOTIFICATION_PRESCRIPTION_ISSUED, {
      consultationId: data.consultationId,
      prescriptionId: prescription.id,
    });

    return {
      id: prescription.id,
      consultationId: prescription.consultationId,
      doctorId: prescription.doctorId,
      patientId: prescription.patientId,
      doctor: {
        id: prescription.doctor.id,
        name: formatUserName(prescription.doctor.user),
        specialization: prescription.doctor.specialization,
        licenseNumber: prescription.doctor.licenseNumber,
      },
      patient: {
        id: prescription.patient.id,
        name: formatUserName(prescription.patient),
        email: prescription.patient.email,
      },
      diagnosis: data.diagnosis,
      medications: data.medications,
      lifestyleAdvice: data.lifestyleAdvice || null,
      followUpDate: prescription.followUpDate,
      digitalSignature: prescription.digitalSignature,
      createdAt: prescription.createdAt,
      updatedAt: prescription.updatedAt,
    };
  }

  /**
   * Retrieves prescription by ID with strict role-based access control.
   * Authorized: Patient who owns consultation, Doctor assigned to consultation, or ADMIN.
   */
  public static async getPrescriptionById(
    id: string,
    requestingUserId: string,
    requestingUserRole: UserRole
  ) {
    const prescription = await prisma.prescription.findUnique({
      where: { id },
      include: {
        doctor: {
          select: {
            id: true,
            userId: true,
            specialization: true,
            licenseNumber: true,
            user: {
              select: {
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
        consultation: {
          select: {
            id: true,
            consultationNumber: true,
            status: true,
            scheduledAt: true,
          },
        },
      },
    });

    if (!prescription) {
      throw new NotFoundError('Prescription not found');
    }

    // Access Control: Admin, assigned Doctor, or Patient
    const isAdmin = requestingUserRole === UserRole.ADMIN;
    const isAssignedDoctor =
      requestingUserRole === UserRole.DOCTOR && prescription.doctor.userId === requestingUserId;
    const isPatientOwner =
      requestingUserRole === UserRole.PATIENT && prescription.patientId === requestingUserId;

    if (!isAdmin && !isAssignedDoctor && !isPatientOwner) {
      throw new ForbiddenError('You do not have authorization to view this prescription');
    }

    // Log access in audit log
    await prisma.auditLog.create({
      data: {
        userId: requestingUserId,
        action: 'PRESCRIPTION_VIEWED',
        resource: 'prescription',
        resourceId: prescription.id,
        details: {
          accessRole: requestingUserRole,
        },
      },
    });

    return this.decryptPrescription(prescription);
  }

  /**
   * Retrieves prescription by Consultation ID with strict access control.
   */
  public static async getPrescriptionByConsultationId(
    consultationId: string,
    requestingUserId: string,
    requestingUserRole: UserRole
  ) {
    const prescription = await prisma.prescription.findUnique({
      where: { consultationId },
      include: {
        doctor: {
          select: {
            id: true,
            userId: true,
            specialization: true,
            licenseNumber: true,
            user: {
              select: {
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
        consultation: {
          select: {
            id: true,
            consultationNumber: true,
            status: true,
            scheduledAt: true,
          },
        },
      },
    });

    if (!prescription) {
      throw new NotFoundError('No prescription found for the specified consultation');
    }

    const isAdmin = requestingUserRole === UserRole.ADMIN;
    const isAssignedDoctor =
      requestingUserRole === UserRole.DOCTOR && prescription.doctor.userId === requestingUserId;
    const isPatientOwner =
      requestingUserRole === UserRole.PATIENT && prescription.patientId === requestingUserId;

    if (!isAdmin && !isAssignedDoctor && !isPatientOwner) {
      throw new ForbiddenError('You do not have authorization to view this prescription');
    }

    // Log access in audit log
    await prisma.auditLog.create({
      data: {
        userId: requestingUserId,
        action: 'PRESCRIPTION_VIEWED',
        resource: 'prescription',
        resourceId: prescription.id,
        details: {
          accessRole: requestingUserRole,
          byConsultation: true,
        },
      },
    });

    return this.decryptPrescription(prescription);
  }

  /**
   * Safely decrypts diagnosis, medications, and lifestyle advice.
   */
  private static decryptPrescription(prescription: any) {
    const decryptedDiagnosis = decrypt(prescription.diagnosis);
    const decryptedLifestyleAdvice = prescription.lifestyleAdvice
      ? decrypt(prescription.lifestyleAdvice)
      : null;

    let decryptedMedications: MedicationItem[] = [];
    if (prescription.medications && typeof prescription.medications === 'object') {
      if ('encrypted' in prescription.medications) {
        try {
          decryptedMedications = JSON.parse(decrypt(prescription.medications.encrypted as string));
        } catch {
          decryptedMedications = [];
        }
      } else if (Array.isArray(prescription.medications)) {
        decryptedMedications = prescription.medications;
      }
    }

    return {
      id: prescription.id,
      consultationId: prescription.consultationId,
      consultation: prescription.consultation,
      doctorId: prescription.doctorId,
      doctor: {
        id: prescription.doctor.id,
        name: formatUserName(prescription.doctor.user),
        specialization: prescription.doctor.specialization,
        licenseNumber: prescription.doctor.licenseNumber,
      },
      patientId: prescription.patientId,
      patient: {
        id: prescription.patient.id,
        name: formatUserName(prescription.patient),
        email: prescription.patient.email,
      },
      diagnosis: decryptedDiagnosis,
      medications: decryptedMedications,
      lifestyleAdvice: decryptedLifestyleAdvice,
      followUpDate: prescription.followUpDate,
      digitalSignature: prescription.digitalSignature,
      createdAt: prescription.createdAt,
      updatedAt: prescription.updatedAt,
    };
  }
}
