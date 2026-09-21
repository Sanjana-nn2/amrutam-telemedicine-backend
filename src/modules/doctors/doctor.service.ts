import { prisma } from '../../config/database';
import { CacheService, CacheKeys, CACHE_TTL } from '../../utils/cache';
import { AuditService } from '../audit/audit.service';
import {
  NotFoundError,
  ConflictError,
  ForbiddenError,
  BadRequestError,
} from '../../utils/errors';
import { z } from 'zod';
import {
  createDoctorSchema,
  updateDoctorSchema,
  doctorSearchQuerySchema,
} from './doctor.schema';
import crypto from 'crypto';

type CreateDoctorInput = z.infer<typeof createDoctorSchema>;
type UpdateDoctorInput = z.infer<typeof updateDoctorSchema>;
type DoctorSearchQuery = z.infer<typeof doctorSearchQuerySchema>;

export class DoctorService {
  /**
   * Helper to format public-safe doctor profile.
   * Strips all internal user fields, password hashes, secrets, and sensitive PII.
   */
  public static formatPublicDoctor(doc: any) {
    return {
      id: doc.id,
      specialization: doc.specialization,
      licenseNumber: doc.licenseNumber,
      experienceYears: doc.experienceYears,
      bio: doc.bio,
      consultationFee: typeof doc.consultationFee === 'object' && doc.consultationFee !== null
        ? Number(doc.consultationFee)
        : doc.consultationFee,
      languages: doc.languages,
      isVerified: doc.isVerified,
      averageRating: typeof doc.averageRating === 'object' && doc.averageRating !== null
        ? Number(doc.averageRating)
        : doc.averageRating,
      totalReviews: doc.totalReviews,
      createdAt: doc.createdAt,
      user: {
        id: doc.user.id,
        email: doc.user.email,
        firstName: doc.user.profile?.firstName || 'Doctor',
        lastName: doc.user.profile?.lastName || '',
      },
    };
  }

