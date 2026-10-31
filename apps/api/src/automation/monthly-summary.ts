import {
  addDaysToIsoDate,
  addMonthsToIsoDate,
  calendarDateInTimeZone,
  firstOfMonth,
  MAX_UPCOMING_OCCURRENCES,
  serializeMinorUnits,
  type CurrencyCode,
  type IsoDateString,
  type MonthlySummaryDto,
} from '@calmcash/shared';

import type { Caller } from '../lib/auth-boundary';
import type { AutomationDomain, UserContext } from './domain';
import { monthlySummaryText } from './notification-text';
import type { NotificationWriter } from './notification-writer';

// The monthly summary: a deterministic overview of the previous, completed calendar month in the
// user's time zone, built from the dashboard analytics (actual income and spending only —
// transfers, balance adjustments, and voided transactions never count) and the budget engine.
// Payments still expected are reported separately and labelled as expected. Each currency gets
// its own summary; amounts are never added across currencies. A month without any recorded
// income or spending in a currency gets no summary rather than an empty one. Nothing is sent to
// any AI service.
//
// Identity: `summary:<YYYY-MM>:<currency>`, once per user, month, and currency. It is created
// during the first week of the following month (a worker that was stopped catches up within that
// window; later, the month is left alone).

export const SUMMARY_CATCH_UP_DAYS = 7;
export const MAX_SUMMARY_CURRENCIES = 5;
export const SUMMARY_TOP_CATEGORIES = 3;
/** Days of payments still expected that a summary mentions. */
export const SUMMARY_UPCOMING_DAYS = 30;

const SUMMARY_EMAIL_MAX_DELAY_MS = 7 * 24 * 60 * 60 * 1000;

export interface SummaryPeriod {
  /** `YYYY-MM`. */
  month: string;
  from: IsoDateString;
  to: IsoDateString;
}

/** The completed month a review on `today` summarises, or `undefined` outside the catch-up week. */
export function summaryPeriodFor(today: IsoDateString): SummaryPeriod | undefined {
  if (Number(today.slice(8, 10)) > SUMMARY_CATCH_UP_DAYS) {
    return undefined;
  }
  const thisMonth = firstOfMonth(today);
  const from = addMonthsToIsoDate(thisMonth, -1);
  return { month: from.slice(0, 7), from, to: addDaysToIsoDate(thisMonth, -1) };
}

export function summaryKey(month: string, currency: CurrencyCode): string {
  return `summary:${month}:${currency}`;
}

/**
 * The summary of one month in one currency from the authoritative services, or `undefined` when
 * nothing was recorded in that currency (or the person holds no account in it).
 */
export async function buildMonthlySummary(
  domain: AutomationDomain,
  caller: Caller,
  period: SummaryPeriod,
  currency: CurrencyCode,
  today: IsoDateString,
): Promise<MonthlySummaryDto | undefined> {
  const query = { period: 'custom' as const, from: period.from, to: period.to, currency };
  const overview = await domain.dashboard.overview(caller, query);
  const cash = overview.cashFlow;
  if (overview.currency !== currency || cash.incomeCount + cash.expenseCount === 0) {
    return undefined;
  }
  const upcomingTo = addDaysToIsoDate(today, SUMMARY_UPCOMING_DAYS);
  const [categories, budgets, upcoming] = await Promise.all([
    domain.dashboard.categories(caller, query),
    domain.budgets.list(caller, {
      status: 'active',
      period: 'monthly',
      currency,
      date: period.to,
    }),
    domain.recurring.collect(caller, {
      from: today,
      to: upcomingTo,
      type: 'expense',
      limit: MAX_UPCOMING_OCCURRENCES,
    }),
  ]);

  const statuses = budgets.budgets
    .filter((item) => item.progress.from <= period.to && item.progress.to >= period.from)
    .map((item) => item.progress.status)
    .filter((status) => status !== 'not_applicable');
  const count = (status: string): number => statuses.filter((value) => value === status).length;
  const expected = upcoming.pendingTotals.find((total) => total.currency === currency);

  return {
    month: period.month,
    from: period.from,
    to: period.to,
    currency,
    incomeMinor: cash.incomeMinor,
    expenseMinor: cash.expenseMinor,
    netMinor: cash.netMinor,
    incomeCount: cash.incomeCount,
    expenseCount: cash.expenseCount,
    savingsRate: overview.savingsRate,
    topCategories: categories.entries
      .flatMap((entry) =>
        entry.kind === 'category'
          ? [
              {
                name: entry.name,
                amountMinor: entry.amountMinor,
                shareBasisPoints: entry.shareBasisPoints,
              },
            ]
          : [],
      )
      .slice(0, SUMMARY_TOP_CATEGORIES),
    budgets: {
      total: statuses.length,
      overBudget: count('over_budget'),
      limitReached: count('limit_reached'),
      approachingLimit: count('approaching_limit'),
      onTrack: count('on_track'),
    },
    upcoming: {
      from: today,
      to: upcomingTo,
      expectedExpenseMinor: expected?.expectedExpenseMinor ?? serializeMinorUnits(0n),
      expenseCount: expected?.expenseCount ?? 0,
    },
  };
}

export interface SummaryContext {
  domain: AutomationDomain;
  writer: NotificationWriter;
}

/** Creates last month's summaries for one user (one per currency with activity). */
export async function sendMonthlySummaries(
  { domain, writer }: SummaryContext,
  user: UserContext,
  now: Date,
): Promise<number> {
  const channels = user.preferences.channels.monthly_summary;
  if (!channels.inApp && !channels.email) {
    return 0;
  }
  const { caller } = user;
  const today = calendarDateInTimeZone(now, caller.timeZone);
  const period = summaryPeriodFor(today);
  if (period === undefined) {
    return 0;
  }
  const { currencies } = await domain.dashboard.overview(caller, {
    period: 'custom',
    from: period.from,
    to: period.to,
  });
  const candidates = currencies.slice(0, MAX_SUMMARY_CURRENCIES);
  const existing = await writer.existingKeys(
    caller.userId,
    candidates.map((currency) => summaryKey(period.month, currency)),
  );

  let created = 0;
  for (const currency of candidates) {
    const key = summaryKey(period.month, currency);
    if (existing.has(key)) continue;
    const summary = await buildMonthlySummary(domain, caller, period, currency, today);
    if (summary === undefined) continue;
    const outcome = await writer.write(
      {
        userId: caller.userId,
        type: 'monthly_summary_ready',
        dedupeKey: key,
        ...monthlySummaryText(summary),
        target: { kind: 'dashboard', from: period.from, to: period.to, currency },
        channels,
        emailExpiresAt: new Date(now.getTime() + SUMMARY_EMAIL_MAX_DELAY_MS),
      },
      user.emailVerified,
      now,
    );
    if (outcome === 'created') created += 1;
  }
  return created;
}
