'use client';

import type {
  DataSufficiencyDto,
  DataSufficiencyLevel,
  ForecastWarningDto,
  IntelligenceExplanationInput,
  MethodologyDto,
} from '@calmcash/shared';
import { Info, LoaderCircle, MessageCircleQuestion, TriangleAlert } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { StatusBadge } from '@/components/feedback/status-badge';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/format';
import { describeRequestError } from '@/lib/form-errors';
import { cn } from '@/lib/utils';
import { explainIntelligence } from '@/services/intelligence.service';

import { SUFFICIENCY_PRESENTATION } from '../intelligence-presentation';

// Pieces every intelligence view uses: how much history a figure stands on, the documented method,
// what kind of figure it is (actual, scheduled, estimated, simulated), warnings, and the optional
// plain-word explanation. Estimates never look like facts.

export type FigureKind = 'actual' | 'scheduled' | 'estimated' | 'simulated';

const KIND_STYLES: Readonly<Record<FigureKind, { label: string; className: string }>> = {
  actual: { label: 'Actual', className: 'bg-muted text-foreground ring-border' },
  scheduled: { label: 'Scheduled', className: 'bg-accent text-accent-foreground ring-primary/20' },
  estimated: {
    label: 'Estimate',
    className: 'border-dashed bg-transparent text-muted-foreground ring-muted-foreground/40',
  },
  simulated: {
    label: 'Simulation',
    className: 'border-dashed bg-transparent text-muted-foreground ring-muted-foreground/40',
  },
};

/** A small label saying what kind of figure follows; estimates and simulations are dashed. */
export function FigureKindLabel({ kind }: { kind: FigureKind }): ReactNode {
  const { label, className } = KIND_STYLES[kind];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-2xs font-medium ring-1 ring-inset',
        className,
      )}
    >
      {label}
    </span>
  );
}

export function SufficiencyBadge({ level }: { level: DataSufficiencyLevel }): ReactNode {
  const { label, tone } = SUFFICIENCY_PRESENTATION[level];
  return (
    <StatusBadge tone={tone} showIcon={level !== 'strong'}>
      {label}
    </StatusBadge>
  );
}

/** The history behind an estimate, with the measured facts and why it is not stronger. */
export function SufficiencyNote({ sufficiency }: { sufficiency: DataSufficiencyDto }): ReactNode {
  const { description } = SUFFICIENCY_PRESENTATION[sufficiency.level];
  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <SufficiencyBadge level={sufficiency.level} />
        <span>
          {description} {sufficiency.monthsWithActivity.toString()} of{' '}
          {sufficiency.monthsConsidered.toString()} completed months had spending.
        </span>
      </div>
      {sufficiency.notes.length > 0 && (
        <ul className="list-disc pl-5">
          {sufficiency.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function WarningList({ warnings }: { warnings: readonly ForecastWarningDto[] }): ReactNode {
  if (warnings.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Limitations of this estimate">
      {warnings.map((warning) => (
        <li key={warning.code} className="flex gap-2 text-sm text-muted-foreground">
          {warning.code === 'account_allocation' ? (
            <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          ) : (
            <TriangleAlert
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-warning-text"
            />
          )}
          <span>{warning.message}</span>
        </li>
      ))}
    </ul>
  );
}

/** "How this is calculated": the same documented method the API used. */
export function MethodologyDisclosure({ methodology }: { methodology: MethodologyDto }): ReactNode {
  return (
    <details className="group rounded-lg border bg-card px-3 py-2 text-sm">
      <summary className="cursor-pointer text-muted-foreground select-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        How this is calculated
      </summary>
      <div className="mt-2 flex flex-col gap-3">
        <p>{methodology.summary}</p>
        {[
          { title: 'Steps', items: methodology.steps },
          { title: 'Assumptions', items: methodology.assumptions },
          { title: 'Limitations', items: methodology.limitations },
        ]
          .filter((group) => group.items.length > 0)
          .map((group) => (
            <div key={group.title}>
              <p className="text-xs font-medium text-muted-foreground">{group.title}</p>
              <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                {group.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        <p className="text-2xs text-muted-foreground">Method version {methodology.version}</p>
      </div>
    </details>
  );
}

export function CalculatedAt({ at, timeZone }: { at: string; timeZone: string }): ReactNode {
  return (
    <p className="text-2xs text-muted-foreground">
      Calculated {formatDateTime(at, timeZone)} from your current records.
    </p>
  );
}

/**
 * Plain words for a result, from the local assistant when it is available. The figures stay the
 * calculated ones; the wording is checked on the server, or a standard wording is used.
 */
export function ExplainButton({
  input,
  aiAvailable,
}: {
  input: IntelligenceExplanationInput;
  aiAvailable: boolean;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    { text: string; worded: boolean } | { failure: string } | undefined
  >();
  if (!aiAvailable) return null;
  const explain = async (): Promise<void> => {
    setBusy(true);
    try {
      const explanation = await explainIntelligence(input);
      setResult({ text: explanation.explanation, worded: explanation.narrative === 'assistant' });
    } catch (error: unknown) {
      setResult({ failure: describeRequestError(error) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      {result === undefined && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-11 w-fit sm:h-8"
          disabled={busy}
          onClick={() => void explain()}
        >
          {busy ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : (
            <MessageCircleQuestion aria-hidden="true" />
          )}
          Explain in plain words
        </Button>
      )}
      {result !== undefined && (
        <div aria-live="polite" className="rounded-lg border bg-card px-3 py-2 text-sm">
          {'failure' in result ? (
            <p className="text-expense">{result.failure}</p>
          ) : (
            <>
              <p className="whitespace-pre-wrap">{result.text}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {result.worded
                  ? 'Worded by the assistant from the calculated figures; the figures themselves are unchanged.'
                  : 'Standard wording.'}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
