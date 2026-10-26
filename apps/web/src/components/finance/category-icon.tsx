import type { TransactionType } from '@calmcash/shared';
import { ArrowLeftRight, Scale } from 'lucide-react';
import type { ReactNode } from 'react';

import { CATEGORY_TONE_CLASSES, getCategoryVisual } from '@/lib/finance-presentation';
import { cn } from '@/lib/utils';

export interface CategoryIconProps {
  category?: { name: string; parentName?: string | undefined } | undefined;
  /** Transfers and balance adjustments have no category and get their own neutral symbols. */
  transactionType?: TransactionType;
  size?: 'sm' | 'md';
  className?: string;
}

const SIZE_CLASSES = {
  sm: 'size-8 rounded-lg [&_svg]:size-4',
  md: 'size-10 rounded-xl [&_svg]:size-5',
} as const;

/** Decorative tile identifying a category; the category name is always shown as text nearby. */
export function CategoryIcon({
  category,
  transactionType,
  size = 'md',
  className,
}: CategoryIconProps): ReactNode {
  if (transactionType === 'transfer' || transactionType === 'balance_adjustment') {
    const transfer = transactionType === 'transfer';
    return (
      <span
        aria-hidden="true"
        className={cn(
          'grid shrink-0 place-items-center',
          transfer ? 'bg-transfer/10 text-transfer' : 'bg-muted text-muted-foreground',
          SIZE_CLASSES[size],
          className,
        )}
      >
        {transfer ? <ArrowLeftRight /> : <Scale />}
      </span>
    );
  }

  const { icon: Icon, tone } = getCategoryVisual(category);
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center',
        CATEGORY_TONE_CLASSES[tone],
        SIZE_CLASSES[size],
        className,
      )}
    >
      <Icon />
    </span>
  );
}
