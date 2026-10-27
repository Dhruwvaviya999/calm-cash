import {
  addDaysToIsoDate,
  addMonthsToIsoDate,
  serializeMinorUnits,
  SUBSCRIPTION_FORECAST_DAYS,
  SUBSCRIPTION_FORECAST_MONTHS,
  type CancelSubscriptionInput,
  type CostEstimateDto,
  type CreateSubscriptionInput,
  type IsoDateString,
  type RecurringScheduleItemDto,
  type SubscriptionCurrencySummaryDto,
  type SubscriptionDto,
  type SubscriptionListDto,
  type SubscriptionListQuery,
  type SubscriptionStatus,
  type SubscriptionSummaryDto,
  type UpcomingOccurrenceDto,
  type UpdateSubscriptionInput,
} from '@calmcash/shared';

import { AppError } from '../../lib/app-error';
import type { Caller } from '../../lib/auth-boundary';
import type { RecurringService } from '../recurring';

// Subscriptions are recurring expense schedules marked as such. Every date, pause, and recording
// rule lives in the recurring module; this module only scopes requests to subscriptions and adds
// cost estimates. Estimates multiply the expected amount by the number of occurrences in a window
// — forecasts, never amounts already spent.

export interface SubscriptionsService {
  list: (caller: Caller, query: SubscriptionListQuery) => Promise<SubscriptionListDto>;
  summary: (caller: Caller) => Promise<SubscriptionSummaryDto>;
  get: (caller: Caller, scheduleId: string) => Promise<SubscriptionDto>;
  create: (caller: Caller, input: CreateSubscriptionInput) => Promise<SubscriptionDto>;
  update: (
    caller: Caller,
    scheduleId: string,
    input: UpdateSubscriptionInput,
  ) => Promise<SubscriptionDto>;
  pause: (caller: Caller, scheduleId: string) => Promise<SubscriptionDto>;
  resume: (caller: Caller, scheduleId: string) => Promise<SubscriptionDto>;
  cancel: (
    caller: Caller,
    scheduleId: string,
    input: CancelSubscriptionInput,
  ) => Promise<SubscriptionDto>;
  archive: (caller: Caller, scheduleId: string) => Promise<SubscriptionDto>;
  restore: (caller: Caller, scheduleId: string) => Promise<SubscriptionDto>;
}

/** Enough occurrences for a year of weekly subscriptions; beyond that estimates are flagged. */
const FORECAST_LIMIT = 10_000;

const notFound = (): AppError =>
  new AppError(404, 'NOT_FOUND', 'That subscription does not exist or is not yours.');

export function subscriptionStatus(item: RecurringScheduleItemDto): SubscriptionStatus {
  const { schedule } = item;
  if (schedule.status === 'archived') return 'archived';
  if (schedule.cancelledAt !== undefined || schedule.status === 'completed') return 'cancelled';
  if (schedule.status === 'paused') return 'paused';
  return 'active';
}

export function estimate(
  items: readonly UpcomingOccurrenceDto[],
  from: IsoDateString,
  to: IsoDateString,
): CostEstimateDto {
  const window = items.filter(
    ({ occurrence }) =>
      (occurrence.status === 'upcoming' || occurrence.status === 'due') &&
      occurrence.dueDate >= from &&
      occurrence.dueDate <= to,
  );
  return {
    from,
    to,
    occurrences: window.length,
    amountMinor: serializeMinorUnits(
      window.reduce((sum, { occurrence }) => sum + BigInt(occurrence.amountMinor), 0n),
    ),
  };
}

