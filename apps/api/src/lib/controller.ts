import type { ApiSuccessResponse } from '@calmcash/shared';
import type { Response } from 'express';

import type { UnvalidatedRequest } from '../middleware/validate-request';

/** A success response whose payload is type-checked against the DTO. */
export type Ok<T> = Response<ApiSuccessResponse<T>>;

/** A controller method behind `validateRequest`: parsed input in, typed DTO out. */
export type Handler<TInput, TData> = (
  input: TInput,
  req: UnvalidatedRequest<ApiSuccessResponse<TData>>,
  res: Ok<TData>,
) => Promise<void>;
