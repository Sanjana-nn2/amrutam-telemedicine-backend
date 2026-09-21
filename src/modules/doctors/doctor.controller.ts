import { Request, Response, NextFunction } from 'express';
import { DoctorService } from './doctor.service';

export class DoctorController {
  /**
   * POST /api/v1/doctors
   * Create doctor profile (DOCTOR only)
   */
  public static async createProfile(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const userId = req.user!.id;

      const result = await DoctorService.createProfile(
        userId,
        req.body,
        req.ip,
        req.get('user-agent')
      );

      res.status(201).json({
        success: true,
        message:
          'Doctor profile created successfully. Pending administrator verification.',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/v1/doctors/:id
   * Update doctor profile (DOCTOR own profile, or ADMIN)
   */
  public static async updateProfile(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const doctorId = req.params.id;
      const userId = req.user!.id;
      const userRole = req.user!.role;

      const result = await DoctorService.updateProfile(
        doctorId,
        userId,
        userRole,
        req.body,
        req.ip,
        req.get('user-agent')
      );

      res.status(200).json({
        success: true,
        message: 'Doctor profile updated successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/v1/doctors/:id/verify
   * Verify or unverify doctor (ADMIN only)
   */
  public static async verifyDoctor(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const doctorId = req.params.id;
      const adminUserId = req.user!.id;
      const { isVerified } = req.body;

      const result = await DoctorService.verifyDoctor(
        doctorId,
        isVerified,
        adminUserId,
        req.ip,
        req.get('user-agent')
      );

      res.status(200).json({
        success: true,
        ...result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/doctors/:id
   * Get public-safe doctor profile by ID (Public)
   */
  public static async getDoctorById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const doctorId = req.params.id;

      const doctor = await DoctorService.getDoctorById(doctorId);

      res.status(200).json({
        success: true,
        data: doctor,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/doctors
   * Search doctors with pagination and filters (Public)
   */
  public static async searchDoctors(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      // Query parameters are already validated and transformed
      // by the route validation middleware.
      const result = await DoctorService.searchDoctors(req.query as any);

      res.status(200).json({
        success: true,
        ...result,
      });
    } catch (error) {
      next(error);
    }
  }
}