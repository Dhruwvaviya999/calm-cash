'use client';

import {
  SCENARIO_ADJUSTMENT_KINDS,
  SCENARIO_HORIZONS,
  SCENARIO_LIMITS,
  type CategoryDto,
  type CurrencyCode,
  type FinancialScenarioDto,
  type RecurringScheduleItemDto,
  type SavingsGoalWithProgressDto,
  type ScenarioAdjustmentKind,
  type ScenarioListDto,
  type ScenarioResultDto,
} from '@calmcash/shared';
import { FlaskConical, LoaderCircle, Play, Plus, Save, Trash2, X } from 'lucide-react';
import { useCallback, useId, useState, type ReactNode } from 'react';

import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { EmptyState } from '@/components/feedback/empty-state';
import { ErrorState } from '@/components/feedback/error-state';
import { ListSkeleton } from '@/components/feedback/loading-skeleton';
import { FormMessage } from '@/components/forms/form-message';
import { MoneyInput } from '@/components/forms/money-input';
import { PageHeader, SectionHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { useAiStatus } from '@/features/ai/use-ai-status';
import { useSignedInSession } from '@/features/auth';
import { ADJUSTMENT_KIND_LABELS } from '@/features/intelligence';
import { useAsyncResource } from '@/hooks/use-async-resource';
import { formatDateTime, formatMoney } from '@/lib/format';
import { describeRequestError } from '@/lib/form-errors';
import { listAccounts } from '@/services/accounts.service';
import { listCategories } from '@/services/categories.service';
import { listGoals } from '@/services/goals.service';
import {
  compareScenarios,
  createScenario,
  deleteScenario,
  listScenarios,
  previewScenario,
  runScenario,
  updateScenario,
} from '@/services/intelligence.service';
import { listSchedules } from '@/services/recurring.service';

import {
  buildScenarioInput,
  emptyAdjustment,
  emptyScenarioValues,
  isCurrency,
  isHorizon,
  scenarioToFormValues,
  type AdjustmentDraft,
  type ScenarioFormErrors,
  type ScenarioFormValues,
} from '../scenario-form-model';
import { ScenarioResult } from './scenario-result';

interface References {
  currencies: CurrencyCode[];
  categories: CategoryDto[];
  schedules: RecurringScheduleItemDto[];
  goals: SavingsGoalWithProgressDto[];
}

function useReferences(): ReturnType<typeof useAsyncResource<References>> {
  return useAsyncResource(
    useCallback(async (signal: AbortSignal): Promise<References> => {
      const [accounts, categories, schedules, goals] = await Promise.all([
        listAccounts('active', signal),
        listCategories(signal),
        listSchedules('status=current', signal),
        listGoals('current', signal),
      ]);
      const currencies = [...new Set(accounts.accounts.map((entry) => entry.account.currency))];
      return {
        currencies,
        // Scenarios work on main expense categories (subcategories are counted in them).
        categories: categories.categories.filter(
          (category) =>
            category.kind === 'expense' &&
            category.parentId === undefined &&
            category.status === 'active',
        ),
        schedules: schedules.schedules.filter((item) => item.schedule.status === 'active'),
        goals: goals.goals,
      };
    }, []),
  );
}

function Field({
  label,
  error,
  children,
  className,
}: {
  label: string;
  error?: string | undefined;
  /** Renders the control with the given id, so the label names it exactly. */
  children: (control: {
    id: string;
    'aria-invalid'?: true;
    'aria-describedby'?: string;
  }) => ReactNode;
  className?: string;
}): ReactNode {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className={`flex min-w-0 flex-col gap-1 text-sm ${className ?? ''}`}>
      <label htmlFor={id} className="text-muted-foreground">
        {label}
      </label>
      {children(
        error === undefined ? { id } : { id, 'aria-invalid': true, 'aria-describedby': errorId },
      )}
      {error !== undefined && (
        <span id={errorId} className="text-xs text-expense">
          {error}
        </span>
      )}
    </div>
  );
}

