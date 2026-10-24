import { z } from 'zod';

import { ERROR_CODES } from '../constants/api';
import type { ApiError, ApiErrorDetail, ApiErrorResponse } from '../types/api';

export const apiErrorDetailSchema = z.object({
  path: z.string(),
  message: z.string(),
}) satisfies z.ZodType<ApiErrorDetail>;

export const apiErrorSchema = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string(),
  details: z.array(apiErrorDetailSchema).exactOptional(),
  requestId: z.string().exactOptional(),
}) satisfies z.ZodType<ApiError>;

export const apiErrorResponseSchema = z.object({
  success: z.literal(false),
  error: apiErrorSchema,
}) satisfies z.ZodType<ApiErrorResponse>;

/** Builds the schema of a success envelope around the given payload schema. */
export function apiSuccessResponseSchema<TDataSchema extends z.ZodType>(
  dataSchema: TDataSchema,
): z.ZodObject<{ success: z.ZodLiteral<true>; data: TDataSchema }> {
  return z.object({
    success: z.literal(true),
    data: dataSchema,
  });
}
