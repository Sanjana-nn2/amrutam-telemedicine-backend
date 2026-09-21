import http from 'http';
import { createApp } from './app';
import { env } from './config/env';
import { logger } from './utils/logger';
import { connectDatabase, disconnectDatabase } from './config/database';
import { connectRedis, disconnectRedis } from './config/redis';

const app = createApp();
const server = http.createServer(app);

let isShuttingDown = false;

const gracefulShutdown = async (signal: string): Promise<void> => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info(`Received ${signal}. Initiating graceful shutdown...`);

  // Stop accepting new incoming requests
  server.close(async () => {
    logger.info('HTTP server closed. Releasing active database and cache connections...');
    try {
      await disconnectRedis();
      await disconnectDatabase();
      logger.info('Graceful shutdown completed successfully. Exiting.');
      process.exit(0);
    } catch (err) {
      logger.error('Error during graceful shutdown cleanup:', err);
      process.exit(1);
    }
  });

  // Force termination if cleanup takes longer than 10 seconds
  setTimeout(() => {
    logger.error('Shutdown deadline exceeded (10s). Forcing process exit.');
    process.exit(1);
  }, 10000).unref();
};

const startServer = async (): Promise<void> => {
  try {
    // Attempt database connection
    try {
      await connectDatabase();
    } catch (err) {
      logger.warn('Initial database connection failed. Server will continue with health check reporting DOWN until DB connects.', err);
    }

    // Attempt Redis connection
    await connectRedis();

    server.listen(env.PORT, () => {
      logger.info(`Amrutam Telemedicine Backend running on port ${env.PORT} in ${env.NODE_ENV} mode`);
      logger.info(`Health check live: http://localhost:${env.PORT}/health/live`);
      logger.info(`Health check ready: http://localhost:${env.PORT}/health/ready`);
    });

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    process.on('unhandledRejection', (reason: unknown) => {
      logger.error('Unhandled Promise Rejection detected:', reason);
    });

    process.on('uncaughtException', (err: Error) => {
      logger.error('Uncaught Exception thrown:', err);
      gracefulShutdown('uncaughtException');
    });
  } catch (err) {
    logger.error('Fatal error during application startup:', err);
    process.exit(1);
  }
};

startServer();
