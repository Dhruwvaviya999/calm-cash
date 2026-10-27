'use client';

import {
  CURRENCIES,
  type AccountSummaryDto,
  type CurrencyCode,
  type DashboardOverviewDto,
  type MetricChangeDto,
  type TransactionListItemDto,
} from '@calmcash/shared';
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  CircleHelp,
  PiggyBank,
  Scale,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useId, useState, type ComponentProps, type ReactNode } from 'react';

import { FinancialAmount } from '@/components/finance/financial-amount';
import { Card } from '@/components/ui/card';
import { TransactionRow } from '@/features/transactions';
import { formatBasisPoints, formatDate, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

// Dashboard sections. They receive validated API responses and only present them: every figure
// was calculated by the API, and nothing here adds amounts together.

export function SectionCard({
  id,
  title,
  description,
  action,
  children,
  className,
  busy = false,
}: {
  id: string;
  title: string;
  description?: string | undefined;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Newer figures are loading: keep the current ones visible but dimmed. */
  busy?: boolean;
}): ReactNode {
  return (
    <Card className={cn('gap-0 p-5 sm:p-6', className)}>
      <section aria-labelledby={id} aria-busy={busy} className="flex min-w-0 flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={id} className="text-base font-semibold tracking-tight">
              {title}
            </h2>
            {description !== undefined && (
              <p className="text-sm text-muted-foreground">{description}</p>
            )}
          </div>
          {action}
        </div>
        <div className={cn('min-w-0 transition-opacity', busy && 'opacity-60')}>{children}</div>
      </section>
    </Card>
  );
}

export function SectionLinkArrow({
  href,
  children,
}: {
  href: ComponentProps<typeof Link>['href'];
  children: ReactNode;
}): ReactNode {
  return (
    <Link
      href={href}
      className="inline-flex shrink-0 items-center gap-1 rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {children}
      <ArrowRight aria-hidden="true" className="size-3.5" />
    </Link>
  );
}

/** "1 Oct – 27 Oct 2026". */
export function describeRange(range: { from: string; to: string }): string {
  return range.from === range.to
    ? formatDate(range.from, 'dayMonthYear')
    : `${formatDate(range.from, 'dayMonth')} – ${formatDate(range.to, 'dayMonthYear')}`;
}

// --- Financial position ---------------------------------------------------------------------------

/**
 * What the user holds and owes right now, per currency, from active accounts — never added
 * together, never converted, and independent of the selected period.
 */
export function FinancialPosition({ position }: { position: AccountSummaryDto }): ReactNode {
  return (
    <ul className="grid gap-3 lg:grid-cols-2">
      {position.currencies.map((entry) => (
        <li key={entry.currency} className="min-w-0">
          <div className="rounded-xl border bg-muted/30 p-4">
            {position.currencies.length > 1 && (
              <p className="mb-3 text-sm font-medium">
                {CURRENCIES[entry.currency].name} ({entry.currency})
              </p>
            )}
            <dl className="grid grid-cols-1 gap-4 min-[360px]:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-1">
                <dt className="text-sm text-muted-foreground">Money held</dt>
                <dd className="flex min-w-0 flex-col">
                  {entry.assetAccounts === 0 ? (
                    <span className="text-sm text-muted-foreground">
                      No accounts that hold money
                    </span>
                  ) : (
                    <>
                      <FinancialAmount
                        amountMinor={entry.assetsMinor}
                        currency={entry.currency}
                        size="lg"
                      />
                      <span className="text-xs text-muted-foreground">
                        In{' '}
                        {entry.assetAccounts === 1
                          ? '1 account'
                          : `${String(entry.assetAccounts)} accounts`}
                      </span>
                    </>
                  )}
                </dd>
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <dt className="text-sm text-muted-foreground">Amount owed</dt>
                <dd className="flex min-w-0 flex-col">
                  {entry.liabilityAccounts === 0 ? (
                    <span className="text-sm text-muted-foreground">No cards or debts</span>
                  ) : (
                    <>
                      <FinancialAmount
                        amountMinor={entry.liabilitiesMinor}
                        currency={entry.currency}
                        size="lg"
                        className="text-expense"
                      />
                      <span className="text-xs text-muted-foreground">
                        On{' '}
                        {entry.liabilityAccounts === 1
                          ? '1 card'
                          : `${String(entry.liabilityAccounts)} cards`}
                      </span>
                    </>
                  )}
                </dd>
              </div>
            </dl>
          </div>
        </li>
      ))}
    </ul>
  );
}

// --- Period summary ---------------------------------------------------------------------------------

function ChangeLine({
  change,
  currency,
  previousLabel,
}: {
  change: MetricChangeDto;
  currency: CurrencyCode;
  previousLabel: string;
}): ReactNode {
  const amount = BigInt(change.changeMinor);
  const Icon = amount > 0n ? ArrowUpRight : amount < 0n ? ArrowDownLeft : Scale;
  const text =
    change.changePercent.status === 'available'
      ? formatBasisPoints(change.changePercent.basisPoints, { signed: true })
      : amount === 0n
        ? 'No change'
        : `${amount > 0n ? '+' : ''}${formatMoney(change.changeMinor, currency)}`;
  return (
    // Neutral on purpose: more income, more spending, and more net mean different things.
    <span className="inline-flex items-center gap-1">
      <Icon aria-hidden="true" className="size-3.5" />
      {text} vs {previousLabel}
    </span>
  );
}

function Tile({
  label,
  icon: Icon,
  tone,
  children,
  footnote,
  help,
}: {
  label: string;
  icon: LucideIcon;
  tone: string;
  children: ReactNode;
  footnote?: ReactNode;
  help?: string;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const helpId = useId();
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2">
        <span className={cn('grid size-7 shrink-0 place-items-center rounded-lg', tone)}>
          <Icon aria-hidden="true" className="size-3.5" />
        </span>
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-muted-foreground">{label}</p>
        {help !== undefined && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={helpId}
            aria-label={`What is ${label.toLowerCase()}?`}
            onClick={() => {
              setOpen((current) => !current);
            }}
            className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <CircleHelp aria-hidden="true" className="size-4" />
          </button>
        )}
      </div>
      <div className="min-w-0">{children}</div>
      {footnote !== undefined && <div className="text-xs text-muted-foreground">{footnote}</div>}
      {help !== undefined && open && (
        <p
          id={helpId}
          className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-pretty text-muted-foreground"
        >
          {help}
        </p>
      )}
    </div>
  );
}

