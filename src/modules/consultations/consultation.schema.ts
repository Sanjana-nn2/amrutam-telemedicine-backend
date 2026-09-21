import { z } from 'zod';
import { ConsultationStatus } from '@prisma/client';

export const bookConsultationSchema = z.object({
  doctorId: z.string().uuid('Invalid doctor ID format (must be UUID)'),
  slotId: z.string().uuid('Invalid slot ID format (must be UUID)'),
  chiefComplaint: z
    .string({ required_error: 'Chief complaint is required' })
    .trim()
    .min(5, 'Chief complaint must be at least 5 characters')
    .max(1000, 'Chief complaint cannot exceed 1000 characters'),
});

export const updateConsultationStatusSchema = z.object({
  status: z.nativeEnum(ConsultationStatus, {
    errorMap: () => ({ message: 'Invalid consultation status value' }),
  }),
  notes: z
    .string()
    .trim()
    .max(2000, 'Notes cannot exceed 2000 characters')
    .optional(),
  reason: z
    .string()
    .trim()
    .max(500, 'Cancellation reason cannot exceed 500 characters')
    .optional(),
});

export const consultationQuerySchema = z.object({
  status: z
    .nativeEnum(ConsultationStatus)
    .optional(),
  page: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 1))
    .refine((val) => val > 0, { message: 'page must be greater than 0' }),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 10))
    .refine((val) => val >= 1 && val <= 50, { message: 'limit must be between 1 and 50' }),
});

export const consultationIdParamSchema = z.object({
  id: z.string().uuid('Invalid consultation ID format (must be UUID)'),
});
