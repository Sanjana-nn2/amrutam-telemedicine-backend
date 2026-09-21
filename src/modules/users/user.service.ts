import { prisma } from '../../config/database';
import { encrypt, decrypt } from '../../utils/encryption';
import { AuditService } from '../audit/audit.service';
import { NotFoundError, BadRequestError } from '../../utils/errors';
import { z } from 'zod';
import { updateProfileSchema } from './user.schema';

type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export class UserService {
  /**
   * Retrieves profile of current authenticated user.
   * Transparently decrypts sensitive PHI/PII fields (phone, emergency contact).
   */
  public static async getMe(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        isEmailVerified: true,
        mfaEnabled: true,
        createdAt: true,
        updatedAt: true,
        profile: true,
        doctor: {
          select: {
            id: true,
            specialization: true,
            licenseNumber: true,
            experienceYears: true,
            bio: true,
            consultationFee: true,
            languages: true,
            isVerified: true,
            averageRating: true,
            totalReviews: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundError('User profile not found');
    }

    // Decrypt sensitive fields for user view
    const safeProfile = user.profile
      ? {
          ...user.profile,
          phone: user.profile.phone ? decrypt(user.profile.phone) : null,
          emergencyContact: user.profile.emergencyContact ? decrypt(user.profile.emergencyContact) : null,
        }
      : null;

    return {
      ...user,
      profile: safeProfile,
    };
  }

  /**
   * Updates profile details of the current authenticated user.
   * Encrypts sensitive fields with AES-256-GCM before saving to database.
   */
  public static async updateProfile(
    userId: string,
    data: UpdateProfileInput,
    ipAddress?: string,
    userAgent?: string
  ) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    const encryptedPhone = data.phone !== undefined ? (data.phone ? encrypt(data.phone) : null) : undefined;
    const encryptedEmergencyContact =
      data.emergencyContact !== undefined
        ? data.emergencyContact
          ? encrypt(data.emergencyContact)
          : null
        : undefined;

    let parsedDob: Date | undefined = undefined;
    if (data.dateOfBirth) {
      parsedDob = new Date(data.dateOfBirth);
      if (isNaN(parsedDob.getTime())) {
        throw new BadRequestError('Invalid date of birth format');
      }
    }

    const updatedProfile = await prisma.profile.upsert({
      where: { userId },
      create: {
        userId,
        firstName: data.firstName ?? 'User',
        lastName: data.lastName ?? '',
        phone: encryptedPhone ?? null,
        emergencyContact: encryptedEmergencyContact ?? null,
        dateOfBirth: parsedDob ?? null,
        gender: data.gender ?? null,
        bloodGroup: data.bloodGroup ?? null,
      },
      update: {
        ...(data.firstName !== undefined && { firstName: data.firstName }),
        ...(data.lastName !== undefined && { lastName: data.lastName }),
        ...(encryptedPhone !== undefined && { phone: encryptedPhone }),
        ...(encryptedEmergencyContact !== undefined && { emergencyContact: encryptedEmergencyContact }),
        ...(parsedDob !== undefined && { dateOfBirth: parsedDob }),
        ...(data.gender !== undefined && { gender: data.gender }),
        ...(data.bloodGroup !== undefined && { bloodGroup: data.bloodGroup }),
      },
    });

    await AuditService.log({
      userId,
      action: 'PROFILE_UPDATED',
      resource: 'Profile',
      resourceId: updatedProfile.id,
      ipAddress,
      userAgent,
      details: {
        updatedFields: Object.keys(data),
      },
    });

    return {
      message: 'Profile updated successfully',
      profile: {
        ...updatedProfile,
        phone: updatedProfile.phone ? decrypt(updatedProfile.phone) : null,
        emergencyContact: updatedProfile.emergencyContact ? decrypt(updatedProfile.emergencyContact) : null,
      },
    };
  }

  /**
   * Retrieves any user by ID (ADMIN only).
   */
  public static async getUserById(userId: string, adminUserId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        isEmailVerified: true,
        mfaEnabled: true,
        createdAt: true,
        updatedAt: true,
        profile: true,
        doctor: true,
      },
    });

    if (!user) {
      throw new NotFoundError(`User with ID ${userId} not found`);
    }

    await AuditService.log({
      userId: adminUserId,
      action: 'ADMIN_VIEWED_USER',
      resource: 'User',
      resourceId: userId,
    });

    return {
      ...user,
      profile: user.profile
        ? {
            ...user.profile,
            phone: user.profile.phone ? decrypt(user.profile.phone) : null,
            emergencyContact: user.profile.emergencyContact ? decrypt(user.profile.emergencyContact) : null,
          }
        : null,
    };
  }

  /**
   * Toggles account active status (ADMIN only).
   * Revokes all refresh tokens if account is being deactivated.
   */
  public static async updateUserStatus(
    userId: string,
    isActive: boolean,
    adminUserId: string,
    ipAddress?: string,
    userAgent?: string
  ) {
    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!targetUser) {
      throw new NotFoundError(`User with ID ${userId} not found`);
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { isActive },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        updatedAt: true,
      },
    });

    // If deactivating, revoke all active sessions immediately
    if (!isActive) {
      await prisma.refreshToken.updateMany({
        where: { userId, revoked: false },
        data: { revoked: true },
      });
    }

    await AuditService.log({
      userId: adminUserId,
      action: isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
      resource: 'User',
      resourceId: userId,
      ipAddress,
      userAgent,
      details: {
        targetUserId: userId,
        newStatus: isActive,
      },
    });

    return {
      message: `User status updated to ${isActive ? 'ACTIVE' : 'DEACTIVATED'}`,
      user: updatedUser,
    };
  }
}
