import { z } from 'zod';

const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

export const registerSchema = z.object({
  email: z.string().email('Invalid email address format').toLowerCase().trim(),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters long')
    .max(128, 'Password cannot exceed 128 characters')
    .regex(
      passwordRegex,
      'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&)'
    ),
  role: z
    .enum(['PATIENT', 'DOCTOR'], {
      errorMap: () => ({ message: "Role must be either 'PATIENT' or 'DOCTOR'. Self-assignment of 'ADMIN' is prohibited." }),
    })
    .default('PATIENT'),
  firstName: z.string().min(1, 'First name is required').max(100).trim(),
  lastName: z.string().min(1, 'Last name is required').max(100).trim(),
  phone: z.string().max(20).optional(),
  // Doctor-specific onboarding parameters
  specialization: z.string().max(100).optional(),
  licenseNumber: z.string().max(100).optional(),
  experienceYears: z.number().int().min(0).max(80).optional(),
  consultationFee: z.number().min(0).optional(),
  languages: z.array(z.string()).optional(),
  bio: z.string().max(2000).optional(),
}).refine(
  (data) => {
    if (data.role === 'DOCTOR') {
      return !!data.specialization && !!data.licenseNumber;
    }
    return true;
  },
  {
    message: "Specialization and license number are required when registering as a DOCTOR",
    path: ['specialization'],
  }
);

export const loginSchema = z.object({
  email: z.string().email('Invalid email address format').toLowerCase().trim(),
  password: z.string().min(1, 'Password is required'),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export const mfaVerifySchema = z.object({
  token: z.string().length(6, 'TOTP verification code must be exactly 6 digits').regex(/^\d{6}$/, 'Code must contain only digits'),
});

export const mfaValidateSchema = z.object({
  mfaToken: z.string().min(1, 'MFA session token is required'),
  token: z.string().length(6, 'TOTP verification code must be exactly 6 digits').regex(/^\d{6}$/, 'Code must contain only digits'),
});
