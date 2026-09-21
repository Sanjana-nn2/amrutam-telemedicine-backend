import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { requestLogger } from './middleware/requestLogger.middleware';
import { errorHandler } from './middleware/errorHandler.middleware';
import { globalRateLimiter } from './middleware/rateLimiter.middleware';
import { metricsMiddleware } from './middleware/metrics.middleware';
import { register, updateHealthGauges } from './modules/observability/metrics';
import healthRoutes from './modules/health/health.routes';
import authRoutes from './modules/auth/auth.routes';
import userRoutes from './modules/users/user.routes';
import doctorRoutes from './modules/doctors/doctor.routes';
import availabilityRoutes from './modules/availability/availability.routes';
import consultationRoutes from './modules/consultations/consultation.routes';
import paymentRoutes from './modules/payments/payment.routes';
import prescriptionRoutes from './modules/prescriptions/prescription.routes';
import adminRoutes from './modules/admin/admin.routes';
import swaggerRoutes from './modules/docs/swagger.routes';
import { NotFoundError } from './utils/errors';

export const createApp = (): Application => {
  const app: Application = express();

  // Basic security & parsing
  app.use(helmet());

  // Strict CORS configuration
  const allowedOrigins = env.CORS_ORIGIN.split(',').map((origin) => origin.trim());
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (e.g. mobile apps, curl) or if origin is in whitelist or wildcard
        if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error('CORS policy: Not allowed by CORS'));
        }
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID', 'Idempotency-Key'],
      exposedHeaders: ['X-Correlation-ID', 'Content-Disposition'],
      credentials: true,
      maxAge: 86400, // 24 hours
    })
  );

  // Request body size limit
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Prometheus Metrics instrumentation
  app.use(metricsMiddleware);

  // Correlation ID & HTTP Logging
  app.use(requestLogger);

  // Health check routes (exempt from rate limiting)
  app.use('/health', healthRoutes);

  // Prometheus Metrics endpoint (exempt from rate limiting)
  app.get('/metrics', async (_req: Request, res: Response) => {
    await updateHealthGauges();
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  // Swagger Documentation UI & OpenAPI schema (exempt from rate limiting)
  app.use('/api/docs', swaggerRoutes);

  // Root status endpoint
  app.get('/', (req: Request, res: Response) => {
    res.status(200).json({
      service: 'Amrutam Telemedicine Backend API',
      version: '1.0.0',
      status: 'OPERATIONAL',
      timestamp: new Date().toISOString(),
      correlationId: req.correlationId,
      endpoints: {
        healthLive: '/health/live',
        healthReady: '/health/ready',
        metrics: '/metrics',
        apiDocs: '/api/docs',
        apiV1: env.API_PREFIX,
      },
    });
  });

  // Apply Global Rate Limiting to all /api/v1 routes
  app.use(env.API_PREFIX, globalRateLimiter);

  // Mount API modules
  app.use(`${env.API_PREFIX}/auth`, authRoutes);
  app.use(`${env.API_PREFIX}/users`, userRoutes);
  app.use(`${env.API_PREFIX}/doctors`, doctorRoutes);
  app.use(`${env.API_PREFIX}/availability`, availabilityRoutes);
  app.use(`${env.API_PREFIX}/consultations`, consultationRoutes);
  app.use(`${env.API_PREFIX}/payments`, paymentRoutes);
  app.use(`${env.API_PREFIX}/prescriptions`, prescriptionRoutes);
  app.use(`${env.API_PREFIX}/admin`, adminRoutes);

  // Catch-all 404 handler
  app.use((req: Request, _res: Response, next: NextFunction) => {
    next(new NotFoundError(`Route ${req.method} ${req.originalUrl} not found`));
  });

  // Global Error Handler
  app.use(errorHandler);

  return app;
};
