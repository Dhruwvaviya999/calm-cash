import {
  ArrowLeftRight,
  Bot,
  FlaskConical,
  FileUp,
  LayoutDashboard,
  PiggyBank,
  Settings,
  Sparkles,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';
import type { Route } from 'next';

// The single source of truth for app navigation. The desktop sidebar, the mobile bottom bar,
// the mobile "More" sheet, and the header context all read from this list.

export type NavItemId =
  | 'dashboard'
  | 'transactions'
  | 'imports'
  | 'budgets'
  | 'accounts'
  | 'insights'
  | 'scenarios'
  | 'assistant'
  | 'settings';
export type NavGroupId = 'overview' | 'manage' | 'system';

export interface NavItem {
  id: NavItemId;
  href: Route;
  label: string;
  /** Label in the mobile bottom bar, where space is tight. */
  mobileLabel: string;
  /** One-line explanation used in the mobile "More" sheet. */
  description: string;
  icon: LucideIcon;
  group: NavGroupId;
  /** `bar`: a bottom-bar destination on mobile; `more`: listed in the "More" sheet. */
  mobilePlacement: 'bar' | 'more';
}

export interface NavGroup {
  id: NavGroupId;
  label: string;
}

export const NAV_GROUPS: readonly NavGroup[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'manage', label: 'Manage' },
  { id: 'system', label: 'System' },
];

export const NAV_ITEMS: readonly NavItem[] = [
  {
    id: 'dashboard',
    href: '/dashboard',
    label: 'Dashboard',
    mobileLabel: 'Home',
    description: 'Your money at a glance',
    icon: LayoutDashboard,
    group: 'overview',
    mobilePlacement: 'bar',
  },
  {
    id: 'insights',
    href: '/insights',
    label: 'Insights',
    mobileLabel: 'Insights',
    description: 'Patterns and trends in your spending',
    icon: Sparkles,
    group: 'overview',
    mobilePlacement: 'more',
  },
  {
    id: 'scenarios',
    href: '/scenarios',
    label: 'Scenarios',
    mobileLabel: 'Scenarios',
    description: 'Try a what-if without changing anything',
    icon: FlaskConical,
    group: 'overview',
    mobilePlacement: 'more',
  },
  {
    id: 'assistant',
    href: '/assistant',
    label: 'Assistant',
    mobileLabel: 'Assistant',
    description: 'Ask about your money in plain words',
    icon: Bot,
    group: 'overview',
    mobilePlacement: 'more',
  },
  {
    id: 'transactions',
    href: '/transactions',
    label: 'Transactions',
    mobileLabel: 'Transactions',
    description: 'Every debit and credit, explained',
    icon: ArrowLeftRight,
    group: 'manage',
    mobilePlacement: 'bar',
  },
  {
    id: 'imports',
    href: '/imports',
    label: 'Statement imports',
    mobileLabel: 'Imports',
    description: 'Bring in a bank statement, row by row',
    icon: FileUp,
    group: 'manage',
    mobilePlacement: 'more',
  },
  {
    id: 'budgets',
    href: '/budgets',
    label: 'Budgets',
    mobileLabel: 'Budgets',
    description: 'Budgets, bills, subscriptions, and goals',
    icon: PiggyBank,
    group: 'manage',
    mobilePlacement: 'bar',
  },
  {
    id: 'accounts',
    href: '/accounts',
    label: 'Accounts',
    mobileLabel: 'Accounts',
    description: 'Bank accounts, cards, cash, and wallets',
    icon: WalletCards,
    group: 'manage',
    mobilePlacement: 'bar',
  },
  {
    id: 'settings',
    href: '/settings',
    label: 'Settings',
    mobileLabel: 'Settings',
    description: 'Profile, security, and appearance',
    icon: Settings,
    group: 'system',
    mobilePlacement: 'more',
  },
];

/** Order of the four route destinations in the mobile bottom bar (the fifth slot is "More"). */
const MOBILE_BAR_ORDER: readonly NavItemId[] = ['dashboard', 'transactions', 'budgets', 'accounts'];

/** True when `pathname` is the item's route or one of its sub-routes. */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function findActiveNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => isNavItemActive(item, pathname));
}

export function getNavItemsByGroup(group: NavGroupId): NavItem[] {
  return NAV_ITEMS.filter((item) => item.group === group);
}

export function getMobileBarItems(): NavItem[] {
  return MOBILE_BAR_ORDER.flatMap((id) => NAV_ITEMS.filter((item) => item.id === id));
}

export function getMobileMoreItems(): NavItem[] {
  return NAV_ITEMS.filter((item) => item.mobilePlacement === 'more');
}

export function getNavGroupLabel(group: NavGroupId): string {
  return NAV_GROUPS.find((entry) => entry.id === group)?.label ?? '';
}
