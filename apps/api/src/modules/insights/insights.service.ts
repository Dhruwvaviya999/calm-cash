import {
  addDaysToIsoDate,
  type AssistantLinkDto,
  addMonthsToIsoDate,
  calendarDateInTimeZone,
  currencyCodeSchema,
  divideRounded,
  previousRange,
  startOfDayInTimeZone,
  type CurrencyCode,
  type InsightListDto,
  type InsightQuery,
  type RecurringCandidateDto,
  type RecurringCandidateListDto,
  type SpendingInsightDto,
} from '@calmcash/shared';

import type { Caller } from '../../lib/auth-boundary';
import { formatBasisPoints, formatDate, formatMoney, formatRange } from '../../lib/text-format';
import type { DashboardService } from '../dashboard/dashboard.service';
import { resolveRange } from '../dashboard/dashboard-metrics';
import type { InsightsRepository } from './insights.repository';
import {
  CANDIDATE_RULES,
  categoryChanges,
  changeBp,
  frequentPayees,
  payeeTotals,
  recurringCandidates,
  unusualExpenses,
  type FrequentPayee,
} from './patterns';

// Deterministic insights: comparisons come from the dashboard service (the same cash-flow
// definition everywhere), per-transaction patterns from the owner's active income and expenses.
// Titles and details are fixed sentences filled with exact figures — the AI may later explain
// them, but never produces them. Dismissed insights and candidates are not shown again.

export interface InsightsService {
  list: (caller: Caller, query: InsightQuery) => Promise<InsightListDto>;
  topPayees: (
    caller: Caller,
    query: InsightQuery,
    limit: number,
  ) => Promise<{
    period: { from: string; to: string };
    currency: CurrencyCode | undefined;
    payees: FrequentPayee[];
  }>;
  recurringCandidates: (caller: Caller) => Promise<RecurringCandidateListDto>;
  dismissInsight: (caller: Caller, key: string) => Promise<void>;
  dismissCandidate: (caller: Caller, key: string) => Promise<void>;
}

export interface InsightsServiceDependencies {
  repository: InsightsRepository;
  dashboard: Pick<DashboardService, 'overview' | 'categories'>;
  now: () => Date;
}

const ACTIVITY_LIMIT = 5_000;

const SUBSCRIPTION_HINTS =
  /(subscription|streaming|software|apps|netflix|spotify|prime|music|cloud)/i;

