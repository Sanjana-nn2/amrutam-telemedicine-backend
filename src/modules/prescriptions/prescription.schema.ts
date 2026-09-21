import { z } from 'zod';

export const medicationItemSchema = z.object({
  name: z.string().min(1, 'Medication name is required').max(100, 'Medication name cannot exceed 100 characters'),
  dosage: z.string().min(1, 'Dosage is required').max(50, 'Dosage cannot exceed 50 characters'),
  frequency: z.string().min(1, 'Frequency is required').max(50, 'Frequency cannot exceed 50 characters'),
  duration: z.string().min(1, 'Duration is required').max(50, 'Duration cannot exceed 50 characters'),
  instructions: z.string().max(200, 'Instructions cannot exceed 200 characters').optional(),
});

export const createPrescriptionSchema = z.object({
  consultationId: z.string().uuid('Invalid consultation ID format (must be UUID)'),
  diagnosis: z
    .string()
    .min(3, 'Diagnosis must be at least 3 characters')
    .max(500, 'Diagnosis cannot exceed 500 characters'),
  medications: z
    .array(medicationItemSchema)
    .min(1, 'At least one medication is required')
    .max(20, 'Cannot exceed 20 medications in a single prescription'),
  lifestyleAdvice: z.string().max(1000, 'Lifestyle advice cannot exceed 1000 characters').optional(),
  followUpDate: z
    .string()
    .datetime({ message: 'Follow-up date must be a valid ISO-8601 date string' })
    .optional()
    .refine(
      (val) => {
        if (!val) return true;
        return new Date(val) > new Date();
      },
      { message: 'Follow-up date must be in the future' }
    ),
  digitalSignature: z
    .string()
    .min(3, 'Digital signature must be at least 3 characters')
    .max(255, 'Digital signature cannot exceed 255 characters'),
});

export const getPrescriptionParamsSchema = z.object({
  id: z.string().uuid('Invalid prescription ID format (must be UUID)'),
});

export const getConsultationPrescriptionParamsSchema = z.object({
  consultationId: z.string().uuid('Invalid consultation ID format (must be UUID)'),
});

export type CreatePrescriptionInput = z.infer<typeof createPrescriptionSchema>;
export type MedicationItem = z.infer<typeof medicationItemSchema>;
