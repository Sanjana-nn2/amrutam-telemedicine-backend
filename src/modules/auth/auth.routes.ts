import { Router } from 'express';
import { AuthController } from './auth.controller';
import { validateRequest } from '../../middleware/validate.middleware';
import { authenticate } from '../../middleware/auth.middleware';
import { authRateLimiter } from '../../middleware/rateLimiter.middleware';
import {
  registerSchema,
  loginSchema,
  refreshSchema,
  logoutSchema,
  mfaVerifySchema,
  mfaValidateSchema,
} from './auth.schema';

const router = Router();

// Public authentication routes (with strict rate limiting on registration & login)
router.post(
  '/register',
  authRateLimiter,
  validateRequest({ body: registerSchema }),
  AuthController.register
);

router.post(
  '/login',
  authRateLimiter,
  validateRequest({ body: loginSchema }),
  AuthController.login
);

router.post(
  '/refresh',
  validateRequest({ body: refreshSchema }),
  AuthController.refresh
);

router.post(
  '/logout',
  validateRequest({ body: logoutSchema }),
  AuthController.logout
);

// MFA step-up validation during login
router.post(
  '/mfa/validate',
  authRateLimiter,
  validateRequest({ body: mfaValidateSchema }),
  AuthController.mfaValidate
);

// Protected MFA setup & confirmation (requires active JWT access token)
router.post(
  '/mfa/setup',
  authenticate,
  AuthController.mfaSetup
);

router.post(
  '/mfa/verify',
  authenticate,
  validateRequest({ body: mfaVerifySchema }),
  AuthController.mfaVerify
);

export default router;
