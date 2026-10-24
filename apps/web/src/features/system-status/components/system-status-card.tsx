'use client';

import type { ReactNode } from 'react';

import { outlineButtonClasses } from '@/components/ui/button-classes';
import { useAsyncResource } from '@/hooks/use-async-resource';
import { ApiClientError } from '@/lib/api-client';

import { loadSystemStatus, type SystemStatus } from '../load-system-status';

type Tone = 'neutral' | 'positive' | 'negative';

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-muted',
  positive: 'bg-positive',
  negative: 'bg-negative',
};

function StatusRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: Tone;
}): ReactNode {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-2 text-sm font-medium">
        <span aria-hidden="true" className={`size-2 rounded-full ${TONE_CLASSES[tone]}`} />
        {value}
      </dd>
    </div>
  );
}

function describeError(error: unknown): string {
  if (error instanceof ApiClientError) {
    return error.code === 'NETWORK_ERROR'
      ? 'The API is not reachable. Is `pnpm dev` running?'
      : error.message;
  }
  return 'Something went wrong while checking the system status.';
}

function StatusRows({ status }: { status: SystemStatus }): ReactNode {
  return (
    <>
      <StatusRow label="API" value="Online" tone="positive" />
      <StatusRow
        label="Database"
        value={status.database === 'connected' ? 'Connected' : 'Unavailable'}
        tone={status.database === 'connected' ? 'positive' : 'negative'}
      />
    </>
  );
}

/** Shows live connectivity between the web app, the API, and PostgreSQL. */
export function SystemStatusCard(): ReactNode {
  const { state, reload } = useAsyncResource(loadSystemStatus);

  return (
    <section
      aria-labelledby="system-status-heading"
      className="w-full rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-6"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 id="system-status-heading" className="text-base font-semibold">
          System status
        </h2>
        <button
          type="button"
          onClick={reload}
          disabled={state.status === 'loading'}
          className={outlineButtonClasses}
        >
          Check again
        </button>
      </div>

      <dl
        aria-live="polite"
        aria-busy={state.status === 'loading'}
        className="mt-2 divide-y divide-border"
      >
        <StatusRow label="Web app" value="Running" tone="positive" />
        {state.status === 'loading' && <StatusRow label="API" value="Checking…" tone="neutral" />}
        {state.status === 'success' && <StatusRows status={state.data} />}
        {state.status === 'error' && <StatusRow label="API" value="Offline" tone="negative" />}
      </dl>

      {state.status === 'error' && (
        <p role="alert" className="mt-3 text-sm text-negative">
          {describeError(state.error)}
        </p>
      )}
      {state.status === 'success' && (
        <p className="mt-3 text-xs text-muted-foreground">
          Last checked{' '}
          <time dateTime={state.data.checkedAt}>
            {new Date(state.data.checkedAt).toLocaleTimeString()}
          </time>
        </p>
      )}
    </section>
  );
}
