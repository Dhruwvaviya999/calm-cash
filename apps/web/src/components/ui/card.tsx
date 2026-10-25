import type * as React from 'react';

import { cn } from '@/lib/utils';

/** Base surface for grouped content. Sections add their own padding and structure. */
function Card({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot="card"
      className={cn('rounded-2xl border bg-card text-card-foreground shadow-sm', className)}
      {...props}
    />
  );
}

export { Card };
