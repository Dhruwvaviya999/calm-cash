import { z } from 'zod';

import { TEXT_LIMITS } from '../constants/domain';
import type { UserDto } from '../types/user';
import { currencyCodeSchema, entityIdSchema, isoDateTimeSchema, timeZoneSchema } from './common';

export const userDtoSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1).max(TEXT_LIMITS.userName),
  email: z.email().max(TEXT_LIMITS.email),
  preferredCurrency: currencyCodeSchema,
  timezone: timeZoneSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
}) satisfies z.ZodType<UserDto>;
