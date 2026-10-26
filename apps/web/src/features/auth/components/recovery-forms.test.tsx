// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiError, createAuthValue, renderWithAuth } from '@/testing/auth';

import { ForgotPasswordForm } from './forgot-password-form';
import { ResetPasswordForm } from './reset-password-form';
import { VerifyEmailPanel } from './verify-email-panel';

const navigation = vi.hoisted(() => ({ search: new URLSearchParams() }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => navigation.search,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const services = vi.hoisted(() => ({
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  verifyEmail: vi.fn(),
  resendVerificationEmail: vi.fn(),
}));
vi.mock('@/services/auth.service', () => services);

const TOKEN = 'R'.repeat(43);
const PASSWORD = 'a brand new passphrase';

beforeEach(() => {
  navigation.search = new URLSearchParams();
  for (const mock of Object.values(services)) {
    mock.mockReset();
  }
});

describe('ForgotPasswordForm', () => {
  it('confirms without revealing whether the account exists', async () => {
    services.requestPasswordReset.mockResolvedValue({ accepted: true });
    renderWithAuth(<ForgotPasswordForm />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Email address'), 'Someone@Example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(services.requestPasswordReset).toHaveBeenCalledWith('someone@example.com');
    expect(await screen.findByRole('heading', { name: 'Check your inbox' })).toBeDefined();
    expect(screen.getByText(/If an account exists for/)).toBeDefined();
  });

  it('validates the address', async () => {
    renderWithAuth(<ForgotPasswordForm />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(screen.getByText(/Enter a valid email address/)).toBeDefined();
    expect(services.requestPasswordReset).not.toHaveBeenCalled();
  });
});

describe('ResetPasswordForm', () => {
  async function submitNewPassword(): Promise<void> {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('New password'), PASSWORD);
    await user.type(screen.getByLabelText('Confirm new password'), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Save new password' }));
  }

  it('explains an incomplete link immediately', () => {
    navigation.search = new URLSearchParams({ token: 'truncated' });
    renderWithAuth(<ResetPasswordForm />);

    expect(screen.getByRole('heading', { name: 'This reset link cannot be used' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Request a new link' }).getAttribute('href')).toBe(
      '/forgot-password',
    );
  });

  it('resets the password and signs the user out locally', async () => {
    navigation.search = new URLSearchParams({ token: TOKEN });
    services.resetPassword.mockResolvedValue({ passwordReset: true });
    const auth = createAuthValue();
    renderWithAuth(<ResetPasswordForm />, auth);

    await submitNewPassword();

    expect(services.resetPassword).toHaveBeenCalledWith({
      token: TOKEN,
      password: PASSWORD,
      passwordConfirmation: PASSWORD,
    });
    expect(
      await screen.findByRole('heading', { name: 'Your password has been changed' }),
    ).toBeDefined();
    expect(auth.endSession).toHaveBeenCalled();
  });

  it('handles expired or used links', async () => {
    navigation.search = new URLSearchParams({ token: TOKEN });
    services.resetPassword.mockRejectedValue(apiError('INVALID_TOKEN', 'Expired.'));
    renderWithAuth(<ResetPasswordForm />);

    await submitNewPassword();

    expect(
      await screen.findByRole('heading', { name: 'This reset link cannot be used' }),
    ).toBeDefined();
  });

  it('shows validation errors for mismatched passwords', async () => {
    navigation.search = new URLSearchParams({ token: TOKEN });
    renderWithAuth(<ResetPasswordForm />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('New password'), PASSWORD);
    await user.type(screen.getByLabelText('Confirm new password'), `${PASSWORD}?`);
    await user.click(screen.getByRole('button', { name: 'Save new password' }));

    expect(screen.getByText('The passwords do not match.')).toBeDefined();
    expect(services.resetPassword).not.toHaveBeenCalled();
  });
});

describe('VerifyEmailPanel', () => {
  it('confirms the address with the token from the link', async () => {
    navigation.search = new URLSearchParams({ token: TOKEN });
    services.verifyEmail.mockResolvedValue({ emailVerified: true });
    renderWithAuth(<VerifyEmailPanel />);

    expect(
      await screen.findByRole('heading', { name: 'Your email address is confirmed' }),
    ).toBeDefined();
    expect(services.verifyEmail).toHaveBeenCalledOnce();
    expect(services.verifyEmail).toHaveBeenCalledWith(TOKEN);
  });

  it('offers a new link when the token cannot be used', async () => {
    navigation.search = new URLSearchParams({ token: 'V'.repeat(43) });
    services.verifyEmail.mockRejectedValue(apiError('INVALID_TOKEN', 'Expired.'));
    renderWithAuth(<VerifyEmailPanel />);

    expect(
      await screen.findByRole('heading', { name: 'This confirmation link cannot be used' }),
    ).toBeDefined();
    expect(screen.getByLabelText('Email address')).toBeDefined();
  });
});
