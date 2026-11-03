import {
  addDaysToIsoDate,
  addMonthsToIsoDate,
  daysBetween,
  serializeMinorUnits,
  type CurrencyCode,
  type IsoDateString,
  type ScenarioAdjustmentDto,
  type ScenarioBudgetImpactDto,
  type ScenarioDefinitionInput,
  type ScenarioEffectDto,
  type ScenarioGoalImpactDto,
  type ScenarioGoalOutcomeDto,
  type ScenarioResultDto,
  type ScenarioTimelinePointDto,
} from '@calmcash/shared';

import { formatBasisPoints, formatDate, formatMoney } from '../../lib/text-format';
import { dayIndex, isCounted, type PendingOccurrence } from './cash-flow-forecast';
import { paceOf, outcomeFor, type GoalInput, type GoalOutcome } from './goal-projections';
import {
  canEstimate,
  categorySeries,
  sufficiencyOf,
  variableSpendingSeries,
  type History,
} from './history';
import { applyBasisPoints, median, prorate } from './statistics';

// What-if scenarios: the baseline projection and the same projection with hypothetical changes,
// side by side. Both are computed here from the same inputs; nothing is written anywhere — no
// transaction, schedule, budget, or contribution — and a saved scenario stores its assumptions
// only, so every run uses the records as they are now.
//
// Baseline (per day k after today, k = 0…horizon):
//   position(k) = net position now + scheduled income due by day k − scheduled expenses due by
//                 day k (overdue bills on day 0) − typical unscheduled spending prorated over k days
// Each change adds its own cumulative effect on income or spending to that line. Percentages and
// monthly amounts are prorated at the average month length; a change limited to N months stops
// after the N calendar months that follow today.

export interface ScenarioBase {
  currency: CurrencyCode;
  today: IsoDateString;
  heldMinor: bigint;
  owedMinor: bigint;
  /** Pending occurrences in the currency due up to the horizon (overdue ones included). */
  pending: readonly PendingOccurrence[];
  history: History;
}

export interface ScenarioRefs {
  categories: ReadonlyMap<
    string,
    { name: string; kind: 'income' | 'expense'; parentId: string | null; archived: boolean }
  >;
  schedules: ReadonlyMap<
    string,
    { name: string; type: 'income' | 'expense'; currency: string; active: boolean }
  >;
  goals: ReadonlyMap<string, GoalInput>;
  /** Current monthly category budgets in the scenario's currency. */
  budgets: readonly { budgetId: string; name: string; categoryId: string; limitMinor: bigint }[];
}

/** Cumulative change by day k, split into income and spending. */
interface Flow {
  income: bigint;
  expense: bigint;
}

interface Effect {
  index: number;
  kind: ScenarioAdjustmentDto['kind'];
  description: string;
  status: 'applied' | 'not_applicable';
  reason?: string;
  at: (day: number) => Flow;
}

const NONE: Flow = { income: 0n, expense: 0n };
const none = (): Flow => NONE;

export type ScenarioSimulation = Omit<
  ScenarioResultDto,
  'calculatedAt' | 'recalculationPolicy' | 'scenarioId'
>;

function signed(direction: 'decrease' | 'increase', amount: bigint): bigint {
  return direction === 'decrease' ? -amount : amount;
}

/** Days covered by "the next N months" from today, within the horizon. */
function limitDays(today: IsoDateString, horizonDays: number, months: number | undefined): number {
  if (months === undefined) return horizonDays;
  return Math.min(horizonDays, daysBetween(today, addMonthsToIsoDate(today, months)));
}

function timelineDays(horizonDays: number): number[] {
  const step = horizonDays <= 90 ? 7 : horizonDays <= 180 ? 14 : 30;
  const days: number[] = [];
  for (let day = 0; day < horizonDays; day += step) days.push(day);
  days.push(horizonDays);
  return days;
}

