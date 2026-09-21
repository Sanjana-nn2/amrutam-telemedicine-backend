import { z } from 'zod';

export const createDoctorSchema = z.object({
  specialization: z
    .string({ required_error: 'Specialization is required' })
    .trim()
    .min(2, 'Specialization must be at least 2 characters')
    .max(100, 'Specialization cannot exceed 100 characters'),
  licenseNumber: z
    .string({ required_error: 'License number is required' })
    .trim()
    .min(3, 'License number must be at least 3 characters')
    .max(50, 'License number cannot exceed 50 characters'),
  experienceYears: z
    .number({ required_error: 'Experience years is required' })
    .int('Experience years must be an integer')
    .min(0, 'Experience years cannot be negative')
    .max(70, 'Experience years must be realistic (<= 70)'),
  consultationFee: z
    .number({ required_error: 'Consultation fee is required' })
    .positive('Consultation fee must be greater than zero')
    .max(100000, 'Consultation fee must be less than or equal to 100,000 INR'),
  languages: z
    .array(z.string().trim().min(2, 'Language name must be at least 2 characters'))
    .min(1, 'At least one language must be specified')
    .max(15, 'Cannot specify more than 15 languages'),
  bio: z
    .string()
    .trim()
    .max(2000, 'Bio cannot exceed 2000 characters')
    .optional(),
});

export const updateDoctorSchema = z.object({
  specialization: z
    .string()
    .trim()
    .min(2, 'Specialization must be at least 2 characters')
    .max(100, 'Specialization cannot exceed 100 characters')
    .optional(),
  licenseNumber: z
    .string()
    .trim()
    .min(3, 'License number must be at least 3 characters')
    .max(50, 'License number cannot exceed 50 characters')
    .optional(),
  experienceYears: z
    .number()
    .int('Experience years must be an integer')
    .min(0, 'Experience years cannot be negative')
    .max(70, 'Experience years must be realistic')
    .optional(),
  consultationFee: z
    .number()
    .positive('Consultation fee must be greater than zero')
    .max(100000, 'Consultation fee must be realistic')
    .optional(),
  languages: z
    .array(z.string().trim().min(2))
    .min(1, 'At least one language must be specified')
    .max(15)
    .optional(),
  bio: z
    .string()
    .trim()
    .max(2000, 'Bio cannot exceed 2000 characters')
    .optional()
    .nullable(),
});

export const verifyDoctorSchema = z.object({
  isVerified: z.boolean({ required_error: 'isVerified boolean flag is required' }),
});

export const doctorSearchQuerySchema = z.object({
  specialization: z.string().trim().optional(),
  language: z.string().trim().optional(),
  minFee: z
    .string()
    .optional()
    .transform((val) => (val !== undefined && val !== '' ? parseFloat(val) : undefined))
    .refine((val) => val === undefined || (!isNaN(val) && val >= 0), {
      message: 'minFee must be a non-negative number',
    }),
  maxFee: z
    .string()
    .optional()
    .transform((val) => (val !== undefined && val !== '' ? parseFloat(val) : undefined))
    .refine((val) => val === undefined || (!isNaN(val) && val >= 0), {
      message: 'maxFee must be a non-negative number',
    }),
  minRating: z
    .string()
    .optional()
    .transform((val) => (val !== undefined && val !== '' ? parseFloat(val) : undefined))
    .refine((val) => val === undefined || (!isNaN(val) && val >= 0 && val <= 5), {
      message: 'minRating must be between 0 and 5',
    }),
  date: z
    .string()
    .optional()
    .refine(
      (val) => {
        if (!val) return true;
        const d = new Date(val);
        return !isNaN(d.getTime());
      },
      { message: 'date must be a valid ISO date string (YYYY-MM-DD)' }
    ),
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
  sortBy: z
    .enum(['rating', 'fee_asc', 'fee_desc', 'experience', 'newest'])
    .optional()
    .default('rating'),
});

export const doctorIdParamSchema = z.object({
  id: z.string().uuid('Invalid doctor ID format (must be UUID)'),
});
