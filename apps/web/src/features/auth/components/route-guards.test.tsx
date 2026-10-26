// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAuthValue, renderWithAuth, TEST_SESSION } from '@/testing/auth';

import type { AuthState } from '../auth-context';
import { GuestOnly } from './guest-only';
import { RequireAuth } from './require-auth';

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  pathname: '/budgets',
  search: new URLSearchParams(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: navigation.replace, push: vi.fn() }),
  usePathname: () => navigation.pathname,
  useSearchParams: () => navigation.search,
}));

const PROTECTED = <p>Protected budgets</p>;

function renderGuard(state: AuthState, retry = vi.fn()): void {
  renderWithAuth(<RequireAuth>{PROTECTED}</RequireAuth>, createAuthValue({ state, retry }));
}

beforeEach(() => {
  navigation.replace.mockReset();
  navigation.pathname = '/budgets';
  navigation.search = new URLSearchParams();
});

describe('RequireAuth', () => {
  it('shows a neutral placeholder, never the page, while the session is checked', () => {
    renderGuard({ status: 'loading' });

    expect(screen.queryByText('Protected budgets')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Loading');
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it('sends signed-out visitors to sign in and remembers where they were going', () => {
    renderGuard({ status: 'unauthenticated', reason: 'anonymous' });

    expect(screen.queryByText('Protected budgets')).toBeNull();
    expect(navigation.replace).toHaveBeenCalledWith('/login?next=%2Fbudgets');
  });

  it('explains an ended session on the sign-in page', () => {
    renderGuard({ status: 'unauthenticated', reason: 'session-ended' });

    expect(navigation.replace).toHaveBeenCalledWith('/login?next=%2Fbudgets&notice=session-ended');
  });

  it('returns to the public sign-in state after signing out', () => {
    renderGuard({ status: 'unauthenticated', reason: 'signed-out' });

    expect(navigation.replace).toHaveBeenCalledWith('/login?notice=signed-out');
  });

  it('renders the page for a signed-in user', () => {
    renderGuard({ status: 'authenticated', session: TEST_SESSION });

    expect(screen.getByText('Protected budgets')).toBeDefined();
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it('offers a retry when the session could not be checked', async () => {
    const retry = vi.fn();
    renderGuard({ status: 'error', error: new Error('offline') }, retry);

    expect(screen.queryByText('Protected budgets')).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe('GuestOnly', () => {
  it('shows the public page to signed-out visitors', () => {
    renderWithAuth(
      <GuestOnly>
        <p>Sign-in form</p>
      </GuestOnly>,
      createAuthValue({ state: { status: 'unauthenticated', reason: 'anonymous' } }),
    );

    expect(screen.getByText('Sign-in form')).toBeDefined();
  });

  it('sends signed-in users to their validated destination', () => {
    navigation.search = new URLSearchParams({ next: '/accounts' });
    renderWithAuth(
      <GuestOnly>
        <p>Sign-in form</p>
      </GuestOnly>,
    );

    expect(screen.queryByText('Sign-in form')).toBeNull();
    expect(navigation.replace).toHaveBeenCalledWith('/accounts');
  });

  it('never follows a destination outside the app', () => {
    navigation.search = new URLSearchParams({ next: '//evil.example/phish' });
    renderWithAuth(
      <GuestOnly>
        <p>Sign-in form</p>
      </GuestOnly>,
    );

    expect(navigation.replace).toHaveBeenCalledWith('/dashboard');
  });
});
