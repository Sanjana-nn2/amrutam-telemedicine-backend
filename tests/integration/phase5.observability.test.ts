import request from 'supertest';

jest.mock('otplib', () => ({
  generateSecret: jest.fn(() => 'TESTSECRET'),
  generateURI: jest.fn(() => 'otpauth://totp/Amrutam:test@example.com?secret=TESTSECRET'),
  verifySync: jest.fn(() => ({ valid: true })),
}));

// Mock Prisma for controller, middleware, and route validation tests
jest.mock('../../src/config/database', () => ({
  prisma: {
    $queryRaw: jest.fn().mockResolvedValue([{ '1': 1 }]),
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
      count: jest.fn().mockResolvedValue(5),
      findMany: jest.fn().mockResolvedValue([]),
    },
    consultation: {
      count: jest.fn().mockResolvedValue(10),
      groupBy: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    payment: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    availabilitySlot: {
      count: jest.fn().mockResolvedValue(20),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    auditLog: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
    },
    prescription: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
  },
}));

import { createApp } from '../../src/app';
import { signAccessToken } from '../../src/utils/jwt';
import { normalizeRoute } from '../../src/modules/observability/metrics';
import { jobQueue, JobTypes } from '../../src/utils/asyncJob';
import { UserRole } from '@prisma/client';

describe('Phase 5: Observability, Swagger & Admin Integration Tests', () => {
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

  describe('Prometheus Metrics Endpoint (GET /metrics)', () => {
    it('should expose Prometheus plain-text metrics with status 200', async () => {
      const res = await request(app).get('/metrics');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.text).toContain('http_requests_total');
      expect(res.text).toContain('http_request_duration_seconds');
      expect(res.text).toContain('amrutam_node_');
    });

    it('should normalize UUIDs and numeric IDs to prevent high-cardinality metric labels', () => {
      const rawUrl1 = '/api/v1/prescriptions/123e4567-e89b-12d3-a456-426614174000';
      const normalized1 = normalizeRoute(rawUrl1);
      expect(normalized1).toBe('/api/v1/prescriptions/:id');

      const rawUrl2 = '/api/v1/consultations/CNS-20260921-ABCD1234/status';
      const normalized2 = normalizeRoute(rawUrl2);
      expect(normalized2).toBe('/api/v1/consultations/:id/status');

      const rawUrlWithQuery = '/api/v1/admin/audit-logs?page=2&limit=20';
      const normalizedWithQuery = normalizeRoute(rawUrlWithQuery);
      expect(normalizedWithQuery).toBe('/api/v1/admin/audit-logs');
    });
  });

  describe('OpenAPI / Swagger Documentation Endpoints', () => {
    it('GET /api/docs should serve Swagger UI documentation', async () => {
      const res = await request(app).get('/api/docs/');
      expect([200, 301, 302]).toContain(res.status);
    });

    it('GET /api/docs/swagger.json should return valid OpenAPI 3.x schema', async () => {
      const res = await request(app).get('/api/docs/swagger.json');
      expect(res.status).toBe(200);
      expect(res.body.openapi).toMatch(/^3\./);
      expect(res.body.paths).toHaveProperty('/api/v1/consultations/book');
      expect(res.body.paths).toHaveProperty('/api/v1/payments/checkout');
      expect(res.body.paths).toHaveProperty('/api/v1/prescriptions');
      expect(res.body.paths).toHaveProperty('/api/v1/admin/analytics/overview');
    });

    it('should document mandatory Idempotency-Key header for booking and checkout', async () => {
      const res = await request(app).get('/api/docs/swagger.json');
      expect(res.status).toBe(200);

      const bookParams = res.body.paths['/api/v1/consultations/book'].post.parameters;
      const hasIdempotency = bookParams.some(
        (p: any) => p.$ref && p.$ref.includes('IdempotencyKeyHeader')
      );
      expect(hasIdempotency).toBe(true);
    });

    it('GET /api/docs/openapi.yaml should return raw YAML specification', async () => {
      const res = await request(app).get('/api/docs/openapi.yaml');
      expect(res.status).toBe(200);
      expect(res.text).toContain('openapi: 3.0.3');
    });
  });

  describe('Admin Analytics & Governance Authorization', () => {
    it('GET /api/v1/admin/analytics/overview should reject unauthenticated requests with 401', async () => {
      const res = await request(app).get('/api/v1/admin/analytics/overview');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('GET /api/v1/admin/analytics/overview should reject PATIENT role with 403 Forbidden', async () => {
      const res = await request(app)
        .get('/api/v1/admin/analytics/overview')
        .set('Authorization', `Bearer ${patientToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('GET /api/v1/admin/analytics/overview should reject DOCTOR role with 403 Forbidden', async () => {
      const res = await request(app)
        .get('/api/v1/admin/analytics/overview')
        .set('Authorization', `Bearer ${doctorToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('GET /api/v1/admin/analytics/overview should permit ADMIN role with 200', async () => {
      const res = await request(app)
        .get('/api/v1/admin/analytics/overview')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('totalConsultations');
    });

    it('GET /api/v1/admin/audit-logs should reject non-ADMIN users with 403 Forbidden', async () => {
      const res = await request(app)
        .get('/api/v1/admin/audit-logs')
        .set('Authorization', `Bearer ${patientToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('Prescription Management Endpoint Authorization', () => {
    it('POST /api/v1/prescriptions should reject unauthenticated requests with 401', async () => {
      const res = await request(app).post('/api/v1/prescriptions').send({});
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('POST /api/v1/prescriptions should reject PATIENT role with 403 Forbidden (DOCTOR only)', async () => {
      const res = await request(app)
        .post('/api/v1/prescriptions')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          consultationId: '11111111-1111-1111-1111-111111111111',
          diagnosis: 'Test diagnosis',
          medications: [{ name: 'Herb', dosage: '100mg', frequency: 'Daily', duration: '5d' }],
          digitalSignature: 'SIG-123',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('Asynchronous Job Queue Foundation', () => {
    it('should enqueue background jobs and execute asynchronously without blocking', async () => {
      let executed = false;
      const testJobType = 'TEST_ASYNC_JOB';

      jobQueue.registerHandler(testJobType, async () => {
        executed = true;
      });

      const jobId = await jobQueue.enqueue(testJobType, { test: 'data' });
      expect(jobId).toMatch(/^job-/);

      // Wait a tick for setImmediate execution
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(executed).toBe(true);
    });
  });
});
