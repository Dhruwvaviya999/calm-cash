'use client';

import { RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';

import { StatusBadge, type StatusTone } from '@/components/feedback/status-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAsyncResource } from '@/hooks/use-async-resource';
import { ApiClientError } from '@/lib/api-client';

import { loadSystemStatus, type SystemStatus } from '../load-system-status';

function StatusRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: StatusTone;
}): ReactNode {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd>
        <StatusBadge tone={tone}>{value}</StatusBadge>
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

/**
 * Live connectivity between the web app, the API, and PostgreSQL (a diagnostic, shown in
 * Settings). Failures are contained here: the rest of the app keeps working without the API.
 */
export function SystemStatusCard(): ReactNode {
  const { state, reload } = useAsyncResource(loadSystemStatus);

  return (
    <Card className="p-5 sm:p-6">
      <section aria-labelledby="system-status-heading">
        <div className="flex items-center justify-between gap-4">
          <h3 id="system-status-heading" className="font-semibold">
            System status
          </h3>
          <Button
            variant="outline"
            size="sm"
            onClick={reload}
            disabled={state.status === 'loading'}
          >
            <RefreshCw aria-hidden="true" />
            Check again
          </Button>
        </div>

        <dl aria-live="polite" aria-busy={state.status === 'loading'} className="mt-2 divide-y">
          <StatusRow label="Web app" value="Running" tone="positive" />
          {state.status === 'loading' && <StatusRow label="API" value="Checking…" tone="neutral" />}
          {state.status === 'success' && <StatusRows status={state.data} />}
          {state.status === 'error' && <StatusRow label="API" value="Offline" tone="negative" />}
        </dl>

        {state.status === 'error' && (
          <p role="alert" className="mt-3 text-sm text-expense">
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
    </Card>
  );
}
