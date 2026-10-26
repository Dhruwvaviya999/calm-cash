import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

const TONES = {
  primary: 'bg-accent text-accent-foreground',
  success: 'bg-income/10 text-income',
  warning: 'bg-warning/15 text-warning-text',
} as const;

/** Decorative icon tile above an authentication card's title. */
export function AuthIcon({
  icon: Icon,
  tone = 'primary',
}: {
  icon: LucideIcon;
  tone?: keyof typeof TONES;
}): ReactNode {
  return (
    <span
      aria-hidden="true"
      className={cn('mb-1 grid size-11 place-items-center rounded-xl', TONES[tone])}
    >
      <Icon className="size-5" />
    </span>
  );
}
