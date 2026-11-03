'use client';

import type {
  BudgetPrefillDto,
  BudgetRecommendationDto,
  BudgetRecommendationsDto,
  BudgetWithProgressDto,
  CurrencyCode,
  GoalProjectionsDto,
} from '@calmcash/shared';
import { Goal, PiggyBank } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useState, type ReactNode } from 'react';

import { EmptyState } from '@/components/feedback/empty-state';
import { ErrorState } from '@/components/feedback/error-state';
import { FormMessage } from '@/components/forms/form-message';
import { ListSkeleton } from '@/components/feedback/loading-skeleton';
import { StatusBadge } from '@/components/feedback/status-badge';
import { FinancialAmount } from '@/components/finance/financial-amount';
import { ProgressMeter } from '@/components/finance/progress-meter';
import { SectionHeader } from '@/components/layout/page-header';
import { SideSheet } from '@/components/layout/side-sheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { BUDGET_STATUS_PRESENTATION, BudgetForm } from '@/features/budgets';
import { usePlanningReferences } from '@/features/recurring';
import { useAsyncResource } from '@/hooks/use-async-resource';
import { formatBasisPoints, formatDate, formatMoney } from '@/lib/format';
import { describeRequestError } from '@/lib/form-errors';
import { getBudget } from '@/services/budgets.service';
import { getBudgetRecommendations, getGoalProjections } from '@/services/intelligence.service';

import {
  budgetValuesFromPrefill,
  GOAL_STATE_PRESENTATION,
  monthLabel,
} from '../intelligence-presentation';
import {
  CalculatedAt,
  ExplainButton,
  FigureKindLabel,
  MethodologyDisclosure,
  SufficiencyBadge,
  SufficiencyNote,
} from './intelligence-parts';

/**
 * The ordinary Phase 7 budget form in a side sheet, started from a suggestion. Editing an
 * existing budget loads it first; nothing is saved until the person presses Save.
 */
export function BudgetPrefillSheet({
  prefill,
  timeZone,
  onClose,
  onSaved,
}: {
  prefill: BudgetPrefillDto | undefined;
  timeZone: string;
  onClose: () => void;
  onSaved: (item: BudgetWithProgressDto) => void;
}): ReactNode {
  const { references } = usePlanningReferences();
  const budgetId = prefill?.budgetId;
  const existing = useAsyncResource(
    useCallback(
      (signal: AbortSignal): Promise<BudgetWithProgressDto | undefined> =>
        budgetId === undefined ? Promise.resolve(undefined) : getBudget(budgetId, '', signal),
      [budgetId],
    ),
  );
  const ready = prefill !== undefined && existing.state.status === 'success';
  return (
    <SideSheet
      open={prefill !== undefined}
      onClose={onClose}
      title={budgetId === undefined ? 'Create a budget' : 'Edit budget'}
      description="Started from your history. Check every field — nothing is saved until you save it."
    >
      {existing.state.status === 'error' && (
        <FormMessage tone="error" title="That budget could not be opened">
          {describeRequestError(existing.state.error)}
        </FormMessage>
      )}
      {ready && (
        <BudgetForm
          key={`${budgetId ?? 'new'}:${prefill.limitMinor}`}
          mode={
            existing.state.status === 'success' && existing.state.data !== undefined
              ? { kind: 'edit', item: existing.state.data }
              : { kind: 'create' }
          }
          categories={references.categories}
          defaultCurrency={prefill.currency}
          timeZone={timeZone}
          initialValues={
            budgetId === undefined
              ? budgetValuesFromPrefill(prefill)
              : { limit: budgetValuesFromPrefill(prefill).limit ?? '' }
          }
          onCancel={onClose}
          onSaved={onSaved}
        />
      )}
    </SideSheet>
  );
}

