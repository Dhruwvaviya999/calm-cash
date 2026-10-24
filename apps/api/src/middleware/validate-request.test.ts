import {
  apiErrorResponseSchema,
  entityIdSchema,
  positiveMinorUnitsSchema,
  type ApiSuccessResponse,
} from '@calmcash/shared';
import express, { type Express, type Response } from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { sendSuccess } from '../lib/http-response';
import { createErrorHandler } from './error-handler';
import { createRequestLogger } from './request-logger';
import { validateRequest } from './validate-request';

const ACCOUNT_ID = '01920c3e-4f6a-7c3b-9d2e-1a2b3c4d5e70';

const createExampleRequest = z.object({
  params: z.object({ accountId: entityIdSchema }),
  query: z.object({ dryRun: z.enum(['true', 'false']).default('false') }),
  body: z.object({ amountMinor: positiveMinorUnitsSchema, description: z.string().min(1) }),
});

type ExampleResponse = ApiSuccessResponse<{
  accountId: string;
  amountMinor: string;
  dryRun: boolean;
}>;

/** A throwaway app that exercises the validation convention end to end. */
function createExampleApp(): Express {
  const app = express();
  app.use(createRequestLogger(pino({ level: 'silent' })));
  app.use(express.json());
  app.post(
    '/accounts/:accountId/examples',
    validateRequest(createExampleRequest, (input, _req, res: Response<ExampleResponse>) => {
      // `input` is fully typed from the schema and `res` from the annotation — no casts, no `any`.
      sendSuccess(res, {
        accountId: input.params.accountId,
        amountMinor: input.body.amountMinor,
        dryRun: input.query.dryRun === 'true',
      });
    }),
  );
  app.get('/boom', () => {
    throw new Error('connection to db at 10.0.0.5 failed: password authentication failed');
  });
  app.use(createErrorHandler());
  return app;
}

describe('validateRequest', () => {
  it('passes parsed, typed input to the handler', async () => {
    const response = await request(createExampleApp())
      .post(`/accounts/${ACCOUNT_ID}/examples?dryRun=true`)
      .send({ amountMinor: '12550', description: 'Lunch' })
      .expect(200);

    expect(response.body).toEqual({
      success: true,
      data: { accountId: ACCOUNT_ID, amountMinor: '12550', dryRun: true },
    });
  });

  it('rejects invalid input with 400 and a detail per failing field', async () => {
    const response = await request(createExampleApp())
      .post('/accounts/not-a-uuid/examples')
      .send({ amountMinor: 125.5 })
      .expect(400);

    const body = apiErrorResponseSchema.parse(response.body);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details?.map((detail) => detail.path).sort()).toEqual([
      'body.amountMinor',
      'body.description',
      'params.accountId',
    ]);
  });
});

describe('error handler', () => {
  it('hides internal error details behind a generic 500', async () => {
    const response = await request(createExampleApp()).get('/boom').expect(500);

    const body = apiErrorResponseSchema.parse(response.body);
    expect(body.error).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
    });
    expect(JSON.stringify(response.body)).not.toContain('10.0.0.5');
    expect(body.error.requestId).toBeDefined();
  });
});
