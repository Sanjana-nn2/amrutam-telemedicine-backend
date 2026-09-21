import bcrypt from 'bcrypt';
import { generateSecret, generateURI, verifySync } from 'otplib';
import qrcode from 'qrcode';
import { prisma } from '../../config/database';
import { UserRole } from '@prisma/client';
import {
  signAccessToken,
  signMfaTempToken,
  generateRefreshToken,
  hashToken,
  verifyMfaTempToken,
} from '../../utils/jwt';
import { encrypt, decrypt } from '../../utils/encryption';
import { AuditService } from '../audit/audit.service';
import {
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
  BadRequestError,
} from '../../utils/errors';
import { z } from 'zod';
import { registerSchema, loginSchema } from './auth.schema';

type RegisterInput = z.infer<typeof registerSchema>;
type LoginInput = z.infer<typeof loginSchema>;

export class AuthService {
  /**
   * Registers a new user (PATIENT or DOCTOR).
   * Prevents ADMIN self-registration.
   * Hashes password with bcrypt (cost factor 12).
   */
  public static async register(
    input: RegisterInput,
    ipAddress?: string,
    userAgent?: string
  ) {
    const existingUser = await prisma.user.findUnique({
      where: { email: input.email },
    });

    if (existingUser) {
      throw new ConflictError('An account with this email address already exists.');
    }

    // Hash password with cost factor 12
    const passwordHash = await bcrypt.hash(input.password, 12);

    // Encrypt phone number for PII privacy
    const encryptedPhone = input.phone ? encrypt(input.phone) : null;

    const userRole = input.role === 'DOCTOR' ? UserRole.DOCTOR : UserRole.PATIENT;

    // Atomic creation of user, profile, and doctor record if applicable
    const newUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          passwordHash,
          role: userRole,
          isActive: true,
          isEmailVerified: false,
          mfaEnabled: false,
          profile: {
            create: {
              firstName: input.firstName,
              lastName: input.lastName,
              phone: encryptedPhone,
            },
          },
          ...(userRole === UserRole.DOCTOR
            ? {
                doctor: {
                  create: {
                    specialization: input.specialization!,
                    licenseNumber: input.licenseNumber!,
                    experienceYears: input.experienceYears || 0,
                    consultationFee: input.consultationFee || 500,
                    languages: input.languages || ['English'],
                    bio: input.bio || null,
                    isVerified: false, // Must be verified by ADMIN before accepting consultations
                  },
                },
              }
            : {}),
        },
        select: {
          id: true,
          email: true,
          role: true,
          isActive: true,
          isEmailVerified: true,
          mfaEnabled: true,
          createdAt: true,
          profile: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
          doctor: {
            select: {
              id: true,
              specialization: true,
              licenseNumber: true,
              isVerified: true,
            },
          },
        },
      });

      return user;
    });

    // Write audit log
    await AuditService.log({
      userId: newUser.id,
      action: 'USER_REGISTERED',
      resource: 'User',
      resourceId: newUser.id,
      ipAddress,
      userAgent,
      details: {
        role: newUser.role,
        email: newUser.email,
        isDoctor: userRole === UserRole.DOCTOR,
      },
    });

    return {
      message: 'Registration successful',
      user: newUser,
    };
  }

  /**
   * Authenticates user via email and password.
   * Returns JWT access token + refresh token, or triggers MFA challenge.
   */
  public static async login(
    input: LoginInput,
    ipAddress?: string,
    userAgent?: string
  ) {
    const user = await prisma.user.findUnique({
      where: { email: input.email },
      include: {
        profile: true,
        doctor: true,
      },
    });

    // Constant-time comparison prevention check
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
      await AuditService.log({
        action: 'LOGIN_FAILED',
        resource: 'Auth',
        ipAddress,
        userAgent,
        details: { attemptedEmail: input.email },
      });
      throw new UnauthorizedError('Invalid email or password');
    }

    if (!user.isActive) {
      throw new ForbiddenError('Account has been deactivated. Please contact administrator.');
    }

    // If MFA is enabled, issue temporary MFA challenge token
    if (user.mfaEnabled) {
      const mfaToken = signMfaTempToken(user.id, user.email, user.role);
      await AuditService.log({
        userId: user.id,
        action: 'MFA_CHALLENGE_ISSUED',
        resource: 'Auth',
        ipAddress,
        userAgent,
      });

      return {
        mfaRequired: true,
        mfaToken,
        message: 'Two-factor authentication code required',
      };
    }

    // Generate tokens
    const accessToken = signAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      mfaAuthenticated: false,
    });

    const rawRefreshToken = generateRefreshToken();
    const tokenHash = hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    await AuditService.log({
      userId: user.id,
      action: 'LOGIN_SUCCESS',
      resource: 'Auth',
      ipAddress,
      userAgent,
      details: { role: user.role },
    });

    return {
      mfaRequired: false,
      accessToken,
      refreshToken: rawRefreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        isEmailVerified: user.isEmailVerified,
        mfaEnabled: user.mfaEnabled,
        profile: user.profile
          ? {
              firstName: user.profile.firstName,
              lastName: user.profile.lastName,
            }
          : null,
        doctor: user.doctor
          ? {
              id: user.doctor.id,
              specialization: user.doctor.specialization,
              isVerified: user.doctor.isVerified,
            }
          : null,
      },
    };
  }

  /**
   * Rotates refresh token: revokes current token and issues fresh pair.
   */
  public static async refresh(
    rawRefreshToken: string,
    ipAddress?: string,
    userAgent?: string
  ) {
    const tokenHash = hashToken(rawRefreshToken);

    const storedToken = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: {
        user: true,
      },
    });

    if (!storedToken || storedToken.revoked || storedToken.expiresAt < new Date()) {
      throw new UnauthorizedError('Invalid, expired, or revoked refresh token. Please log in again.');
    }

    if (!storedToken.user.isActive) {
      throw new ForbiddenError('User account is deactivated');
    }

    // Revoke current token (Token Rotation)
    await prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revoked: true },
    });

    // Issue new pair
    const newAccessToken = signAccessToken({
      userId: storedToken.user.id,
      email: storedToken.user.email,
      role: storedToken.user.role,
      mfaAuthenticated: storedToken.user.mfaEnabled,
    });

    const newRawRefreshToken = generateRefreshToken();
    const newTokenHash = hashToken(newRawRefreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await prisma.refreshToken.create({
      data: {
        userId: storedToken.user.id,
        tokenHash: newTokenHash,
        expiresAt,
      },
    });

    await AuditService.log({
      userId: storedToken.user.id,
      action: 'TOKEN_ROTATED',
      resource: 'Auth',
      ipAddress,
      userAgent,
    });

    return {
      accessToken: newAccessToken,
      refreshToken: newRawRefreshToken,
    };
  }

  /**
   * Revokes refresh token on logout.
   */
  public static async logout(
    rawRefreshToken: string,
    userId?: string,
    ipAddress?: string,
    userAgent?: string
  ) {
    const tokenHash = hashToken(rawRefreshToken);

    await prisma.refreshToken.updateMany({
      where: { tokenHash, revoked: false },
      data: { revoked: true },
    });

    if (userId) {
      await AuditService.log({
        userId,
        action: 'USER_LOGOUT',
        resource: 'Auth',
        ipAddress,
        userAgent,
      });
    }

    return { message: 'Logged out successfully' };
  }

  /**
   * Initiates TOTP MFA setup.
   * Generates secret, otpauth URI, and QR code data URI.
   * Encrypts secret at rest in DB.
   */
  public static async mfaSetup(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    const secret = generateSecret();
    const otpauthUrl = generateURI({ issuer: 'Amrutam Telemedicine', label: user.email, secret });
    const qrCodeDataUrl = await qrcode.toDataURL(otpauthUrl);

    // Encrypt MFA secret using AES-256-GCM before database storage
    const encryptedSecret = encrypt(secret);

    await prisma.user.update({
      where: { id: userId },
      data: {
        mfaSecret: encryptedSecret,
        // mfaEnabled stays false until verified with code
      },
    });

    await AuditService.log({
      userId,
      action: 'MFA_SETUP_INITIATED',
      resource: 'User',
      resourceId: userId,
    });

    return {
      secret, // Transmitted once during initial setup so user can type it in authenticator app
      otpauthUrl,
      qrCode: qrCodeDataUrl,
      instructions: 'Scan the QR code with your authenticator app (Google Authenticator, Authy) and submit the 6-digit code to /auth/mfa/verify to activate.',
    };
  }

  /**
   * Confirms TOTP code and activates MFA for user.
   */
  public static async mfaVerify(userId: string, token: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.mfaSecret) {
      throw new BadRequestError('MFA setup has not been initiated. Call /auth/mfa/setup first.');
    }

    // Decrypt secret from database
    const decryptedSecret = decrypt(user.mfaSecret);
    const result = verifySync({ token, secret: decryptedSecret });

    if (!result.valid) {
      throw new BadRequestError('Invalid TOTP verification code. Please check your authenticator clock.');
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        mfaEnabled: true,
      },
    });

    await AuditService.log({
      userId,
      action: 'MFA_ENABLED',
      resource: 'User',
      resourceId: userId,
    });

    return {
      success: true,
      message: 'Two-factor authentication has been successfully activated.',
    };
  }

  /**
   * Validates TOTP code during multi-factor login (step-up authentication).
   */
  public static async mfaValidate(
    mfaToken: string,
    token: string,
    ipAddress?: string,
    userAgent?: string
  ) {
    const payload = verifyMfaTempToken(mfaToken);

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: {
        profile: true,
        doctor: true,
      },
    });

    if (!user || !user.mfaSecret || !user.mfaEnabled) {
      throw new UnauthorizedError('MFA is not configured for this account');
    }

    if (!user.isActive) {
      throw new ForbiddenError('Account is deactivated');
    }

    const decryptedSecret = decrypt(user.mfaSecret);
    const result = verifySync({ token, secret: decryptedSecret });

    if (!result.valid) {
      await AuditService.log({
        userId: user.id,
        action: 'MFA_VALIDATION_FAILED',
        resource: 'Auth',
        ipAddress,
        userAgent,
      });
      throw new UnauthorizedError('Invalid two-factor authentication code');
    }

    // Generate final tokens
    const accessToken = signAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      mfaAuthenticated: true,
    });

    const rawRefreshToken = generateRefreshToken();
    const tokenHash = hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    await AuditService.log({
      userId: user.id,
      action: 'MFA_LOGIN_SUCCESS',
      resource: 'Auth',
      ipAddress,
      userAgent,
      details: { role: user.role },
    });

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        isEmailVerified: user.isEmailVerified,
        mfaEnabled: user.mfaEnabled,
        profile: user.profile
          ? {
              firstName: user.profile.firstName,
              lastName: user.profile.lastName,
            }
          : null,
        doctor: user.doctor
          ? {
              id: user.doctor.id,
              specialization: user.doctor.specialization,
              isVerified: user.doctor.isVerified,
            }
          : null,
      },
    };
  }
}
