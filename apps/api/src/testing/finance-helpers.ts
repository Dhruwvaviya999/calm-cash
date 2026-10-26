import {
  accountWithBalanceDtoSchema,
  API_V1_PREFIX,
  apiErrorResponseSchema,
  apiSuccessResponseSchema,
  categoryListDtoSchema,
  IDEMPOTENCY_KEY_HEADER,
  transactionListItemDtoSchema,
  type AccountWithBalanceDto,
  type ApiError,
  type CategoryDto,
  type CategoryKind,
  type TransactionListItemDto,
} from '@calmcash/shared';
import type request from 'supertest';
import { expect } from 'vitest';

import {
  createVerifiedUser,
  signIn,
  withCsrf,
  type SignedIn,
  type TestContext,
} from './integration-harness';

// Helpers for integration tests that record money through the real API.

export const ACCOUNTS = `${API_V1_PREFIX}/accounts`;
export const TRANSACTIONS = `${API_V1_PREFIX}/transactions`;
export const CATEGORIES = `${API_V1_PREFIX}/categories`;
export const TAGS = `${API_V1_PREFIX}/tags`;

const accountEnvelope = apiSuccessResponseSchema(accountWithBalanceDtoSchema);
const itemEnvelope = apiSuccessResponseSchema(transactionListItemDtoSchema);

export async function newUser(context: TestContext): Promise<SignedIn> {
  return signIn(context, await createVerifiedUser(context));
}

export async function createAccount(
  user: SignedIn,
  body: Record<string, unknown>,
): Promise<AccountWithBalanceDto> {
  const response = await withCsrf(user.agent.post(ACCOUNTS), user).send(body).expect(201);
  return accountEnvelope.parse(response.body).data;
}

export async function getAccount(
  user: SignedIn,
  accountId: string,
): Promise<AccountWithBalanceDto> {
  const response = await user.agent.get(`${ACCOUNTS}/${accountId}`).expect(200);
  return accountEnvelope.parse(response.body).data;
}

/** The current signed balance of an account, as minor units. */
export async function balanceOf(user: SignedIn, accountId: string): Promise<bigint> {
  return BigInt((await getAccount(user, accountId)).balance.currentBalanceMinor);
}

export async function listCategories(user: SignedIn): Promise<CategoryDto[]> {
  const response = await user.agent.get(CATEGORIES).expect(200);
  return apiSuccessResponseSchema(categoryListDtoSchema).parse(response.body).data.categories;
}

export async function categoryId(
  user: SignedIn,
  kind: CategoryKind,
  name: string,
): Promise<string> {
  const category = (await listCategories(user)).find(
    (entry) => entry.kind === kind && entry.name === name,
  );
  expect(category, `${kind} category ${name}`).toBeDefined();
  return category?.id ?? '';
}

export function postTransaction(
  user: SignedIn,
  body: Record<string, unknown>,
  idempotencyKey?: string,
): request.Test {
  const test = withCsrf(user.agent.post(TRANSACTIONS), user);
  return idempotencyKey === undefined
    ? test.send(body)
    : test.set(IDEMPOTENCY_KEY_HEADER, idempotencyKey).send(body);
}

export async function record(
  user: SignedIn,
  body: Record<string, unknown>,
): Promise<TransactionListItemDto> {
  const response = await postTransaction(user, body);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return itemEnvelope.parse(response.body).data;
}

export function parseItem(body: unknown): TransactionListItemDto {
  return itemEnvelope.parse(body).data;
}

export function parseError(body: unknown): ApiError {
  return apiErrorResponseSchema.parse(body).error;
}

/** `occurredAt` a given number of hours before the test clock's "now". */
export function hoursAgo(now: Date, hours: number): string {
  return new Date(now.getTime() - hours * 3_600_000).toISOString();
}
