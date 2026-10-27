'use client';

import {
  calendarDateInTimeZone,
  DASHBOARD_PERIODS,
  type CurrencyCode,
  type DashboardPeriod,
} from '@calmcash/shared';
import { useState, type ReactNode, type SubmitEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';

import type { DashboardSelection } from '../dashboard-selection';

export const PERIOD_LABELS: Readonly<Record<DashboardPeriod, string>> = {
  'this-month': 'This month',
  'last-month': 'Last month',
  'last-3-months': 'Last 3 months',
  'last-6-months': 'Last 6 months',
  'this-year': 'This year',
  custom: 'Custom range',
};

function isPeriod(value: string): value is DashboardPeriod {
  return DASHBOARD_PERIODS.some((period) => period === value);
}

/** A custom range, applied only when both dates are valid and in order. */
function CustomRange({
  selection,
  timeZone,
  onApply,
}: {
  selection: DashboardSelection;
  timeZone: string;
  onApply: (from: string, to: string) => void;
}): ReactNode {
  const today = calendarDateInTimeZone(new Date(), timeZone);
  const [from, setFrom] = useState(selection.from ?? `${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(selection.to ?? today);
  const [problem, setProblem] = useState<string | undefined>();

  const apply = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (from === '' || to === '') {
      setProblem('Choose a start and an end date.');
    } else if (from > to) {
      setProblem('The end date must be on or after the start date.');
    } else if (to > today) {
      setProblem('The end date cannot be in the future.');
    } else {
      setProblem(undefined);
      onApply(from, to);
    }
  };

  return (
    <form
      noValidate
      aria-label="Custom range"
      onSubmit={apply}
      className="flex flex-wrap items-end gap-2"
    >
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        From
        <Input
          type="date"
          value={from}
          min="1900-01-01"
          max={today}
          className="h-10 w-40 text-foreground"
          onChange={(event) => {
            setFrom(event.target.value);
          }}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        To
        <Input
          type="date"
          value={to}
          min="1900-01-01"
          max={today}
          className="h-10 w-40 text-foreground"
          onChange={(event) => {
            setTo(event.target.value);
          }}
        />
      </label>
      <Button type="submit" variant="outline" className="h-10">
        Apply
      </Button>
      {problem !== undefined && (
        <p role="alert" className="w-full text-sm text-expense">
          {problem}
        </p>
      )}
    </form>
  );
}

/**
 * Period and currency for every period figure below. One row above the content they scope; the
 * currency control appears only when the user has more than one currency.
 */
export function DashboardControls({
  selection,
  currency,
  currencies,
  timeZone,
  onChange,
}: {
  selection: DashboardSelection;
  /** The currency the figures are in (resolved by the API). */
  currency: CurrencyCode;
  currencies: readonly CurrencyCode[];
  timeZone: string;
  onChange: (selection: DashboardSelection) => void;
}): ReactNode {
  const [customOpen, setCustomOpen] = useState(selection.period === 'custom');

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Period
          <NativeSelect
            aria-label="Period"
            className="h-10 w-44 text-foreground"
            value={customOpen ? 'custom' : selection.period}
            onChange={(event) => {
              const period = event.target.value;
              if (!isPeriod(period)) return;
              if (period === 'custom') {
                setCustomOpen(true);
              } else {
                setCustomOpen(false);
                onChange({
                  period,
                  ...(selection.currency === undefined ? {} : { currency: selection.currency }),
                });
              }
            }}
          >
            {DASHBOARD_PERIODS.map((period) => (
              <option key={period} value={period}>
                {PERIOD_LABELS[period]}
              </option>
            ))}
          </NativeSelect>
        </label>
        {currencies.length > 1 && (
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Currency
            <NativeSelect
              aria-label="Currency"
              className="h-10 w-28 text-foreground"
              value={currency}
              onChange={(event) => {
                const next = currencies.find((code) => code === event.target.value);
                if (next !== undefined) {
                  onChange({ ...selection, currency: next });
                }
              }}
            >
              {currencies.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </NativeSelect>
          </label>
        )}
      </div>
      {customOpen && (
        <CustomRange
          selection={selection}
          timeZone={timeZone}
          onApply={(from, to) => {
            onChange({
              period: 'custom',
              from,
              to,
              ...(selection.currency === undefined ? {} : { currency: selection.currency }),
            });
          }}
        />
      )}
    </div>
  );
}
