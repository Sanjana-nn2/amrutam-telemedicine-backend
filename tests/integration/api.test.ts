import request from 'supertest';

jest.mock('otplib', () => ({
  generateSecret: jest.fn(() => 'TESTSECRET'),
  generateURI: jest.fn(() => 'otpauth://totp/Amrutam:test@example.com?secret=TESTSECRET'),
  verifySync: jest.fn(() => ({ valid: true })),
}));

import { createApp } from '../../src/app';

describe('API Security & Endpoints Integration Tests', () => {
  const app = createApp();

  describe('Root & Health Endpoints', () => {
    it('GET / should return 200 with service metadata and correlationId', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.body.service).toBe('Amrutam Telemedicine Backend API');
      expect(res.body.status).toBe('OPERATIONAL');
      expect(res.headers['x-correlation-id']).toBeDefined();
    });

    it('GET /health/live should return 200 UP', async () => {
      const res = await request(app).get('/health/live');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('UP');
    });
  });

  describe('Authentication Input Validation & Security', () => {
    it('POST /api/v1/auth/register should reject missing fields with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toBeDefined();
    });

    it('POST /api/v1/auth/register should reject self-assigned ADMIN role with 400', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'admin-attempt@amrutam.co.in',
          password: 'Password@123',
          firstName: 'Admin',
          lastName: 'Hacker',
          role: 'ADMIN',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('POST /api/v1/auth/login should reject invalid email format with 400', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'not-a-valid-email',
          password: 'Password@123',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('JWT Protected Endpoints Authorization', () => {
    it('GET /api/v1/users/me should reject requests without Authorization header with 401', async () => {
      const res = await request(app).get('/api/v1/users/me');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
      expect(res.body.error.message).toContain('Authentication token required');
    });

    it('GET /api/v1/users/me should reject requests with invalid Bearer token with 401', async () => {
      const res = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', 'Bearer invalid.bogus.jwt');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('POST /api/v1/auth/mfa/setup should reject unauthenticated requests with 401', async () => {
      const res = await request(app).post('/api/v1/auth/mfa/setup');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('GET /api/v1/users/:id should reject unauthenticated requests with 401', async () => {
      const res = await request(app).get('/api/v1/users/11111111-2222-3333-4444-555555555555');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('404 Not Found & Unknown Routes', () => {
    it('should return standardized 404 error envelope for unknown routes', async () => {
      const res = await request(app).get('/api/v1/unknown-route-endpoint');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOTFOUND');
    });
  });
});