function AdjustmentEditor({
  draft,
  index,
  currency,
  references,
  errors,
  onChange,
  onRemove,
}: {
  draft: AdjustmentDraft;
  index: number;
  currency: CurrencyCode;
  references: References;
  errors: ScenarioFormErrors;
  onChange: (draft: AdjustmentDraft) => void;
  onRemove: () => void;
}): ReactNode {
  const error = (field: string): string | undefined =>
    errors[`adjustments.${index.toString()}.${field}`];
  const set = (patch: Partial<AdjustmentDraft>): void => {
    onChange({ ...draft, ...patch });
  };
  const schedules = references.schedules.filter((item) => item.schedule.currency === currency);
  const goals = references.goals.filter(
    (item) => item.goal.currency === currency && item.goal.status !== 'archived',
  );
  const usesChange = draft.kind === 'category_spending' || draft.kind === 'income_change';
  const usesMonths =
    usesChange || draft.kind === 'monthly_expense' || draft.kind === 'monthly_income';
  return (
    <li className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium">
          Change {(index + 1).toString()}: {ADJUSTMENT_KIND_LABELS[draft.kind]}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 sm:size-8"
          aria-label={`Remove change ${(index + 1).toString()}`}
          onClick={onRemove}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {draft.kind === 'category_spending' && (
          <Field label="Category" error={error('categoryId')} className="sm:col-span-2">
            {(control) => (
              <>
                <NativeSelect
                  {...control}
                  value={draft.categoryId}
                  onChange={(event) => {
                    set({ categoryId: event.target.value });
                  }}
                >
                  <option value="">Choose a category</option>
                  {references.categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </NativeSelect>
              </>
            )}
          </Field>
        )}
        {usesChange && (
          <>
            <Field label="Direction">
              {(control) => (
                <>
                  <NativeSelect
                    {...control}
                    value={draft.direction}
                    onChange={(event) => {
                      set({
                        direction: event.target.value === 'increase' ? 'increase' : 'decrease',
                      });
                    }}
                  >
                    <option value="decrease">
                      {draft.kind === 'income_change' ? 'Income falls' : 'Spend less'}
                    </option>
                    <option value="increase">
                      {draft.kind === 'income_change' ? 'Income rises' : 'Spend more'}
                    </option>
                  </NativeSelect>
                </>
              )}
            </Field>
            <Field label="By">
              {(control) => (
                <>
                  <NativeSelect
                    {...control}
                    value={draft.by}
                    onChange={(event) => {
                      set({
                        by: event.target.value === 'amount' ? 'amount' : 'percent',
                        value: '',
                      });
                    }}
                  >
                    <option value="percent">
                      {draft.kind === 'income_change'
                        ? 'A percentage of scheduled income'
                        : 'A percentage'}
                    </option>
                    <option value="amount">An amount per month</option>
                  </NativeSelect>
                </>
              )}
            </Field>
            <Field
              label={draft.by === 'percent' ? 'Percentage' : 'Amount per month'}
              error={error('value')}
            >
              {(control) => (
                <>
                  {draft.by === 'percent' ? (
                    <div className="relative">
                      <Input
                        {...control}
                        inputMode="decimal"
                        className="h-11 pr-8"
                        value={draft.value}
                        placeholder="15"
                        onChange={(event) => {
                          set({ value: event.target.value });
                        }}
                      />
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-sm text-muted-foreground"
                      >
                        %
                      </span>
                    </div>
                  ) : (
                    <MoneyInput
                      {...control}
                      currency={currency}
                      value={draft.value}
                      onChange={(event) => {
                        set({ value: event.target.value });
                      }}
                    />
                  )}
                </>
              )}
            </Field>
          </>
        )}
        {(draft.kind === 'cancel_schedule' || draft.kind === 'change_schedule_amount') && (
          <Field label="Schedule" error={error('scheduleId')} className="sm:col-span-2">
            {(control) => (
              <>
                <NativeSelect
                  {...control}
                  value={draft.scheduleId}
                  onChange={(event) => {
                    set({ scheduleId: event.target.value });
                  }}
                >
                  <option value="">Choose a bill, subscription, or income</option>
                  {schedules.map((item) => (
                    <option key={item.schedule.id} value={item.schedule.id}>
                      {item.schedule.name} (
                      {formatMoney(item.schedule.amountMinor, item.schedule.currency)})
                    </option>
                  ))}
                </NativeSelect>
              </>
            )}
          </Field>
        )}
        {(draft.kind === 'monthly_expense' ||
          draft.kind === 'monthly_income' ||
          draft.kind === 'one_time_expense') && (
          <Field label="What is it?" error={error('label')}>
            {(control) => (
              <>
                <Input
                  {...control}
                  className="h-11"
                  maxLength={SCENARIO_LIMITS.label}
                  value={draft.label}
                  placeholder={draft.kind === 'monthly_income' ? 'Side project' : 'Rent increase'}
                  onChange={(event) => {
                    set({ label: event.target.value });
                  }}
                />
              </>
            )}
          </Field>
        )}
        {(draft.kind === 'change_schedule_amount' ||
          draft.kind === 'monthly_expense' ||
          draft.kind === 'monthly_income' ||
          draft.kind === 'one_time_expense' ||
          draft.kind === 'debt_payment' ||
          draft.kind === 'goal_contribution') && (
          <Field
            label={
              draft.kind === 'change_schedule_amount'
                ? 'New amount each time'
                : draft.kind === 'one_time_expense' || draft.kind === 'debt_payment'
                  ? 'Amount'
                  : 'Amount per month'
            }
            error={error('amount')}
          >
            {(control) => (
              <>
                <MoneyInput
                  {...control}
                  currency={currency}
                  value={draft.amount}
                  onChange={(event) => {
                    set({ amount: event.target.value });
                  }}
                />
              </>
            )}
          </Field>
        )}
        {(draft.kind === 'goal_contribution' || draft.kind === 'goal_target_date') && (
          <Field label="Goal" error={error('goalId')}>
            {(control) => (
              <>
                <NativeSelect
                  {...control}
                  value={draft.goalId}
                  onChange={(event) => {
                    set({ goalId: event.target.value });
                  }}
                >
                  <option value="">Choose a goal</option>
                  {goals.map((item) => (
                    <option key={item.goal.id} value={item.goal.id}>
                      {item.goal.name}
                    </option>
                  ))}
                </NativeSelect>
              </>
            )}
          </Field>
        )}
        {(draft.kind === 'one_time_expense' || draft.kind === 'goal_target_date') && (
          <Field
            label={draft.kind === 'goal_target_date' ? 'New target date' : 'Date'}
            error={error('date')}
          >
            {(control) => (
              <>
                <Input
                  {...control}
                  type="date"
                  className="h-11"
                  value={draft.date}
                  onChange={(event) => {
                    set({ date: event.target.value });
                  }}
                />
              </>
            )}
          </Field>
        )}
        {usesMonths && (
          <Field label="For how many months? (optional)" error={error('months')}>
            {(control) => (
              <>
                <Input
                  {...control}
                  inputMode="numeric"
                  className="h-11"
                  value={draft.months}
                  placeholder="The whole period"
                  onChange={(event) => {
                    set({ months: event.target.value });
                  }}
                />
              </>
            )}
          </Field>
        )}
      </div>
    </li>
  );
}

function ScenarioBuilder({
  references,
  initial,
  editingId,
  timeZone,
  aiAvailable,
  onSaved,
}: {
  references: References;
  initial: ScenarioFormValues;
  editingId: string | undefined;
  timeZone: string;
  aiAvailable: boolean;
  onSaved: (scenario: FinancialScenarioDto) => void;
}): ReactNode {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<ScenarioFormErrors>({});
  const [busy, setBusy] = useState<'run' | 'save' | undefined>();
  const [failure, setFailure] = useState<string | undefined>();
  const [result, setResult] = useState<ScenarioResultDto | undefined>();
  const [nextKind, setNextKind] = useState<ScenarioAdjustmentKind>('monthly_expense');
  const currencies = references.currencies.length > 0 ? references.currencies : [values.currency];

  const submit = async (action: 'run' | 'save'): Promise<void> => {
    const built = buildScenarioInput(values);
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    setFailure(undefined);
    setBusy(action);
    try {
      if (action === 'run') {
        setResult(await previewScenario(built.input));
      } else {
        const saved =
          editingId === undefined
            ? await createScenario(built.input)
            : await updateScenario(editingId, built.input);
        setResult(await runScenario(saved.id));
        onSaved(saved);
      }
    } catch (error: unknown) {
      setFailure(describeRequestError(error));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Name" error={errors.name} className="sm:col-span-3">
            {(control) => (
              <>
                <Input
                  {...control}
                  className="h-11"
                  maxLength={SCENARIO_LIMITS.name}
                  value={values.name}
                  placeholder="Spend less on dining"
                  onChange={(event) => {
                    setValues({ ...values, name: event.target.value });
                  }}
                />
              </>
            )}
          </Field>
          <Field label="Currency">
            {(control) => (
              <>
                <NativeSelect
                  {...control}
                  value={values.currency}
                  onChange={(event) => {
                    if (isCurrency(event.target.value))
                      setValues({ ...values, currency: event.target.value });
                  }}
                >
                  {currencies.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </NativeSelect>
              </>
            )}
          </Field>
          <Field label="Look ahead">
            {(control) => (
              <>
                <NativeSelect
                  {...control}
                  value={String(values.horizonDays)}
                  onChange={(event) => {
                    const days = Number(event.target.value);
                    if (isHorizon(days)) setValues({ ...values, horizonDays: days });
                  }}
                >
                  {SCENARIO_HORIZONS.map((days) => (
                    <option key={days} value={days}>
                      {days === 365 ? 'One year' : `${days.toString()} days`}
                    </option>
                  ))}
                </NativeSelect>
              </>
            )}
          </Field>
        </div>
        {errors.adjustments !== undefined && (
          <p className="text-sm text-expense">{errors.adjustments}</p>
        )}
        <ol className="flex flex-col gap-3">
          {values.adjustments.map((draft, index) => (
            <AdjustmentEditor
              key={draft.key}
              draft={draft}
              index={index}
              currency={values.currency}
              references={references}
              errors={errors}
              onChange={(next) => {
                setValues({
                  ...values,
                  adjustments: values.adjustments.map((item) =>
                    item.key === draft.key ? next : item,
                  ),
                });
              }}
              onRemove={() => {
                setValues({
                  ...values,
                  adjustments: values.adjustments.filter((item) => item.key !== draft.key),
                });
              }}
            />
          ))}
        </ol>
        {values.adjustments.length < SCENARIO_LIMITS.adjustments && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Field label="Add a change" className="sm:flex-1">
              {(control) => (
                <>
                  <NativeSelect
                    {...control}
                    value={nextKind}
                    onChange={(event) => {
                      const kind = SCENARIO_ADJUSTMENT_KINDS.find(
                        (candidate) => candidate === event.target.value,
                      );
                      if (kind !== undefined) setNextKind(kind);
                    }}
                  >
                    {SCENARIO_ADJUSTMENT_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {ADJUSTMENT_KIND_LABELS[kind]}
                      </option>
                    ))}
                  </NativeSelect>
                </>
              )}
            </Field>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() => {
                setValues({
                  ...values,
                  adjustments: [...values.adjustments, emptyAdjustment(nextKind)],
                });
              }}
            >
              <Plus aria-hidden="true" /> Add
            </Button>
          </div>
        )}
        {failure !== undefined && (
          <FormMessage tone="error" title="That did not work">
            {failure}
          </FormMessage>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            className="h-11"
            disabled={busy !== undefined}
            onClick={() => void submit('run')}
          >
            {busy === 'run' ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : (
              <Play aria-hidden="true" />
            )}
            Run simulation
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={busy !== undefined}
            onClick={() => void submit('save')}
          >
            {busy === 'save' ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : (
              <Save aria-hidden="true" />
            )}
            {editingId === undefined ? 'Save scenario' : 'Save changes'}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          A simulation never records a transaction or changes a budget, schedule, or goal. Saving
          keeps only these assumptions; results are recalculated from your records each time.
        </p>
      </Card>
      {result !== undefined && (
        <ScenarioResult result={result} timeZone={timeZone} aiAvailable={aiAvailable} />
      )}
    </div>
  );
}

/**
 * What-if scenarios: explore the effect of a decision on projected cash flow, budgets, and goals
 * without changing a single record.
 */
export function ScenariosPage(): ReactNode {
  const { user } = useSignedInSession();
  const status = useAiStatus();
  const aiAvailable = status.state.status === 'success' && status.state.data.available;
  const references = useReferences();
  const scenarios = useAsyncResource(
    useCallback((signal: AbortSignal): Promise<ScenarioListDto> => listScenarios(1, signal), []),
  );
  const [editing, setEditing] = useState<{
    id: string | undefined;
    values: ScenarioFormValues;
    version: number;
  }>();
  const [selected, setSelected] = useState<string[]>([]);
  const [comparison, setComparison] = useState<ScenarioResultDto[] | undefined>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();
  const [deleting, setDeleting] = useState<FinancialScenarioDto | undefined>();
  const refs = references.state.status === 'success' ? references.state.data : undefined;
  const defaultCurrency =
    refs?.currencies.includes(user.preferredCurrency) === true
      ? user.preferredCurrency
      : (refs?.currencies[0] ?? user.preferredCurrency);

  const startNew = (): void => {
    setEditing({
      id: undefined,
      values: emptyScenarioValues(defaultCurrency),
      version: Date.now(),
    });
  };
  const compare = async (): Promise<void> => {
    setBusy(true);
    setFailure(undefined);
    try {
      setComparison((await compareScenarios(selected)).results);
    } catch (error: unknown) {
      setFailure(describeRequestError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="What-if scenarios"
        description="Try a change — spend less somewhere, a new cost, extra income, a goal contribution — and compare the projection with and without it. A simulation only: nothing is recorded or changed."
        actions={
          <Button
            type="button"
            className="h-11 sm:h-9"
            onClick={startNew}
            disabled={refs === undefined}
          >
            <Plus aria-hidden="true" /> New scenario
          </Button>
        }
      />
      {references.state.status === 'error' && (
        <ErrorState
          title="Your categories and plans could not be loaded"
          description={describeRequestError(references.state.error)}
          onRetry={references.reload}
        />
      )}

      <section aria-labelledby="saved-scenarios-heading" className="flex flex-col gap-3">
        <SectionHeader
          id="saved-scenarios-heading"
          title="Saved scenarios"
          description="Assumptions only. Opening one recalculates it from your current records."
        />
        {scenarios.state.status === 'loading' && <ListSkeleton rows={2} />}
        {scenarios.state.status === 'error' && (
          <ErrorState
            title="Scenarios could not be loaded"
            description={describeRequestError(scenarios.state.error)}
            onRetry={scenarios.reload}
          />
        )}
        {scenarios.state.status === 'success' &&
          (scenarios.state.data.items.length === 0 ? (
            <EmptyState
              icon={FlaskConical}
              headingLevel="h3"
              title="No saved scenarios yet"
              description="Create one to see how a change could affect your projected position, budgets, and goals."
            />
          ) : (
            <>
              <ul className="divide-y rounded-lg border">
                {scenarios.state.data.items.map((scenario) => (
                  <li
                    key={scenario.id}
                    className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <label className="flex min-h-11 min-w-0 items-center gap-3">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={selected.includes(scenario.id)}
                        disabled={
                          !selected.includes(scenario.id) &&
                          selected.length >= SCENARIO_LIMITS.compare
                        }
                        onChange={(event) => {
                          setSelected(
                            event.target.checked
                              ? [...selected, scenario.id]
                              : selected.filter((id) => id !== scenario.id),
                          );
                        }}
                        aria-label={`Compare ${scenario.name}`}
                      />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">{scenario.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {scenario.adjustments.length.toString()}{' '}
                          {scenario.adjustments.length === 1 ? 'change' : 'changes'} ·{' '}
                          {scenario.currency} · {scenario.horizonDays.toString()} days · saved{' '}
                          {formatDateTime(scenario.updatedAt, user.timezone)}
                        </span>
                      </span>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-11 sm:h-8"
                        disabled={refs === undefined}
                        onClick={() => {
                          setEditing({
                            id: scenario.id,
                            values: scenarioToFormValues(scenario),
                            version: Date.now(),
                          });
                        }}
                      >
                        Open
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-11 sm:h-8"
                        aria-label={`Delete ${scenario.name}`}
                        onClick={() => {
                          setDeleting(scenario);
                        }}
                      >
                        <Trash2 aria-hidden="true" /> Delete
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 sm:h-9"
                  disabled={selected.length < 2 || busy}
                  onClick={() => void compare()}
                >
                  Compare selected ({selected.length.toString()})
                </Button>
                <span className="text-xs text-muted-foreground">
                  Choose two or three scenarios to compare.
                </span>
              </div>
            </>
          ))}
        {failure !== undefined && (
          <FormMessage tone="error" title="That did not work">
            {failure}
          </FormMessage>
        )}
      </section>

      {comparison !== undefined && (
        <section aria-labelledby="comparison-heading" className="flex flex-col gap-3">
          <SectionHeader
            id="comparison-heading"
            title="Comparison"
            description="Each scenario is a simulation against the same records; amounts are only compared within one currency."
          />
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Scenario comparison</caption>
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Scenario
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Without changes
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    With the changes
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Difference
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y tabular-nums">
                {comparison.map((item) => (
                  <tr key={item.scenarioId ?? item.name}>
                    <th scope="row" className="px-3 py-2 font-normal">
                      {item.name}
                      <span className="block text-xs text-muted-foreground">
                        {item.currency} · to {item.to}
                      </span>
                    </th>
                    <td className="px-3 py-2 text-right">
                      {formatMoney(item.baseline.endingPositionMinor, item.currency)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatMoney(item.simulated.endingPositionMinor, item.currency)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {item.differenceMinor.startsWith('-') ? '' : '+'}
                      {formatMoney(item.differenceMinor, item.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {editing !== undefined && refs !== undefined && (
        <section aria-labelledby="builder-heading" className="flex flex-col gap-3">
          <SectionHeader
            id="builder-heading"
            title={editing.id === undefined ? 'New scenario' : 'Edit scenario'}
          />
          <ScenarioBuilder
            key={editing.version}
            references={refs}
            initial={editing.values}
            editingId={editing.id}
            timeZone={user.timezone}
            aiAvailable={aiAvailable}
            onSaved={(saved) => {
              setEditing({
                id: saved.id,
                values: scenarioToFormValues(saved),
                version: editing.version,
              });
              scenarios.refresh();
            }}
          />
        </section>
      )}
      {editing === undefined && refs !== undefined && (
        <Card className="flex flex-col items-start gap-3 p-5">
          <p className="text-sm text-muted-foreground">
            Example: “What if I spend 15 % less on food for three months?” — choose a change, enter
            the numbers, and run the simulation.
          </p>
          <Button type="button" className="h-11 sm:h-9" onClick={startNew}>
            <Plus aria-hidden="true" /> New scenario
          </Button>
        </Card>
      )}

      <ConfirmDialog
        open={deleting !== undefined}
        onOpenChange={(open) => {
          if (!open) setDeleting(undefined);
        }}
        title={`Delete “${deleting?.name ?? ''}”?`}
        description="Only the saved assumptions are deleted. Your records are not affected."
        confirmLabel="Delete scenario"
        destructive
        onConfirm={() => {
          if (deleting === undefined) return;
          const target = deleting;
          setDeleting(undefined);
          deleteScenario(target.id).then(
            () => {
              setSelected((current) => current.filter((id) => id !== target.id));
              setComparison(undefined);
              setEditing((current) => (current?.id === target.id ? undefined : current));
              scenarios.refresh();
            },
            (error: unknown) => {
              setFailure(describeRequestError(error));
            },
          );
        }}
      />
    </div>
  );
}
