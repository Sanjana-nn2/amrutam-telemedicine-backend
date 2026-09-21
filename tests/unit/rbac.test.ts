import { Request, Response, NextFunction } from 'express';
import { requireRole } from '../../src/middleware/rbac.middleware';
import { UserRole } from '@prisma/client';
import { ForbiddenError, UnauthorizedError } from '../../src/utils/errors';

describe('RBAC Middleware (requireRole)', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let nextFn: jest.Mock;

  beforeEach(() => {
    mockReq = {};
    mockRes = {};
    nextFn = jest.fn();
  });

  it('should call next with UnauthorizedError if req.user is undefined', () => {
    const middleware = requireRole(UserRole.ADMIN);
    middleware(mockReq as Request, mockRes as Response, nextFn as NextFunction);

    expect(nextFn).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });

  it('should call next with ForbiddenError if user role is not in allowed roles', () => {
    mockReq.user = {
      id: 'patient-id',
      email: 'patient@example.com',
      role: UserRole.PATIENT,
      isActive: true,
      isEmailVerified: true,
      mfaEnabled: false,
    };

    const middleware = requireRole(UserRole.ADMIN, UserRole.DOCTOR);
    middleware(mockReq as Request, mockRes as Response, nextFn as NextFunction);

    expect(nextFn).toHaveBeenCalledWith(expect.any(ForbiddenError));
  });

  it('should call next without error if user role matches allowed roles', () => {
    mockReq.user = {
      id: 'admin-id',
      email: 'admin@amrutam.co.in',
      role: UserRole.ADMIN,
      isActive: true,
      isEmailVerified: true,
      mfaEnabled: true,
    };

    const middleware = requireRole(UserRole.ADMIN);
    middleware(mockReq as Request, mockRes as Response, nextFn as NextFunction);

    expect(nextFn).toHaveBeenCalledWith();
  });
});
