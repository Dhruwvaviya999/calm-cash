'use client';

import type { NotificationDto, NotificationListFilter } from '@calmcash/shared';
import { BellOff, CheckCheck, Settings } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { EmptyState } from '@/components/feedback/empty-state';
import { ErrorState } from '@/components/feedback/error-state';
import { ListSkeleton } from '@/components/feedback/loading-skeleton';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { useSignedInSession } from '@/features/auth';
import { describeRequestError } from '@/lib/form-errors';
import { cn } from '@/lib/utils';
import {
  dismissNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/services/notifications.service';

import { useNotifications } from '../notifications-context';
import { NotificationItem } from './notification-item';

export const NOTIFICATION_PAGE_SIZE = 20;

type ListState =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'success'; items: NotificationDto[]; page: number; totalPages: number };

const FILTERS: readonly { value: NotificationListFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
];

/**
 * The notification center: every notification, newest first, a page at a time. Notifications are
 * read, followed, or dismissed here; what is created at all is decided in Settings.
 */
export function NotificationsPage(): ReactNode {
  const { user } = useSignedInSession();
  const { unreadCount, revision, notifyChanged, refreshCount } = useNotifications();
  const [filter, setFilter] = useState<NotificationListFilter>('all');
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyId, setBusyId] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | undefined>();

  // The first page; reloaded when the filter changes or notifications change elsewhere (the bell).
  useEffect(() => {
    const controller = new AbortController();
    listNotifications(
      { status: filter, page: 1, pageSize: NOTIFICATION_PAGE_SIZE },
      controller.signal,
    ).then(
      (page) => {
        if (controller.signal.aborted) return;
        setState({
          status: 'success',
          items: page.items,
          page: 1,
          totalPages: page.pagination.totalPages,
        });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ status: 'error', error });
      },
    );
    return () => {
      controller.abort();
    };
  }, [filter, attempt, revision]);

  const loadMore = async (): Promise<void> => {
    if (state.status !== 'success') return;
    setLoadingMore(true);
    setFailure(undefined);
    try {
      const next = await listNotifications({
        status: filter,
        page: state.page + 1,
        pageSize: NOTIFICATION_PAGE_SIZE,
      });
      setState((current) =>
        current.status === 'success'
          ? {
              status: 'success',
              // Skip anything already shown (a new notification can shift the pages).
              items: [
                ...current.items,
                ...next.items.filter((item) => !current.items.some((seen) => seen.id === item.id)),
              ],
              page: next.pagination.page,
              totalPages: next.pagination.totalPages,
            }
          : current,
      );
    } catch (error: unknown) {
      setFailure(describeRequestError(error));
    } finally {
      setLoadingMore(false);
    }
  };

  const change = useCallback(
    async (notification: NotificationDto, action: 'read' | 'dismiss'): Promise<void> => {
      setBusyId(notification.id);
      setFailure(undefined);
      try {
        if (action === 'read') {
          const updated = await markNotificationRead(notification.id);
          setState((current) =>
            current.status === 'success'
              ? {
                  ...current,
                  items:
                    filter === 'unread'
                      ? current.items.filter((item) => item.id !== updated.id)
                      : current.items.map((item) => (item.id === updated.id ? updated : item)),
                }
              : current,
          );
          refreshCount();
        } else {
          const result = await dismissNotification(notification.id);
          setState((current) =>
            current.status === 'success'
              ? { ...current, items: current.items.filter((item) => item.id !== notification.id) }
              : current,
          );
          refreshCount(result.unreadCount);
        }
      } catch (error: unknown) {
        setFailure(describeRequestError(error));
      } finally {
        setBusyId(undefined);
      }
    },
    [filter, refreshCount],
  );

  const markAll = async (): Promise<void> => {
    setBusyId('all');
    setFailure(undefined);
    try {
      notifyChanged((await markAllNotificationsRead()).unreadCount);
    } catch (error: unknown) {
      setFailure(describeRequestError(error));
    } finally {
      setBusyId(undefined);
    }
  };

  const now = new Date();
  return (
    <>
      <PageHeader
        title="Notifications"
        description="Budget alerts, payment reminders, and monthly summaries. Reminders describe what is expected — CalmCash never records or pays anything on its own."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 sm:h-9"
              disabled={busyId !== undefined || unreadCount === undefined || unreadCount === 0}
              onClick={() => void markAll()}
            >
              <CheckCheck aria-hidden="true" />
              Mark all as read
            </Button>
            <Button asChild variant="ghost" className="h-11 sm:h-9">
              <Link href={{ pathname: '/settings', hash: 'notifications' }}>
                <Settings aria-hidden="true" />
                Preferences
              </Link>
            </Button>
          </div>
        }
      />

      <div role="group" aria-label="Show" className="mt-6 inline-flex w-fit rounded-lg border p-1">
        {FILTERS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => {
              if (filter === value) return;
              setState({ status: 'loading' });
              setFilter(value);
            }}
            className={cn(
              'h-9 rounded-md px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring',
              filter === value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
            {value === 'unread' && unreadCount !== undefined && unreadCount > 0 && (
              <span> ({unreadCount})</span>
            )}
          </button>
        ))}
      </div>

      <section
        aria-label="Notification list"
        className="mt-4"
        aria-busy={state.status === 'loading'}
      >
        {state.status === 'loading' && (
          <div role="status">
            <span className="sr-only">Loading notifications…</span>
            <ListSkeleton rows={5} />
          </div>
        )}
        {state.status === 'error' && (
          <ErrorState
            title="Notifications could not be loaded"
            description={describeRequestError(state.error)}
            onRetry={() => {
              setState({ status: 'loading' });
              setAttempt((value) => value + 1);
            }}
          />
        )}
        {state.status === 'success' && state.items.length === 0 && (
          <EmptyState
            icon={BellOff}
            title={filter === 'unread' ? 'You’re all caught up' : 'No notifications yet'}
            description={
              filter === 'unread'
                ? 'Nothing unread. Older notifications are under “All”.'
                : 'Budget alerts, payment reminders, and monthly summaries will appear here once CalmCash has something to tell you.'
            }
          />
        )}
        {state.status === 'success' && state.items.length > 0 && (
          <>
            <ul className="flex flex-col gap-2">
              {state.items.map((notification) => (
                <li key={notification.id} className="rounded-xl border bg-card">
                  <NotificationItem
                    notification={notification}
                    timeZone={user.timezone}
                    now={now}
                    busy={busyId !== undefined}
                    onOpen={(item) => {
                      if (item.readAt === undefined) void change(item, 'read');
                    }}
                    onMarkRead={(item) => void change(item, 'read')}
                    onDismiss={(item) => void change(item, 'dismiss')}
                  />
                </li>
              ))}
            </ul>
            {state.page < state.totalPages && (
              <div className="mt-4 flex justify-center">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 sm:h-9"
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                >
                  {loadingMore ? 'Loading…' : 'Show older notifications'}
                </Button>
              </div>
            )}
          </>
        )}
        {failure !== undefined && (
          <p role="alert" className="mt-3 text-sm text-expense">
            {failure}
          </p>
        )}
      </section>
    </>
  );
}
