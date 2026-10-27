'use client';

import {
  calendarDateInTimeZone,
  CURRENCIES,
  CURRENCY_CODES,
  type SavingsGoalDetailDto,
  type SavingsGoalListDto,
  type SavingsGoalWithProgressDto,
} from '@calmcash/shared';
import {
  Archive,
  ArchiveRestore,
  CircleCheck,
  CirclePause,
  CirclePlay,
  Goal,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCcw,
} from 'lucide-react';
import { useCallback, useState, type ReactNode, type SubmitEvent } from 'react';

import { EmptyState } from '@/components/feedback/empty-state';
import { ErrorState } from '@/components/feedback/error-state';
import { ListSkeleton } from '@/components/feedback/loading-skeleton';
import { StatusBadge } from '@/components/feedback/status-badge';
import { FinancialAmount } from '@/components/finance/financial-amount';
import { ProgressMeter } from '@/components/finance/progress-meter';
import { FilterOptions } from '@/components/forms/filter-bar';
import { FormField } from '@/components/forms/form-field';
import { FormMessage } from '@/components/forms/form-message';
import { MoneyInput } from '@/components/forms/money-input';
import { SectionHeader } from '@/components/layout/page-header';
import { SideSheet } from '@/components/layout/side-sheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { useSignedInSession } from '@/features/auth';
import { useAsyncResource } from '@/hooks/use-async-resource';
import { useFormFields } from '@/hooks/use-form-fields';
import { ApiClientError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';
import { describeRequestError } from '@/lib/form-errors';
import {
  addGoalContribution,
  changeGoal,
  createGoal,
  getGoal,
  listGoals,
  updateGoal,
  type GoalAction,
} from '@/services/goals.service';

import {
  buildContributionInput,
  buildCreateGoalInput,
  buildUpdateGoalInput,
  emptyGoalFormValues,
  goalToFormValues,
  type ContributionKind,
} from '../goal-form-model';
import {
  describeGoalPercent,
  describeTiming,
  GOAL_STATUS_PRESENTATION,
  goalMeter,
} from '../goal-presentation';

type Notice = { tone: 'success' | 'error'; message: string } | undefined;
type FormMode = { kind: 'create' } | { kind: 'edit'; item: SavingsGoalWithProgressDto };

/** A goal's figures, as the API calculated them; over 100 % is shown as it is. */
export function GoalProgress({ item }: { item: SavingsGoalWithProgressDto }): ReactNode {
  const { goal, progress } = item;
  const meter = goalMeter(progress);
  const remaining = BigInt(progress.remainingMinor);
  const timing = describeTiming(progress);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <ProgressMeter
        percent={meter.percent}
        tone={meter.tone}
        label={`${goal.name} progress`}
        valueText={`${describeGoalPercent(progress)} of the target saved`}
      />
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
        <p className="text-muted-foreground">
          <FinancialAmount
            amountMinor={progress.savedMinor}
            currency={goal.currency}
            size="sm"
            className="text-foreground"
          />{' '}
          of {formatMoney(goal.targetMinor, goal.currency)} · {describeGoalPercent(progress)}
        </p>
        <p className="whitespace-nowrap text-muted-foreground">
          {remaining > 0n
            ? `${formatMoney(remaining, goal.currency)} to go`
            : remaining === 0n
              ? 'Target reached'
              : `${formatMoney(-remaining, goal.currency)} beyond the target`}
        </p>
      </div>
      {(timing !== undefined || progress.monthlyNeededMinor !== undefined) && (
        <p className="text-xs text-muted-foreground">
          {timing}
          {progress.monthlyNeededMinor === undefined
            ? ''
            : ` · about ${formatMoney(progress.monthlyNeededMinor, goal.currency)} a month to get there`}
        </p>
      )}
    </div>
  );
}

