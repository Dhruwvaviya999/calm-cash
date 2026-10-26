// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { createAuthValue, renderWithAuth, TEST_SESSION } from '@/testing/auth';

import { getInitials, UserMenu } from './user-menu';

describe('getInitials', () => {
  it('uses up to two initials and handles empty names', () => {
    expect(getInitials('Asha Rao')).toBe('AR');
    expect(getInitials('  priya  ')).toBe('P');
    expect(getInitials('Ana María López')).toBe('AM');
    expect(getInitials('')).toBe('');
  });
});

describe('UserMenu', () => {
  it('shows a placeholder, not an invented identity, while the session is checked', () => {
    renderWithAuth(<UserMenu />, createAuthValue({ state: { status: 'loading' } }));

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the signed-in user and signs out', async () => {
    const signOut = vi.fn(() => Promise.resolve());
    renderWithAuth(<UserMenu />, createAuthValue({ signOut }));
    const user = userEvent.setup();

    const trigger = screen.getByRole('button', { name: 'Account menu for Asha Rao' });
    expect(trigger.textContent).toBe('AR');

    await user.click(trigger);
    expect(await screen.findByText(TEST_SESSION.user.email)).toBeDefined();
    expect(
      screen.getByRole('menuitem', { name: 'Profile and settings' }).getAttribute('href'),
    ).toBe('/settings');

    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalledOnce();
  });

  it('keeps the user informed when signing out fails', async () => {
    const signOut = vi.fn(() => Promise.reject(new Error('offline')));
    renderWithAuth(<UserMenu />, createAuthValue({ signOut }));
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Account menu for Asha Rao' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Could not sign out');
  });
});
