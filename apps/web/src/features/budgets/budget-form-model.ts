import {
  alertThresholdProblems,
  BUDGET_PERIODS,
  budgetPeriodContaining,
  calendarDateInTimeZone,
  createBudgetInputSchema,
  CURRENCY_CODES,
  DEFAULT_BUDGET_ALERT_THRESHOLDS_BP,
  describeDecimalAmountError,
  formatDecimalAmount,
  parseDecimalAmount,
  parseMinorUnits,
  type BudgetDto,
  type BudgetPeriod,
  type CreateBudgetInput,
  type CurrencyCode,
  type UpdateBudgetInput,
} from '@calmcash/shared';

import type { FieldErrors } from '@/lib/form-errors';

// The budget form works with text the person typed; this module converts it to the API's exact
// contracts (and back), with the same rules the API enforces. No React here.

export const BUDGET_FORM_FIELDS = [
  'name',
  'scope',
  'categoryId',
  'limit',
  'currency',
  'period',
  'startDate',
  'endDate',
  'alerts',
  'description',
] as const;

export type BudgetFormField = (typeof BUDGET_FORM_FIELDS)[number];
export type BudgetFormValues = Record<BudgetFormField, string>;

/** `overall` covers all spending; `category` one category (with its subcategories). */
export type BudgetScope = 'overall' | 'category';

export type BuildResult<T> =
  { ok: true; input: T } | { ok: false; errors: FieldErrors<BudgetFormField> };

function isCurrencyCode(value: string): value is CurrencyCode {
  return CURRENCY_CODES.some((code) => code === value);
}

export function isBudgetPeriod(value: string): value is BudgetPeriod {
  return BUDGET_PERIODS.some((period) => period === value);
}

/** A new monthly budget from the first of this month, with the default 80 % alert. */
export function emptyBudgetFormValues(currency: CurrencyCode, timeZone: string): BudgetFormValues {
  const today = calendarDateInTimeZone(new Date(), timeZone);
  return {
    name: '',
    scope: 'category',
    categoryId: '',
    limit: '',
    currency,
    period: 'monthly',
    startDate: budgetPeriodContaining('monthly', today).from,
    endDate: '',
    alerts: DEFAULT_BUDGET_ALERT_THRESHOLDS_BP.map((value) => String(value / 100)).join(', '),
    description: '',
  };
}

export function budgetToFormValues(budget: BudgetDto): BudgetFormValues {
  return {
    name: budget.name,
    scope: budget.categoryId === undefined ? 'overall' : 'category',
    categoryId: budget.categoryId ?? '',
    limit: formatDecimalAmount(parseMinorUnits(budget.limitMinor), budget.currency),
    currency: budget.currency,
    period: budget.period,
    startDate: budget.startDate,
    endDate: budget.endDate ?? '',
    alerts: budget.alertThresholdsBp.map((value) => String(value / 100)).join(', '),
    description: budget.description ?? '',
  };
}

/** "50, 80" → `[5000, 8000]`; whole or one-decimal percentages, ascending. */
export function parseAlerts(
  text: string,
): { ok: true; value: number[] } | { ok: false; error: string } {
  const parts = text
    .split(/[,\s]+/)
    .map((part) => part.replace(/%$/, ''))
    .filter((part) => part !== '');
  const value: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,2}(?:\.\d)?$/.test(part)) {
      return { ok: false, error: 'Enter percentages such as 50, 80.' };
    }
    const [whole = '0', tenth = '0'] = part.split('.');
    value.push(Number(whole) * 100 + Number(tenth) * 10);
  }
  const problems = alertThresholdProblems(value);
  return problems.length > 0 ? { ok: false, error: problems[0] ?? '' } : { ok: true, value };
}

function fieldOf(path: string): BudgetFormField | undefined {
  const key = path.replace(/^body\./, '').split('.')[0];
  if (key === 'limitMinor') return 'limit';
  if (key === 'alertThresholdsBp') return 'alerts';
  return BUDGET_FORM_FIELDS.find((field) => field === key);
}

