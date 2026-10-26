// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getCsrfToken, notifySessionEnded, setCsrfToken } from '@/lib/session-store';
import { apiError, TEST_SESSION } from '@/testing/auth';

import { useAuth } from './auth-context';
import { AuthProvider } from './auth-provider';

const services = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
}));
vi.mock('@/services/auth.service', () => services);

function Probe(): ReactNode {
  const { state, signOut } = useAuth();
  return (
    <div>
      <p data-testid="status">
        {state.status}
        {state.status === 'unauthenticated' ? `:${state.reason}` : ''}
      </p>
      {state.status === 'authenticated' && <p>{state.session.user.name}</p>}
      <button type="button" onClick={() => void signOut()}>
        Sign out
      </button>
    </div>
  );
}

function renderProvider(): void {
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

const status = (): string | null => screen.getByTestId('status').textContent;

beforeEach(() => {
  for (const mock of Object.values(services)) {
    mock.mockReset();
  }
  setCsrfToken(undefined);
});

describe('AuthProvider', () => {
  it('starts loading, then restores the session from the API and keeps the CSRF token in memory', async () => {
    services.getCurrentSession.mockResolvedValue(TEST_SESSION);
    renderProvider();

    expect(status()).toBe('loading');
    expect(await screen.findByText('Asha Rao')).toBeDefined();
    expect(status()).toBe('authenticated');
    expect(getCsrfToken()).toBe(TEST_SESSION.csrfToken);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('treats a missing session as signed out', async () => {
    services.getCurrentSession.mockRejectedValue(apiError('UNAUTHORIZED', 'No session.', 401));
    renderProvider();

    await vi.waitFor(() => {
      expect(status()).toBe('unauthenticated:anonymous');
    });
  });

  it('reports an unreachable API as a recoverable error', async () => {
    services.getCurrentSession.mockRejectedValue(apiError('NETWORK_ERROR', 'offline', 0));
    renderProvider();

    await vi.waitFor(() => {
      expect(status()).toBe('error');
    });
  });

  it('signs out when the API reports that the session ended', async () => {
    services.getCurrentSession.mockResolvedValue(TEST_SESSION);
    renderProvider();
    await screen.findByText('Asha Rao');

    act(() => {
      notifySessionEnded();
    });

    expect(status()).toBe('unauthenticated:session-ended');
    expect(screen.queryByText('Asha Rao')).toBeNull();
    expect(getCsrfToken()).toBeUndefined();
  });

  it('ends the session on the server before forgetting it locally', async () => {
    services.getCurrentSession.mockResolvedValue(TEST_SESSION);
    services.logout.mockResolvedValue({ signedOut: true });
    renderProvider();
    await screen.findByText('Asha Rao');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));

    expect(services.logout).toHaveBeenCalledOnce();
    expect(status()).toBe('unauthenticated:signed-out');
    expect(getCsrfToken()).toBeUndefined();
  });
});
