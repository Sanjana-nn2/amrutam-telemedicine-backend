import { z } from 'zod';

export const updateProfileSchema = z.object({
  firstName: z.string().min(1).max(100).trim().optional(),
  lastName: z.string().min(1).max(100).trim().optional(),
  phone: z.string().max(20).optional(),
  dateOfBirth: z.string().datetime({ offset: true }).optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  gender: z.enum(['Male', 'Female', 'Other', 'PreferNotToSay']).optional(),
  bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).optional(),
  emergencyContact: z.string().max(100).optional(),
});

export const updateStatusSchema = z.object({
  isActive: z.boolean({ required_error: 'isActive boolean flag is required' }),
});

export const userIdParamSchema = z.object({
  id: z.string().uuid('Invalid user UUID format'),
});
