import {
  subscriptionDtoSchema,
  subscriptionListDtoSchema,
  subscriptionSummaryDtoSchema,
  type CreateSubscriptionInput,
  type EntityId,
  type IsoDateString,
  type RecurringStatusFilter,
  type SubscriptionDto,
  type SubscriptionListDto,
  type SubscriptionSummaryDto,
  type UpdateSubscriptionInput,
} from '@calmcash/shared';

import { api } from '@/lib/api';

// One function per subscriptions endpoint; every response is validated against the shared schema.
// Estimates are forecasts from the schedules, never amounts already spent.

function subscriptionPath(scheduleId: EntityId): `/${string}` {
  return `/subscriptions/${encodeURIComponent(scheduleId)}`;
}

export function listSubscriptions(
  status: RecurringStatusFilter,
  signal?: AbortSignal,
): Promise<SubscriptionListDto> {
  return api.request(`/subscriptions?status=${status}`, {
    schema: subscriptionListDtoSchema,
    signal,
  });
}

export function getSubscriptionSummary(signal?: AbortSignal): Promise<SubscriptionSummaryDto> {
  return api.request('/subscriptions/summary', { schema: subscriptionSummaryDtoSchema, signal });
}

export function createSubscription(input: CreateSubscriptionInput): Promise<SubscriptionDto> {
  return api.request('/subscriptions', {
    schema: subscriptionDtoSchema,
    method: 'POST',
    body: input,
  });
}

export function updateSubscription(
  scheduleId: EntityId,
  input: UpdateSubscriptionInput,
): Promise<SubscriptionDto> {
  return api.request(subscriptionPath(scheduleId), {
    schema: subscriptionDtoSchema,
    method: 'PATCH',
    body: input,
  });
}

export type SubscriptionAction = 'pause' | 'resume' | 'archive' | 'restore';

export function changeSubscription(
  scheduleId: EntityId,
  action: SubscriptionAction,
): Promise<SubscriptionDto> {
  return api.request(`${subscriptionPath(scheduleId)}/${action}`, {
    schema: subscriptionDtoSchema,
    method: 'POST',
  });
}

export function cancelSubscription(
  scheduleId: EntityId,
  effectiveDate?: IsoDateString,
): Promise<SubscriptionDto> {
  return api.request(`${subscriptionPath(scheduleId)}/cancel`, {
    schema: subscriptionDtoSchema,
    method: 'POST',
    body: effectiveDate === undefined ? {} : { effectiveDate },
  });
}
