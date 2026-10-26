'use client';

import type { SessionDto } from '@calmcash/shared';
import { LogOut, Monitor, RefreshCw, Smartphone } from 'lucide-react';
import { useCallback, useState, type ReactNode } from 'react';

import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { ListSkeleton } from '@/components/feedback/loading-skeleton';
import { StatusBadge } from '@/components/feedback/status-badge';
import { FormMessage } from '@/components/forms/form-message';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useSignedInSession } from '@/features/auth';
import { useAsyncResource } from '@/hooks/use-async-resource';
import { formatDateTime } from '@/lib/format';
import { describeRequestError } from '@/lib/form-errors';
import { listSessions, revokeOtherSessions, revokeSession } from '@/services/auth.service';

const MOBILE_SYSTEMS = /\b(?:Android|iOS|iPadOS)\b/;

type Feedback = { tone: 'success' | 'error'; message: string } | undefined;

function SessionRow({
  session,
  timeZone,
  onRevoke,
  busy,
}: {
  session: SessionDto;
  timeZone: string;
  onRevoke: (session: SessionDto) => void;
  busy: boolean;
}): ReactNode {
  const label = session.deviceLabel ?? 'Unknown device';
  const Icon =
    session.deviceLabel !== undefined && MOBILE_SYSTEMS.test(label) ? Smartphone : Monitor;

  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-foreground">
          <Icon aria-hidden="true" className="size-5" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            {label}
            {session.current && <StatusBadge tone="positive">This device</StatusBadge>}
          </p>
          <dl className="grid gap-x-4 gap-y-0.5 text-sm text-muted-foreground sm:grid-cols-[auto_1fr]">
            <dt>Signed in</dt>
            <dd>
              <time dateTime={session.createdAt}>
                {formatDateTime(session.createdAt, timeZone)}
              </time>
            </dd>
            <dt>Last active</dt>
            <dd>
              <time dateTime={session.lastActiveAt}>
                {formatDateTime(session.lastActiveAt, timeZone)}
              </time>
            </dd>
            <dt>Ends at the latest</dt>
            <dd>
              <time dateTime={session.expiresAt}>
                {formatDateTime(session.expiresAt, timeZone)}
              </time>
            </dd>
          </dl>
        </div>
      </div>
      {!session.current && (
        <ConfirmDialog
          trigger={
            <Button
              variant="outline"
              size="sm"
              className="h-10 self-start sm:h-8 sm:self-center"
              disabled={busy}
            >
              <LogOut aria-hidden="true" />
              Sign out
            </Button>
          }
          title={`Sign out ${label}?`}
          description="That device will need to sign in again before it can open CalmCash."
          confirmLabel="Sign out device"
          destructive
          onConfirm={() => {
            onRevoke(session);
          }}
        />
      )}
    </li>
  );
}

/** Where the user is signed in, with per-device sign-out and "sign out everywhere else". */
export function ActiveSessions(): ReactNode {
  const { sessionId, user } = useSignedInSession();
  // Reloads whenever this device's session changes (e.g. rotated by a password change).
  const load = useCallback(
    async (signal: AbortSignal) => {
      const { sessions } = await listSessions(signal);
      return [...sessions].sort((a, b) => Number(b.id === sessionId) - Number(a.id === sessionId));
    },
    [sessionId],
  );
  const { state, reload } = useAsyncResource(load);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>();

  const run = async (action: () => Promise<string>): Promise<void> => {
    setBusy(true);
    setFeedback(undefined);
    try {
      setFeedback({ tone: 'success', message: await action() });
      reload();
    } catch (error: unknown) {
      setFeedback({ tone: 'error', message: describeRequestError(error) });
    } finally {
      setBusy(false);
    }
  };

  const others = state.status === 'success' ? state.data.filter((session) => !session.current) : [];

  return (
    <Card className="p-5 sm:p-6">
      <section aria-labelledby="sessions-list-heading" className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <h3 id="sessions-list-heading" className="font-semibold">
            Signed-in devices
          </h3>
          <Button
            variant="outline"
            size="sm"
            onClick={reload}
            disabled={state.status === 'loading' || busy}
          >
            <RefreshCw aria-hidden="true" />
            Refresh
          </Button>
        </div>

        {feedback !== undefined && (
          <FormMessage tone={feedback.tone}>{feedback.message}</FormMessage>
        )}

        <div aria-live="polite" aria-busy={state.status === 'loading'}>
          {state.status === 'loading' && <ListSkeleton rows={2} />}
          {state.status === 'error' && (
            <FormMessage tone="error" title="Your sessions could not be loaded">
              {describeRequestError(state.error)}
            </FormMessage>
          )}
          {state.status === 'success' && (
            <ul className="flex flex-col divide-y">
              {state.data.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  timeZone={user.timezone}
                  busy={busy}
                  onRevoke={(target) => {
                    void run(async () => {
                      await revokeSession(target.id);
                      return `${target.deviceLabel ?? 'The device'} was signed out.`;
                    });
                  }}
                />
              ))}
            </ul>
          )}
        </div>

        {others.length > 0 && (
          <div className="border-t pt-4">
            <ConfirmDialog
              trigger={
                <Button variant="outline" className="h-11 w-full sm:h-9 sm:w-auto" disabled={busy}>
                  <LogOut aria-hidden="true" />
                  Sign out all other devices
                </Button>
              }
              title="Sign out all other devices?"
              description="Every device except this one will need to sign in again. Use this if you signed in somewhere you no longer trust."
              confirmLabel="Sign out other devices"
              destructive
              onConfirm={() => {
                void run(async () => {
                  const { revokedCount } = await revokeOtherSessions();
                  return revokedCount === 1
                    ? 'One other device was signed out.'
                    : `${revokedCount} other devices were signed out.`;
                });
              }}
            />
          </div>
        )}
      </section>
    </Card>
  );
}
