import type { ErrorCode } from '../constants/api';

/** Envelope of every successful API response. */
export interface ApiSuccessResponse<TData> {
  success: true;
  data: TData;
}

/** A single field-level problem, e.g. from request validation. */
export interface ApiErrorDetail {
  /** Dot-separated location of the problem, e.g. `body.amountMinor` or `query.page`. */
  path: string;
  message: string;
}

export interface ApiError {
  code: ErrorCode;
  /** Human-readable summary that is safe to show to end users. */
  message: string;
  details?: ApiErrorDetail[];
  /** Correlates the failure with server logs; present whenever the API produced the error. */
  requestId?: string;
}

/** Envelope of every failed API response. */
export interface ApiErrorResponse {
  success: false;
  error: ApiError;
}

export type ApiResponse<TData> = ApiSuccessResponse<TData> | ApiErrorResponse;
