import type { ReactNode } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface AuthCardProps {
  title: string;
  description?: ReactNode;
  /** Small context above the title, e.g. an icon tile. */
  eyebrow?: ReactNode;
  /** Below the card: links to the other authentication pages. */
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/** The single card that frames every authentication page. Holds the page's only <h1>. */
export function AuthCard({
  title,
  description,
  eyebrow,
  footer,
  children,
  className,
}: AuthCardProps): ReactNode {
  return (
    <div className="flex w-full flex-col gap-6">
      <Card className={cn('flex flex-col gap-6 p-6 sm:p-8', className)}>
        <header className="flex flex-col gap-2">
          {eyebrow}
          <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
          {description !== undefined && (
            <div className="text-pretty text-muted-foreground">{description}</div>
          )}
        </header>
        {children}
      </Card>
      {footer !== undefined && (
        <div className="text-center text-sm text-muted-foreground">{footer}</div>
      )}
    </div>
  );
}

/** Placeholder with the card's shape while the session is checked or a page streams in. */
export function AuthCardSkeleton({ label = 'Loading…' }: { label?: string }): ReactNode {
  return (
    <Card role="status" aria-live="polite" className="flex w-full flex-col gap-6 p-6 sm:p-8">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="flex flex-col gap-3">
        <Skeleton className="h-7 w-2/3 bg-muted" />
        <Skeleton className="h-4 w-full bg-muted" />
      </div>
      <div aria-hidden="true" className="flex flex-col gap-4">
        <Skeleton className="h-11 w-full bg-muted" />
        <Skeleton className="h-11 w-full bg-muted" />
        <Skeleton className="h-11 w-full bg-muted" />
      </div>
    </Card>
  );
}
