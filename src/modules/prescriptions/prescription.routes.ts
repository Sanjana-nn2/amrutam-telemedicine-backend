import { Router } from 'express';
import { PrescriptionController } from './prescription.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/rbac.middleware';
import { validateBody, validateParams } from '../../middleware/validate.middleware';
import {
  createPrescriptionSchema,
  getPrescriptionParamsSchema,
  getConsultationPrescriptionParamsSchema,
} from './prescription.schema';
import { UserRole } from '@prisma/client';

const router = Router();

/**
 * POST /api/v1/prescriptions
 * Doctor only - issues prescription for assigned in-progress or completed consultation
 */
router.post(
  '/',
  authenticate,
  requireRole([UserRole.DOCTOR]),
  validateBody(createPrescriptionSchema),
  PrescriptionController.create
);

/**
 * GET /api/v1/prescriptions/:id
 * Authorized patient owner, assigned doctor, or admin
 */
router.get(
  '/:id',
  authenticate,
  validateParams(getPrescriptionParamsSchema),
  PrescriptionController.getById
);

/**
 * GET /api/v1/prescriptions/consultation/:consultationId
 * Authorized patient owner, assigned doctor, or admin
 */
router.get(
  '/consultation/:consultationId',
  authenticate,
  validateParams(getConsultationPrescriptionParamsSchema),
  PrescriptionController.getByConsultationId
);

export default router;
