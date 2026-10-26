import type {
  AccountClassification,
  AccountColor,
  AccountType,
  AdjustmentDirection,
  PaymentMethod,
  TransactionType,
} from '@calmcash/shared';
import {
  Banknote,
  Briefcase,
  Car,
  Clapperboard,
  CreditCard,
  GraduationCap,
  HandCoins,
  HeartPulse,
  House,
  Landmark,
  Laptop,
  Percent,
  Plane,
  Repeat,
  RotateCcw,
  ShoppingBag,
  ShoppingBasket,
  Smartphone,
  Store,
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

/** Short labels for list rows (bank-statement wording). */
export const TRANSACTION_TYPE_LABELS: Readonly<Record<TransactionType, string>> = {
  income: 'Credit',
  expense: 'Debit',
  transfer: 'Transfer',
  balance_adjustment: 'Balance adjustment',
};

export interface TransactionTypePresentation {
  /** What the type selector and filters call it. */
  label: string;
  /** One line under the label in the type selector. */
  description: string;
}

export const TRANSACTION_TYPE_PRESENTATION: Readonly<
  Record<TransactionType, TransactionTypePresentation>
> = {
  expense: { label: 'Expense', description: 'Money you spent' },
  income: { label: 'Income', description: 'Money you received' },
  transfer: { label: 'Transfer', description: 'Between your own accounts' },
  balance_adjustment: { label: 'Adjust balance', description: 'Match what your bank shows' },
};

export const PAYMENT_METHOD_LABELS: Readonly<Record<PaymentMethod, string>> = {
  cash: 'Cash',
  upi: 'UPI',
  bank_transfer: 'Bank transfer',
  debit_card: 'Debit card',
  credit_card: 'Credit card',
  net_banking: 'Net banking',
  cheque: 'Cheque',
  digital_wallet: 'Digital wallet',
  direct_debit: 'Direct debit',
  other: 'Other',
};

/** How an adjustment reads for money held vs. money owed (a card's balance going up means less owed). */
export function describeAdjustmentDirection(
  direction: AdjustmentDirection,
  classification: AccountClassification,
): string {
  if (classification === 'liability') {
    return direction === 'increase' ? 'Amount owed goes down' : 'Amount owed goes up';
  }
  return direction === 'increase' ? 'Balance goes up' : 'Balance goes down';
}

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
  { keywords: ['flight', 'hotel', 'travel', 'trip'], icon: Plane, tone: 'chart-2' },
  { keywords: ['transport', 'fuel', 'commute', 'taxi'], icon: Car, tone: 'chart-2' },
  { keywords: ['bill', 'utilit', 'electric', 'internet'], icon: Zap, tone: 'chart-3' },
  { keywords: ['rent', 'home', 'housing'], icon: House, tone: 'chart-4' },
  { keywords: ['shopping', 'clothing'], icon: ShoppingBag, tone: 'chart-4' },
  { keywords: ['health', 'medical', 'pharmacy', 'medicine'], icon: HeartPulse, tone: 'chart-5' },
  { keywords: ['subscription', 'streaming', 'software'], icon: Repeat, tone: 'chart-3' },
  { keywords: ['entertain', 'movie', 'hobb'], icon: Clapperboard, tone: 'chart-2' },
  { keywords: ['education', 'course', 'book'], icon: GraduationCap, tone: 'chart-1' },
  { keywords: ['salary', 'payroll', 'wage'], icon: Briefcase, tone: 'chart-1' },
  { keywords: ['freelance', 'consult'], icon: Laptop, tone: 'chart-2' },
  { keywords: ['business'], icon: Store, tone: 'chart-4' },
  { keywords: ['interest', 'dividend'], icon: Percent, tone: 'chart-3' },
  { keywords: ['refund', 'cashback'], icon: RotateCcw, tone: 'chart-1' },
];

const FALLBACK_CATEGORY_VISUAL: CategoryVisual = { icon: Tag, tone: 'chart-2' };

/** Matches the category's name, then its parent's (a subcategory looks like its family). */
export function getCategoryVisual(
  category: { name: string; parentName?: string | undefined } | undefined,
): CategoryVisual {
  if (category === undefined) {
    return FALLBACK_CATEGORY_VISUAL;
  }
  for (const candidate of [category.name, category.parentName]) {
    const name = candidate?.toLowerCase();
    const rule =
      name === undefined
        ? undefined
        : CATEGORY_RULES.find((entry) => entry.keywords.some((keyword) => name.includes(keyword)));
    if (rule !== undefined) {
      return rule;
    }
  }
  return FALLBACK_CATEGORY_VISUAL;
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