/** Field errors from API or schema paths (`body.limitMinor` → `limit`). */
export function budgetErrorsFromPaths(
  details: readonly { path: string; message: string }[],
): FieldErrors<BudgetFormField> {
  const errors: FieldErrors<BudgetFormField> = {};
  for (const detail of details) {
    const field = fieldOf(detail.path);
    if (field !== undefined && errors[field] === undefined) {
      errors[field] = detail.message;
    }
  }
  return errors;
}

export function buildCreateBudgetInput(values: BudgetFormValues): BuildResult<CreateBudgetInput> {
  const errors: FieldErrors<BudgetFormField> = {};
  const currency = isCurrencyCode(values.currency) ? values.currency : undefined;
  if (currency === undefined) {
    errors.currency = 'Choose a currency.';
  }
  let limitMinor: string | undefined;
  if (currency !== undefined) {
    const parsed = parseDecimalAmount(values.limit, currency);
    if (!parsed.ok) {
      errors.limit = describeDecimalAmountError(parsed.error, currency);
    } else if (parsed.minorUnits <= 0n) {
      errors.limit = 'Enter a limit above zero.';
    } else {
      limitMinor = parsed.minorUnits.toString();
    }
  }
  const alerts = parseAlerts(values.alerts);
  if (!alerts.ok) {
    errors.alerts = alerts.error;
  }
  if (values.scope === 'category' && values.categoryId === '') {
    errors.categoryId = 'Choose a category, or budget for all spending.';
  }
  const candidate = {
    name: values.name,
    ...(values.description.trim() === '' ? {} : { description: values.description }),
    ...(values.scope === 'category' && values.categoryId !== ''
      ? { categoryId: values.categoryId }
      : {}),
    limitMinor: limitMinor ?? '1',
    currency: currency ?? 'INR',
    period: values.period,
    startDate: values.startDate,
    ...(values.endDate === '' ? {} : { endDate: values.endDate }),
    alertThresholdsBp: alerts.ok ? alerts.value : [],
  };
  const parsed = createBudgetInputSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const [field, message] of Object.entries(
      budgetErrorsFromPaths(
        parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      ),
    )) {
      const key = BUDGET_FORM_FIELDS.find((entry) => entry === field);
      if (key !== undefined && errors[key] === undefined) {
        errors[key] = message;
      }
    }
  }
  if (Object.values(errors).some((message) => message !== undefined) || !parsed.success) {
    return { ok: false, errors };
  }
  return { ok: true, input: parsed.data };
}

/** Only the fields that changed (`null` clears); `undefined` when nothing changed. */
export function buildUpdateBudgetInput(
  budget: BudgetDto,
  values: BudgetFormValues,
): BuildResult<UpdateBudgetInput | undefined> {
  const built = buildCreateBudgetInput(values);
  if (!built.ok) {
    return built;
  }
  const next = built.input;
  const changes: UpdateBudgetInput = {
    ...(next.name === budget.name ? {} : { name: next.name }),
    ...((next.description ?? null) === (budget.description ?? null)
      ? {}
      : { description: next.description ?? null }),
    ...((next.categoryId ?? null) === (budget.categoryId ?? null)
      ? {}
      : { categoryId: next.categoryId ?? null }),
    ...(next.limitMinor === budget.limitMinor ? {} : { limitMinor: next.limitMinor }),
    ...(next.currency === budget.currency ? {} : { currency: next.currency }),
    ...(next.period === budget.period ? {} : { period: next.period }),
    ...(next.startDate === budget.startDate ? {} : { startDate: next.startDate }),
    ...((next.endDate ?? null) === (budget.endDate ?? null)
      ? {}
      : { endDate: next.endDate ?? null }),
    ...((next.alertThresholdsBp ?? []).join(',') === budget.alertThresholdsBp.join(',')
      ? {}
      : { alertThresholdsBp: next.alertThresholdsBp ?? [] }),
  };
  return { ok: true, input: Object.keys(changes).length === 0 ? undefined : changes };
}