  /**
   * Create or complete doctor profile for an authenticated DOCTOR user.
   * Prevents duplicates, ignores any attempts to self-verify.
   */
  public static async createProfile(
    userId: string,
    data: CreateDoctorInput,
    ipAddress?: string,
    userAgent?: string
  ) {
    // 1. Check if user already has a doctor profile
    const existingDoctor = await prisma.doctor.findUnique({
      where: { userId },
    });
    if (existingDoctor) {
      throw new ConflictError('A doctor profile already exists for this user account');
    }

    // 2. Check license number uniqueness
    const licenseExists = await prisma.doctor.findUnique({
      where: { licenseNumber: data.licenseNumber },
    });
    if (licenseExists) {
      throw new ConflictError('A doctor with this medical license number is already registered');
    }

    // 3. Create doctor profile (isVerified ALWAYS defaults to false)
    const doctor = await prisma.doctor.create({
      data: {
        userId,
        specialization: data.specialization,
        licenseNumber: data.licenseNumber,
        experienceYears: data.experienceYears,
        bio: data.bio ?? null,
        consultationFee: data.consultationFee,
        languages: data.languages,
        isVerified: false, // New doctor can NEVER self-verify
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            profile: {
              select: { firstName: true, lastName: true },
            },
          },
        },
      },
    });

    // 4. Invalidate search cache so new doctors can be indexed once verified
    await CacheService.delByPattern(CacheKeys.doctorListPattern());

    // 5. Audit log
    await AuditService.log({
      userId,
      action: 'DOCTOR_PROFILE_CREATED',
      resource: 'Doctor',
      resourceId: doctor.id,
      ipAddress,
      userAgent,
      details: {
        specialization: doctor.specialization,
        licenseNumber: doctor.licenseNumber,
      },
    });

    return this.formatPublicDoctor(doctor);
  }

  /**
   * Update doctor profile.
   * Doctor can only update their own profile; ADMIN can also update.
   */
  public static async updateProfile(
    doctorId: string,
    userId: string,
    userRole: string,
    data: UpdateDoctorInput,
    ipAddress?: string,
    userAgent?: string
  ) {
    const doctor = await prisma.doctor.findUnique({
      where: { id: doctorId },
      include: { user: true },
    });

    if (!doctor) {
      throw new NotFoundError(`Doctor with ID ${doctorId} not found`);
    }

    // RBAC: Doctor can only update their own profile; Admin can update any
    if (userRole !== 'ADMIN' && doctor.userId !== userId) {
      throw new ForbiddenError('You are not authorized to modify another doctor profile');
    }

    // If updating license number, verify uniqueness
    if (data.licenseNumber && data.licenseNumber !== doctor.licenseNumber) {
      const licenseConflict = await prisma.doctor.findUnique({
        where: { licenseNumber: data.licenseNumber },
      });
      if (licenseConflict) {
        throw new ConflictError('A doctor with this medical license number is already registered');
      }
    }

    const updatedDoctor = await prisma.doctor.update({
      where: { id: doctorId },
      data: {
        ...(data.specialization !== undefined && { specialization: data.specialization }),
        ...(data.licenseNumber !== undefined && { licenseNumber: data.licenseNumber }),
        ...(data.experienceYears !== undefined && { experienceYears: data.experienceYears }),
        ...(data.consultationFee !== undefined && { consultationFee: data.consultationFee }),
        ...(data.languages !== undefined && { languages: data.languages }),
        ...(data.bio !== undefined && { bio: data.bio }),
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            profile: {
              select: { firstName: true, lastName: true },
            },
          },
        },
      },
    });

    // Invalidate Redis cache
    await CacheService.invalidateDoctorProfile(doctorId);

    // Audit log
    await AuditService.log({
      userId,
      action: 'DOCTOR_PROFILE_UPDATED',
      resource: 'Doctor',
      resourceId: doctorId,
      ipAddress,
      userAgent,
      details: {
        updatedFields: Object.keys(data),
      },
    });

    return this.formatPublicDoctor(updatedDoctor);
  }

  /**
   * ADMIN only: Mark doctor verified/unverified.
   */
  public static async verifyDoctor(
    doctorId: string,
    isVerified: boolean,
    adminUserId: string,
    ipAddress?: string,
    userAgent?: string
  ) {
    const doctor = await prisma.doctor.findUnique({
      where: { id: doctorId },
    });

    if (!doctor) {
      throw new NotFoundError(`Doctor with ID ${doctorId} not found`);
    }

    const updatedDoctor = await prisma.doctor.update({
      where: { id: doctorId },
      data: { isVerified },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            profile: {
              select: { firstName: true, lastName: true },
            },
          },
        },
      },
    });

    // Invalidate cache
    await CacheService.invalidateDoctorProfile(doctorId);

    // Audit log
    await AuditService.log({
      userId: adminUserId,
      action: isVerified ? 'DOCTOR_VERIFIED' : 'DOCTOR_UNVERIFIED',
      resource: 'Doctor',
      resourceId: doctorId,
      ipAddress,
      userAgent,
      details: {
        isVerified,
      },
    });

    return {
      message: `Doctor ${isVerified ? 'verified' : 'unverified'} successfully`,
      doctor: this.formatPublicDoctor(updatedDoctor),
    };
  }

  /**
   * Get public-safe doctor profile by ID with Redis cache-aside.
   */
  public static async getDoctorById(doctorId: string) {
    const cacheKey = CacheKeys.doctorProfile(doctorId);

    // 1. Try Redis cache
    const cached = await CacheService.get<ReturnType<typeof DoctorService.formatPublicDoctor>>(cacheKey);
    if (cached) {
      return cached;
    }

    // 2. Fetch from DB
    const doctor = await prisma.doctor.findUnique({
      where: { id: doctorId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            profile: {
              select: { firstName: true, lastName: true },
            },
          },
        },
      },
    });

    if (!doctor) {
      throw new NotFoundError(`Doctor with ID ${doctorId} not found`);
    }

    const formatted = this.formatPublicDoctor(doctor);

    // 3. Set Redis cache (TTL: 10 mins)
    await CacheService.set(cacheKey, formatted, CACHE_TTL.DOCTOR_PROFILE);

    return formatted;
  }

  /**
   * Search and filter doctors directory with pagination and Redis cache-aside.
   */
  public static async searchDoctors(query: DoctorSearchQuery) {
    // Generate deterministic cache key from normalized query
    const normalizedQuery = {
      spec: query.specialization || '',
      lang: query.language || '',
      minF: query.minFee || '',
      maxF: query.maxFee || '',
      minR: query.minRating || '',
      date: query.date || '',
      page: query.page,
      lim: query.limit,
      sort: query.sortBy,
    };
    const queryHash = crypto.createHash('sha256').update(JSON.stringify(normalizedQuery)).digest('hex');
    const cacheKey = CacheKeys.doctorList(queryHash);

    // 1. Try Redis cache
    const cached = await CacheService.get<{
      data: ReturnType<typeof DoctorService.formatPublicDoctor>[];
      pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
        hasNext: boolean;
        hasPrev: boolean;
      };
    }>(cacheKey);

    if (cached) {
      return cached;
    }

    // 2. Build Prisma where clause
    const where: any = {
      isVerified: true, // Only verified doctors appear in public search
      user: {
        isActive: true, // Ensure doctor account is active
      },
    };

    if (query.specialization) {
      where.specialization = {
        contains: query.specialization,
        mode: 'insensitive',
      };
    }

    if (query.language) {
      where.languages = {
        has: query.language,
      };
    }

    if (query.minFee !== undefined || query.maxFee !== undefined) {
      where.consultationFee = {};
      if (query.minFee !== undefined) {
        where.consultationFee.gte = query.minFee;
      }
      if (query.maxFee !== undefined) {
        where.consultationFee.lte = query.maxFee;
      }
    }

    if (query.minRating !== undefined) {
      where.averageRating = {
        gte: query.minRating,
      };
    }

    // Availability date filter
    if (query.date) {
      const targetDate = new Date(query.date);
      const startOfDay = new Date(Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate(), 0, 0, 0));
      const endOfDay = new Date(Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate(), 23, 59, 59, 999));

      where.availabilitySlots = {
        some: {
          status: 'AVAILABLE',
          startTime: {
            gte: startOfDay,
            lte: endOfDay,
          },
        },
      };
    }

    // Build orderBy
    let orderBy: any = {};
    switch (query.sortBy) {
      case 'fee_asc':
        orderBy = { consultationFee: 'asc' };
        break;
      case 'fee_desc':
        orderBy = { consultationFee: 'desc' };
        break;
      case 'experience':
        orderBy = { experienceYears: 'desc' };
        break;
      case 'newest':
        orderBy = { createdAt: 'desc' };
        break;
      case 'rating':
      default:
        orderBy = [{ averageRating: 'desc' }, { totalReviews: 'desc' }];
        break;
    }

    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;

    // Run parallel count and query
    const [total, doctors] = await Promise.all([
      prisma.doctor.count({ where }),
      prisma.doctor.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              profile: {
                select: { firstName: true, lastName: true },
              },
            },
          },
        },
      }),
    ]);

    const formattedDoctors = doctors.map(DoctorService.formatPublicDoctor);
    const totalPages = Math.ceil(total / limit);

    const result = {
      data: formattedDoctors,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };

    // 3. Store in Redis cache (TTL: 2 mins)
    await CacheService.set(cacheKey, result, CACHE_TTL.DOCTOR_LIST);

    return result;
  }
}
