import crypto from 'crypto';
import { logger } from './logger';
import { withRetry } from './retry';

export interface JobPayload<T = unknown> {
  id: string;
  type: string;
  data: T;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
}

export type JobHandler<T = unknown> = (job: JobPayload<T>) => Promise<void>;

export interface IJobQueue {
  enqueue<T>(type: string, data: T, options?: { maxAttempts?: number; delayMs?: number }): Promise<string>;
  registerHandler<T>(type: string, handler: JobHandler<T>): void;
  getPendingCount(): number;
}

/**
 * Standard Job Types in Amrutam Telemedicine System
 */
export const JobTypes = {
  NOTIFICATION_APPOINTMENT_CONFIRMED: 'NOTIFICATION_APPOINTMENT_CONFIRMED',
  NOTIFICATION_PAYMENT_CONFIRMED: 'NOTIFICATION_PAYMENT_CONFIRMED',
  NOTIFICATION_PRESCRIPTION_ISSUED: 'NOTIFICATION_PRESCRIPTION_ISSUED',
  AUDIT_EVENT_DISPATCH: 'AUDIT_EVENT_DISPATCH',
} as const;

/**
 * In-Process Async Job Queue Adapter.
 *
 * Implements non-blocking execution using setImmediate / microtasks with
 * automatic exponential backoff and jitter retry via withRetry().
 *
 * Production Strategy Note:
 * This interface (IJobQueue) can be swapped in production with BullMQ (backed by Redis Cluster)
 * or AWS SQS / Apache Kafka without changing calling code in application services.
 */
class InMemoryJobQueue implements IJobQueue {
  private handlers = new Map<string, JobHandler<any>>();
  private pendingCount = 0;

  public registerHandler<T>(type: string, handler: JobHandler<T>): void {
    this.handlers.set(type, handler);
    logger.info(`[AsyncJobQueue] Registered handler for job type: ${type}`);
  }

  public async enqueue<T>(
    type: string,
    data: T,
    options: { maxAttempts?: number; delayMs?: number } = {}
  ): Promise<string> {
    const jobId = `job-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const maxAttempts = options.maxAttempts ?? 3;
    const delayMs = options.delayMs ?? 0;

    const job: JobPayload<T> = {
      id: jobId,
      type,
      data,
      attempts: 0,
      maxAttempts,
      createdAt: new Date(),
    };

    this.pendingCount++;

    // Process asynchronously without blocking the calling thread or HTTP response
    const executeJob = () => {
      setImmediate(async () => {
        const handler = this.handlers.get(type);
        if (!handler) {
          logger.warn(`[AsyncJobQueue] No handler registered for job type: ${type}. Dropping job ${jobId}.`);
          this.pendingCount--;
          return;
        }

        try {
          // Execute with exponential backoff and jitter retry
          await withRetry(
            async () => {
              job.attempts++;
              await handler(job);
            },
            {
              maxAttempts: job.maxAttempts,
              initialDelayMs: 50,
              maxDelayMs: 1000,
              operationName: `async-job:${type}:${jobId}`,
            }
          );

          logger.info(`[AsyncJobQueue] Job ${jobId} (${type}) completed successfully.`);
        } catch (error) {
          logger.error(`[AsyncJobQueue] Job ${jobId} (${type}) failed after ${job.attempts} attempts:`, {
            jobId,
            jobType: type,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        } finally {
          this.pendingCount--;
        }
      });
    };

    if (delayMs > 0) {
      setTimeout(executeJob, delayMs);
    } else {
      executeJob();
    }

    return jobId;
  }

  public getPendingCount(): number {
    return this.pendingCount;
  }
}

export const jobQueue: IJobQueue = new InMemoryJobQueue();

// Register Default Notification Handlers
jobQueue.registerHandler(
  JobTypes.NOTIFICATION_APPOINTMENT_CONFIRMED,
  async (job: JobPayload<{ consultationId: string; consultationNumber: string; scheduledAt: string }>) => {
    // Simulated SMS / Email notification dispatch
    logger.info(`[NotificationService] Sending appointment confirmation notification`, {
      consultationId: job.data.consultationId,
      consultationNumber: job.data.consultationNumber,
      scheduledAt: job.data.scheduledAt,
    });
  }
);

jobQueue.registerHandler(
  JobTypes.NOTIFICATION_PAYMENT_CONFIRMED,
  async (job: JobPayload<{ consultationId: string; transactionReference: string; amount: number }>) => {
    // Simulated payment receipt notification dispatch
    logger.info(`[NotificationService] Sending payment receipt notification`, {
      consultationId: job.data.consultationId,
      transactionReference: job.data.transactionReference,
      amount: job.data.amount,
    });
  }
);

jobQueue.registerHandler(
  JobTypes.NOTIFICATION_PRESCRIPTION_ISSUED,
  async (job: JobPayload<{ consultationId: string; prescriptionId: string }>) => {
    // Simulated prescription ready notification (avoids logging PHI/medications)
    logger.info(`[NotificationService] Sending prescription ready notification`, {
      consultationId: job.data.consultationId,
      prescriptionId: job.data.prescriptionId,
    });
  }
);
