import { Router } from 'express';
import { ConsultationController } from './consultation.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/rbac.middleware';
import { requireIdempotency } from '../../middleware/idempotency.middleware';
import { validate } from '../../middleware/validate.middleware';
import { UserRole } from '@prisma/client';
import {
  bookConsultationSchema,
  updateConsultationStatusSchema,
  consultationQuerySchema,
  consultationIdParamSchema,
} from './consultation.schema';

const router = Router();

/**
 * Concurrency-safe atomic booking (PATIENT only, requires Idempotency-Key)
 */
router.post(
  '/book',
  authenticate,
  requireRole(UserRole.PATIENT),
  requireIdempotency({ required: true }),
  validate(bookConsultationSchema, 'body'),
  ConsultationController.book
);

/**
 * List consultations (PATIENT/DOCTOR/ADMIN)
 */
router.get(
  '/',
  authenticate,
  validate(consultationQuerySchema, 'query'),
  ConsultationController.getConsultations
);

/**
 * Get consultation by ID (PATIENT/DOCTOR/ADMIN with ownership enforcement)
 */
router.get(
  '/:id',
  authenticate,
  validate(consultationIdParamSchema, 'params'),
  ConsultationController.getConsultationById
);

/**
 * Update consultation status (explicit state transition matrix + SAGA compensation)
 */
router.patch(
  '/:id/status',
  authenticate,
  validate(consultationIdParamSchema, 'params'),
  validate(updateConsultationStatusSchema, 'body'),
  ConsultationController.updateStatus
);

export default router;