export function simulateScenario(
  definition: ScenarioDefinitionInput,
  base: ScenarioBase,
  refs: ScenarioRefs,
): ScenarioSimulation {
  const { today, currency } = base;
  const horizon = definition.horizonDays;
  const to = addDaysToIsoDate(today, horizon);
  const money = (amount: bigint): string => formatMoney(amount, currency);
  const sufficiency = sufficiencyOf(base.history);
  const estimable = canEstimate(sufficiency.level);

  const counted = base.pending.filter((item) => item.dueDate <= to && isCounted(item));
  const indexed = counted.map((item) => ({ item, day: dayIndex(today, item.dueDate) }));
  const variableMonthly = estimable ? median(variableSpendingSeries(base.history)) : 0n;
  const baselineAt = (day: number): Flow => {
    let income = 0n;
    let expense = prorate(variableMonthly, day);
    for (const { item, day: due } of indexed) {
      if (due > day) continue;
      if (item.type === 'income') income += item.amountMinor;
      else expense += item.amountMinor;
    }
    return { income, expense };
  };

  const effects: Effect[] = [];
  const goalPace = new Map<string, bigint>();
  const goalDate = new Map<string, IsoDateString>();
  let debtPayment = 0n;
  const categoryMonthlyChange = new Map<string, bigint>();

  const notApplicable = (
    index: number,
    kind: ScenarioAdjustmentDto['kind'],
    description: string,
    reason: string,
  ): Effect => ({ index, kind, description, status: 'not_applicable', reason, at: none });

  definition.adjustments.forEach((adjustment, index) => {
    switch (adjustment.kind) {
      case 'category_spending': {
        const category = refs.categories.get(adjustment.categoryId);
        const label = category?.name ?? 'a category';
        const amountWords =
          adjustment.change.by === 'percent'
            ? formatBasisPoints(BigInt(adjustment.change.percentBp))
            : `${money(BigInt(adjustment.change.amountMinor))} a month`;
        const description = `${adjustment.direction === 'decrease' ? 'Spend less' : 'Spend more'} on ${label} by ${amountWords}${adjustment.months === undefined ? '' : ` for ${adjustment.months.toString()} months`}`;
        if (category?.kind !== 'expense') {
          effects.push(
            notApplicable(
              index,
              adjustment.kind,
              description,
              'That expense category is not one of yours.',
            ),
          );
          return;
        }
        if (category.parentId !== null) {
          effects.push(
            notApplicable(
              index,
              adjustment.kind,
              description,
              'Scenarios use main categories; choose its parent category instead.',
            ),
          );
          return;
        }
        const history = base.history.categories.get(adjustment.categoryId);
        const typical =
          history === undefined || !estimable
            ? 0n
            : median(
                categorySeries(base.history, history, 'variable').map((month) => month.amountMinor),
              );
        let monthly: bigint;
        let reason: string | undefined;
        if (adjustment.change.by === 'percent') {
          if (typical <= 0n) {
            effects.push(
              notApplicable(
                index,
                adjustment.kind,
                description,
                'There is not enough everyday spending history in this category to apply a percentage.',
              ),
            );
            return;
          }
          monthly = applyBasisPoints(typical, adjustment.change.percentBp);
        } else {
          monthly = BigInt(adjustment.change.amountMinor);
          if (adjustment.direction === 'decrease') {
            if (typical <= 0n) {
              effects.push(
                notApplicable(
                  index,
                  adjustment.kind,
                  description,
                  'There is no typical everyday spending in this category to reduce.',
                ),
              );
              return;
            }
            if (monthly > typical) {
              reason = `Limited to the typical month of ${money(typical)}: spending cannot go below zero.`;
              monthly = typical;
            }
          }
        }
        const days = limitDays(today, horizon, adjustment.months);
        const change = signed(adjustment.direction, monthly);
        categoryMonthlyChange.set(
          adjustment.categoryId,
          (categoryMonthlyChange.get(adjustment.categoryId) ?? 0n) + change,
        );
        effects.push({
          index,
          kind: adjustment.kind,
          description,
          status: 'applied',
          ...(reason === undefined ? {} : { reason }),
          at: (day) => ({
            income: 0n,
            expense: signed(adjustment.direction, prorate(monthly, Math.min(day, days))),
          }),
        });
        return;
      }

      case 'income_change': {
        const days = limitDays(today, horizon, adjustment.months);
        const words =
          adjustment.change.by === 'percent'
            ? `${formatBasisPoints(BigInt(adjustment.change.percentBp))} of scheduled income`
            : `${money(BigInt(adjustment.change.amountMinor))} a month`;
        const description = `Income ${adjustment.direction === 'decrease' ? 'falls' : 'rises'} by ${words}${adjustment.months === undefined ? '' : ` for ${adjustment.months.toString()} months`}`;
        if (adjustment.change.by === 'percent') {
          const percentBp = adjustment.change.percentBp;
          const income = indexed.filter(
            ({ item }) => item.type === 'income' && item.status !== 'overdue',
          );
          if (income.length === 0) {
            effects.push(
              notApplicable(
                index,
                adjustment.kind,
                description,
                'No scheduled income is due in this period to change by a percentage.',
              ),
            );
            return;
          }
          effects.push({
            index,
            kind: adjustment.kind,
            description,
            status: 'applied',
            at: (day) => ({
              income: signed(
                adjustment.direction,
                income
                  .filter(({ day: due }) => due <= Math.min(day, days))
                  .reduce(
                    (total, { item }) => total + applyBasisPoints(item.amountMinor, percentBp),
                    0n,
                  ),
              ),
              expense: 0n,
            }),
          });
          return;
        }
        const monthly = BigInt(adjustment.change.amountMinor);
        effects.push({
          index,
          kind: adjustment.kind,
          description,
          status: 'applied',
          at: (day) => ({
            income: signed(adjustment.direction, prorate(monthly, Math.min(day, days))),
            expense: 0n,
          }),
        });
        return;
      }

      case 'cancel_schedule':
      case 'change_schedule_amount': {
        const schedule = refs.schedules.get(adjustment.scheduleId);
        const name = schedule?.name ?? 'a schedule';
        const description =
          adjustment.kind === 'cancel_schedule'
            ? `Stop ${name}`
            : `Change ${name} to ${money(BigInt(adjustment.amountMinor))} each time`;
        if (schedule === undefined) {
          effects.push(
            notApplicable(
              index,
              adjustment.kind,
              description,
              'That schedule is not one of yours any more.',
            ),
          );
          return;
        }
        if (schedule.currency !== currency) {
          effects.push(
            notApplicable(
              index,
              adjustment.kind,
              description,
              `That schedule is in ${schedule.currency}, not ${currency}.`,
            ),
          );
          return;
        }
        if (!schedule.active) {
          effects.push(
            notApplicable(
              index,
              adjustment.kind,
              description,
              'That schedule is paused or has ended, so nothing is expected from it.',
            ),
          );
          return;
        }
        // Overdue occurrences are already owed; only upcoming ones change.
        const items = indexed.filter(
          ({ item }) => item.scheduleId === adjustment.scheduleId && item.status !== 'overdue',
        );
        const newAmount =
          adjustment.kind === 'change_schedule_amount' ? BigInt(adjustment.amountMinor) : 0n;
        effects.push({
          index,
          kind: adjustment.kind,
          description,
          status: 'applied',
          ...(items.length === 0
            ? { reason: 'Nothing from this schedule is due in this period.' }
            : {}),
          at: (day) => {
            const delta = items
              .filter(({ day: due }) => due <= day)
              .reduce((total, { item }) => total + (newAmount - item.amountMinor), 0n);
            return schedule.type === 'income'
              ? { income: delta, expense: 0n }
              : { income: 0n, expense: delta };
          },
        });
        return;
      }

      case 'monthly_expense':
      case 'monthly_income': {
        const monthly = BigInt(adjustment.amountMinor);
        const days = limitDays(today, horizon, adjustment.months);
        const expense = adjustment.kind === 'monthly_expense';
        effects.push({
          index,
          kind: adjustment.kind,
          description: `${expense ? 'Extra spending' : 'Extra income'}: ${adjustment.label}, ${money(monthly)} a month${adjustment.months === undefined ? '' : ` for ${adjustment.months.toString()} months`}`,
          status: 'applied',
          at: (day) => {
            const amount = prorate(monthly, Math.min(day, days));
            return expense ? { income: 0n, expense: amount } : { income: amount, expense: 0n };
          },
        });
        return;
      }

      case 'one_time_expense': {
        const amount = BigInt(adjustment.amountMinor);
        const description = `One-off: ${adjustment.label}, ${money(amount)} on ${formatDate(adjustment.date)}`;
        if (adjustment.date < today || adjustment.date > to) {
          effects.push(
            notApplicable(
              index,
              adjustment.kind,
              description,
              'That date is outside the period of this scenario.',
            ),
          );
          return;
        }
        const due = dayIndex(today, adjustment.date);
        effects.push({
          index,
          kind: adjustment.kind,
          description,
          status: 'applied',
          at: (day) => (day >= due ? { income: 0n, expense: amount } : NONE),
        });
        return;
      }

      case 'debt_payment': {
        const amount = BigInt(adjustment.amountMinor);
        const description = `Pay ${money(amount)} off cards or loans from money held`;
        if (base.owedMinor <= 0n || amount > base.owedMinor) {
          effects.push(
            notApplicable(
              index,
              adjustment.kind,
              description,
              `That is more than you owe in ${currency} now (${money(base.owedMinor > 0n ? base.owedMinor : 0n)}).`,
            ),
          );
          return;
        }
        if (amount > base.heldMinor - debtPayment) {
          effects.push(
            notApplicable(
              index,
              adjustment.kind,
              description,
              `That is more than the money you hold in ${currency} now.`,
            ),
          );
          return;
        }
        debtPayment += amount;
        effects.push({
          index,
          kind: adjustment.kind,
          description,
          status: 'applied',
          reason:
            'Money held and money owed both fall by the same amount, so the net position does not change.',
          at: none,
        });
        return;
      }

      case 'goal_contribution':
      case 'goal_target_date': {
        const goal = refs.goals.get(adjustment.goalId);
        const description =
          adjustment.kind === 'goal_contribution'
            ? `Set aside ${money(BigInt(adjustment.monthlyAmountMinor))} a month for ${goal?.name ?? 'a goal'}`
            : `Move the target date of ${goal?.name ?? 'a goal'} to ${formatDate(adjustment.targetDate)}`;
        if (goal === undefined) {
          effects.push(
            notApplicable(
              index,
              adjustment.kind,
              description,
              'That goal is not one of your current goals.',
            ),
          );
          return;
        }
        if (goal.currency !== currency) {
          effects.push(
            notApplicable(
              index,
              adjustment.kind,
              description,
              `That goal is in ${goal.currency}, not ${currency}.`,
            ),
          );
          return;
        }
        if (adjustment.kind === 'goal_target_date' && adjustment.targetDate <= today) {
          effects.push(
            notApplicable(index, adjustment.kind, description, 'Choose a target date after today.'),
          );
          return;
        }
        if (adjustment.kind === 'goal_contribution') {
          goalPace.set(
            goal.goalId,
            (goalPace.get(goal.goalId) ?? 0n) + BigInt(adjustment.monthlyAmountMinor),
          );
        } else {
          goalDate.set(goal.goalId, adjustment.targetDate);
        }
        effects.push({
          index,
          kind: adjustment.kind,
          description,
          status: 'applied',
          reason:
            'Goal allocations are planning records: they do not move money, so the projected position does not change.',
          at: none,
        });
        return;
      }
    }
  });

  const effectAt = (day: number): Flow =>
    effects.reduce(
      (total, effect) => {
        const flow = effect.at(day);
        return { income: total.income + flow.income, expense: total.expense + flow.expense };
      },
      { income: 0n, expense: 0n },
    );

  const net = base.heldMinor - base.owedMinor;
  const baseEnd = baselineAt(horizon);
  const change = effectAt(horizon);
  const baselineEnding = net + baseEnd.income - baseEnd.expense;
  const simulatedEnding = baselineEnding + change.income - change.expense;

  const timeline: ScenarioTimelinePointDto[] = timelineDays(horizon).map((day) => {
    const flow = baselineAt(day);
    const delta = effectAt(day);
    const baseline = net + flow.income - flow.expense;
    return {
      date: addDaysToIsoDate(today, day),
      baselineMinor: serializeMinorUnits(baseline),
      simulatedMinor: serializeMinorUnits(baseline + delta.income - delta.expense),
    };
  });

  const effectDtos: ScenarioEffectDto[] = effects.map((effect) => {
    const flow = effect.at(horizon);
    return {
      index: effect.index,
      kind: effect.kind,
      description: effect.description.slice(0, 300),
      status: effect.status,
      ...(effect.reason === undefined ? {} : { reason: effect.reason.slice(0, 300) }),
      positionChangeMinor: serializeMinorUnits(flow.income - flow.expense),
    };
  });

  const outcomeDto = (outcome: GoalOutcome): ScenarioGoalOutcomeDto => ({
    state: outcome.state,
    ...(outcome.requiredMonthlyMinor === undefined
      ? {}
      : { requiredMonthlyMinor: serializeMinorUnits(outcome.requiredMonthlyMinor) }),
    ...(outcome.projectedCompletionDate === undefined
      ? {}
      : { projectedCompletionDate: outcome.projectedCompletionDate }),
  });
  const goalImpacts: ScenarioGoalImpactDto[] = [
    ...new Set([...goalPace.keys(), ...goalDate.keys()]),
  ].flatMap((goalId) => {
    const goal = refs.goals.get(goalId);
    if (goal === undefined) return [];
    const { pace } = paceOf(goal, today);
    const recent = pace.status === 'available' ? BigInt(pace.monthlyAverageMinor) : undefined;
    const baseline = outcomeFor(
      goal.targetMinor,
      goal.savedMinor,
      goal.status,
      goal.targetDate,
      recent,
      today,
    );
    const simulated = outcomeFor(
      goal.targetMinor,
      goal.savedMinor,
      // Planning contributions to a paused goal means picturing it resumed.
      goal.status === 'paused' && goalPace.has(goalId) ? 'active' : goal.status,
      goalDate.get(goalId) ?? goal.targetDate,
      goalPace.get(goalId) ?? recent,
      today,
    );
    return [
      { goalId, name: goal.name, baseline: outcomeDto(baseline), simulated: outcomeDto(simulated) },
    ];
  });

  const budgetImpacts: ScenarioBudgetImpactDto[] = refs.budgets.flatMap((budget) => {
    const delta = categoryMonthlyChange.get(budget.categoryId);
    if (delta === undefined) return [];
    const history = base.history.categories.get(budget.categoryId);
    const typical =
      history === undefined
        ? 0n
        : median(categorySeries(base.history, history).map((month) => month.amountMinor));
    const simulated = typical + delta < 0n ? 0n : typical + delta;
    return [
      {
        budgetId: budget.budgetId,
        name: budget.name,
        limitMinor: serializeMinorUnits(budget.limitMinor),
        baselineMonthlyMinor: serializeMinorUnits(typical),
        simulatedMonthlyMinor: serializeMinorUnits(simulated),
      },
    ];
  });

  const assumptions = [
    `The baseline is the cash-flow projection from today to ${formatDate(to)}: your net position now, plus scheduled income, minus scheduled bills, minus typical everyday spending of ${money(variableMonthly)} a month.`,
    'Income without a schedule is not assumed in either projection.',
    'Monthly amounts and percentages are spread evenly over the days they apply to (365.25 ÷ 12 days per month).',
    'Category changes apply to everyday spending in that category, not to scheduled bills.',
  ];
  const limitations = [
    'A simulation only: nothing was recorded, scheduled, budgeted, or allocated.',
    'Real spending varies from month to month; the result is an estimate, not a guaranteed outcome.',
    'Projections are per currency and combine money held and money owed into one net position.',
  ];
  if (!estimable) {
    limitations.unshift(
      'There is not enough completed history to estimate everyday spending, so it is left out of both projections.',
    );
  }

  return {
    name: definition.name,
    currency,
    horizonDays: definition.horizonDays,
    from: today,
    to,
    sufficiency,
    baseline: {
      startingPositionMinor: serializeMinorUnits(net),
      incomeMinor: serializeMinorUnits(baseEnd.income),
      expensesMinor: serializeMinorUnits(baseEnd.expense),
      endingPositionMinor: serializeMinorUnits(baselineEnding),
    },
    simulated: {
      startingPositionMinor: serializeMinorUnits(net),
      incomeMinor: serializeMinorUnits(baseEnd.income + change.income),
      expensesMinor: serializeMinorUnits(baseEnd.expense + change.expense),
      endingPositionMinor: serializeMinorUnits(simulatedEnding),
    },
    differenceMinor: serializeMinorUnits(simulatedEnding - baselineEnding),
    ...(debtPayment === 0n
      ? {}
      : {
          heldAndOwed: {
            baselineHeldMinor: serializeMinorUnits(base.heldMinor),
            baselineOwedMinor: serializeMinorUnits(base.owedMinor),
            simulatedHeldMinor: serializeMinorUnits(base.heldMinor - debtPayment),
            simulatedOwedMinor: serializeMinorUnits(base.owedMinor - debtPayment),
          },
        }),
    effects: effectDtos,
    timeline,
    goalImpacts,
    budgetImpacts,
    assumptions,
    limitations,
  };
}
