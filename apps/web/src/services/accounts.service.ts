import {
  accountListDtoSchema,
  accountSummaryDtoSchema,
  accountWithBalanceDtoSchema,
  type AccountListDto,
  type AccountStatusFilter,
  type AccountSummaryDto,
  type AccountWithBalanceDto,
  type CreateAccountInput,
  type EntityId,
  type UpdateAccountInput,
} from '@calmcash/shared';

import { api } from '@/lib/api';

// One function per accounts endpoint; every response is validated against the shared schema.

export function listAccounts(
  status: AccountStatusFilter,
  signal?: AbortSignal,
): Promise<AccountListDto> {
  return api.request(`/accounts?status=${status}`, { schema: accountListDtoSchema, signal });
}

export function getAccountSummary(signal?: AbortSignal): Promise<AccountSummaryDto> {
  return api.request('/accounts/summary', { schema: accountSummaryDtoSchema, signal });
}

export function getAccount(
  accountId: EntityId,
  signal?: AbortSignal,
): Promise<AccountWithBalanceDto> {
  return api.request(`/accounts/${encodeURIComponent(accountId)}`, {
    schema: accountWithBalanceDtoSchema,
    signal,
  });
}

export function createAccount(input: CreateAccountInput): Promise<AccountWithBalanceDto> {
  return api.request('/accounts', {
    schema: accountWithBalanceDtoSchema,
    method: 'POST',
    body: input,
  });
}

export function updateAccount(
  accountId: EntityId,
  input: UpdateAccountInput,
): Promise<AccountWithBalanceDto> {
  return api.request(`/accounts/${encodeURIComponent(accountId)}`, {
    schema: accountWithBalanceDtoSchema,
    method: 'PATCH',
    body: input,
  });
}

export function archiveAccount(accountId: EntityId): Promise<AccountWithBalanceDto> {
  return api.request(`/accounts/${encodeURIComponent(accountId)}/archive`, {
    schema: accountWithBalanceDtoSchema,
    method: 'POST',
  });
}

export function restoreAccount(accountId: EntityId): Promise<AccountWithBalanceDto> {
  return api.request(`/accounts/${encodeURIComponent(accountId)}/restore`, {
    schema: accountWithBalanceDtoSchema,
    method: 'POST',
  });
}
