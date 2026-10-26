'use client';

import type { AuthSessionDto, LoginInput, UserDto } from '@calmcash/shared';
import { createContext, useContext } from 'react';

/** Why nobody is signed in: shapes the message and redirect on the sign-in page. */
export type UnauthenticatedReason = 'anonymous' | 'signed-out' | 'session-ended';

/**
 * The authentication lifecycle. Components must narrow on `status`; only `authenticated` carries
 * a session, so signed-out UI can never read a stale user.
 */
export type AuthState =
  | { status: 'loading' }
  | { status: 'authenticated'; session: AuthSessionDto }
  | { status: 'unauthenticated'; reason: UnauthenticatedReason }
  /** The session could not be checked (e.g. the API is unreachable); `retry` may recover. */
  | { status: 'error'; error: unknown };

export interface AuthContextValue {
  state: AuthState;
  /** Rejects with the `ApiClientError` from the API (invalid credentials, unverified, …). */
  signIn: (input: LoginInput) => Promise<AuthSessionDto>;
  /** Ends the session on the server first; rejects (and stays signed in) if that fails. */
  signOut: () => Promise<void>;
  /** Checks the session again after a recoverable error. */
  retry: () => void;
  /** Replaces the signed-in user after a profile update. */
  updateUser: (user: UserDto) => void;
  /** Adopts a rotated session (e.g. after a password change). */
  replaceSession: (session: AuthSessionDto) => void;
  /** Forgets the session locally after the server ended it (e.g. it was revoked). */
  endSession: (reason: UnauthenticatedReason) => void;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === undefined) {
    throw new Error('useAuth must be used inside <AuthProvider>.');
  }
  return value;
}

/**
 * The signed-in session, for components rendered inside `RequireAuth`. Throws if used where
 * nobody is signed in, which would be a programming error.
 */
export function useSignedInSession(): AuthSessionDto {
  const { state } = useAuth();
  if (state.status !== 'authenticated') {
    throw new Error('useSignedInSession must be used inside <RequireAuth>.');
  }
  return state.session;
}