function BudgetRecommendationCard({
  item,
  onUse,
}: {
  item: BudgetRecommendationDto;
  onUse: (prefill: BudgetPrefillDto) => void;
}): ReactNode {
  const money = (value: string): string => formatMoney(value, item.currency);
  return (
    <li>
      <Card className="flex h-full flex-col gap-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col">
            <h3 className="font-medium">{item.categoryName}</h3>
            <p className="text-xs text-muted-foreground">
              {item.existingBudget === undefined
                ? 'No budget yet'
                : `Budget “${item.existingBudget.name}”: ${money(item.existingBudget.limitMinor)} a month`}
            </p>
          </div>
          <SufficiencyBadge level={item.sufficiency} />
        </div>
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <FigureKindLabel kind="actual" />
          Average month {money(item.history.averageMinor)} · typical{' '}
          {money(item.history.medianMinor)} · range {money(item.history.lowestMinor)}–
          {money(item.history.highestMinor)}
        </p>
        {item.existingBudget !== undefined && item.existingBudget.recentPeriods.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Recent completed months">
            {item.existingBudget.recentPeriods.map((period) => {
              const status = BUDGET_STATUS_PRESENTATION[period.status];
              return (
                <li key={period.from}>
                  <StatusBadge tone={status.badgeTone} showIcon={period.status === 'over_budget'}>
                    {monthLabel(period.from.slice(0, 7))}: {money(period.spentMinor)}
                  </StatusBadge>
                </li>
              );
            })}
          </ul>
        )}
        {item.flags.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
            {item.flags.map((flag) => (
              <li key={flag.code}>• {flag.message}</li>
            ))}
          </ul>
        )}
        {item.suggestions.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-muted-foreground">
              Suggested starting limits (from your history)
            </p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {item.suggestions.map((suggestion) => (
                <li
                  key={suggestion.basis}
                  className="flex flex-col gap-1 rounded-lg border border-dashed px-3 py-2"
                >
                  <span className="text-xs text-muted-foreground">
                    {suggestion.basis === 'historical_average'
                      ? 'Historical average'
                      : 'Conservative target'}
                  </span>
                  <FinancialAmount
                    amountMinor={suggestion.limitMinor}
                    currency={item.currency}
                    size="sm"
                  />
                  <span className="text-xs text-muted-foreground">
                    {suggestion.monthsWithin.toString()} of {suggestion.monthsConsidered.toString()}{' '}
                    past months stayed within it
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-1 h-11 w-fit sm:h-8"
                    onClick={() => {
                      onUse({ ...item.prefill, limitMinor: suggestion.limitMinor });
                    }}
                  >
                    {item.existingBudget === undefined
                      ? 'Create with this limit'
                      : 'Edit with this limit'}
                  </Button>
                </li>
              ))}
            </ul>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-11 w-fit sm:h-8"
              onClick={() => {
                onUse(item.prefill);
              }}
            >
              Choose my own limit
            </Button>
          </div>
        )}
      </Card>
    </li>
  );
}

export function BudgetRecommendationsSection({
  currency,
  timeZone,
  aiAvailable,
}: {
  currency: CurrencyCode | undefined;
  timeZone: string;
  aiAvailable: boolean;
}): ReactNode {
  const recommendations = useAsyncResource(
    useCallback(
      (signal: AbortSignal): Promise<BudgetRecommendationsDto> =>
        getBudgetRecommendations(currency, signal),
      [currency],
    ),
  );
  const [prefill, setPrefill] = useState<BudgetPrefillDto | undefined>();
  const [saved, setSaved] = useState<string | undefined>();
  const data = recommendations.state.status === 'success' ? recommendations.state.data : undefined;
  return (
    <section aria-labelledby="budget-recommendations-heading" className="flex flex-col gap-4">
      <SectionHeader
        id="budget-recommendations-heading"
        title="Budget suggestions"
        description="Limits worked out from your completed months, and how your budgets have done. Starting points, not rules — a budget changes only when you save it."
      />
      {saved !== undefined && (
        <FormMessage tone="success" title="Saved">
          {saved}
        </FormMessage>
      )}
      {recommendations.state.status === 'loading' && <ListSkeleton rows={2} />}
      {recommendations.state.status === 'error' && (
        <ErrorState
          title="Budget suggestions could not be loaded"
          description={describeRequestError(recommendations.state.error)}
          onRetry={recommendations.reload}
        />
      )}
      {data !== undefined && (
        <>
          {data.items.length === 0 ? (
            <EmptyState
              icon={PiggyBank}
              headingLevel="h3"
              title="No suggestions yet"
              description="Suggestions need spending in a category in at least two completed months."
            />
          ) : (
            <ul className="grid gap-4 md:grid-cols-2">
              {data.items.slice(0, 12).map((item) => (
                <BudgetRecommendationCard key={item.key} item={item} onUse={setPrefill} />
              ))}
            </ul>
          )}
          <SufficiencyNote sufficiency={data.sufficiency} />
          <ExplainButton
            input={{ subject: 'budget_recommendations', currency: data.currency }}
            aiAvailable={aiAvailable}
          />
          <MethodologyDisclosure methodology={data.methodology} />
          <CalculatedAt at={data.calculatedAt} timeZone={timeZone} />
        </>
      )}
      <BudgetPrefillSheet
        prefill={prefill}
        timeZone={timeZone}
        onClose={() => {
          setPrefill(undefined);
        }}
        onSaved={(item) => {
          setPrefill(undefined);
          setSaved(
            `${item.budget.name} was saved with a limit of ${formatMoney(item.budget.limitMinor, item.budget.currency)}.`,
          );
          recommendations.refresh();
        }}
      />
    </section>
  );
}