function asCurrency(value: string): CurrencyCode | undefined {
  const parsed = currencyCodeSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function createInsightsService({
  repository,
  dashboard,
  now,
}: InsightsServiceDependencies): InsightsService {
  const windowOf = (caller: Caller, from: string, to: string): { start: Date; end: Date } => ({
    start: startOfDayInTimeZone(from, caller.timeZone),
    end: startOfDayInTimeZone(addDaysToIsoDate(to, 1), caller.timeZone),
  });

  const list: InsightsService['list'] = async (caller, query) => {
    const range = resolveRange(query, caller.timeZone, now());
    const earlier = previousRange(range, query.period);
    const overview = await dashboard.overview(caller, query);
    const currency = overview.currency;
    const scope = { period: 'custom' as const, from: earlier.from, to: earlier.to, currency };
    const [current, previous, previousOverview, dismissed] = await Promise.all([
      dashboard.categories(caller, { ...query, currency }),
      dashboard.categories(caller, scope),
      dashboard.overview(caller, scope),
      repository.dismissed(caller.userId, 'insight'),
    ]);
    const window = windowOf(caller, range.from, range.to);
    const historyStart = startOfDayInTimeZone(addDaysToIsoDate(range.from, -180), caller.timeZone);
    const rows = (
      await repository.activity(caller.userId, historyStart, window.end, ACTIVITY_LIMIT)
    ).filter((row) => row.currency === currency);
    const inPeriod = rows.filter((row) => row.occurredAt >= window.start);
    const history = rows.filter((row) => row.occurredAt < window.start);

    const items: SpendingInsightDto[] = [];
    const period = { from: range.from, to: range.to };
    const comparedTo = { from: earlier.from, to: earlier.to };
    const money = (amount: bigint | string): string => formatMoney(amount, currency);
    const periodWords = formatRange(range.from, range.to);
    const earlierWords = formatRange(earlier.from, earlier.to);
    const expensesLink = (label: string, extra: Record<string, string>): AssistantLinkDto => ({
      label,
      target: {
        kind: 'transactions' as const,
        filters: { type: 'expense' as const, currency, from: range.from, to: range.to, ...extra },
      },
    });

    const changes = categoryChanges(current.entries, previous.entries, {
      current: BigInt(current.totalExpenseMinor),
      previous: BigInt(previous.totalExpenseMinor),
    });
    for (const change of [...changes.increases, ...changes.decreases]) {
      const up = change.changeBp > 0n;
      const magnitude = formatBasisPoints(
        change.changeBp < 0n ? -change.changeBp : change.changeBp,
      );
      items.push({
        key: `${up ? 'up' : 'down'}:${currency}:${range.from}:${change.categoryId}`,
        kind: up ? 'category_increase' : 'category_decrease',
        currency,
        period,
        comparedTo,
        title: `${change.name} spending ${up ? 'rose' : 'fell'} by ${magnitude}`,
        detail: `${money(change.currentMinor)} in ${periodWords}, compared with ${money(change.previousMinor)} in ${earlierWords}. This compares recorded expenses only; it does not say why they changed.`,
        figures: [
          { label: periodWords, amountMinor: change.currentMinor.toString() },
          { label: earlierWords, amountMinor: change.previousMinor.toString() },
          { label: 'Change', text: `${up ? '+' : '−'}${magnitude}` },
        ],
        link: expensesLink(`View ${change.name} expenses`, { categoryId: change.categoryId }),
      });
    }

    for (const unusual of unusualExpenses(inPeriod, history)) {
      const { row } = unusual;
      const date = calendarDateInTimeZone(row.occurredAt, caller.timeZone);
      const tenths = divideRounded(unusual.multipleBp, 1_000n);
      const times = `${(tenths / 10n).toString()}.${(tenths % 10n).toString()}`;
      items.push({
        key: `unusual:${currency}:${row.id}`,
        kind: 'unusual_expense',
        currency,
        period,
        title: `A larger than usual ${row.categoryName ?? 'expense'} payment`,
        detail: `${money(row.amountMinor)} on ${formatDate(date)} is about ${times} times your typical ${money(unusual.medianMinor)} in this category (median of ${unusual.historyCount.toString()} earlier expenses). Unusual for your records — not a sign of fraud by itself.`,
        figures: [
          { label: 'This payment', amountMinor: row.amountMinor.toString() },
          { label: 'Typical in this category', amountMinor: unusual.medianMinor.toString() },
        ],
        link: {
          label: 'Open the transaction',
          target: { kind: 'transaction', transactionId: row.id },
        },
      });
    }

    for (const payee of frequentPayees(inPeriod)) {
      items.push({
        key: `frequent:${currency}:${range.from}:${payee.key.replace(/\s+/g, '-')}`,
        kind: 'frequent_merchant',
        currency,
        period,
        title: `${payee.count.toString()} payments to ${payee.label}`,
        detail: `You recorded ${payee.count.toString()} expenses for ${payee.label} in ${periodWords}, ${money(payee.totalMinor)} in total.`,
        figures: [
          { label: 'Payments', text: payee.count.toString() },
          { label: 'Total', amountMinor: payee.totalMinor.toString() },
        ],
        link: expensesLink('View these payments', { q: payee.label.slice(0, 100) }),
      });
    }

    const incomeNow = BigInt(overview.cashFlow.incomeMinor);
    const incomeBefore = BigInt(previousOverview.cashFlow.incomeMinor);
    const incomeChange = changeBp(incomeBefore, incomeNow);
    if (
      incomeChange !== undefined &&
      incomeNow > 0n &&
      (incomeChange < 0n ? -incomeChange : incomeChange) >= 2_000n
    ) {
      const up = incomeChange > 0n;
      items.push({
        key: `income:${currency}:${range.from}`,
        kind: 'income_change',
        currency,
        period,
        comparedTo,
        title: `Income was ${formatBasisPoints(up ? incomeChange : -incomeChange)} ${up ? 'higher' : 'lower'}`,
        detail: `${money(incomeNow)} received in ${periodWords}, compared with ${money(incomeBefore)} in ${earlierWords}. Net cash flow for the period was ${money(overview.cashFlow.netMinor)}.`,
        figures: [
          { label: periodWords, amountMinor: incomeNow.toString() },
          { label: earlierWords, amountMinor: incomeBefore.toString() },
          { label: 'Net cash flow', amountMinor: overview.cashFlow.netMinor },
        ],
        link: {
          label: 'View income',
          target: {
            kind: 'transactions',
            filters: { type: 'income', currency, from: range.from, to: range.to },
          },
        },
      });
    }

    return {
      period,
      currency,
      currencies: overview.currencies,
      items: items.filter((item) => !dismissed.has(item.key)),
      insufficientHistory:
        previousOverview.cashFlow.expenseCount + previousOverview.cashFlow.incomeCount === 0 ||
        history.length < 8,
    };
  };

  return {
    list,

    topPayees: async (caller, query, limit) => {
      const range = resolveRange(query, caller.timeZone, now());
      const overview = await dashboard.overview(caller, query);
      const window = windowOf(caller, range.from, range.to);
      const rows = (
        await repository.activity(caller.userId, window.start, window.end, ACTIVITY_LIMIT)
      ).filter((row) => row.currency === overview.currency);
      return {
        period: { from: range.from, to: range.to },
        currency: overview.currency,
        payees: payeeTotals(rows).slice(0, limit),
      };
    },

    recurringCandidates: async (caller) => {
      const today = calendarDateInTimeZone(now(), caller.timeZone);
      const start = startOfDayInTimeZone(
        addMonthsToIsoDate(today, -CANDIDATE_RULES.historyMonths),
        caller.timeZone,
      );
      const end = startOfDayInTimeZone(addDaysToIsoDate(today, 1), caller.timeZone);
      const [rows, schedules, dismissed] = await Promise.all([
        repository.activity(caller.userId, start, end, ACTIVITY_LIMIT),
        repository.schedules(caller.userId),
        repository.dismissed(caller.userId, 'recurring_candidate'),
      ]);
      const items: RecurringCandidateDto[] = recurringCandidates(
        rows,
        schedules,
        dismissed,
        today,
        caller.timeZone,
      ).flatMap((candidate) => {
        const currency = asCurrency(candidate.currency);
        if (currency === undefined) return [];
        const last = candidate.rows.at(-1);
        const sameCategory = candidate.rows.every((row) => row.categoryId === last?.categoryId);
        const sameAccount = candidate.rows.every((row) => row.accountId === last?.accountId);
        const money = (amount: bigint): string => formatMoney(amount, currency);
        const range =
          candidate.minMinor === candidate.maxMinor
            ? money(candidate.typicalMinor)
            : `${money(candidate.minMinor)}–${money(candidate.maxMinor)}`;
        return [
          {
            key: candidate.key,
            label: candidate.label.slice(0, 255),
            ...(candidate.merchant === undefined
              ? {}
              : { merchant: candidate.merchant.slice(0, 120) }),
            currency,
            typicalAmountMinor: candidate.typicalMinor.toString(),
            minAmountMinor: candidate.minMinor.toString(),
            maxAmountMinor: candidate.maxMinor.toString(),
            frequency: candidate.frequency,
            lastDate: candidate.lastDate,
            nextEstimatedDate: candidate.nextEstimatedDate,
            occurrences: candidate.rows.length,
            transactionIds: candidate.rows.slice(-24).map((row) => row.id),
            ...(sameAccount && last !== undefined ? { accountId: last.accountId } : {}),
            ...(sameCategory && last !== undefined && last.categoryId !== null
              ? { categoryId: last.categoryId }
              : {}),
            strength: candidate.strong ? 'strong' : 'possible',
            evidence: `${candidate.rows.length.toString()} payments, ${candidate.fitting.toString()} of ${candidate.intervals.toString()} gaps fit a ${candidate.frequency} rhythm, amounts ${range}. The next date is an estimate.`,
            likelySubscription: SUBSCRIPTION_HINTS.test(
              `${last?.topCategoryName ?? ''} ${last?.categoryName ?? ''} ${candidate.label}`,
            ),
          },
        ];
      });
      return { items };
    },

    dismissInsight: (caller, key) => repository.dismiss(caller.userId, 'insight', key),
    dismissCandidate: (caller, key) =>
      repository.dismiss(caller.userId, 'recurring_candidate', key),
  };
}
