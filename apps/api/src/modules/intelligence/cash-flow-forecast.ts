import {
  addDaysToIsoDate,
  daysBetween,
  divideRounded,
  FORECAST_ITEM_LIMIT,
  INTELLIGENCE_RULES,
  serializeMinorUnits,
  type CurrencyCashFlowForecastDto,
  type CurrencyCode,
  type ForecastBucketDto,
  type ForecastIncomeBasis,
  type ForecastItemDto,
  type ForecastWarningDto,
  type IsoDateString,
} from '@calmcash/shared';

import {
  canEstimate,
  series,
  sufficiencyOf,
  unscheduledIncomeSeries,
  variableSpendingSeries,
  type History,
} from './history';
import { highest, lowest, median, prorate } from './statistics';

// The cash-flow forecast, as one pure function of measured inputs:
//
//   projected net position = current net position (money held − money owed, now)
//                          + scheduled income due from today to the horizon
//                          + estimated unscheduled income (only when the person asks for it)
//                          − scheduled expenses due from today to the horizon (overdue included)
//                          − estimated variable spending over the horizon's days
//
// Scheduled amounts are pending occurrences of confirmed schedules: recorded occurrences already
// moved the balance, so they are never counted again, and skipped or paused ones are not owed.
// Variable spending is the median of completed months' expenses that were *not* recorded from a
// schedule (those are represented by the schedules themselves), spread over the horizon at the
// average month length. Overdue income is reported but never assumed to arrive.

export interface PendingOccurrence {
  scheduleId: string;
  currency: CurrencyCode;
  name: string;
  type: 'income' | 'expense';
  isSubscription: boolean;
  categoryId: string | undefined;
  scheduledDate: IsoDateString;
  dueDate: IsoDateString;
  status: 'upcoming' | 'due' | 'overdue';
  postponed: boolean;
  amountMinor: bigint;
}

export interface ForecastInput {
  currency: CurrencyCode;
  today: IsoDateString;
  horizonDays: number;
  incomeBasis: ForecastIncomeBasis;
  heldMinor: bigint;
  owedMinor: bigint;
  monthToDate: {
    from: IsoDateString;
    to: IsoDateString;
    incomeMinor: bigint;
    expenseMinor: bigint;
  };
  /** Pending occurrences of this currency due up to the horizon (overdue ones included). */
  pending: readonly PendingOccurrence[];
  pendingTruncated: boolean;
  history: History;
}

/** Whether a pending occurrence counts towards the projection. */
export function isCounted(item: Pick<PendingOccurrence, 'status' | 'type'>): boolean {
  return item.status !== 'overdue' || item.type === 'expense';
}

/** Day index (0 = today) of a due date; overdue items fall on day 0. */
export function dayIndex(today: IsoDateString, dueDate: IsoDateString): number {
  return dueDate <= today ? 0 : daysBetween(today, dueDate);
}

/** Bucket boundaries as inclusive day indexes: daily up to 30 days, weekly beyond. */
export function bucketBounds(horizonDays: number): [number, number][] {
  const size = horizonDays <= 30 ? 1 : 7;
  const bounds: [number, number][] = [];
  for (let start = 0; start <= horizonDays; start += size) {
    bounds.push([start, Math.min(horizonDays, start + size - 1)]);
  }
  return bounds;
}

function warning(code: ForecastWarningDto['code'], message: string): ForecastWarningDto {
  return { code, message };
}

/** True when the monthly amounts spread by more than half their median (irregular income). */
export function isIrregular(amounts: readonly bigint[]): boolean {
  if (amounts.length < 3) return false;
  const typical = median(amounts);
  if (typical <= 0n) return amounts.some((amount) => amount > 0n);
  return (
    (highest(amounts) - lowest(amounts)) * 10_000n >
    INTELLIGENCE_RULES.irregularIncomeSpreadBp * typical
  );
}

