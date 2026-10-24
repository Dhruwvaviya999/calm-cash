import type { ApiError, ApiErrorResponse, ApiSuccessResponse } from '@calmcash/shared';
import type { Response } from 'express';

/**
 * Sends `{ success: true, data }` — the only shape a successful API response may have.
 * Handlers that type their response (`Response<ApiSuccessResponse<AccountDto>>`) get `data`
 * checked against that DTO.
 */
export function sendSuccess<TData>(
  res: Response<ApiSuccessResponse<TData>>,
  data: TData,
  statusCode = 200,
): void {
  res.status(statusCode).json({ success: true, data });
}

/** Sends `{ success: false, error }` — the only shape a failed API response may have. */
export function sendError(
  res: Response<ApiErrorResponse>,
  statusCode: number,
  error: ApiError,
): void {
  res.status(statusCode).json({ success: false, error });
}
