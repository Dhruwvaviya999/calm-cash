'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { useAuth } from '@/features/auth';
import { getUnreadNotificationCount } from '@/services/notifications.service';

// The unread count shared by the header bell and the notification center, so reading something in
// one place updates the other. It is fetched only for a signed-in user, refreshed every minute
// while the tab is visible and whenever it becomes visible again, and left unknown (never guessed)
// until the API answers.

export interface NotificationsContextValue {
  /** `undefined` until loaded, or when it could not be loaded. */
  unreadCount: number | undefined;
  /** Increments whenever notifications change in this tab, so open lists reload. */
  revision: number;
  /** Many changed (e.g. all marked read): record the new count if known; open lists reload. */
  notifyChanged: (unreadCount?: number) => void;
  /** One changed in a list that updated itself: record the new count if known, or re-read it. */
  refreshCount: (unreadCount?: number) => void;
}

const DISABLED: NotificationsContextValue = {
  unreadCount: undefined,
  revision: 0,
  notifyChanged: () => undefined,
  refreshCount: () => undefined,
};

const NotificationsContext = createContext<NotificationsContextValue>(DISABLED);

export const UNREAD_REFRESH_MS = 60_000;

export function NotificationsProvider({ children }: { children: ReactNode }): ReactNode {
  const { state } = useAuth();
  const signedIn = state.status === 'authenticated';
  const [unreadCount, setUnreadCount] = useState<number | undefined>();
  const [revision, setRevision] = useState(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!signedIn) {
      return;
    }
    const controller = new AbortController();
    getUnreadNotificationCount(controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) setUnreadCount(result.unreadCount);
      },
      () => {
        // The bell shows no count rather than a wrong one; the rest of the app is unaffected.
        if (!controller.signal.aborted) setUnreadCount(undefined);
      },
    );
    return () => {
      controller.abort();
    };
  }, [signedIn, attempt, revision]);

  useEffect(() => {
    if (!signedIn) {
      return;
    }
    const refresh = (): void => {
      if (document.visibilityState === 'visible') setAttempt((value) => value + 1);
    };
    const timer = window.setInterval(refresh, UNREAD_REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [signedIn]);

  const notifyChanged = useCallback((count?: number) => {
    if (count !== undefined) setUnreadCount(count);
    setRevision((value) => value + 1);
  }, []);

  const refreshCount = useCallback((count?: number) => {
    if (count === undefined) {
      setAttempt((value) => value + 1);
    } else {
      setUnreadCount(count);
    }
  }, []);

  const value = useMemo<NotificationsContextValue>(
    () => (signedIn ? { unreadCount, revision, notifyChanged, refreshCount } : DISABLED),
    [signedIn, unreadCount, revision, notifyChanged, refreshCount],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications(): NotificationsContextValue {
  return useContext(NotificationsContext);
}
