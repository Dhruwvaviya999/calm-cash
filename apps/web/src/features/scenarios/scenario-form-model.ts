import {
  CURRENCY_CODES,
  describeDecimalAmountError,
  formatDecimalAmount,
  parseDecimalAmount,
  parseMinorUnits,
  SCENARIO_HORIZONS,
  SCENARIO_LIMITS,
  scenarioDefinitionInputSchema,
  type CurrencyCode,
  type FinancialScenarioDto,
  type ScenarioAdjustmentDto,
  type ScenarioAdjustmentKind,
  type ScenarioChangeDto,
  type ScenarioDefinitionInput,
  type ScenarioHorizon,
} from '@calmcash/shared';

import {
  basisPointsFromPercent,
  percentFromBasisPoints,
} from '@/features/intelligence/intelligence-presentation';

// The scenario builder works with text the person typed; this module turns it into the API's
// exact contract (amounts parsed in the currency's minor units, percentages to basis points) and
// back. No React here.

/** One change being edited. Fields that the kind does not use are ignored. */
export interface AdjustmentDraft {
  /** Local key for the list (never sent). */
  key: string;
  kind: ScenarioAdjustmentKind;
  categoryId: string;
  scheduleId: string;
  goalId: string;
  direction: 'decrease' | 'increase';
  by: 'percent' | 'amount';
  /** A percentage ("15") or an amount ("2000"), depending on `by`. */
  value: string;
  /** Optional: for this many months. */
  months: string;
  label: string;
  amount: string;
  date: string;
}

export interface ScenarioFormValues {
  name: string;
  currency: CurrencyCode;
  horizonDays: ScenarioHorizon;
  adjustments: AdjustmentDraft[];
}

export type ScenarioFormErrors = Record<string, string>;

let counter = 0;
function nextKey(): string {
  counter += 1;
  return `change-${counter.toString()}`;
}

export function emptyAdjustment(kind: ScenarioAdjustmentKind): AdjustmentDraft {
  return {
    key: nextKey(),
    kind,
    categoryId: '',
    scheduleId: '',
    goalId: '',
    direction: kind === 'income_change' ? 'increase' : 'decrease',
    by: 'percent',
    value: '',
    months: '',
    label: '',
    amount: '',
    date: '',
  };
}

export function emptyScenarioValues(currency: CurrencyCode): ScenarioFormValues {
  return {
    name: '',
    currency,
    horizonDays: 90,
    adjustments: [emptyAdjustment('category_spending')],
  };
}

export function isHorizon(value: number): value is ScenarioHorizon {
  return SCENARIO_HORIZONS.some((horizon) => horizon === value);
}

export function isCurrency(value: string): value is CurrencyCode {
  return CURRENCY_CODES.some((code) => code === value);
}

function amountOf(
  text: string,
  currency: CurrencyCode,
  path: string,
  errors: ScenarioFormErrors,
): string | undefined {
  const parsed = parseDecimalAmount(text, currency);
  if (!parsed.ok) {
    errors[path] = describeDecimalAmountError(parsed.error, currency);
    return undefined;
  }
  if (parsed.minorUnits <= 0n) {
    errors[path] = 'Enter an amount above zero.';
    return undefined;
  }
  return parsed.minorUnits.toString();
}

function monthsOf(text: string, path: string, errors: ScenarioFormErrors): number | undefined {
  if (text.trim() === '') return undefined;
  const months = Number(text);
  if (!Number.isInteger(months) || months < 1 || months > SCENARIO_LIMITS.maxMonths) {
    errors[path] = `Use 1 to ${SCENARIO_LIMITS.maxMonths.toString()} months, or leave it empty.`;
    return undefined;
  }
  return months;
}

function required(
  value: string,
  path: string,
  message: string,
  errors: ScenarioFormErrors,
): string {
  if (value === '') errors[path] = message;
  return value;
}

