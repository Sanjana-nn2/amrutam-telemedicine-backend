import { Request, Response, NextFunction } from 'express';
import { ConsultationService } from './consultation.service';

export class ConsultationController {
  /**
   * POST /api/v1/consultations/book
   * Concurrency-safe, atomic appointment booking (PATIENT only)
   */
  public static async book(req: Request, res: Response, next: NextFunction) {
    try {
      const patientId = req.user!.id;

      const consultation = await ConsultationService.bookConsultation(
        patientId,
        req.body,
        req.ip,
        req.get('user-agent')
      );

      res.status(201).json({
        success: true,
        message:
          'Consultation appointment booked successfully. Pending payment.',
        data: consultation,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/consultations
   * List consultations with role-based isolation (PATIENT/DOCTOR/ADMIN)
   */
  public static async getConsultations(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const userId = req.user!.id;
      const userRole = req.user!.role;

      // Query has already been validated/transformed by middleware.
      const result = await ConsultationService.getConsultations(
        userId,
        userRole,
        req.query as any
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
   * GET /api/v1/consultations/:id
   * Get single consultation by ID with access control
   */
  public static async getConsultationById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const consultationId = req.params.id;
      const userId = req.user!.id;
      const userRole = req.user!.role;

      const consultation =
        await ConsultationService.getConsultationById(
          consultationId,
          userId,
          userRole
        );

      res.status(200).json({
        success: true,
        data: consultation,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/v1/consultations/:id/status
   * Update consultation status with explicit state transition matrix
   */
  public static async updateStatus(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const consultationId = req.params.id;
      const userId = req.user!.id;
      const userRole = req.user!.role;

      const updated = await ConsultationService.updateStatus(
        consultationId,
        userId,
        userRole,
        req.body,
        req.ip,
        req.get('user-agent')
      );

      res.status(200).json({
        success: true,
        message: `Consultation status successfully updated to ${updated.status}`,
        data: updated,
      });
    } catch (error) {
      next(error);
    }
  }
}