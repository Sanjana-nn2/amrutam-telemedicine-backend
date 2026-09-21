import { Request, Response, NextFunction } from 'express';
import { ZodTypeAny, ZodError } from 'zod';

interface RequestValidationSchema {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

export const validateRequest = (schema: RequestValidationSchema) => {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (schema.body) {
        req.body = await schema.body.parseAsync(req.body);
      }
      if (schema.query) {
        req.query = (await schema.query.parseAsync(req.query)) as any;
      }
      if (schema.params) {
        req.params = (await schema.params.parseAsync(req.params)) as any;
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(error);
      } else {
        next(error);
      }
    }
  };
};

export const validate = (schema: ZodTypeAny, target: 'body' | 'query' | 'params' = 'body') => {
  return validateRequest({ [target]: schema });
};

export const validateBody = (schema: ZodTypeAny) => validate(schema, 'body');
export const validateQuery = (schema: ZodTypeAny) => validate(schema, 'query');
export const validateParams = (schema: ZodTypeAny) => validate(schema, 'params');