/** The definition to send, or the problems per field (`name`, `adjustments.0.value`, …). */
export function buildScenarioInput(
  values: ScenarioFormValues,
): { ok: true; input: ScenarioDefinitionInput } | { ok: false; errors: ScenarioFormErrors } {
  const errors: ScenarioFormErrors = {};
  const { currency } = values;
  if (values.name.trim() === '')
    errors.name = 'Give this scenario a name, e.g. "Spend less on dining".';
  if (values.adjustments.length === 0) errors.adjustments = 'Add at least one change to simulate.';

  const adjustments: ScenarioAdjustmentDto[] = [];
  values.adjustments.forEach((draft, index) => {
    const path = (field: string): string => `adjustments.${index.toString()}.${field}`;
    const months = monthsOf(draft.months, path('months'), errors);
    const withMonths = months === undefined ? {} : { months };
    const change = (): ScenarioChangeDto | undefined => {
      if (draft.by === 'percent') {
        const percentBp = basisPointsFromPercent(draft.value);
        if (percentBp === undefined) {
          errors[path('value')] = 'Enter a percentage above zero, e.g. 15.';
          return undefined;
        }
        if (draft.direction === 'decrease' && percentBp > SCENARIO_LIMITS.maxDecreaseBp) {
          errors[path('value')] = 'A reduction can be at most 100 %.';
          return undefined;
        }
        if (percentBp > SCENARIO_LIMITS.maxIncreaseBp) {
          errors[path('value')] = 'Use at most 1000 %.';
          return undefined;
        }
        return { by: 'percent', percentBp };
      }
      const amountMinor = amountOf(draft.value, currency, path('value'), errors);
      return amountMinor === undefined ? undefined : { by: 'amount', amountMinor };
    };
    switch (draft.kind) {
      case 'category_spending': {
        const categoryId = required(
          draft.categoryId,
          path('categoryId'),
          'Choose a category.',
          errors,
        );
        const by = change();
        if (by !== undefined && categoryId !== '') {
          adjustments.push({
            kind: 'category_spending',
            categoryId,
            direction: draft.direction,
            change: by,
            ...withMonths,
          });
        }
        return;
      }
      case 'income_change': {
        const by = change();
        if (by !== undefined)
          adjustments.push({
            kind: 'income_change',
            direction: draft.direction,
            change: by,
            ...withMonths,
          });
        return;
      }
      case 'cancel_schedule': {
        const scheduleId = required(
          draft.scheduleId,
          path('scheduleId'),
          'Choose a schedule.',
          errors,
        );
        if (scheduleId !== '') adjustments.push({ kind: 'cancel_schedule', scheduleId });
        return;
      }
      case 'change_schedule_amount': {
        const scheduleId = required(
          draft.scheduleId,
          path('scheduleId'),
          'Choose a schedule.',
          errors,
        );
        const amountMinor = amountOf(draft.amount, currency, path('amount'), errors);
        if (scheduleId !== '' && amountMinor !== undefined)
          adjustments.push({ kind: 'change_schedule_amount', scheduleId, amountMinor });
        return;
      }
      case 'monthly_expense':
      case 'monthly_income':
      case 'one_time_expense': {
        const label = draft.label.trim();
        if (label === '') errors[path('label')] = 'Describe this change, e.g. "Rent increase".';
        const amountMinor = amountOf(draft.amount, currency, path('amount'), errors);
        if (draft.kind === 'one_time_expense') {
          const date = required(draft.date, path('date'), 'Choose the date.', errors);
          if (label !== '' && amountMinor !== undefined && date !== '')
            adjustments.push({ kind: 'one_time_expense', label, amountMinor, date });
        } else if (label !== '' && amountMinor !== undefined) {
          adjustments.push({ kind: draft.kind, label, amountMinor, ...withMonths });
        }
        return;
      }
      case 'debt_payment': {
        const amountMinor = amountOf(draft.amount, currency, path('amount'), errors);
        if (amountMinor !== undefined) adjustments.push({ kind: 'debt_payment', amountMinor });
        return;
      }
      case 'goal_contribution': {
        const goalId = required(draft.goalId, path('goalId'), 'Choose a goal.', errors);
        const monthlyAmountMinor = amountOf(draft.amount, currency, path('amount'), errors);
        if (goalId !== '' && monthlyAmountMinor !== undefined)
          adjustments.push({ kind: 'goal_contribution', goalId, monthlyAmountMinor });
        return;
      }
      case 'goal_target_date': {
        const goalId = required(draft.goalId, path('goalId'), 'Choose a goal.', errors);
        const targetDate = required(
          draft.date,
          path('date'),
          'Choose the new target date.',
          errors,
        );
        if (goalId !== '' && targetDate !== '')
          adjustments.push({ kind: 'goal_target_date', goalId, targetDate });
        return;
      }
    }
  });
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  // The same strict schema the API applies, so a request never surprises the server.
  const parsed = scenarioDefinitionInputSchema.safeParse({
    name: values.name.trim(),
    currency,
    horizonDays: values.horizonDays,
    adjustments,
  });
  if (!parsed.success) {
    return {
      ok: false,
      errors: Object.fromEntries(
        parsed.error.issues.map((issue) => [issue.path.join('.'), issue.message]),
      ),
    };
  }
  return { ok: true, input: parsed.data };
}

/** A saved scenario back into editable text. */
export function scenarioToFormValues(scenario: FinancialScenarioDto): ScenarioFormValues {
  const money = (amountMinor: string): string =>
    formatDecimalAmount(parseMinorUnits(amountMinor), scenario.currency);
  return {
    name: scenario.name,
    currency: scenario.currency,
    horizonDays: scenario.horizonDays,
    adjustments: scenario.adjustments.map((adjustment) => {
      const draft = emptyAdjustment(adjustment.kind);
      switch (adjustment.kind) {
        case 'category_spending':
        case 'income_change':
          return {
            ...draft,
            ...(adjustment.kind === 'category_spending'
              ? { categoryId: adjustment.categoryId }
              : {}),
            direction: adjustment.direction,
            by: adjustment.change.by,
            value:
              adjustment.change.by === 'percent'
                ? percentFromBasisPoints(adjustment.change.percentBp)
                : money(adjustment.change.amountMinor),
            months: adjustment.months === undefined ? '' : adjustment.months.toString(),
          };
        case 'cancel_schedule':
          return { ...draft, scheduleId: adjustment.scheduleId };
        case 'change_schedule_amount':
          return {
            ...draft,
            scheduleId: adjustment.scheduleId,
            amount: money(adjustment.amountMinor),
          };
        case 'monthly_expense':
        case 'monthly_income':
          return {
            ...draft,
            label: adjustment.label,
            amount: money(adjustment.amountMinor),
            months: adjustment.months === undefined ? '' : adjustment.months.toString(),
          };
        case 'one_time_expense':
          return {
            ...draft,
            label: adjustment.label,
            amount: money(adjustment.amountMinor),
            date: adjustment.date,
          };
        case 'debt_payment':
          return { ...draft, amount: money(adjustment.amountMinor) };
        case 'goal_contribution':
          return {
            ...draft,
            goalId: adjustment.goalId,
            amount: money(adjustment.monthlyAmountMinor),
          };
        case 'goal_target_date':
          return { ...draft, goalId: adjustment.goalId, date: adjustment.targetDate };
      }
    }),
  };
}
