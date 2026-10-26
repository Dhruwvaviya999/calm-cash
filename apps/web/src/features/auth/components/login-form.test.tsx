// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiError, createAuthValue, renderWithAuth, TEST_SESSION } from '@/testing/auth';

import { LoginForm } from './login-form';

const navigation = vi.hoisted(() => ({ search: new URLSearchParams() }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => navigation.search,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

function unauthenticated(signIn = vi.fn(() => Promise.resolve(TEST_SESSION))): {
  value: ReturnType<typeof createAuthValue>;
  signIn: typeof signIn;
} {
  return {
    value: createAuthValue({ state: { status: 'unauthenticated', reason: 'anonymous' }, signIn }),
    signIn,
  };
}

async function fillAndSubmit(email: string, password: string): Promise<void> {
  const user = userEvent.setup();
  if (email !== '') {
    await user.type(screen.getByLabelText('Email address'), email);
  }
  if (password !== '') {
    await user.type(screen.getByLabelText('Password'), password);
  }
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

beforeEach(() => {
  navigation.search = new URLSearchParams();
});

describe('LoginForm', () => {
  it('renders accessible fields and links to recovery and registration', () => {
    renderWithAuth(<LoginForm />, unauthenticated().value);

    expect(screen.getByRole('heading', { level: 1, name: 'Sign in to CalmCash' })).toBeDefined();
    expect(screen.getByLabelText('Email address').getAttribute('autocomplete')).toBe('email');
    expect(screen.getByLabelText('Password').getAttribute('type')).toBe('password');
    expect(screen.getByRole('link', { name: 'Forgot password?' }).getAttribute('href')).toBe(
      '/forgot-password',
    );
    expect(screen.getByRole('link', { name: 'Create an account' }).getAttribute('href')).toBe(
      '/register',
    );
  });

  it('toggles password visibility', async () => {
    renderWithAuth(<LoginForm />, unauthenticated().value);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText('Password').getAttribute('type')).toBe('text');
    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(screen.getByLabelText('Password').getAttribute('type')).toBe('password');
  });

  it('shows validation messages without contacting the API', async () => {
    const { value, signIn } = unauthenticated();
    renderWithAuth(<LoginForm />, value);

    await fillAndSubmit('not-an-email', '');

    expect(screen.getByText(/Enter a valid email address/)).toBeDefined();
    expect(screen.getByText('Enter your password.')).toBeDefined();
    expect(screen.getByLabelText('Email address').getAttribute('aria-invalid')).toBe('true');
    expect(signIn).not.toHaveBeenCalled();
  });

  it('signs in with the normalised address', async () => {
    const { value, signIn } = unauthenticated();
    renderWithAuth(<LoginForm />, value);

    await fillAndSubmit('  Asha@Example.com ', 'correct horse battery staple');

    expect(signIn).toHaveBeenCalledWith({
      email: 'asha@example.com',
      password: 'correct horse battery staple',
    });
  });

  it('shows the server error for wrong credentials', async () => {
    const { value } = unauthenticated(
      vi.fn(() =>
        Promise.reject(
          apiError('INVALID_CREDENTIALS', 'The email address or password is incorrect.', 401),
        ),
      ),
    );
    renderWithAuth(<LoginForm />, value);

    await fillAndSubmit('asha@example.com', 'wrong password');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The email address or password is incorrect.');
    expect(screen.getByRole('button', { name: 'Sign in' }).hasAttribute('disabled')).toBe(false);
  });

  it('explains unverified accounts and offers a new confirmation link', async () => {
    const { value } = unauthenticated(
      vi.fn(() => Promise.reject(apiError('EMAIL_NOT_VERIFIED', 'Confirm first.', 403))),
    );
    renderWithAuth(<LoginForm />, value);

    await fillAndSubmit('asha@example.com', 'correct horse battery staple');

    expect(await screen.findByText('Confirm your email address first')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Send a new confirmation link' })).toBeDefined();
  });

  it('explains connection problems calmly', async () => {
    const { value } = unauthenticated(
      vi.fn(() => Promise.reject(apiError('NETWORK_ERROR', 'fetch failed', 0))),
    );
    renderWithAuth(<LoginForm />, value);

    await fillAndSubmit('asha@example.com', 'correct horse battery staple');

    expect((await screen.findByRole('alert')).textContent).toContain('could not be reached');
  });

  it('confirms a completed sign-out', () => {
    navigation.search = new URLSearchParams({ notice: 'signed-out' });
    renderWithAuth(<LoginForm />, unauthenticated().value);

    expect(screen.getByRole('status').textContent).toContain('You have signed out of CalmCash.');
  });
});
