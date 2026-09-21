import { z } from 'zod';

const slotItemSchema = z
  .object({
    startTime: z
      .string({ required_error: 'startTime is required' })
      .refine((val) => !isNaN(new Date(val).getTime()), {
        message: 'startTime must be a valid ISO-8601 date string',
      }),
    endTime: z
      .string({ required_error: 'endTime is required' })
      .refine((val) => !isNaN(new Date(val).getTime()), {
        message: 'endTime must be a valid ISO-8601 date string',
      }),
  })
  .refine(
    (data) => {
      const start = new Date(data.startTime);
      const end = new Date(data.endTime);
      return end.getTime() > start.getTime();
    },
    {
      message: 'endTime must be strictly after startTime',
      path: ['endTime'],
    }
  )
  .refine(
    (data) => {
      const start = new Date(data.startTime);
      const now = new Date();
      return start.getTime() > now.getTime();
    },
    {
      message: 'startTime cannot be in the past',
      path: ['startTime'],
    }
  )
  .refine(
    (data) => {
      const start = new Date(data.startTime);
      const end = new Date(data.endTime);
      const durationMs = end.getTime() - start.getTime();
      const minDurationMs = 15 * 60 * 1000; // 15 minutes minimum
      const maxDurationMs = 240 * 60 * 1000; // 4 hours maximum
      return durationMs >= minDurationMs && durationMs <= maxDurationMs;
    },
    {
      message: 'Slot duration must be between 15 minutes and 4 hours',
      path: ['endTime'],
    }
  );

export const createSlotsSchema = z
  .object({
    slots: z
      .array(slotItemSchema)
      .min(1, 'At least one slot must be provided')
      .max(50, 'Cannot create more than 50 slots in a single batch'),
  })
  .refine(
    (data) => {
      // Check for mutual overlap or duplication within the submitted batch
      const slots = data.slots.map((s) => ({
        start: new Date(s.startTime).getTime(),
        end: new Date(s.endTime).getTime(),
      }));

      // Sort by start time to detect overlaps easily in O(n log n)
      const sorted = [...slots].sort((a, b) => a.start - b.start);
      for (let i = 0; i < sorted.length - 1; i++) {
        const current = sorted[i];
        const next = sorted[i + 1];
        // Overlap: current.start < next.end && current.end > next.start
        if (current.end > next.start) {
          return false;
        }
      }
      return true;
    },
    {
      message: 'Slots within the submitted batch contain overlapping or duplicate intervals',
      path: ['slots'],
    }
  );

export const doctorSlotsQuerySchema = z.object({
  startDate: z
    .string()
    .optional()
    .refine(
      (val) => {
        if (!val) return true;
        return !isNaN(new Date(val).getTime());
      },
      { message: 'startDate must be a valid ISO date string' }
    ),
  endDate: z
    .string()
    .optional()
    .refine(
      (val) => {
        if (!val) return true;
        return !isNaN(new Date(val).getTime());
      },
      { message: 'endDate must be a valid ISO date string' }
    ),
  page: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 1))
    .refine((val) => val > 0, { message: 'page must be greater than 0' }),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 50))
    .refine((val) => val >= 1 && val <= 100, { message: 'limit must be between 1 and 100' }),
});

export const slotIdParamSchema = z.object({
  id: z.string().uuid('Invalid slot ID format (must be UUID)'),
});

export const doctorIdParamSchema = z.object({
  doctorId: z.string().uuid('Invalid doctor ID format (must be UUID)'),
});