const SAVINGS_RATE_HELP =
  'Savings rate = (money in − money out) ÷ money in, for this period and currency. It measures cash flow only: transfers between your accounts, balance corrections, and changes in what your investments are worth are not included. It is negative when you spent more than came in.';

const NET_HELP =
  'Net cash flow = money in − money out. It is not your balance: it shows how much more came in than went out during the period.';

/** Income, spending, net cash flow, and savings rate for the period, in one currency. */
export function PeriodSummary({ overview }: { overview: DashboardOverviewDto }): ReactNode {
  const { cashFlow, currency, savingsRate, comparison } = overview;
  const previousLabel = describeRange(comparison);
  const changes = comparison.status === 'available' ? comparison : undefined;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="Money in"
          icon={ArrowDownLeft}
          tone="bg-income/10 text-income"
          footnote={
            changes === undefined ? (
              `${String(cashFlow.incomeCount)} income ${cashFlow.incomeCount === 1 ? 'entry' : 'entries'}`
            ) : (
              <ChangeLine
                change={changes.income}
                currency={currency}
                previousLabel={previousLabel}
              />
            )
          }
        >
          <FinancialAmount
            amountMinor={cashFlow.incomeMinor}
            currency={currency}
            direction="credit"
            size="lg"
          />
        </Tile>
        <Tile
          label="Money out"
          icon={ArrowUpRight}
          tone="bg-expense/10 text-expense"
          footnote={
            changes === undefined ? (
              `${String(cashFlow.expenseCount)} ${cashFlow.expenseCount === 1 ? 'expense' : 'expenses'}`
            ) : (
              <ChangeLine
                change={changes.expense}
                currency={currency}
                previousLabel={previousLabel}
              />
            )
          }
        >
          <FinancialAmount
            amountMinor={cashFlow.expenseMinor}
            currency={currency}
            direction="debit"
            size="lg"
          />
        </Tile>
        <Tile
          label="Net cash flow"
          icon={Scale}
          tone="bg-muted text-muted-foreground"
          help={NET_HELP}
          footnote={
            changes === undefined
              ? 'Money in minus money out'
              : `${BigInt(changes.net.changeMinor) >= 0n ? '+' : ''}${formatMoney(changes.net.changeMinor, currency)} vs ${previousLabel}`
          }
        >
          <FinancialAmount amountMinor={cashFlow.netMinor} currency={currency} size="lg" />
        </Tile>
        <Tile
          label="Savings rate"
          icon={PiggyBank}
          tone="bg-accent text-accent-foreground"
          help={SAVINGS_RATE_HELP}
          footnote={
            savingsRate.status === 'available'
              ? 'Of money in, kept this period'
              : 'Needs income in this period'
          }
        >
          {savingsRate.status === 'available' ? (
            <span className="text-lg font-semibold tracking-tight tabular-nums sm:text-xl">
              {formatBasisPoints(savingsRate.basisPoints)}
            </span>
          ) : (
            <span className="text-lg font-semibold text-muted-foreground">
              <span aria-hidden="true">—</span>
              <span className="sr-only">Not available</span>
            </span>
          )}
        </Tile>
      </div>
      {comparison.status === 'unavailable' && (
        <p className="text-xs text-muted-foreground">
          Nothing was recorded in {previousLabel}, so there is no earlier period to compare with.
        </p>
      )}
    </div>
  );
}

// --- Recent activity ------------------------------------------------------------------------------

/** The latest real transactions, each opening its details on the Transactions page. */
export function RecentActivity({
  items,
  timeZone,
}: {
  items: readonly TransactionListItemDto[];
  timeZone: string;
}): ReactNode {
  return (
    <ul aria-label="Recent transactions" className="-my-1 divide-y">
      {items.map((item) => (
        <li key={item.transaction.id}>
          <Link
            href={{ pathname: '/transactions', query: { transaction: item.transaction.id } }}
            className="-mx-2 block rounded-xl px-2 outline-none hover:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          >
            <TransactionRow item={item} timeZone={timeZone} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
