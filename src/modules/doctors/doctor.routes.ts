import { Router } from 'express';
import { DoctorController } from './doctor.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/rbac.middleware';
import { validate } from '../../middleware/validate.middleware';
import { UserRole } from '@prisma/client';
import {
  createDoctorSchema,
  updateDoctorSchema,
  verifyDoctorSchema,
  doctorIdParamSchema,
  doctorSearchQuerySchema,
} from './doctor.schema';

const router = Router();

/**
 * Public routes
 */
router.get(
  '/',
  validate(doctorSearchQuerySchema, 'query'),
  DoctorController.searchDoctors
);

router.get(
  '/:id',
  validate(doctorIdParamSchema, 'params'),
  DoctorController.getDoctorById
);

/**
 * Protected routes
 */
router.post(
  '/',
  authenticate,
  requireRole(UserRole.DOCTOR),
  validate(createDoctorSchema, 'body'),
  DoctorController.createProfile
);

router.put(
  '/:id',
  authenticate,
  requireRole(UserRole.DOCTOR, UserRole.ADMIN),
  validate(doctorIdParamSchema, 'params'),
  validate(updateDoctorSchema, 'body'),
  DoctorController.updateProfile
);

router.patch(
  '/:id/verify',
  authenticate,
  requireRole(UserRole.ADMIN),
  validate(doctorIdParamSchema, 'params'),
  validate(verifyDoctorSchema, 'body'),
  DoctorController.verifyDoctor
);

export default router;
