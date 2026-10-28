'use client';

import type { AccountWithBalanceDto, CategoryDto, ImportBatchDetailDto } from '@calmcash/shared';
import { Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, type ReactNode } from 'react';

import { ErrorState } from '@/components/feedback/error-state';
import { PageSkeleton } from '@/components/feedback/loading-skeleton';
import { StatusBadge } from '@/components/feedback/status-badge';
import { useSignedInSession } from '@/features/auth';
import { useAsyncResource } from '@/hooks/use-async-resource';
import { describeRequestError } from '@/lib/form-errors';
import { cn } from '@/lib/utils';
import { listAccounts } from '@/services/accounts.service';
import { listCategories } from '@/services/categories.service';
import { getImport } from '@/services/imports.service';

import { BATCH_STATUS_PRESENTATION, describePeriod } from '../import-presentation';
import { ImportSummary } from './import-summary';
import { MappingStep } from './mapping-step';
import { ReconcileStep } from './reconcile-step';
import { ReviewStep } from './review-step';

export const IMPORT_STEPS = ['map', 'review', 'reconcile'] as const;

export type ImportStep = (typeof IMPORT_STEPS)[number];

export function parseStep(value: string | null): ImportStep | undefined {
  return IMPORT_STEPS.find((step) => step === value);
}

const STEP_LABELS: Readonly<Record<ImportStep | 'upload', string>> = {
  upload: 'Upload',
  map: 'Map columns',
  review: 'Review & import',
  reconcile: 'Reconcile',
};

export interface ImportReferences {
  accounts: AccountWithBalanceDto[];
  categories: CategoryDto[];
}

const loadReferences = async (signal: AbortSignal): Promise<ImportReferences> => {
  const [accounts, categories] = await Promise.all([
    listAccounts('all', signal),
    listCategories(signal),
  ]);
  return { accounts: accounts.accounts, categories: categories.categories };
};

export interface ImportWizardProps {
  batchId: string;
  /** The step in the URL (`?step=`); the import's state decides when it is absent or unavailable. */
  requestedStep: ImportStep | undefined;
}

/**
 * One import, step by step. Every step reads and writes the API, so an import can be left at any
 * point and resumed later from the same URL.
 */
export function ImportWizard({ batchId, requestedStep }: ImportWizardProps): ReactNode {
  const { user } = useSignedInSession();
  const router = useRouter();
  const batch = useAsyncResource(
    useCallback((signal: AbortSignal) => getImport(batchId, signal), [batchId]),
  );
  const refs = useAsyncResource(loadReferences);

  const goTo = useCallback(
    (step: ImportStep) => {
      router.replace(`/imports?batch=${batchId}&step=${step}`, { scroll: false });
    },
    [router, batchId],
  );

  if (batch.state.status === 'loading' || refs.state.status === 'loading') {
    return <PageSkeleton />;
  }
  if (batch.state.status === 'error') {
    return (
      <ErrorState
        title="This import could not be opened"
        description={describeRequestError(batch.state.error)}
        onRetry={batch.reload}
      />
    );
  }
  if (refs.state.status === 'error') {
    return (
      <ErrorState
        title="Your accounts and categories could not be loaded"
        description={describeRequestError(refs.state.error)}
        onRetry={refs.reload}
      />
    );
  }

  const detail = batch.state.data;
  const references = refs.state.data;
  const open = detail.status === 'mapping' || detail.status === 'reviewing';
  // Rows exist only once the columns are confirmed; a finished import is summarised.
  const step: ImportStep | 'summary' =
    detail.status === 'mapping'
      ? 'map'
      : open
        ? (requestedStep ?? 'review')
        : requestedStep === 'review'
          ? 'review'
          : 'summary';

  return (
    <>
      <WizardHeader batch={detail} />
      {open && (
        <Stepper
          current={step === 'summary' ? 'review' : step}
          mapped={detail.status === 'reviewing'}
          onSelect={goTo}
        />
      )}
      {step === 'map' && (
        <MappingStep
          batch={detail}
          onSaved={() => {
            // Reloaded (not refreshed in the background): the rows exist only now.
            batch.reload();
            goTo('review');
          }}
        />
      )}
      {step === 'review' && (
        <ReviewStep
          batch={detail}
          references={references}
          timeZone={user.timezone}
          readOnly={!open}
          onBatchChanged={batch.refresh}
          onContinue={() => {
            goTo('reconcile');
          }}
        />
      )}
      {step === 'reconcile' && (
        <ReconcileStep
          batch={detail}
          timeZone={user.timezone}
          onBatchChanged={batch.refresh}
          onBack={() => {
            goTo('review');
          }}
        />
      )}
      {step === 'summary' && <ImportSummary batch={detail} timeZone={user.timezone} />}
    </>
  );
}

function WizardHeader({ batch }: { batch: ImportBatchDetailDto }): ReactNode {
  const status = BATCH_STATUS_PRESENTATION[batch.status];
  const period = describePeriod(batch);
  return (
    <header className="flex flex-col gap-1.5">
      <StatusBadge tone={status.tone} className="self-start">
        {status.label}
      </StatusBadge>
      <h1 className="text-2xl font-semibold tracking-tight break-all md:text-3xl">
        {batch.fileName}
      </h1>
      <p className="text-pretty text-muted-foreground">
        Into {batch.account.name} ({batch.currency}){period === undefined ? '' : ` · ${period}`} ·{' '}
        {batch.totalRows} {batch.totalRows === 1 ? 'row' : 'rows'}
      </p>
    </header>
  );
}

function Stepper({
  current,
  mapped,
  onSelect,
}: {
  current: ImportStep;
  mapped: boolean;
  onSelect: (step: ImportStep) => void;
}): ReactNode {
  const steps = ['upload', ...IMPORT_STEPS] as const;
  const currentIndex = steps.indexOf(current);
  return (
    <nav aria-label="Import steps">
      <ol className="grid grid-cols-4 gap-1 sm:gap-2">
        {steps.map((step, index) => {
          const done = index < currentIndex;
          const active = step === current;
          const available = step !== 'upload' && (step === 'map' || mapped);
          const marker = (
            <>
              <span
                aria-hidden="true"
                className={cn(
                  'grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold tabular-nums',
                  active && 'border-primary bg-primary text-primary-foreground',
                  done && !active && 'border-primary/40 bg-accent text-accent-foreground',
                )}
              >
                {done ? <Check className="size-3.5" /> : index + 1}
              </span>
              <span className="text-center text-xs leading-tight font-medium sm:text-sm">
                {STEP_LABELS[step]}
              </span>
            </>
          );
          const className = cn(
            'flex w-full flex-col items-center gap-1.5 rounded-lg px-1 py-2 sm:flex-row sm:justify-center',
            active ? 'text-foreground' : 'text-muted-foreground',
          );
          return (
            <li key={step} className="min-w-0">
              {available && !active ? (
                <button
                  type="button"
                  className={cn(
                    className,
                    'outline-none hover:bg-muted/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring',
                  )}
                  onClick={() => {
                    onSelect(step);
                  }}
                >
                  {marker}
                </button>
              ) : (
                <span className={className} aria-current={active ? 'step' : undefined}>
                  {marker}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
