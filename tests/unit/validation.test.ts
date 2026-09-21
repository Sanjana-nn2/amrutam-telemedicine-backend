import {
  registerSchema,
  loginSchema,
  mfaVerifySchema,
  mfaValidateSchema,
} from '../../src/modules/auth/auth.schema';
import { updateProfileSchema } from '../../src/modules/users/user.schema';

describe('Zod Input Validation Schemas', () => {
  describe('Registration Schema', () => {
    it('should accept valid PATIENT registration data', async () => {
      const validPatient = {
        email: 'patient@example.com',
        password: 'Password@123',
        firstName: 'Ananya',
        lastName: 'Sharma',
        role: 'PATIENT',
      };

      const parsed = await registerSchema.parseAsync(validPatient);
      expect(parsed.email).toBe('patient@example.com');
      expect(parsed.role).toBe('PATIENT');
    });

    it('should reject weak passwords lacking numbers or special characters', async () => {
      const weakPassword = {
        email: 'patient@example.com',
        password: 'passwordOnly',
        firstName: 'Ananya',
        lastName: 'Sharma',
        role: 'PATIENT',
      };

      await expect(registerSchema.parseAsync(weakPassword)).rejects.toThrow();
    });

    it('should explicitly reject attempts to self-assign ADMIN role', async () => {
      const adminAttempt = {
        email: 'attacker@example.com',
        password: 'Password@123',
        firstName: 'Bad',
        lastName: 'Actor',
        role: 'ADMIN',
      };

      await expect(registerSchema.parseAsync(adminAttempt)).rejects.toThrow(
        "Role must be either 'PATIENT' or 'DOCTOR'. Self-assignment of 'ADMIN' is prohibited."
      );
    });

    it('should require specialization and licenseNumber for DOCTOR registrations', async () => {
      const incompleteDoctor = {
        email: 'dr.incomplete@amrutam.co.in',
        password: 'Password@123',
        firstName: 'Priya',
        lastName: 'Menon',
        role: 'DOCTOR',
        // missing specialization and licenseNumber
      };

      await expect(registerSchema.parseAsync(incompleteDoctor)).rejects.toThrow();
    });

    it('should accept complete DOCTOR registration data', async () => {
      const completeDoctor = {
        email: 'dr.priya@amrutam.co.in',
        password: 'Password@123',
        firstName: 'Priya',
        lastName: 'Menon',
        role: 'DOCTOR',
        specialization: 'Ayurveda & Panchakarma',
        licenseNumber: 'AYUR-KA-2024-8899',
        experienceYears: 8,
        consultationFee: 750,
      };

      const parsed = await registerSchema.parseAsync(completeDoctor);
      expect(parsed.role).toBe('DOCTOR');
      expect(parsed.specialization).toBe('Ayurveda & Panchakarma');
    });
  });

  describe('Login & MFA Schemas', () => {
    it('should validate email format on login', async () => {
      await expect(
        loginSchema.parseAsync({ email: 'not-an-email', password: 'Password@123' })
      ).rejects.toThrow();
    });

    it('should enforce 6-digit numeric TOTP codes', async () => {
      await expect(mfaVerifySchema.parseAsync({ token: '12345' })).rejects.toThrow();
      await expect(mfaVerifySchema.parseAsync({ token: 'abcdef' })).rejects.toThrow();

      const valid = await mfaVerifySchema.parseAsync({ token: '654321' });
      expect(valid.token).toBe('654321');
    });
  });

  describe('Profile Update Schema', () => {
    it('should validate allowed blood groups and genders', async () => {
      const validProfile = {
        firstName: 'Rahul',
        gender: 'Male',
        bloodGroup: 'O+',
        phone: '+919876543210',
      };

      const parsed = await updateProfileSchema.parseAsync(validProfile);
      expect(parsed.bloodGroup).toBe('O+');

      await expect(
        updateProfileSchema.parseAsync({ bloodGroup: 'INVALID' })
      ).rejects.toThrow();
    });
  });
});
