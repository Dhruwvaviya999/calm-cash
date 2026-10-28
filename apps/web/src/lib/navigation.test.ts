import { describe, expect, it } from 'vitest';

import {
  findActiveNavItem,
  getMobileBarItems,
  getMobileMoreItems,
  getNavItemsByGroup,
  NAV_GROUPS,
  NAV_ITEMS,
} from './navigation';

describe('navigation config', () => {
  it('has unique ids and routes', () => {
    expect(new Set(NAV_ITEMS.map((item) => item.id)).size).toBe(NAV_ITEMS.length);
    expect(new Set(NAV_ITEMS.map((item) => item.href)).size).toBe(NAV_ITEMS.length);
  });

  it('places every destination in exactly one sidebar group', () => {
    const grouped = NAV_GROUPS.flatMap((group) => getNavItemsByGroup(group.id));
    expect(grouped).toHaveLength(NAV_ITEMS.length);
  });

  it('gives mobile Home, Transactions, Budgets, Accounts, and puts the rest under More', () => {
    expect(getMobileBarItems().map((item) => item.mobileLabel)).toEqual([
      'Home',
      'Transactions',
      'Budgets',
      'Accounts',
    ]);
    expect(getMobileMoreItems().map((item) => item.id)).toEqual([
      'insights',
      'imports',
      'settings',
    ]);
  });
});

describe('findActiveNavItem', () => {
  it('matches a route and its sub-routes', () => {
    expect(findActiveNavItem('/transactions')?.id).toBe('transactions');
    expect(findActiveNavItem('/transactions/0193a000-0000-7000-8000-000000000301')?.id).toBe(
      'transactions',
    );
  });

  it('does not match routes that merely share a prefix', () => {
    expect(findActiveNavItem('/budgets-archive')).toBeUndefined();
    expect(findActiveNavItem('/')).toBeUndefined();
  });
});
