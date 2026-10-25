import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** Content column for in-app pages: consistent maximum width, gutters, and vertical rhythm. */
export function PageContainer({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <div
      className={cn(
        'mx-auto flex w-full max-w-7xl flex-col gap-6 py-6 px-gutter md:gap-8 md:py-8',
        className,
      )}
    >
      {children}
    </div>
  );
}
