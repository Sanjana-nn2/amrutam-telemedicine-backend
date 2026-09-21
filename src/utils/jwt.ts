import crypto from 'crypto';
import jwt, { SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import { UserRole } from '@prisma/client';
import { UnauthorizedError } from './errors';

export interface JwtPayload {
  userId: string;
  email: string;
  role: UserRole;
  mfaAuthenticated?: boolean;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

/**
 * Signs a short-lived access token with user claims.
 */
export const signAccessToken = (payload: JwtPayload): string => {
  const options: SignOptions = {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as any,
  };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, options);
};

/**
 * Signs a temporary token for step-up MFA verification.
 */
export const signMfaTempToken = (userId: string, email: string, role: UserRole): string => {
  const options: SignOptions = {
    expiresIn: '5m' as any,
  };
  return jwt.sign({ userId, email, role, mfaPending: true }, env.JWT_ACCESS_SECRET, options);
};

/**
 * Generates an opaque, cryptographically random refresh token.
 */
export const generateRefreshToken = (): string => {
  return crypto.randomBytes(48).toString('hex');
};

/**
 * Hashes a refresh token using SHA-256 before storing it in PostgreSQL.
 * Plaintext refresh tokens are never stored in the database.
 */
export const hashToken = (token: string): string => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

/**
 * Verifies and decodes an access token.
 */
export const verifyAccessToken = (token: string): JwtPayload => {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError('Access token has expired');
    }
    throw new UnauthorizedError('Invalid access token');
  }
};

/**
 * Verifies a temporary MFA token.
 */
export const verifyMfaTempToken = (token: string): { userId: string; email: string; role: UserRole } => {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as any;
    if (!decoded.mfaPending) {
      throw new UnauthorizedError('Invalid MFA token state');
    }
    return {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
    };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError('MFA verification session expired. Please log in again.');
    }
    throw new UnauthorizedError('Invalid MFA token');
  }
};
