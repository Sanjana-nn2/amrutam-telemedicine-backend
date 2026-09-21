import { Router } from 'express';
import { AvailabilityController } from './availability.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/rbac.middleware';
import { validate } from '../../middleware/validate.middleware';
import { UserRole } from '@prisma/client';
import {
  createSlotsSchema,
  doctorSlotsQuerySchema,
  slotIdParamSchema,
  doctorIdParamSchema,
} from './availability.schema';

const router = Router();

/**
 * Public / Authenticated route: Get available slots for a doctor
 */
router.get(
  '/doctors/:doctorId',
  validate(doctorIdParamSchema, 'params'),
  validate(doctorSlotsQuerySchema, 'query'),
  AvailabilityController.getDoctorSlots
);

/**
 * Doctor-only route: Batch create availability slots
 */
router.post(
  '/slots',
  authenticate,
  requireRole(UserRole.DOCTOR),
  validate(createSlotsSchema, 'body'),
  AvailabilityController.createSlots
);

/**
 * Doctor-only route: Cancel an unbooked availability slot
 */
router.delete(
  '/slots/:id',
  authenticate,
  requireRole(UserRole.DOCTOR),
  validate(slotIdParamSchema, 'params'),
  AvailabilityController.cancelSlot
);

export default router;
