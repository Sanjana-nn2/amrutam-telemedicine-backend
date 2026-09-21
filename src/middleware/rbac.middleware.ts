import { Request, Response, NextFunction } from 'express';
import { UserRole } from '@prisma/client';
import { ForbiddenError, UnauthorizedError } from '../utils/errors';

export const requireRole = (...allowedRoles: (UserRole | UserRole[])[]) => {
  const flattenedRoles: UserRole[] = allowedRoles.flat();
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication required before checking role permissions'));
    }

    if (!flattenedRoles.includes(req.user.role)) {
      return next(
        new ForbiddenError(
          `Access denied. Requires one of [${flattenedRoles.join(', ')}] role(s). Your role is '${req.user.role}'.`
        )
      );
    }

    next();
  };
};
