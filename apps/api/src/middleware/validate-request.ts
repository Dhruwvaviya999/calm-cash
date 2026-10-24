import type { ApiErrorDetail } from '@calmcash/shared';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { z } from 'zod';

import { AppError } from '../lib/app-error';

/** A request whose params, query, and body have not been validated yet. */
export type UnvalidatedRequest<TResBody = unknown> = Request<
  Record<string, string>,
  TResBody,
  unknown,
  unknown
>;

export type ValidatedRequestHandler<TInput, TResBody> = (
  input: TInput,
  req: UnvalidatedRequest<TResBody>,
  res: Response<TResBody>,
  next: NextFunction,
) => unknown;

export function toValidationDetails(error: z.ZodError): ApiErrorDetail[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

/**
 * Convention for every route that accepts input: describe the request with one Zod schema over
 * `{ params, query, body }`, and receive the parsed, fully typed result in the handler.
 * Annotate `res` with the response envelope so the payload is type-checked as well.
 *
 * @example
 * const getAccountRequest = z.object({ params: z.object({ accountId: entityIdSchema }) });
 * router.get(
 *   '/:accountId',
 *   validateRequest(getAccountRequest, async (input, _req, res: Response<ApiSuccessResponse<AccountDto>>) => {
 *     sendSuccess(res, await accountService.get(input.params.accountId));
 *   }),
 * );
 *
 * Invalid input never reaches the handler; it becomes a 400 `VALIDATION_ERROR` response whose
 * `details` list each failing path (e.g. `body.amountMinor`).
 */
export function validateRequest<TSchema extends z.ZodType, TResBody = unknown>(
  schema: TSchema,
  handler: ValidatedRequestHandler<z.output<TSchema>, TResBody>,
): RequestHandler<Record<string, string>, TResBody, unknown, unknown> {
  return async (req: UnvalidatedRequest<TResBody>, res: Response<TResBody>, next: NextFunction) => {
    const result = await schema.safeParseAsync({
      params: req.params,
      query: req.query,
      body: req.body,
    });

    if (!result.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'The request is invalid.', {
        details: toValidationDetails(result.error),
      });
    }

    return handler(result.data, req, res, next);
  };
}
