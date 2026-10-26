// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppearanceSettings } from '@/features/settings';
import { THEME_STORAGE_KEY } from '@/lib/preferences';

import { AppShell } from './app-shell';

const navigation = vi.hoisted(() => ({ pathname: '/budgets' }));
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

// jsdom has no media queries; the theme code asks whether the OS prefers dark mode.
function mockMatchMedia(prefersDark: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: prefersDark && query.includes('dark'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

beforeEach(() => {
  navigation.pathname = '/budgets';
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
  mockMatchMedia(false);
});

describe('AppShell with authentication', () => {
  it('keeps the mobile bottom navigation and renders the account slot', () => {
    render(
      <AppShell accountMenu={<button type="button">Account menu for Asha Rao</button>}>
        <p>Page</p>
      </AppShell>,
    );

    // The sidebar shares the label; CSS shows one of them per breakpoint.
    const bar = screen
      .getAllByRole('navigation', { name: 'Main navigation' })
      .find((nav) => within(nav).queryByRole('button', { name: 'More' }) !== null);
    if (bar === undefined) {
      throw new Error('The mobile bottom navigation is missing.');
    }
    const links = within(bar).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Home',
      'Transactions',
      'Budgets',
      'Accounts',
    ]);
    expect(within(bar).getByRole('link', { name: 'Budgets' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(within(bar).getByRole('button', { name: 'More' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Account menu for Asha Rao' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Change theme' })).toBeDefined();
  });

  it('opens the More sheet with the settings destination', async () => {
    render(
      <AppShell accountMenu={null}>
        <p>Page</p>
      </AppShell>,
    );

    await userEvent.setup().click(screen.getByRole('button', { name: 'More' }));

    const sheet = await screen.findByRole('dialog');
    expect(
      within(sheet)
        .getByRole('link', { name: /Settings/ })
        .getAttribute('href'),
    ).toBe('/settings');
  });
});

describe('theme preference', () => {
  it('applies and remembers the chosen theme on this device', async () => {
    render(<AppearanceSettings />);

    await userEvent.setup().click(screen.getByRole('radio', { name: /Dark/ }));

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });
});
