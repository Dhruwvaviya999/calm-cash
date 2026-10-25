import {
  CircleAlert,
  CircleCheck,
  Clock,
  Info,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type StatusTone = 'positive' | 'warning' | 'negative' | 'info' | 'neutral' | 'upcoming';

const TONES: Readonly<Record<StatusTone, { className: string; icon: LucideIcon }>> = {
  positive: { className: 'bg-income/10 text-income ring-income/25', icon: CircleCheck },
  warning: { className: 'bg-warning/15 text-warning-text ring-warning/40', icon: TriangleAlert },
  negative: { className: 'bg-expense/10 text-expense ring-expense/25', icon: CircleAlert },
  info: { className: 'bg-transfer/10 text-transfer ring-transfer/25', icon: Info },
  neutral: { className: 'bg-muted text-muted-foreground ring-border', icon: Info },
  upcoming: { className: 'bg-accent text-accent-foreground ring-primary/20', icon: Clock },
};

export interface StatusBadgeProps {
  tone: StatusTone;
  children: ReactNode;
  /** The icon repeats the meaning of the tone, so status never depends on colour alone. */
  showIcon?: boolean;
  className?: string;
}

export function StatusBadge({
  tone,
  children,
  showIcon = true,
  className,
}: StatusBadgeProps): ReactNode {
  const { className: toneClassName, icon: Icon } = TONES[tone];
  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1 border-transparent font-medium ring-1 ring-inset',
        toneClassName,
        className,
      )}
    >
      {showIcon && <Icon aria-hidden="true" />}
      {children}
    </Badge>
  );
}
