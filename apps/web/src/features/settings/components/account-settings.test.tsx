// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiError, createAuthValue, renderWithAuth, TEST_SESSION, TEST_USER } from '@/testing/auth';

import { ActiveSessions } from './active-sessions';
import { ChangePasswordForm } from './change-password-form';
import { ProfileSettings } from './profile-settings';

const services = vi.hoisted(() => ({
  updateProfile: vi.fn(),
  changePassword: vi.fn(),
  listSessions: vi.fn(),
  revokeSession: vi.fn(),
  revokeOtherSessions: vi.fn(),
}));
vi.mock('@/services/auth.service', () => services);

beforeEach(() => {
  for (const mock of Object.values(services)) {
    mock.mockReset();
  }
});

function valueOf(label: string): string {
  const element = screen.getByLabelText(label);
  return element instanceof HTMLInputElement || element instanceof HTMLSelectElement
    ? element.value
    : '';
}

describe('ProfileSettings', () => {
  it('is populated from the signed-in user returned by the API', () => {
    renderWithAuth(<ProfileSettings />);

    expect(valueOf('Display name')).toBe('Asha Rao');
    expect(valueOf('Preferred currency')).toBe('INR');
    expect(valueOf('Time zone')).toBe('Asia/Kolkata');
    expect(screen.getByText(TEST_USER.email)).toBeDefined();
    expect(screen.getByText('Verified')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Save profile' }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('saves changes and updates the signed-in user', async () => {
    const updated = { ...TEST_USER, name: 'Asha R.', preferredCurrency: 'USD' as const };
    services.updateProfile.mockResolvedValue(updated);
    const auth = createAuthValue();
    renderWithAuth(<ProfileSettings />, auth);
    const user = userEvent.setup();

    await user.clear(screen.getByLabelText('Display name'));
    await user.type(screen.getByLabelText('Display name'), 'Asha R.');
    await user.selectOptions(screen.getByLabelText('Preferred currency'), 'USD');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    expect(services.updateProfile).toHaveBeenCalledWith({
      name: 'Asha R.',
      preferredCurrency: 'USD',
      timezone: 'Asia/Kolkata',
    });
    expect(auth.updateUser).toHaveBeenCalledWith(updated);
    expect((await screen.findByRole('status')).textContent).toContain('Your profile was saved.');
  });

  it('can discard unsaved edits', async () => {
    renderWithAuth(<ProfileSettings />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Display name'), ' Jr');
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));

    expect(valueOf('Display name')).toBe('Asha Rao');
  });

  it('validates the name before saving', async () => {
    renderWithAuth(<ProfileSettings />);
    const user = userEvent.setup();

    await user.clear(screen.getByLabelText('Display name'));
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    expect(screen.getByText('Enter your name.')).toBeDefined();
    expect(services.updateProfile).not.toHaveBeenCalled();
  });
});

describe('ChangePasswordForm', () => {
  async function submit(current: string, next: string): Promise<void> {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Current password'), current);
    await user.type(screen.getByLabelText('New password'), next);
    await user.type(screen.getByLabelText('Confirm new password'), next);
    await user.click(screen.getByRole('button', { name: 'Change password' }));
  }

  it('adopts the rotated session after a successful change', async () => {
    const rotated = { ...TEST_SESSION, csrfToken: 'n'.repeat(43) };
    services.changePassword.mockResolvedValue(rotated);
    const auth = createAuthValue();
    renderWithAuth(<ChangePasswordForm />, auth);

    await submit('correct horse battery staple', 'a completely new passphrase');

    expect(auth.replaceSession).toHaveBeenCalledWith(rotated);
    expect((await screen.findByRole('status')).textContent).toContain(
      'Every other device has been signed out.',
    );
  });

  it('marks a wrong current password on its field', async () => {
    services.changePassword.mockRejectedValue(
      Object.assign(apiError('INVALID_CREDENTIALS', 'Your current password is incorrect.'), {
        details: [{ path: 'body.currentPassword', message: 'Your current password is incorrect.' }],
      }),
    );
    renderWithAuth(<ChangePasswordForm />);

    await submit('not my password', 'a completely new passphrase');

    expect(await screen.findByText('Your current password is incorrect.')).toBeDefined();
    expect(screen.getByLabelText('Current password').getAttribute('aria-invalid')).toBe('true');
  });
});

describe('ActiveSessions', () => {
  const sessions = [
    {
      id: TEST_SESSION.sessionId,
      deviceLabel: 'Chrome on Windows',
      createdAt: '2026-10-20T09:30:00.000Z',
      lastActiveAt: '2026-10-26T04:00:00.000Z',
      expiresAt: '2026-11-03T09:30:00.000Z',
      current: true,
    },
    {
      id: '0193a000-0000-7000-8000-000000000102',
      deviceLabel: 'Firefox on Android',
      createdAt: '2026-10-21T09:30:00.000Z',
      lastActiveAt: '2026-10-25T12:00:00.000Z',
      expiresAt: '2026-11-04T09:30:00.000Z',
      current: false,
    },
  ];

  it('lists sessions from the API and marks this device', async () => {
    services.listSessions.mockResolvedValue({ sessions });
    renderWithAuth(<ActiveSessions />);

    expect(await screen.findByText('Firefox on Android')).toBeDefined();
    expect(screen.getByText('This device')).toBeDefined();
    expect(screen.getAllByRole('button', { name: 'Sign out' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Sign out all other devices' })).toBeDefined();
  });

  it('signs out another device after confirmation', async () => {
    services.listSessions.mockResolvedValue({ sessions });
    services.revokeSession.mockResolvedValue({ revokedCount: 1 });
    renderWithAuth(<ActiveSessions />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    await user.click(await screen.findByRole('button', { name: 'Sign out device' }));

    expect(services.revokeSession).toHaveBeenCalledWith(sessions[1]?.id);
    expect(await screen.findByText('Firefox on Android was signed out.')).toBeDefined();
  });
});
