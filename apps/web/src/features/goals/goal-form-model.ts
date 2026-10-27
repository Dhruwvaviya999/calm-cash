import {
  createSavingsGoalInputSchema,
  CURRENCY_CODES,
  describeDecimalAmountError,
  formatDecimalAmount,
  parseDecimalAmount,
  parseMinorUnits,
  type CreateSavingsGoalInput,
  type CurrencyCode,
  type GoalContributionInput,
  type SavingsGoalDto,
  type UpdateSavingsGoalInput,
} from '@calmcash/shared';

import type { FieldErrors } from '@/lib/form-errors';

// Goal and contribution forms: typed text → the API's exact contracts. No React here.

export const GOAL_FORM_FIELDS = [
  'name',
  'target',
  'currency',
  'targetDate',
  'saved',
  'description',
] as const;

export type GoalFormField = (typeof GOAL_FORM_FIELDS)[number];
export type GoalFormValues = Record<GoalFormField, string>;

export type BuildResult<T, F extends string> =
  { ok: true; input: T } | { ok: false; errors: FieldErrors<F> };

function isCurrencyCode(value: string): value is CurrencyCode {
  return CURRENCY_CODES.some((code) => code === value);
}

function amountError(
  text: string,
  currency: CurrencyCode,
  { allowZero }: { allowZero: boolean },
): { minor: bigint } | { error: string } {
  const parsed = parseDecimalAmount(text, currency);
  if (!parsed.ok) return { error: describeDecimalAmountError(parsed.error, currency) };
  if (parsed.minorUnits < 0n || (!allowZero && parsed.minorUnits === 0n)) {
    return { error: allowZero ? 'Enter zero or more.' : 'Enter an amount above zero.' };
  }
  return { minor: parsed.minorUnits };
}

export function emptyGoalFormValues(currency: CurrencyCode): GoalFormValues {
  return { name: '', target: '', currency, targetDate: '', saved: '', description: '' };
}

export function goalToFormValues(goal: SavingsGoalDto): GoalFormValues {
  return {
    name: goal.name,
    target: formatDecimalAmount(parseMinorUnits(goal.targetMinor), goal.currency),
    currency: goal.currency,
    targetDate: goal.targetDate ?? '',
    saved: '',
    description: goal.description ?? '',
  };
}

export function buildCreateGoalInput(
  values: GoalFormValues,
): BuildResult<CreateSavingsGoalInput, GoalFormField> {
  const errors: FieldErrors<GoalFormField> = {};
  if (!isCurrencyCode(values.currency)) {
    return { ok: false, errors: { currency: 'Choose a currency.' } };
  }
  const target = amountError(values.target, values.currency, { allowZero: false });
  if ('error' in target) errors.target = target.error;
  const saved =
    values.saved.trim() === ''
      ? { minor: 0n }
      : amountError(values.saved, values.currency, { allowZero: true });
  if ('error' in saved) errors.saved = saved.error;
  const parsed = createSavingsGoalInputSchema.safeParse({
    name: values.name,
    ...(values.description.trim() === '' ? {} : { description: values.description }),
    targetMinor: 'minor' in target ? target.minor.toString() : '1',
    currency: values.currency,
    ...(values.targetDate === '' ? {} : { targetDate: values.targetDate }),
    ...('minor' in saved && saved.minor > 0n ? { initialSavedMinor: saved.minor.toString() } : {}),
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key =
        issue.path[0] === 'targetMinor'
          ? 'target'
          : GOAL_FORM_FIELDS.find((field) => field === issue.path[0]);
      if (key !== undefined) errors[key] ??= issue.message;
    }
  }
  if (!parsed.success || Object.values(errors).some((message) => message !== undefined)) {
    return { ok: false, errors };
  }
  return { ok: true, input: parsed.data };
}

export function buildUpdateGoalInput(
  goal: SavingsGoalDto,
  values: GoalFormValues,
): BuildResult<UpdateSavingsGoalInput | undefined, GoalFormField> {
  const built = buildCreateGoalInput({ ...values, saved: '' });
  if (!built.ok) return built;
  const next = built.input;
  const changes: UpdateSavingsGoalInput = {
    ...(next.name === goal.name ? {} : { name: next.name }),
    ...((next.description ?? null) === (goal.description ?? null)
      ? {}
      : { description: next.description ?? null }),
    ...(next.targetMinor === goal.targetMinor ? {} : { targetMinor: next.targetMinor }),
    ...(next.currency === goal.currency ? {} : { currency: next.currency }),
    ...((next.targetDate ?? null) === (goal.targetDate ?? null)
      ? {}
      : { targetDate: next.targetDate ?? null }),
  };
  return { ok: true, input: Object.keys(changes).length === 0 ? undefined : changes };
}

export type ContributionKind = GoalContributionInput['kind'];

/** The contribution request for one of "add", "withdraw", or "set the total". */
export function buildContributionInput(
  kind: ContributionKind,
  amount: string,
  currency: CurrencyCode,
  contributedOn: string,
  note: string,
): { ok: true; input: GoalContributionInput } | { ok: false; error: string } {
  const value = amountError(amount, currency, { allowZero: kind === 'set' });
  if ('error' in value) return { ok: false, error: value.error };
  const extras = {
    ...(contributedOn === '' ? {} : { contributedOn }),
    ...(note.trim() === '' ? {} : { note: note.trim() }),
  };
  return {
    ok: true,
    input:
      kind === 'set'
        ? { kind, savedMinor: value.minor.toString(), ...extras }
        : { kind, amountMinor: value.minor.toString(), ...extras },
  };
}
