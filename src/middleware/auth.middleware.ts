import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import { UnauthorizedError, ForbiddenError } from '../utils/errors';
import { prisma } from '../config/database';

export const authenticate = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('Authentication token required. Format: Bearer <token>');
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      throw new UnauthorizedError('Authentication token missing');
    }

    const payload = verifyAccessToken(token);

    // Look up user in database to verify existence, active status, and doctor relation
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        isEmailVerified: true,
        mfaEnabled: true,
        doctor: {
          select: { id: true },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedError('User account associated with token no longer exists');
    }

    if (!user.isActive) {
      throw new ForbiddenError('Account has been deactivated. Please contact support.');
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      isEmailVerified: user.isEmailVerified,
      mfaEnabled: user.mfaEnabled,
      doctorProfileId: user.doctor?.id,
    };

    next();
  } catch (error) {
    next(error);
  }
};