export function GoalProjectionsSection({
  timeZone,
  aiAvailable,
}: {
  timeZone: string;
  aiAvailable: boolean;
}): ReactNode {
  const projections = useAsyncResource(getGoalProjections);
  const data = projections.state.status === 'success' ? projections.state.data : undefined;
  const goals: GoalProjectionsDto['goals'] = data?.goals ?? [];
  return (
    <section aria-labelledby="goal-projections-heading" className="flex flex-col gap-4">
      <SectionHeader
        id="goal-projections-heading"
        title="Savings-goal projections"
        description="When each goal could be reached at the pace of your recent allocations. Goal progress is planning — it never moves money."
      />
      {projections.state.status === 'loading' && <ListSkeleton rows={2} />}
      {projections.state.status === 'error' && (
        <ErrorState
          title="Goal projections could not be loaded"
          description={describeRequestError(projections.state.error)}
          onRetry={projections.reload}
        />
      )}
      {data !== undefined && (
        <>
          {goals.length === 0 ? (
            <EmptyState
              icon={Goal}
              headingLevel="h3"
              title="No savings goals yet"
              description="Create a goal under Budgets → Goals to see when you could reach it."
            />
          ) : (
            <ul className="grid gap-4 md:grid-cols-2">
              {goals.map((goal) => {
                const state = GOAL_STATE_PRESENTATION[goal.state];
                return (
                  <li key={goal.goalId}>
                    <Card className="flex h-full flex-col gap-3 p-4 sm:p-5">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <h3 className="font-medium">{goal.name}</h3>
                        <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
                      </div>
                      <ProgressMeter
                        percent={
                          goal.percent.status === 'available'
                            ? Number(BigInt(goal.percent.basisPoints)) / 100
                            : 0
                        }
                        tone={goal.state === 'reached' ? 'positive' : 'neutral'}
                        label={`${goal.name} progress`}
                        valueText={
                          goal.percent.status === 'available'
                            ? `${formatBasisPoints(goal.percent.basisPoints)} of the target set aside`
                            : 'No target'
                        }
                      />
                      <dl className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <dt className="text-xs text-muted-foreground">Set aside</dt>
                          <dd>
                            <FinancialAmount
                              amountMinor={goal.savedMinor}
                              currency={goal.currency}
                              size="sm"
                            />
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">Target</dt>
                          <dd>
                            <FinancialAmount
                              amountMinor={goal.targetMinor}
                              currency={goal.currency}
                              size="sm"
                            />
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">Remaining</dt>
                          <dd>
                            <FinancialAmount
                              amountMinor={goal.remainingMinor}
                              currency={goal.currency}
                              size="sm"
                            />
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">Recent pace</dt>
                          <dd>
                            {goal.pace.status === 'available' ? (
                              <>
                                <FinancialAmount
                                  amountMinor={goal.pace.monthlyAverageMinor}
                                  currency={goal.currency}
                                  size="sm"
                                />
                                <span className="text-xs text-muted-foreground"> a month</span>
                              </>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                {goal.pace.reason === 'no_contributions'
                                  ? 'No allocations yet'
                                  : goal.pace.reason === 'too_little_history'
                                    ? 'Less than two months of allocations'
                                    : 'Not increasing recently'}
                              </span>
                            )}
                          </dd>
                        </div>
                        {goal.requiredMonthlyMinor !== undefined && (
                          <div>
                            <dt className="text-xs text-muted-foreground">
                              Needed per month
                              {goal.targetDate === undefined
                                ? ''
                                : ` by ${formatDate(goal.targetDate, 'dayMonthYear')}`}
                            </dt>
                            <dd>
                              <FinancialAmount
                                amountMinor={goal.requiredMonthlyMinor}
                                currency={goal.currency}
                                size="sm"
                              />
                            </dd>
                          </div>
                        )}
                        {goal.projectedCompletionDate !== undefined && (
                          <div>
                            <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                              Could be reached <FigureKindLabel kind="estimated" />
                            </dt>
                            <dd>{formatDate(goal.projectedCompletionDate, 'monthYear')}</dd>
                          </div>
                        )}
                      </dl>
                      {goal.suggestions.length > 0 && (
                        <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                          {goal.suggestions.map((suggestion) => (
                            <li key={suggestion.kind}>• {suggestion.text}</li>
                          ))}
                        </ul>
                      )}
                      <Button
                        asChild
                        variant="outline"
                        size="sm"
                        className="mt-auto h-11 w-fit sm:h-8"
                      >
                        <Link href={{ pathname: '/budgets', query: { section: 'goals' } }}>
                          Open goals
                        </Link>
                      </Button>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            CalmCash never adds or changes allocations for you; reminders for goals are not part of
            notifications yet.
          </p>
          <ExplainButton
            input={{ subject: 'goal_projections' }}
            aiAvailable={aiAvailable && goals.length > 0}
          />
          <MethodologyDisclosure methodology={data.methodology} />
          <CalculatedAt at={data.calculatedAt} timeZone={timeZone} />
        </>
      )}
    </section>
  );
}
