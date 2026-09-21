import { Request, Response, NextFunction } from 'express';
import { PrescriptionService } from './prescription.service';
import { CreatePrescriptionInput } from './prescription.schema';

export class PrescriptionController {
  public static create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const prescription = await PrescriptionService.createPrescription(
        req.user!.id,
        req.body as CreatePrescriptionInput
      );

      res.status(201).json({
        success: true,
        message: 'Prescription created successfully',
        data: prescription,
      });
    } catch (error) {
      next(error);
    }
  };

  public static getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const prescription = await PrescriptionService.getPrescriptionById(
        req.params.id,
        req.user!.id,
        req.user!.role
      );

      res.status(200).json({
        success: true,
        data: prescription,
      });
    } catch (error) {
      next(error);
    }
  };

  public static getByConsultationId = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const prescription = await PrescriptionService.getPrescriptionByConsultationId(
        req.params.consultationId,
        req.user!.id,
        req.user!.role
      );

      res.status(200).json({
        success: true,
        data: prescription,
      });
    } catch (error) {
      next(error);
    }
  };
}
