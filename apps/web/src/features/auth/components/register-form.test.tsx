// @vitest-environment jsdom
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiError, renderWithAuth } from '@/testing/auth';

import { RegisterForm } from './register-form';

const services = vi.hoisted(() => ({
  register: vi.fn(),
  resendVerificationEmail: vi.fn(),
}));
vi.mock('@/services/auth.service', () => services);

const PASSWORD = 'correct horse battery staple';

async function fill(values: {
  name?: string;
  email?: string;
  password?: string;
  confirmation?: string;
}): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  if (values.name !== undefined) {
    await user.type(screen.getByLabelText('Your name'), values.name);
  }
  if (values.email !== undefined) {
    await user.type(screen.getByLabelText('Email address'), values.email);
  }
  if (values.password !== undefined) {
    await user.type(screen.getByLabelText('Password'), values.password);
  }
  if (values.confirmation !== undefined) {
    await user.type(screen.getByLabelText('Confirm password'), values.confirmation);
  }
  return user;
}

beforeEach(() => {
  services.register.mockReset();
  services.resendVerificationEmail.mockReset();
});

describe('RegisterForm', () => {
  it('shows the password requirements as the user types', async () => {
    renderWithAuth(<RegisterForm />);

    expect(screen.getByText(/At least 12 characters/).textContent).toContain('(not met yet)');
    await fill({ password: PASSWORD });
    expect(screen.getByText(/At least 12 characters/).textContent).toContain('(met)');
  });

  it('validates every field inline before submitting', async () => {
    renderWithAuth(<RegisterForm />);
    const user = await fill({ email: 'asha@', password: 'short', confirmation: 'different' });

    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(screen.getByText('Enter your name.')).toBeDefined();
    expect(screen.getByText(/Enter a valid email address/)).toBeDefined();
    expect(screen.getByText('Use at least 12 characters.')).toBeDefined();
    expect(screen.getByText('The passwords do not match.')).toBeDefined();
    expect(services.register).not.toHaveBeenCalled();
  });

  it('rejects easily guessed passwords', async () => {
    renderWithAuth(<RegisterForm />);
    const user = await fill({
      name: 'Asha',
      email: 'asha@example.com',
      password: 'password1234',
      confirmation: 'password1234',
    });

    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(screen.getByText(/too easy to guess/)).toBeDefined();
  });

  it('ends on a confirmation screen that asks the user to verify their address', async () => {
    services.register.mockResolvedValue({ email: 'asha@example.com', verificationRequired: true });
    renderWithAuth(<RegisterForm />);
    const user = await fill({
      name: 'Asha Rao',
      email: 'Asha@Example.com',
      password: PASSWORD,
      confirmation: PASSWORD,
    });

    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(services.register).toHaveBeenCalledWith({
      name: 'Asha Rao',
      email: 'asha@example.com',
      password: PASSWORD,
      passwordConfirmation: PASSWORD,
    });
    const heading = await screen.findByRole('heading', { level: 1, name: 'Check your inbox' });
    expect(heading).toBeDefined();
    expect(screen.getByText('asha@example.com')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Send a new confirmation link' })).toBeDefined();
  });

  it('shows server-side problems without losing the form', async () => {
    services.register.mockRejectedValue(
      apiError('EMAIL_DELIVERY_FAILED', 'We could not send the email right now.', 503),
    );
    renderWithAuth(<RegisterForm />);
    const user = await fill({
      name: 'Asha Rao',
      email: 'asha@example.com',
      password: PASSWORD,
      confirmation: PASSWORD,
    });

    await user.click(screen.getByRole('button', { name: 'Create account' }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('We could not send the email right now.')).toBeDefined();
    const name = screen.getByLabelText('Your name');
    expect(name instanceof HTMLInputElement && name.value).toBe('Asha Rao');
  });
});