export function createSubscriptionsService(recurring: RecurringService): SubscriptionsService {
  /** Expected charges from today for twelve months (plus overdue ones), for every subscription. */
  const forecast = async (
    caller: Caller,
  ): Promise<{ today: IsoDateString; to: IsoDateString; items: UpcomingOccurrenceDto[] }> => {
    const today = recurring.today(caller);
    const to = addDaysToIsoDate(addMonthsToIsoDate(today, SUBSCRIPTION_FORECAST_MONTHS), -1);
    const upcoming = await recurring.collect(caller, {
      from: today,
      to,
      subscription: true,
      limit: FORECAST_LIMIT,
    });
    return { today, to, items: upcoming.items };
  };

  const toDto = (
    item: RecurringScheduleItemDto,
    items: readonly UpcomingOccurrenceDto[],
    today: IsoDateString,
    to: IsoDateString,
  ): SubscriptionDto => ({
    ...item,
    status: subscriptionStatus(item),
    nextTwelveMonths: estimate(
      items.filter((entry) => entry.schedule.id === item.schedule.id),
      today,
      to,
    ),
  });

  const load = async (caller: Caller, scheduleId: string): Promise<SubscriptionDto> => {
    const detail = await recurring.get(caller, scheduleId);
    if (!detail.schedule.isSubscription) {
      throw notFound();
    }
    const { today, to, items } = await forecast(caller);
    const { upcoming: _upcoming, history: _history, today: _today, ...item } = detail;
    return toDto(item, items, today, to);
  };

  /** Runs an action on a schedule only when it is one of the caller's subscriptions. */
  const act = async (
    caller: Caller,
    scheduleId: string,
    action: () => Promise<unknown>,
  ): Promise<SubscriptionDto> => {
    const detail = await recurring.get(caller, scheduleId);
    if (!detail.schedule.isSubscription) {
      throw notFound();
    }
    await action();
    return load(caller, scheduleId);
  };

  return {
    list: async (caller, { status }) => {
      const list = await recurring.list(caller, { status, subscription: true });
      const { today, to, items } = await forecast(caller);
      return {
        today: list.today,
        subscriptions: list.schedules.map((item) => toDto(item, items, today, to)),
      };
    },

    summary: async (caller) => {
      const list = await recurring.list(caller, { status: 'current', subscription: true });
      const { today, to, items } = await forecast(caller);
      const next30To = addDaysToIsoDate(today, SUBSCRIPTION_FORECAST_DAYS - 1);
      const currencies = [...new Set(list.schedules.map((item) => item.schedule.currency))].sort(
        (a, b) => a.localeCompare(b),
      );
      return {
        today,
        currencies: currencies.map((currency): SubscriptionCurrencySummaryDto => {
          const inCurrency = items.filter((entry) => entry.occurrence.currency === currency);
          const overdue = inCurrency.filter((entry) => entry.occurrence.status === 'overdue');
          return {
            currency,
            activeCount: list.schedules.filter(
              (item) =>
                item.schedule.currency === currency && subscriptionStatus(item) === 'active',
            ).length,
            overdueCount: overdue.length,
            overdueMinor: serializeMinorUnits(
              overdue.reduce((sum, entry) => sum + BigInt(entry.occurrence.amountMinor), 0n),
            ),
            next30Days: estimate(inCurrency, today, next30To),
            next12Months: estimate(inCurrency, today, to),
          };
        }),
      };
    },

    get: load,

    create: async (caller, input) => {
      const created = await recurring.create(
        caller,
        { ...input, type: 'expense' },
        { isSubscription: true },
      );
      return load(caller, created.schedule.id);
    },

    update: (caller, scheduleId, input) =>
      act(caller, scheduleId, () => recurring.update(caller, scheduleId, input)),

    pause: (caller, scheduleId) =>
      act(caller, scheduleId, () => recurring.pause(caller, scheduleId)),

    resume: (caller, scheduleId) =>
      act(caller, scheduleId, () => recurring.resume(caller, scheduleId)),

    cancel: (caller, scheduleId, input) =>
      act(caller, scheduleId, () =>
        recurring.end(
          caller,
          scheduleId,
          input.effectiveDate === undefined ? {} : { endDate: input.effectiveDate },
          { cancel: true },
        ),
      ),

    archive: (caller, scheduleId) =>
      act(caller, scheduleId, () => recurring.archive(caller, scheduleId)),

    restore: (caller, scheduleId) =>
      act(caller, scheduleId, () => recurring.restore(caller, scheduleId)),
  };
}
