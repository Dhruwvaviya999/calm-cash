import {
  calendarDateInTimeZone,
  createRecurringScheduleInputSchema,
  CURRENCY_CODES,
  describeDecimalAmountError,
  formatDecimalAmount,
  parseDecimalAmount,
  parseMinorUnits,
  RECURRING_FREQUENCIES,
  type CreateRecurringScheduleInput,
  type CurrencyCode,
  type RecurringFrequency,
  type RecurringScheduleDto,
  type UpdateRecurringScheduleInput,
} from '@calmcash/shared';

import type { FieldErrors } from '@/lib/form-errors';

// The schedule form works with text the person typed; this module converts it to the API's exact
// contracts (and back). No React here. Subscriptions use the same form without the type choice.

export const SCHEDULE_FORM_FIELDS = [
  'name',
  'type',
  'amount',
  'currency',
  'accountId',
  'categoryId',
  'merchant',
  'repeat',
  'frequency',
  'interval',
  'startDate',
  'endDate',
  'reminderDays',
  'notes',
] as const;

export type ScheduleFormField = (typeof SCHEDULE_FORM_FIELDS)[number];
export type ScheduleFormValues = Record<ScheduleFormField, string>;

export type BuildResult<T> =
  { ok: true; input: T } | { ok: false; errors: FieldErrors<ScheduleFormField> };

/** Common rhythms; `custom` shows the frequency and interval fields. */
export const REPEAT_PRESETS = [
  { value: 'weekly:1', label: 'Every week' },
  { value: 'weekly:2', label: 'Every 2 weeks' },
  { value: 'monthly:1', label: 'Every month' },
  { value: 'monthly:3', label: 'Every 3 months' },
  { value: 'monthly:6', label: 'Every 6 months' },
  { value: 'yearly:1', label: 'Every year' },
  { value: 'custom', label: 'Something else' },
] as const;

function isCurrencyCode(value: string): value is CurrencyCode {
  return CURRENCY_CODES.some((code) => code === value);
}

function isFrequency(value: string): value is RecurringFrequency {
  return RECURRING_FREQUENCIES.some((frequency) => frequency === value);
}

function repeatOf(frequency: RecurringFrequency, interval: number): string {
  const preset = `${frequency}:${String(interval)}`;
  return REPEAT_PRESETS.some((entry) => entry.value === preset) ? preset : 'custom';
}

export function emptyScheduleFormValues(
  currency: CurrencyCode,
  timeZone: string,
  type: 'income' | 'expense' = 'expense',
): ScheduleFormValues {
  return {
    name: '',
    type,
    amount: '',
    currency,
    accountId: '',
    categoryId: '',
    merchant: '',
    repeat: 'monthly:1',
    frequency: 'monthly',
    interval: '1',
    startDate: calendarDateInTimeZone(new Date(), timeZone),
    endDate: '',
    reminderDays: '3',
    notes: '',
  };
}

export function scheduleToFormValues(schedule: RecurringScheduleDto): ScheduleFormValues {
  return {
    name: schedule.name,
    type: schedule.type,
    amount: formatDecimalAmount(parseMinorUnits(schedule.amountMinor), schedule.currency),
    currency: schedule.currency,
    accountId: schedule.accountId ?? '',
    categoryId: schedule.categoryId ?? '',
    merchant: schedule.merchant ?? '',
    repeat: repeatOf(schedule.frequency, schedule.interval),
    frequency: schedule.frequency,
    interval: String(schedule.interval),
    startDate: schedule.startDate,
    endDate: schedule.endDate ?? '',
    reminderDays: schedule.reminderDays === undefined ? '' : String(schedule.reminderDays),
    notes: schedule.notes ?? '',
  };
}

function fieldOf(path: string): ScheduleFormField | undefined {
  const key = path.replace(/^body\./, '').split('.')[0];
  if (key === 'amountMinor') return 'amount';
  return SCHEDULE_FORM_FIELDS.find((field) => field === key);
}

export function scheduleErrorsFromPaths(
  details: readonly { path: string; message: string }[],
): FieldErrors<ScheduleFormField> {
  const errors: FieldErrors<ScheduleFormField> = {};
  for (const detail of details) {
    const field = fieldOf(detail.path);
    if (field !== undefined && errors[field] === undefined) {
      errors[field] = detail.message;
    }
  }
  return errors;
}

