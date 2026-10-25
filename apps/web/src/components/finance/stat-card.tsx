import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export type StatTone = 'income' | 'expense' | 'savings' | 'neutral';

const TONE_CLASSES: Readonly<Record<StatTone, string>> = {
  income: 'bg-income/10 text-income',
  expense: 'bg-expense/10 text-expense',
  savings: 'bg-accent text-accent-foreground',
  neutral: 'bg-muted text-muted-foreground',
};

export interface StatCardProps {
  label: string;
  icon: LucideIcon;
  tone: StatTone;
  /** The headline value, usually a <FinancialAmount>. */
  value: ReactNode;
  /** Short supporting context, e.g. the period or a comparison. */
  footnote?: ReactNode;
  className?: string;
}

/** A single key figure with a label, icon, and short context. */
export function StatCard({
  label,
  icon: Icon,
  tone,
  value,
  footnote,
  className,
}: StatCardProps): ReactNode {
  return (
    <Card className={cn('flex flex-col gap-3 p-4 sm:p-5', className)}>
      <div className="flex items-center gap-2.5">
        <span
          className={cn('grid size-8 shrink-0 place-items-center rounded-lg', TONE_CLASSES[tone])}
        >
          <Icon aria-hidden="true" className="size-4" />
        </span>
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
      </div>
      <div className="min-w-0">{value}</div>
      {footnote !== undefined && <div className="text-xs text-muted-foreground">{footnote}</div>}
    </Card>
  );
}
