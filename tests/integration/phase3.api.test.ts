import request from 'supertest';

jest.mock('otplib', () => ({
  generateSecret: jest.fn(() => 'TESTSECRET'),
  generateURI: jest.fn(() => 'otpauth://totp/Amrutam:test@example.com?secret=TESTSECRET'),
  verifySync: jest.fn(() => ({ valid: true })),
}));

// Mock Prisma for integration controller & middleware tests
jest.mock('../../src/config/database', () => ({
  prisma: {
    user: {
      findUnique: jest.fn().mockImplementation(({ where }) => {
        if (where.id === '11111111-1111-1111-1111-111111111111') {
          return Promise.resolve({
            id: '11111111-1111-1111-1111-111111111111',
            email: 'patient@example.com',
            role: 'PATIENT',
            isActive: true,
            isEmailVerified: true,
            mfaEnabled: false,
            doctor: null,
          });
        }
        if (where.id === '22222222-2222-2222-2222-222222222222') {
          return Promise.resolve({
            id: '22222222-2222-2222-2222-222222222222',
            email: 'doctor@amrutam.co.in',
            role: 'DOCTOR',
            isActive: true,
            isEmailVerified: true,
            mfaEnabled: false,
            doctor: { id: 'dddddddd-dddd-dddd-dddd-dddddddddddd' },
          });
        }
        if (where.id === '33333333-3333-3333-3333-333333333333') {
          return Promise.resolve({
            id: '33333333-3333-3333-3333-333333333333',
            email: 'admin@amrutam.co.in',
            role: 'ADMIN',
            isActive: true,
            isEmailVerified: true,
            mfaEnabled: true,
            doctor: null,
          });
        }
        return Promise.resolve(null);
      }),
    },
    doctor: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    availabilitySlot: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
  },
}));

import { createApp } from '../../src/app';
import { signAccessToken } from '../../src/utils/jwt';
import { UserRole } from '@prisma/client';

describe('Phase 3 Doctor & Availability Endpoints Integration Tests', () => {
  const app = createApp();

  const patientToken = signAccessToken({
    userId: '11111111-1111-1111-1111-111111111111',
    email: 'patient@example.com',
    role: UserRole.PATIENT,
    mfaAuthenticated: false,
  });

  const doctorToken = signAccessToken({
    userId: '22222222-2222-2222-2222-222222222222',
    email: 'doctor@amrutam.co.in',
    role: UserRole.DOCTOR,
    mfaAuthenticated: false,
  });

  const adminToken = signAccessToken({
    userId: '33333333-3333-3333-3333-333333333333',
    email: 'admin@amrutam.co.in',
    role: UserRole.ADMIN,
    mfaAuthenticated: true,
  });

  describe('Doctor Profile & Search Endpoints Authorization & Validation', () => {
    it('POST /api/v1/doctors should reject unauthenticated requests with 401', async () => {
      const res = await request(app).post('/api/v1/doctors').send({});
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('POST /api/v1/doctors should reject PATIENT role with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/v1/doctors')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          specialization: 'Ayurveda',
          licenseNumber: 'AYUR-1234',
          experienceYears: 5,
          consultationFee: 500,
          languages: ['English'],
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('POST /api/v1/doctors with DOCTOR role should validate schema and reject empty body with 400', async () => {
      const res = await request(app)
        .post('/api/v1/doctors')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toBeDefined();
    });

    it('PATCH /api/v1/doctors/:id/verify should reject DOCTOR role with 403 (ADMIN only)', async () => {
      const res = await request(app)
        .patch('/api/v1/doctors/44444444-4444-4444-4444-444444444444/verify')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ isVerified: true });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('GET /api/v1/doctors/:id should reject invalid UUID format with 400', async () => {
      const res = await request(app).get('/api/v1/doctors/not-a-valid-uuid');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('GET /api/v1/doctors should validate search query limit and reject excessive limit (> 50) with 400', async () => {
      const res = await request(app).get('/api/v1/doctors?limit=100');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Availability Slot Endpoints Authorization & Validation', () => {
    it('POST /api/v1/availability/slots should reject unauthenticated requests with 401', async () => {
      const res = await request(app).post('/api/v1/availability/slots').send({});
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('POST /api/v1/availability/slots should reject PATIENT role with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/v1/availability/slots')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          slots: [
            {
              startTime: new Date(Date.now() + 86400000).toISOString(),
              endTime: new Date(Date.now() + 90000000).toISOString(),
            },
          ],
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('POST /api/v1/availability/slots should reject overlapping slots in batch with 400 validation error', async () => {
      const start1 = new Date(Date.now() + 86400000);
      const end1 = new Date(Date.now() + 86400000 + 3600000);
      const start2 = new Date(Date.now() + 86400000 + 1800000); // 30 min into slot 1 -> overlaps!
      const end2 = new Date(Date.now() + 86400000 + 5400000);

      const res = await request(app)
        .post('/api/v1/availability/slots')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          slots: [
            { startTime: start1.toISOString(), endTime: end1.toISOString() },
            { startTime: start2.toISOString(), endTime: end2.toISOString() },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(res.body.error.details)).toContain('overlapping or duplicate intervals');
    });

    it('DELETE /api/v1/availability/slots/:id should reject unauthenticated requests with 401', async () => {
      const res = await request(app).delete('/api/v1/availability/slots/55555555-5555-5555-5555-555555555555');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('DELETE /api/v1/availability/slots/:id should reject PATIENT role with 403 Forbidden', async () => {
      const res = await request(app)
        .delete('/api/v1/availability/slots/55555555-5555-5555-5555-555555555555')
        .set('Authorization', `Bearer ${patientToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('GET /api/v1/availability/doctors/:doctorId should reject invalid doctorId UUID with 400', async () => {
      const res = await request(app).get('/api/v1/availability/doctors/invalid-doc-id');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
