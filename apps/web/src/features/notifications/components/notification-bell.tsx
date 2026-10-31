'use client';

import type { NotificationDto } from '@calmcash/shared';
import { Bell, CheckCheck } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { ListSkeleton } from '@/components/feedback/loading-skeleton';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAuth } from '@/features/auth';
import { describeRequestError } from '@/lib/form-errors';
import { cn } from '@/lib/utils';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/services/notifications.service';
import type { AsyncState } from '@/types/async-state';

import { badgeText, bellLabel } from '../notification-presentation';
import { useNotifications } from '../notifications-context';
import { NotificationItem } from './notification-item';

const PREVIEW_SIZE = 5;

function BellIcon({ unreadCount }: { unreadCount: number | undefined }): ReactNode {
  return (
    <>
      <Bell aria-hidden="true" className="size-5" />
      {unreadCount !== undefined && unreadCount > 0 && (
        <span
          aria-hidden="true"
          className="absolute top-1 right-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[0.625rem] leading-none font-semibold text-primary-foreground"
        >
          {badgeText(unreadCount)}
        </span>
      )}
    </>
  );
}

/** The most recent notifications, inside the desktop popover. */
function NotificationPreview({
  timeZone,
  onNavigate,
}: {
  timeZone: string;
  onNavigate: () => void;
}): ReactNode {
  const { unreadCount, revision, notifyChanged } = useNotifications();
  const [state, setState] = useState<AsyncState<NotificationDto[]>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();

  useEffect(() => {
    const controller = new AbortController();
    listNotifications({ status: 'all', page: 1, pageSize: PREVIEW_SIZE }, controller.signal).then(
      (page) => {
        if (!controller.signal.aborted) setState({ status: 'success', data: page.items });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ status: 'error', error });
      },
    );
    return () => {
      controller.abort();
    };
  }, [attempt, revision]);

  const markRead = useCallback(
    async (notification: NotificationDto): Promise<void> => {
      setBusy(true);
      setFailure(undefined);
      try {
        await markNotificationRead(notification.id);
        notifyChanged();
      } catch (error: unknown) {
        setFailure(describeRequestError(error));
      } finally {
        setBusy(false);
      }
    },
    [notifyChanged],
  );

  const markAll = async (): Promise<void> => {
    setBusy(true);
    setFailure(undefined);
    try {
      notifyChanged((await markAllNotificationsRead()).unreadCount);
    } catch (error: unknown) {
      setFailure(describeRequestError(error));
    } finally {
      setBusy(false);
    }
  };

  const now = new Date();
  return (
    <div className="flex max-h-[min(32rem,var(--radix-popover-content-available-height))] flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="font-semibold">Notifications</h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy || unreadCount === undefined || unreadCount === 0}
          onClick={() => void markAll()}
        >
          <CheckCheck aria-hidden="true" />
          Mark all as read
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2" aria-live="polite">
        {state.status === 'loading' && (
          <div role="status">
            <span className="sr-only">Loading notifications…</span>
            <ListSkeleton rows={3} />
          </div>
        )}
        {state.status === 'error' && (
          <div role="alert" className="flex flex-col items-start gap-2 p-2 text-sm">
            <p>{describeRequestError(state.error)}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setState({ status: 'loading' });
                setAttempt((value) => value + 1);
              }}
            >
              Try again
            </Button>
          </div>
        )}
        {state.status === 'success' && state.data.length === 0 && (
          <p className="p-4 text-center text-sm text-muted-foreground">
            You&apos;re all caught up. Budget alerts, payment reminders, and monthly summaries will
            appear here.
          </p>
        )}
        {state.status === 'success' && state.data.length > 0 && (
          <ul className="flex flex-col gap-1">
            {state.data.map((notification) => (
              <li key={notification.id}>
                <NotificationItem
                  notification={notification}
                  timeZone={timeZone}
                  now={now}
                  compact
                  busy={busy}
                  onMarkRead={(item) => void markRead(item)}
                  onOpen={(item) => {
                    if (item.readAt === undefined) void markRead(item);
                    onNavigate();
                  }}
                />
              </li>
            ))}
          </ul>
        )}
        {failure !== undefined && (
          <p role="alert" className="px-2 pt-2 text-xs text-expense">
            {failure}
          </p>
        )}
      </div>
      <div className="border-t p-2">
        <Link
          href="/notifications"
          onClick={onNavigate}
          className="flex h-10 items-center justify-center rounded-md text-sm font-medium text-primary hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        >
          View all notifications
        </Link>
      </div>
    </div>
  );
}

/**
 * The header's notification control. Desktop and tablet: a popover with the latest notifications.
 * Phones: a link to the notification center page (a full page reads better than a small popover).
 * The count appears only once the API has answered — never a placeholder number.
 */
export function NotificationBell(): ReactNode {
  const { state } = useAuth();
  const { unreadCount } = useNotifications();
  const [open, setOpen] = useState(false);

  if (state.status !== 'authenticated') {
    return <span className="size-10" aria-hidden="true" />;
  }

  const label = bellLabel(unreadCount);
  const buttonClass =
    'relative grid size-10 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring data-[state=open]:bg-muted';

  return (
    <>
      <Link href="/notifications" aria-label={label} className={cn(buttonClass, 'md:hidden')}>
        <BellIcon unreadCount={unreadCount} />
      </Link>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger aria-label={label} className={cn(buttonClass, 'hidden md:grid')}>
          <BellIcon unreadCount={unreadCount} />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
          <NotificationPreview
            timeZone={state.session.user.timezone}
            onNavigate={() => {
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </>
  );
}
