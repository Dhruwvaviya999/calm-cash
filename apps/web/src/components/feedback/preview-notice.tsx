import { FlaskConical } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * States plainly that the figures nearby are sample data. Every screen that renders prototype
 * fixtures shows this, so sample values can never be mistaken for the user's real finances.
 */
export function PreviewNotice({
  children = 'Design preview — every figure on this page is sample data, not your real finances.',
  className,
}: {
  children?: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <p
      role="note"
      className={cn(
        'flex items-start gap-2.5 rounded-xl border border-transfer/25 bg-transfer/8 px-4 py-3 text-sm text-foreground',
        className,
      )}
    >
      <FlaskConical aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-transfer" />
      <span>{children}</span>
    </p>
  );
}
