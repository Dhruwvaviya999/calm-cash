import { CircleAlert, CircleCheck, Info, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type FormMessageTone = 'error' | 'success' | 'info';

const TONES: Readonly<Record<FormMessageTone, { className: string; icon: LucideIcon }>> = {
  error: { className: 'border-expense/25 bg-expense/8 [&>svg]:text-expense', icon: CircleAlert },
  success: { className: 'border-income/25 bg-income/8 [&>svg]:text-income', icon: CircleCheck },
  info: { className: 'border-transfer/25 bg-transfer/8 [&>svg]:text-transfer', icon: Info },
};

export interface FormMessageProps {
  tone: FormMessageTone;
  title?: string;
  children?: ReactNode;
  className?: string;
}

/**
 * Form-level feedback. Errors use `role="alert"` (announced immediately); success and information
 * use `role="status"`. The icon repeats the tone, so meaning never depends on colour alone.
 */
export function FormMessage({ tone, title, children, className }: FormMessageProps): ReactNode {
  const { className: toneClassName, icon: Icon } = TONES[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm text-foreground',
        toneClassName,
        className,
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="flex min-w-0 flex-col gap-1">
        {title !== undefined && <p className="font-medium">{title}</p>}
        {children !== undefined && <div className="text-pretty">{children}</div>}
      </div>
    </div>
  );
}
