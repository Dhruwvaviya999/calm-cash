'use client';

import type { AuthSessionDto, UserDto } from '@calmcash/shared';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { ApiClientError } from '@/lib/api-client';
import { registerSessionHandlers, setCsrfToken } from '@/lib/session-store';
import { getCurrentSession, login, logout } from '@/services/auth.service';

import {
  AuthContext,
  type AuthContextValue,
  type AuthState,
  type UnauthenticatedReason,
} from './auth-context';

/** When a tab becomes visible again, re-check the session if it was last confirmed this long ago. */
const REVALIDATE_AFTER_MS = 60_000;

function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === 'UNAUTHORIZED';
}

/**
 * Owns the signed-in state for the whole app. It restores the session from the API on start (the
 * HttpOnly cookie is sent automatically), keeps the CSRF token in memory for the API client, and
 * reacts when the API reports that the session has ended. Nothing is stored in browser storage.
 */
export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const lastConfirmedAt = useRef(0);

  const applySession = useCallback((session: AuthSessionDto) => {
    setCsrfToken(session.csrfToken);
    lastConfirmedAt.current = Date.now();
    setState({ status: 'authenticated', session });
  }, []);

  const endSession = useCallback((reason: UnauthenticatedReason) => {
    setCsrfToken(undefined);
    setState({ status: 'unauthenticated', reason });
  }, []);

  // Restore the session on start and on retry.
  useEffect(() => {
    const controller = new AbortController();
    getCurrentSession(controller.signal).then(
      (session) => {
        if (!controller.signal.aborted) {
          applySession(session);
        }
      },
      (error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        if (isUnauthorized(error)) {
          endSession('anonymous');
        } else {
          setState({ status: 'error', error });
        }
      },
    );
    return () => {
      controller.abort();
    };
  }, [attempt, applySession, endSession]);

  // Let the API client report ended sessions and refresh the CSRF token.
  useEffect(
    () =>
      registerSessionHandlers({
        onSessionEnded: () => {
          setCsrfToken(undefined);
          setState((current) =>
            current.status === 'authenticated'
              ? { status: 'unauthenticated', reason: 'session-ended' }
              : current,
          );
        },
        refresh: async () => {
          try {
            applySession(await getCurrentSession());
            return true;
          } catch {
            return false;
          }
        },
      }),
    [applySession],
  );

  // Notice sessions revoked elsewhere (another device, another tab) when the user comes back.
  useEffect(() => {
    if (state.status !== 'authenticated') {
      return undefined;
    }
    const handleVisibility = (): void => {
      if (
        document.visibilityState === 'visible' &&
        Date.now() - lastConfirmedAt.current > REVALIDATE_AFTER_MS
      ) {
        getCurrentSession().then(applySession, () => {
          // An ended session is reported through `onSessionEnded`; other failures are transient.
        });
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [state.status, applySession]);

  const signIn = useCallback(
    async (input: Parameters<AuthContextValue['signIn']>[0]) => {
      const session = await login(input);
      applySession(session);
      return session;
    },
    [applySession],
  );

  const signOut = useCallback(async () => {
    try {
      await logout();
    } catch (error: unknown) {
      // Already signed out on the server: nothing left to end.
      if (!isUnauthorized(error)) {
        throw error;
      }
    }
    endSession('signed-out');
  }, [endSession]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((current) => current + 1);
  }, []);

  const updateUser = useCallback((user: UserDto) => {
    setState((current) =>
      current.status === 'authenticated'
        ? { status: 'authenticated', session: { ...current.session, user } }
        : current,
    );
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      signIn,
      signOut,
      retry,
      updateUser,
      replaceSession: applySession,
      endSession,
    }),
    [state, signIn, signOut, retry, updateUser, applySession, endSession],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}
