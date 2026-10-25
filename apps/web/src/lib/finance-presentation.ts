import type { AccountType, CategoryDto, TransactionType } from '@calmcash/shared';
import {
  Banknote,
  Briefcase,
  Car,
  Clapperboard,
  CreditCard,
  HandCoins,
  HeartPulse,
  House,
  Landmark,
  Laptop,
  Percent,
  ShoppingBag,
  ShoppingBasket,
  Smartphone,
  Tag,
  TrendingUp,
  UtensilsCrossed,
  Wallet,
  Zap,
  type LucideIcon,
} from 'lucide-react';

// Labels, icons, and colour tones for financial concepts. Pure presentation: these mappings take
// shared contracts as input and never change how data is stored.

export interface AccountTypePresentation {
  label: string;
  icon: LucideIcon;
}

export const ACCOUNT_TYPE_PRESENTATION: Readonly<Record<AccountType, AccountTypePresentation>> = {
  bank: { label: 'Bank account', icon: Landmark },
  credit_card: { label: 'Credit card', icon: CreditCard },
  cash: { label: 'Cash', icon: Banknote },
  digital_wallet: { label: 'Digital wallet', icon: Smartphone },
  investment: { label: 'Investment', icon: TrendingUp },
  loan: { label: 'Loan', icon: HandCoins },
  other: { label: 'Other', icon: Wallet },
};

export const TRANSACTION_TYPE_LABELS: Readonly<Record<TransactionType, string>> = {
  income: 'Credit',
  expense: 'Debit',
  transfer: 'Transfer',
};

/** Chart-palette slot used to tint a category's icon tile. */
export type CategoryTone = 'chart-1' | 'chart-2' | 'chart-3' | 'chart-4' | 'chart-5';

export interface CategoryVisual {
  icon: LucideIcon;
  tone: CategoryTone;
}

interface CategoryRule extends CategoryVisual {
  keywords: readonly string[];
}

// Categories are user-defined, so visuals are matched by keyword with a neutral fallback.
const CATEGORY_RULES: readonly CategoryRule[] = [
  { keywords: ['grocer', 'supermarket'], icon: ShoppingBasket, tone: 'chart-1' },
  { keywords: ['dining', 'food', 'restaurant', 'cafe'], icon: UtensilsCrossed, tone: 'chart-5' },
  { keywords: ['transport', 'fuel', 'travel', 'commute'], icon: Car, tone: 'chart-2' },
  { keywords: ['bill', 'utilit', 'electric', 'internet'], icon: Zap, tone: 'chart-3' },
  { keywords: ['rent', 'home', 'housing'], icon: House, tone: 'chart-4' },
  { keywords: ['shopping', 'clothing'], icon: ShoppingBag, tone: 'chart-4' },
  { keywords: ['health', 'medical', 'pharmacy'], icon: HeartPulse, tone: 'chart-5' },
  { keywords: ['entertain', 'movie', 'stream'], icon: Clapperboard, tone: 'chart-2' },
  { keywords: ['salary', 'payroll', 'wage'], icon: Briefcase, tone: 'chart-1' },
  { keywords: ['freelance', 'consult'], icon: Laptop, tone: 'chart-2' },
  { keywords: ['interest', 'dividend'], icon: Percent, tone: 'chart-3' },
];

const FALLBACK_CATEGORY_VISUAL: CategoryVisual = { icon: Tag, tone: 'chart-2' };

export function getCategoryVisual(category: Pick<CategoryDto, 'name'> | undefined): CategoryVisual {
  if (category === undefined) {
    return FALLBACK_CATEGORY_VISUAL;
  }
  const name = category.name.toLowerCase();
  const rule = CATEGORY_RULES.find((entry) =>
    entry.keywords.some((keyword) => name.includes(keyword)),
  );
  return rule ?? FALLBACK_CATEGORY_VISUAL;
}

/** Static class names per tone, so Tailwind can detect every utility at build time. */
export const CATEGORY_TONE_CLASSES: Readonly<Record<CategoryTone, string>> = {
  'chart-1': 'bg-chart-1/12 text-chart-1',
  'chart-2': 'bg-chart-2/12 text-chart-2',
  'chart-3': 'bg-chart-3/15 text-chart-3',
  'chart-4': 'bg-chart-4/12 text-chart-4',
  'chart-5': 'bg-chart-5/12 text-chart-5',
};

export const CATEGORY_BAR_CLASSES: Readonly<Record<CategoryTone, string>> = {
  'chart-1': 'bg-chart-1',
  'chart-2': 'bg-chart-2',
  'chart-3': 'bg-chart-3',
  'chart-4': 'bg-chart-4',
  'chart-5': 'bg-chart-5',
};
