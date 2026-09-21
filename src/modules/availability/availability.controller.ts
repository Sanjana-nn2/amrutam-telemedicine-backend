import { Request, Response, NextFunction } from 'express';
import { AvailabilityService } from './availability.service';

export class AvailabilityController {
  /**
   * POST /api/v1/availability/slots
   * Create availability slots batch (DOCTOR only)
   */
  public static async createSlots(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const userId = req.user!.id;

      const slots = await AvailabilityService.createSlots(
        userId,
        req.body,
        req.ip,
        req.get('user-agent')
      );

      res.status(201).json({
        success: true,
        message: `${slots.length} availability slot(s) created successfully`,
        data: slots,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/availability/doctors/:doctorId
   * Get available slots for a doctor (Public/Authenticated)
   */
  public static async getDoctorSlots(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const doctorId = req.params.doctorId;

      // Query parameters are already validated and transformed
      // by the route validation middleware.
      const result = await AvailabilityService.getDoctorSlots(
        doctorId,
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
   * DELETE /api/v1/availability/slots/:id
   * Cancel an unbooked slot (DOCTOR only, must own slot)
   */
  public static async cancelSlot(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const slotId = req.params.id;
      const userId = req.user!.id;

      const result = await AvailabilityService.cancelSlot(
        slotId,
        userId,
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
}