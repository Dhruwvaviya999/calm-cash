import { z } from 'zod';

import { ACCOUNT_TYPES, TEXT_LIMITS } from '../constants/domain';
import type { AccountDto } from '../types/account';
import { currencyCodeSchema, entityIdSchema, isoDateTimeSchema, minorUnitsSchema } from './common';

export const accountTypeSchema = z.enum(ACCOUNT_TYPES);

export const accountDtoSchema = z.object({
  id: entityIdSchema,
  userId: entityIdSchema,
  name: z.string().min(1).max(TEXT_LIMITS.accountName),
  type: accountTypeSchema,
  currency: currencyCodeSchema,
  openingBalanceMinor: minorUnitsSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
}) satisfies z.ZodType<AccountDto>;
