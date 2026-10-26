import type {
  AccountClassification,
  AccountColor,
  AccountType,
  CategoryDto,
  TransactionType,
} from '@calmcash/shared';
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
  Vault,
  Wallet,
  Zap,
  type LucideIcon,
} from 'lucide-react';

// Labels, icons, and colour tones for financial concepts. Pure presentation: these mappings take
// shared contracts as input and never change how data is stored.

export interface AccountTypePresentation {
  label: string;
  icon: LucideIcon;
  /** One-line explanation shown when choosing a type. */
  description: string;
}

export const ACCOUNT_TYPE_PRESENTATION: Readonly<Record<AccountType, AccountTypePresentation>> = {
  bank: { label: 'Bank account', icon: Landmark, description: 'Current or salary account' },
  savings: { label: 'Savings account', icon: Vault, description: 'Money set aside at a bank' },
  credit_card: { label: 'Credit card', icon: CreditCard, description: 'Tracks what you owe' },
  cash: { label: 'Cash', icon: Banknote, description: 'Notes and coins you carry' },
  digital_wallet: {
    label: 'Digital wallet',
    icon: Smartphone,
    description: 'UPI apps and prepaid wallets',
  },
  investment: { label: 'Investment', icon: TrendingUp, description: 'Investment account' },
  loan: { label: 'Loan', icon: HandCoins, description: 'Money borrowed' },
  other: { label: 'Other account', icon: Wallet, description: 'Any other place money lives' },
};

export const ACCOUNT_CLASSIFICATION_LABELS: Readonly<Record<AccountClassification, string>> = {
  asset: 'Money you hold',
  liability: 'Money you owe',
};

export interface AccountColorPresentation {
  label: string;
  /** Tinted icon tile. Static class names, so Tailwind can detect them. */
  tileClassName: string;
  /** Solid swatch for the colour picker. */
  swatchClassName: string;
}

/** Account accents reuse the chart palette, whose contrast is checked in both themes. */
export const ACCOUNT_COLOR_PRESENTATION: Readonly<Record<AccountColor, AccountColorPresentation>> =
  {
    green: {
      label: 'Green',
      tileClassName: 'bg-chart-1/12 text-chart-1',
      swatchClassName: 'bg-chart-1',
    },
    blue: {
      label: 'Blue',
      tileClassName: 'bg-chart-2/12 text-chart-2',
      swatchClassName: 'bg-chart-2',
    },
    amber: {
      label: 'Amber',
      tileClassName: 'bg-chart-3/15 text-chart-3',
      swatchClassName: 'bg-chart-3',
    },
    purple: {
      label: 'Purple',
      tileClassName: 'bg-chart-4/12 text-chart-4',
      swatchClassName: 'bg-chart-4',
    },
    coral: {
      label: 'Coral',
      tileClassName: 'bg-chart-5/12 text-chart-5',
      swatchClassName: 'bg-chart-5',
    },
    slate: {
      label: 'Slate',
      tileClassName: 'bg-muted text-muted-foreground',
      swatchClassName: 'bg-muted-foreground',
    },
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
