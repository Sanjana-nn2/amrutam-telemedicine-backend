import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { env } from './env';

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

export const prisma =
  globalThis.prismaGlobal ??
  new PrismaClient({
    log:
      env.NODE_ENV === 'development'
        ? [
            { emit: 'event', level: 'query' },
            { emit: 'event', level: 'error' },
            { emit: 'event', level: 'warn' },
          ]
        : [{ emit: 'event', level: 'error' }],
  });

if (env.NODE_ENV !== 'production') {
  globalThis.prismaGlobal = prisma;
}

// Log queries in development
if (env.NODE_ENV === 'development') {
  // @ts-expect-error Prisma event typing
  prisma.$on('query', (e: { query: string; params: string; duration: number }) => {
    logger.debug(`Prisma Query [${e.duration}ms]: ${e.query}`);
  });
}

// @ts-expect-error Prisma event typing
prisma.$on('error', (e: { message: string }) => {
  logger.error(`Prisma Error: ${e.message}`);
});

export const connectDatabase = async (): Promise<void> => {
  try {
    await prisma.$connect();
    logger.info('Database connection established successfully');
  } catch (error) {
    logger.error('Failed to establish database connection:', error);
    throw error;
  }
};

export const disconnectDatabase = async (): Promise<void> => {
  try {
    await prisma.$disconnect();
    logger.info('Database connection closed cleanly');
  } catch (error) {
    logger.error('Error during database disconnect:', error);
  }
};