export function forecastCashFlow(input: ForecastInput): CurrencyCashFlowForecastDto {
  const { history, horizonDays, today } = input;
  const to = addDaysToIsoDate(today, horizonDays);
  const sufficiency = sufficiencyOf(history);
  const estimable = canEstimate(sufficiency.level);

  const inRange = input.pending
    .filter((item) => item.dueDate <= to)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name));
  const counted = inRange.filter(isCounted);
  const overdueIncome = inRange.filter((item) => !isCounted(item));
  const total = (items: readonly PendingOccurrence[]): bigint =>
    items.reduce((sum, item) => sum + item.amountMinor, 0n);
  const scheduledIncome = counted.filter((item) => item.type === 'income');
  const scheduledExpenses = counted.filter((item) => item.type === 'expense');
  const overdueExpenses = scheduledExpenses.filter((item) => item.status === 'overdue');

  // Estimated variable spending and (optionally) unscheduled income, from completed months.
  const variableMonths = variableSpendingSeries(history);
  const variableBaseline = estimable ? median(variableMonths) : undefined;
  const incomeMonths = unscheduledIncomeSeries(history);
  const incomeBaseline = estimable ? median(incomeMonths) : undefined;
  const includeIncome =
    incomeBaseline !== undefined && input.incomeBasis === 'scheduled_and_estimated';

  const variableTotal =
    variableBaseline === undefined ? 0n : prorate(variableBaseline, horizonDays);
  const estimatedIncomeTotal = includeIncome ? prorate(incomeBaseline, horizonDays) : 0n;
  const netNow = input.heldMinor - input.owedMinor;
  const expectedIncome = total(scheduledIncome) + estimatedIncomeTotal;
  const expectedExpenses = total(scheduledExpenses) + variableTotal;
  const ending = netNow + expectedIncome - expectedExpenses;

  // Timeline: cumulative estimates per day index keep every bucket exact and their sum whole.
  const buckets: ForecastBucketDto[] = [];
  let position = netNow;
  for (const [first, last] of bucketBounds(horizonDays)) {
    const due = counted.filter((item) => {
      const index = dayIndex(today, item.dueDate);
      return index >= first && index <= last;
    });
    const income = total(due.filter((item) => item.type === 'income'));
    const expense = total(due.filter((item) => item.type === 'expense'));
    const spread = (monthly: bigint | undefined, enabled: boolean): bigint =>
      monthly === undefined || !enabled ? 0n : prorate(monthly, last) - prorate(monthly, first - 1);
    const variable = spread(variableBaseline, true);
    const estimatedIncome = spread(incomeBaseline, includeIncome);
    position += income + estimatedIncome - expense - variable;
    buckets.push({
      start: addDaysToIsoDate(today, first),
      end: addDaysToIsoDate(today, last),
      scheduledIncomeMinor: serializeMinorUnits(income),
      scheduledExpenseMinor: serializeMinorUnits(expense),
      estimatedIncomeMinor: serializeMinorUnits(estimatedIncome),
      estimatedVariableMinor: serializeMinorUnits(variable),
      projectedPositionMinor: serializeMinorUnits(position),
    });
  }

  const warnings: ForecastWarningDto[] = [];
  if (sufficiency.level === 'insufficient') {
    warnings.push(
      warning(
        'insufficient_history',
        'There is not enough completed history to estimate everyday spending, so only scheduled bills and income are projected.',
      ),
    );
  } else if (sufficiency.level === 'limited') {
    warnings.push(
      warning(
        'limited_history',
        `The estimate of everyday spending rests on only ${sufficiency.monthsWithActivity.toString()} completed months and may be far off.`,
      ),
    );
  }
  if (isIrregular(series(history, (month) => month.incomeMinor))) {
    warnings.push(
      warning(
        'irregular_income',
        'Your recorded income has varied a lot from month to month, so income may differ from this projection.',
      ),
    );
  }
  if (input.pending.length === 0) {
    warnings.push(
      warning(
        'no_schedules',
        'No recurring bills or income are scheduled in this currency, so known future payments are not part of this forecast.',
      ),
    );
  } else if (
    expectedExpenses > 0n &&
    total(scheduledExpenses) * 10_000n > INTELLIGENCE_RULES.scheduleHeavyShareBp * expectedExpenses
  ) {
    warnings.push(
      warning(
        'schedule_heavy',
        'Most of the expected spending comes from schedules you entered; keep their amounts and dates up to date.',
      ),
    );
  }
  if (inRange.some((item) => item.postponed)) {
    warnings.push(
      warning(
        'postponed_timing',
        'Some payments were postponed, so their timing may change again.',
      ),
    );
  }
  if (overdueExpenses.length > 0 || overdueIncome.length > 0) {
    warnings.push(
      warning(
        'overdue_items',
        'Some scheduled payments are overdue and not recorded. Overdue bills are counted as still to pay; overdue income is not counted. Record or skip them to keep this accurate.',
      ),
    );
  }
  if (includeIncome) {
    warnings.push(
      warning(
        'estimated_income_included',
        'Typical income without a schedule is included as an estimate. Past income is not a promise of future income.',
      ),
    );
  }
  if (input.pendingTruncated) {
    warnings.push(
      warning('truncated', 'There are more scheduled payments than one forecast can include.'),
    );
  }
  warnings.push(
    warning(
      'account_allocation',
      'This is a projection per currency, not a bank balance: CalmCash cannot tell which account future spending will use, so money held and money owed are projected together as a net position.',
    ),
  );

  const items: ForecastItemDto[] = inRange.slice(0, FORECAST_ITEM_LIMIT).map((item) => ({
    scheduleId: item.scheduleId,
    name: item.name,
    type: item.type,
    isSubscription: item.isSubscription,
    scheduledDate: item.scheduledDate,
    dueDate: item.dueDate,
    status: item.status,
    postponed: item.postponed,
    amountMinor: serializeMinorUnits(item.amountMinor),
    counted: isCounted(item),
  }));

  const monthsUsed = history.months.length;
  return {
    currency: input.currency,
    sufficiency,
    starting: {
      heldMinor: serializeMinorUnits(input.heldMinor),
      owedMinor: serializeMinorUnits(input.owedMinor),
      netPositionMinor: serializeMinorUnits(netNow),
    },
    monthToDate: {
      from: input.monthToDate.from,
      to: input.monthToDate.to,
      incomeMinor: serializeMinorUnits(input.monthToDate.incomeMinor),
      expenseMinor: serializeMinorUnits(input.monthToDate.expenseMinor),
    },
    scheduledIncome: {
      amountMinor: serializeMinorUnits(total(scheduledIncome)),
      count: scheduledIncome.length,
    },
    scheduledExpenses: {
      amountMinor: serializeMinorUnits(total(scheduledExpenses)),
      count: scheduledExpenses.length,
      subscriptionMinor: serializeMinorUnits(
        total(scheduledExpenses.filter((item) => item.isSubscription)),
      ),
      overdueMinor: serializeMinorUnits(total(overdueExpenses)),
      overdueCount: overdueExpenses.length,
    },
    overdueIncomeNotCounted: {
      amountMinor: serializeMinorUnits(total(overdueIncome)),
      count: overdueIncome.length,
    },
    variableSpending:
      variableBaseline === undefined
        ? { status: 'unavailable', reason: 'insufficient_history' }
        : {
            status: 'available',
            amountMinor: serializeMinorUnits(variableTotal),
            monthlyBaselineMinor: serializeMinorUnits(variableBaseline),
            lowMinor: serializeMinorUnits(prorate(lowest(variableMonths), horizonDays)),
            highMinor: serializeMinorUnits(prorate(highest(variableMonths), horizonDays)),
            monthsUsed,
          },
    estimatedIncome:
      incomeBaseline === undefined
        ? { status: 'unavailable', reason: 'insufficient_history' }
        : {
            status: includeIncome ? 'included' : 'excluded',
            amountMinor: serializeMinorUnits(prorate(incomeBaseline, horizonDays)),
            monthlyBaselineMinor: serializeMinorUnits(incomeBaseline),
            monthsUsed,
          },
    expectedIncomeMinor: serializeMinorUnits(expectedIncome),
    expectedExpensesMinor: serializeMinorUnits(expectedExpenses),
    projected: {
      endingPositionMinor: serializeMinorUnits(ending),
      changeMinor: serializeMinorUnits(ending - netNow),
      ...(variableBaseline === undefined
        ? {}
        : {
            // The low end uses the highest month's spending, the high end the lowest month's.
            lowMinor: serializeMinorUnits(
              ending + variableTotal - prorate(highest(variableMonths), horizonDays),
            ),
            highMinor: serializeMinorUnits(
              ending + variableTotal - prorate(lowest(variableMonths), horizonDays),
            ),
          }),
    },
    buckets,
    items,
    itemsTruncated: inRange.length > FORECAST_ITEM_LIMIT,
    warnings,
  };
}

/** Share of a part in a whole, in basis points (for wording); 0 without a whole. */
export function shareBp(part: bigint, whole: bigint): bigint {
  return whole <= 0n ? 0n : divideRounded(part * 10_000n, whole);
}