/** The rhythm chosen through a preset or the custom fields. */
export function timingOf(values: ScheduleFormValues): { frequency: string; interval: number } {
  if (values.repeat !== 'custom') {
    const [frequency = 'monthly', interval = '1'] = values.repeat.split(':');
    return { frequency, interval: Number(interval) };
  }
  return {
    frequency: values.frequency,
    interval: /^\d+$/.test(values.interval) ? Number(values.interval) : Number.NaN,
  };
}

export function buildCreateScheduleInput(
  values: ScheduleFormValues,
): BuildResult<CreateRecurringScheduleInput> {
  const errors: FieldErrors<ScheduleFormField> = {};
  const currency = isCurrencyCode(values.currency) ? values.currency : undefined;
  let amountMinor: string | undefined;
  if (currency === undefined) {
    errors.currency = 'Choose a currency.';
  } else {
    const parsed = parseDecimalAmount(values.amount, currency);
    if (!parsed.ok) {
      errors.amount = describeDecimalAmountError(parsed.error, currency);
    } else if (parsed.minorUnits <= 0n) {
      errors.amount = 'Enter an amount above zero.';
    } else {
      amountMinor = parsed.minorUnits.toString();
    }
  }
  const { frequency, interval } = timingOf(values);
  if (!isFrequency(frequency)) {
    errors.frequency = 'Choose how often it repeats.';
  }
  if (Number.isNaN(interval)) {
    errors.interval = 'Enter a whole number.';
  }
  if (values.reminderDays !== '' && !/^\d{1,2}$/.test(values.reminderDays)) {
    errors.reminderDays = 'Enter a number of days.';
  }
  const optional = (key: string, value: string): Record<string, string> =>
    value.trim() === '' ? {} : { [key]: value };
  const candidate = {
    name: values.name,
    type: values.type,
    amountMinor: amountMinor ?? '1',
    ...(currency === undefined ? {} : { currency }),
    ...optional('accountId', values.accountId),
    ...optional('categoryId', values.categoryId),
    ...optional('merchant', values.merchant),
    ...optional('notes', values.notes),
    frequency,
    interval,
    startDate: values.startDate,
    ...optional('endDate', values.endDate),
    ...(values.reminderDays === '' ? {} : { reminderDays: Number(values.reminderDays) }),
  };
  const parsed = createRecurringScheduleInputSchema.safeParse(candidate);
  if (!parsed.success) {
    const schemaErrors = scheduleErrorsFromPaths(
      parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    );
    for (const field of SCHEDULE_FORM_FIELDS) {
      errors[field] ??= schemaErrors[field];
    }
  }
  if (!parsed.success || Object.values(errors).some((message) => message !== undefined)) {
    return { ok: false, errors };
  }
  return { ok: true, input: parsed.data };
}

/** Only changed fields (`null` clears); `undefined` when nothing changed. */
export function buildUpdateScheduleInput(
  schedule: RecurringScheduleDto,
  values: ScheduleFormValues,
): BuildResult<UpdateRecurringScheduleInput | undefined> {
  const built = buildCreateScheduleInput(values);
  if (!built.ok) {
    return built;
  }
  const next = built.input;
  const same = (a: unknown, b: unknown): boolean => (a ?? null) === (b ?? null);
  const changes: UpdateRecurringScheduleInput = {
    ...(next.name === schedule.name ? {} : { name: next.name }),
    ...(next.amountMinor === schedule.amountMinor ? {} : { amountMinor: next.amountMinor }),
    ...(next.currency === undefined || next.currency === schedule.currency
      ? {}
      : { currency: next.currency }),
    ...(same(next.accountId, schedule.accountId) ? {} : { accountId: next.accountId ?? null }),
    ...(same(next.categoryId, schedule.categoryId) ? {} : { categoryId: next.categoryId ?? null }),
    ...(same(next.merchant, schedule.merchant) ? {} : { merchant: next.merchant ?? null }),
    ...(same(next.notes, schedule.notes) ? {} : { notes: next.notes ?? null }),
    ...(next.frequency === schedule.frequency ? {} : { frequency: next.frequency }),
    ...((next.interval ?? 1) === schedule.interval ? {} : { interval: next.interval ?? 1 }),
    ...(next.startDate === schedule.startDate ? {} : { startDate: next.startDate }),
    ...(same(next.endDate, schedule.endDate) ? {} : { endDate: next.endDate ?? null }),
    ...(same(next.reminderDays, schedule.reminderDays)
      ? {}
      : { reminderDays: next.reminderDays ?? null }),
  };
  return { ok: true, input: Object.keys(changes).length === 0 ? undefined : changes };
}