function GoalForm({
  mode,
  defaultCurrency,
  onSaved,
  onCancel,
}: {
  mode: FormMode;
  defaultCurrency: (typeof CURRENCY_CODES)[number];
  onSaved: (goal: SavingsGoalDetailDto) => void;
  onCancel: () => void;
}): ReactNode {
  const editing = mode.kind === 'edit' ? mode.item : undefined;
  const form = useFormFields(
    editing === undefined ? emptyGoalFormValues(defaultCurrency) : goalToFormValues(editing.goal),
  );
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();
  const currency = CURRENCY_CODES.find((code) => code === form.values.currency) ?? defaultCurrency;
  const currencyLocked = editing !== undefined && editing.progress.contributionCount > 0;

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting) return;
    setFailure(undefined);
    let save: () => Promise<SavingsGoalDetailDto>;
    if (editing === undefined) {
      const built = buildCreateGoalInput(form.values);
      if (!built.ok) {
        form.setErrors(built.errors);
        return;
      }
      save = () => createGoal(built.input);
    } else {
      const built = buildUpdateGoalInput(editing.goal, form.values);
      if (!built.ok) {
        form.setErrors(built.errors);
        return;
      }
      const changes = built.input;
      if (changes === undefined) {
        onCancel();
        return;
      }
      save = () => updateGoal(editing.goal.id, changes);
    }
    setSubmitting(true);
    try {
      onSaved(await save());
    } catch (error: unknown) {
      setFailure(describeRequestError(error));
      if (error instanceof ApiClientError) {
        const target = error.details?.find((detail) => detail.path === 'body.targetMinor');
        if (target !== undefined) form.setErrors({ target: target.message });
      }
      setSubmitting(false);
    }
  };

  return (
    <form
      noValidate
      aria-label={editing === undefined ? 'Create a goal' : 'Edit goal'}
      onSubmit={(event) => void handleSubmit(event)}
      className="flex flex-col gap-5"
    >
      <FormField id="goal-name" label="Goal" error={form.errors.name}>
        {(control) => (
          <Input
            {...control}
            className="h-11"
            placeholder="e.g. Emergency fund"
            value={form.values.name}
            onChange={(event) => {
              form.setValue('name', event.target.value);
            }}
          />
        )}
      </FormField>
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,9rem)]">
        <FormField id="goal-target" label="Target" error={form.errors.target}>
          {(control) => (
            <MoneyInput
              {...control}
              currency={currency}
              value={form.values.target}
              onChange={(event) => {
                form.setValue('target', event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField
          id="goal-currency"
          label="Currency"
          error={form.errors.currency}
          hint={currencyLocked ? 'Fixed once money is tracked.' : undefined}
        >
          {(control) => (
            <NativeSelect
              {...control}
              disabled={currencyLocked}
              value={form.values.currency}
              onChange={(event) => {
                form.setValue('currency', event.target.value);
              }}
            >
              {CURRENCY_CODES.map((code) => (
                <option key={code} value={code}>
                  {code} · {CURRENCIES[code].name}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
      </div>
      <FormField id="goal-date" label="Target date (optional)" error={form.errors.targetDate}>
        {(control) => (
          <Input
            {...control}
            type="date"
            min="1900-01-01"
            className="h-11"
            value={form.values.targetDate}
            onChange={(event) => {
              form.setValue('targetDate', event.target.value);
            }}
          />
        )}
      </FormField>
      {editing === undefined && (
        <FormField
          id="goal-saved"
          label="Already set aside (optional)"
          error={form.errors.saved}
          hint="Counted towards the goal only. No account balance changes."
        >
          {(control) => (
            <MoneyInput
              {...control}
              currency={currency}
              value={form.values.saved}
              onChange={(event) => {
                form.setValue('saved', event.target.value);
              }}
            />
          )}
        </FormField>
      )}
      <FormField id="goal-description" label="Note (optional)" error={form.errors.description}>
        {(control) => (
          <Input
            {...control}
            className="h-11"
            value={form.values.description}
            onChange={(event) => {
              form.setValue('description', event.target.value);
            }}
          />
        )}
      </FormField>
      {failure !== undefined && (
        <FormMessage tone="error" title="Not saved">
          {failure}
        </FormMessage>
      )}
      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" className="h-11 sm:h-10" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" className="h-11 sm:h-10" disabled={submitting}>
          {submitting && <LoaderCircle aria-hidden="true" className="animate-spin" />}
          {editing === undefined ? 'Create goal' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}

const CONTRIBUTION_KINDS = [
  { value: 'add', label: 'Add' },
  { value: 'withdraw', label: 'Take out' },
  { value: 'set', label: 'Set total' },
] as const;

function ContributionForm({
  detail,
  timeZone,
  onSaved,
}: {
  detail: SavingsGoalDetailDto;
  timeZone: string;
  onSaved: (goal: SavingsGoalDetailDto) => void;
}): ReactNode {
  const today = calendarDateInTimeZone(new Date(), timeZone);
  const [kind, setKind] = useState<ContributionKind>('add');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting) return;
    const built = buildContributionInput(kind, amount, detail.goal.currency, date, note);
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setSubmitting(true);
    try {
      onSaved(await addGoalContribution(detail.goal.id, built.input));
      setAmount('');
      setNote('');
      setError(undefined);
    } catch (failure: unknown) {
      setError(describeRequestError(failure));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      noValidate
      aria-label="Update tracked amount"
      onSubmit={(event) => void handleSubmit(event)}
      className="flex flex-col gap-4 rounded-xl border bg-muted/20 p-4"
    >
      <FilterOptions
        legend="Change"
        name="contribution-kind"
        options={CONTRIBUTION_KINDS}
        value={kind}
        onValueChange={setKind}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id="contribution-amount"
          label={kind === 'set' ? 'New total' : 'Amount'}
          error={error}
        >
          {(control) => (
            <MoneyInput
              {...control}
              currency={detail.goal.currency}
              value={amount}
              onChange={(event) => {
                setError(undefined);
                setAmount(event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField id="contribution-date" label="Date">
          {(control) => (
            <Input
              {...control}
              type="date"
              max={today}
              className="h-11"
              value={date}
              onChange={(event) => {
                setDate(event.target.value);
              }}
            />
          )}
        </FormField>
      </div>
      <FormField id="contribution-note" label="Note (optional)">
        {(control) => (
          <Input
            {...control}
            className="h-11"
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        )}
      </FormField>
      <p className="text-xs text-muted-foreground">
        This only tracks money you set aside for the goal. It does not move money or change any
        account.
      </p>
      <Button type="submit" className="h-11 sm:h-10 sm:self-end" disabled={submitting}>
        {submitting && <LoaderCircle aria-hidden="true" className="animate-spin" />}
        Update
      </Button>
    </form>
  );
}

function GoalDetails({
  goalId,
  timeZone,
  onChanged,
  onEdit,
  onAction,
}: {
  goalId: string;
  timeZone: string;
  onChanged: () => void;
  onEdit: (item: SavingsGoalWithProgressDto) => void;
  onAction: (item: SavingsGoalWithProgressDto, action: GoalAction) => void;
}): ReactNode {
  const { state, reload, refresh } = useAsyncResource(
    useCallback(
      (signal: AbortSignal): Promise<SavingsGoalDetailDto> => getGoal(goalId, signal),
      [goalId],
    ),
  );
  if (state.status === 'loading') return <ListSkeleton rows={3} />;
  if (state.status === 'error') {
    return (
      <ErrorState
        title="This goal could not be loaded"
        description={describeRequestError(state.error)}
        onRetry={reload}
      />
    );
  }
  const detail = state.data;
  const { goal } = detail;
  const status = GOAL_STATUS_PRESENTATION[goal.status];
  const open = goal.status === 'active' || goal.status === 'paused';
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        {detail.progress.reached && goal.status !== 'completed' && (
          <span className="text-sm text-income">Target reached</span>
        )}
      </div>
      <GoalProgress item={detail} />
      {goal.description !== undefined && (
        <p className="text-sm text-muted-foreground">{goal.description}</p>
      )}
      {open && (
        <ContributionForm
          detail={detail}
          timeZone={timeZone}
          onSaved={() => {
            refresh();
            onChanged();
          }}
        />
      )}
      <section aria-labelledby="goal-history-heading" className="flex flex-col gap-2">
        <h3 id="goal-history-heading" className="text-sm font-semibold">
          History
        </h3>
        {detail.contributions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing tracked yet.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {detail.contributions.map((entry) => (
              <li key={entry.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block">{formatDate(entry.contributedOn, 'dayMonthYear')}</span>
                  {entry.note !== undefined && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {entry.note}
                    </span>
                  )}
                </span>
                <FinancialAmount
                  amountMinor={entry.amountMinor.replace(/^-/, '')}
                  currency={goal.currency}
                  direction={
                    entry.amountMinor.startsWith('-') ? 'adjustment-down' : 'adjustment-up'
                  }
                  size="sm"
                />
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:flex-wrap sm:justify-end">
        {goal.status === 'archived' ? (
          <Button
            className="h-11 sm:h-10"
            onClick={() => {
              onAction(detail, 'restore');
            }}
          >
            <ArchiveRestore aria-hidden="true" />
            Restore
          </Button>
        ) : (
          <>
            <Button
              variant="outline"
              className="h-11 sm:h-10"
              onClick={() => {
                onAction(detail, 'archive');
              }}
            >
              <Archive aria-hidden="true" />
              Archive
            </Button>
            {goal.status === 'completed' ? (
              <Button
                variant="outline"
                className="h-11 sm:h-10"
                onClick={() => {
                  onAction(detail, 'reopen');
                }}
              >
                <RotateCcw aria-hidden="true" />
                Reopen
              </Button>
            ) : (
              <>
                {goal.status === 'paused' ? (
                  <Button
                    variant="outline"
                    className="h-11 sm:h-10"
                    onClick={() => {
                      onAction(detail, 'resume');
                    }}
                  >
                    <CirclePlay aria-hidden="true" />
                    Resume
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    className="h-11 sm:h-10"
                    onClick={() => {
                      onAction(detail, 'pause');
                    }}
                  >
                    <CirclePause aria-hidden="true" />
                    Pause
                  </Button>
                )}
                <Button
                  variant="outline"
                  className="h-11 sm:h-10"
                  onClick={() => {
                    onAction(detail, 'complete');
                  }}
                >
                  <CircleCheck aria-hidden="true" />
                  Mark completed
                </Button>
              </>
            )}
            <Button
              className="h-11 sm:h-10"
              onClick={() => {
                onEdit(detail);
              }}
            >
              <Pencil aria-hidden="true" />
              Edit
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

const ACTION_WORDS: Readonly<Record<GoalAction, string>> = {
  pause: 'is paused.',
  resume: 'is active again.',
  complete: 'is marked completed.',
  reopen: 'is open again.',
  archive: 'was archived.',
  restore: 'was restored.',
};

/**
 * Savings goals and how far along each one is. Progress is what the person tracked for the goal:
 * it never changes an account balance and is separate from the dashboard's savings rate.
 */
export function GoalsOverview(): ReactNode {
  const { user } = useSignedInSession();
  const [archived, setArchived] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const [formMode, setFormMode] = useState<FormMode | undefined>();
  const [detailsId, setDetailsId] = useState<string | undefined>();
  const { state, reload, refresh } = useAsyncResource(
    useCallback(
      (signal: AbortSignal): Promise<SavingsGoalListDto> =>
        listGoals(archived ? 'archived' : 'current', signal),
      [archived],
    ),
  );
  const changed = (): void => {
    refresh();
  };
  const goals = state.status === 'success' ? state.data.goals : [];
  const details = goals.find((item) => item.goal.id === detailsId);

  const act = async (item: SavingsGoalWithProgressDto, action: GoalAction): Promise<void> => {
    setNotice(undefined);
    try {
      const result = await changeGoal(item.goal.id, action);
      setNotice({ tone: 'success', message: `${result.goal.name} ${ACTION_WORDS[action]}` });
      if (action === 'archive' || action === 'restore') setDetailsId(undefined);
      changed();
    } catch (error: unknown) {
      setNotice({ tone: 'error', message: describeRequestError(error) });
    }
  };

  let content: ReactNode;
  if (state.status === 'loading') {
    content = <ListSkeleton rows={3} />;
  } else if (state.status === 'error') {
    content = (
      <ErrorState
        title="Your goals could not be loaded"
        description={`${describeRequestError(state.error)} Nothing has been lost.`}
        onRetry={reload}
      />
    );
  } else if (goals.length === 0) {
    content = archived ? (
      <EmptyState
        icon={Archive}
        title="No archived goals"
        description="Goals you archive appear here with their history."
      />
    ) : (
      <EmptyState
        icon={Goal}
        title="Set a savings goal"
        description="An emergency fund, a holiday, a new laptop: give it a target and track what you set aside. It is a plan — no money moves between accounts."
      >
        <Button
          size="lg"
          className="h-11"
          onClick={() => {
            setFormMode({ kind: 'create' });
          }}
        >
          <Plus aria-hidden="true" />
          Create a goal
        </Button>
      </EmptyState>
    );
  } else {
    content = (
      <ul className="grid gap-3 md:grid-cols-2">
        {goals.map((item) => {
          const status = GOAL_STATUS_PRESENTATION[item.goal.status];
          return (
            <li key={item.goal.id} className="min-w-0">
              <Card className="gap-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-medium">{item.goal.name}</h3>
                    {item.goal.targetDate !== undefined && (
                      <p className="text-sm text-muted-foreground">
                        By {formatDate(item.goal.targetDate, 'dayMonthYear')}
                      </p>
                    )}
                  </div>
                  <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                </div>
                <GoalProgress item={item} />
                <Button
                  variant="outline"
                  className="h-10 self-start"
                  aria-label={`Open ${item.goal.name}`}
                  onClick={() => {
                    setDetailsId(item.goal.id);
                  }}
                >
                  Open
                </Button>
              </Card>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section aria-labelledby="goals-heading" className="flex flex-col gap-5">
      <SectionHeader
        id="goals-heading"
        title="Savings goals"
        description="What you are saving towards, and how much you have set aside."
        action={
          <Button
            onClick={() => {
              setNotice(undefined);
              setFormMode({ kind: 'create' });
            }}
          >
            <Plus aria-hidden="true" />
            Create goal
          </Button>
        }
      />
      <FilterOptions
        legend="Show goals"
        name="goal-status"
        options={[
          { value: 'current', label: 'Current' },
          { value: 'archived', label: 'Archived' },
        ]}
        value={archived ? 'archived' : 'current'}
        onValueChange={(next) => {
          setNotice(undefined);
          setArchived(next === 'archived');
        }}
      />
      {notice !== undefined && <FormMessage tone={notice.tone}>{notice.message}</FormMessage>}
      <div aria-busy={state.status === 'loading'}>{content}</div>

      <SideSheet
        open={formMode !== undefined}
        onClose={() => {
          setFormMode(undefined);
        }}
        title={
          formMode?.kind === 'edit' ? `Edit ${formMode.item.goal.name}` : 'Create a savings goal'
        }
      >
        {formMode !== undefined && (
          <GoalForm
            key={formMode.kind === 'edit' ? formMode.item.goal.id : 'create'}
            mode={formMode}
            defaultCurrency={user.preferredCurrency}
            onCancel={() => {
              setFormMode(undefined);
            }}
            onSaved={(goal) => {
              setFormMode(undefined);
              setNotice({ tone: 'success', message: `${goal.goal.name} was saved.` });
              changed();
            }}
          />
        )}
      </SideSheet>

      <SideSheet
        open={detailsId !== undefined}
        onClose={() => {
          setDetailsId(undefined);
        }}
        title={details?.goal.name ?? 'Goal'}
      >
        {detailsId !== undefined && (
          <GoalDetails
            key={detailsId}
            goalId={detailsId}
            timeZone={user.timezone}
            onChanged={changed}
            onEdit={(item) => {
              setDetailsId(undefined);
              setFormMode({ kind: 'edit', item });
            }}
            onAction={(item, action) => void act(item, action)}
          />
        )}
      </SideSheet>
    </section>
  );
}
