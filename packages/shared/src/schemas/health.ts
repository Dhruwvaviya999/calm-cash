import { z } from 'zod';

import type { HealthCheckDto, ReadinessCheckDto } from '../types/health';
import { isoDateTimeSchema } from './common';

export const healthCheckDtoSchema = z.object({
  status: z.literal('ok'),
  uptimeSeconds: z.number().nonnegative(),
  timestamp: isoDateTimeSchema,
}) satisfies z.ZodType<HealthCheckDto>;

export const readinessCheckDtoSchema = z.object({
  status: z.literal('ok'),
  checks: z.object({
    database: z.literal('up'),
  }),
  timestamp: isoDateTimeSchema,
}) satisfies z.ZodType<ReadinessCheckDto>;
