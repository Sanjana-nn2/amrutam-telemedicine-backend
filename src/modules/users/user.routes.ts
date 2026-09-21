import { Router } from 'express';
import { UserController } from './user.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/rbac.middleware';
import { validateRequest } from '../../middleware/validate.middleware';
import { UserRole } from '@prisma/client';
import {
  updateProfileSchema,
  updateStatusSchema,
  userIdParamSchema,
} from './user.schema';

const router = Router();

// Current user profile endpoints (Authenticated)
router.get('/me', authenticate, UserController.getMe);
router.put(
  '/me/profile',
  authenticate,
  validateRequest({ body: updateProfileSchema }),
  UserController.updateProfile
);

// Admin-only user management endpoints
router.get(
  '/:id',
  authenticate,
  requireRole(UserRole.ADMIN),
  validateRequest({ params: userIdParamSchema }),
  UserController.getUserById
);

router.patch(
  '/:id/status',
  authenticate,
  requireRole(UserRole.ADMIN),
  validateRequest({ params: userIdParamSchema, body: updateStatusSchema }),
  UserController.updateUserStatus
);

export default router;
