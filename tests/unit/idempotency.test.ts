import {
  hashRequestPayload,
  sortKeys,
  sanitizeResponseBody,
  requireIdempotency,
} from '../../src/middleware/idempotency.middleware';
import { prisma } from '../../src/config/database';
import { Request, Response } from 'express';

jest.mock('../../src/config/database', () => ({
  prisma: {
    idempotencyKey: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

describe('Phase 4: Idempotency Middleware & Payload Hashing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Deterministic Hashing & Key Sorting', () => {
    it('should sort keys recursively and produce identical hash regardless of key order', () => {
      const payloadA = {
        doctorId: '1234',
        slotId: '5678',
        chiefComplaint: 'Headache',
        details: { severe: true, since: 'yesterday' },
      };

      const payloadB = {
        details: { since: 'yesterday', severe: true },
        chiefComplaint: 'Headache',
        slotId: '5678',
        doctorId: '1234',
      };

      const hashA = hashRequestPayload(payloadA);
      const hashB = hashRequestPayload(payloadB);

      expect(hashA).toBe(hashB);
      expect(hashA).toHaveLength(64); // SHA-256 hex length
    });

    it('should produce different hashes for different payloads', () => {
      const hash1 = hashRequestPayload({ slotId: 'slot-1' });
      const hash2 = hashRequestPayload({ slotId: 'slot-2' });

      expect(hash1).not.toBe(hash2);
    });

    it('should sanitize sensitive credentials from stored response body', () => {
      const rawResponse = {
        accessToken: 'secret-jwt-token',
        passwordHash: 'hash-abc',
        consultationNumber: 'CNS-2026-001',
        user: {
          refreshToken: 'refresh-xyz',
          mfaSecret: 'otp-secret',
          email: 'patient@example.com',
        },
      };

      const clean = sanitizeResponseBody(rawResponse);

      expect(clean.accessToken).toBe('[REDACTED]');
      expect(clean.passwordHash).toBe('[REDACTED]');
      expect(clean.consultationNumber).toBe('CNS-2026-001');
      expect(clean.user.refreshToken).toBe('[REDACTED]');
      expect(clean.user.mfaSecret).toBe('[REDACTED]');
      expect(clean.user.email).toBe('patient@example.com');
    });
  });

  describe('requireIdempotency Middleware Behavior', () => {
    const mockResponse = () => {
      const res: any = {};
      res.status = jest.fn().mockReturnValue(res);
      res.json = jest.fn().mockReturnValue(res);
      res.setHeader = jest.fn().mockReturnValue(res);
      res.statusCode = 200;
      return res;
    };

    it('should reject requests missing Idempotency-Key when mandatory', async () => {
      const middleware = requireIdempotency({ required: true });
      const req: any = {
        header: jest.fn().mockReturnValue(null),
        body: { slotId: 'slot-123' },
      };
      const res = mockResponse();
      const next = jest.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          message: expect.stringContaining('Idempotency-Key header is required'),
        })
      );
    });

    it('should replay cached response when same key, user, endpoint, and hash are presented', async () => {
      const middleware = requireIdempotency({ required: true });
      const key = 'test-idemp-key-1';
      const userId = 'user-patient-123';
      const endpoint = '/api/v1/consultations/book';
      const body = { slotId: 'slot-1', doctorId: 'doc-1' };
      const hash = hashRequestPayload(body);

      const cachedResponseBody = { success: true, consultationNumber: 'CNS-001' };

      (prisma.idempotencyKey.findUnique as jest.Mock).mockResolvedValue({
        key,
        userId,
        endpoint,
        requestHash: hash,
        responseStatus: 201,
        responseBody: cachedResponseBody,
        expiresAt: new Date(Date.now() + 60000),
      });

      const req: any = {
        header: jest.fn().mockReturnValue(key),
        user: { id: userId },
        originalUrl: endpoint,
        body,
      };
      const res = mockResponse();
      const next = jest.fn();

      await middleware(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('Idempotent-Replay', 'true');
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(cachedResponseBody);
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject with 409 Conflict when reusing same key with different payload', async () => {
      const middleware = requireIdempotency({ required: true });
      const key = 'test-idemp-key-2';
      const userId = 'user-patient-123';
      const endpoint = '/api/v1/consultations/book';

      (prisma.idempotencyKey.findUnique as jest.Mock).mockResolvedValue({
        key,
        userId,
        endpoint,
        requestHash: 'previous-hash-different',
        responseStatus: 201,
        responseBody: { success: true },
        expiresAt: new Date(Date.now() + 60000),
      });

      const req: any = {
        header: jest.fn().mockReturnValue(key),
        user: { id: userId },
        originalUrl: endpoint,
        body: { slotId: 'different-slot' },
      };
      const res = mockResponse();
      const next = jest.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 409,
          message: expect.stringContaining('different request payload'),
        })
      );
    });

    it('should reject with 409 Conflict when reusing same key with different user', async () => {
      const middleware = requireIdempotency({ required: true });
      const key = 'test-idemp-key-3';
      const endpoint = '/api/v1/consultations/book';
      const body = { slotId: 'slot-1' };
      const hash = hashRequestPayload(body);

      (prisma.idempotencyKey.findUnique as jest.Mock).mockResolvedValue({
        key,
        userId: 'original-user-999',
        endpoint,
        requestHash: hash,
        responseStatus: 201,
        responseBody: { success: true },
        expiresAt: new Date(Date.now() + 60000),
      });

      const req: any = {
        header: jest.fn().mockReturnValue(key),
        user: { id: 'attacker-user-000' },
        originalUrl: endpoint,
        body,
      };
      const res = mockResponse();
      const next = jest.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 409,
          message: expect.stringContaining('another account'),
        })
      );
    });

    it('should reject with 409 Conflict if request is currently being processed (status 0)', async () => {
      const middleware = requireIdempotency({ required: true });
      const key = 'test-idemp-key-4';
      const userId = 'user-1';
      const endpoint = '/api/v1/consultations/book';
      const body = { slotId: 'slot-1' };

      (prisma.idempotencyKey.findUnique as jest.Mock).mockResolvedValue({
        key,
        userId,
        endpoint,
        requestHash: hashRequestPayload(body),
        responseStatus: 0, // IN_PROGRESS
        responseBody: {},
        expiresAt: new Date(Date.now() + 60000),
      });

      const req: any = {
        header: jest.fn().mockReturnValue(key),
        user: { id: userId },
        originalUrl: endpoint,
        body,
      };
      const res = mockResponse();
      const next = jest.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 409,
          message: expect.stringContaining('currently being processed'),
        })
      );
    });
  });
});
