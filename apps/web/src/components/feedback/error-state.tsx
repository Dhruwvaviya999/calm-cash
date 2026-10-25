import { CloudOff, RotateCcw } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ErrorStateProps {
  title?: string;
  description: string;
  /** Shown when provided; for example a route error boundary's `retry()`. */
  onRetry?: () => void;
  /** Support reference such as an error digest or request ID. */
  reference?: string;
  /** `h1` when the error is the page's main content (outside the app shell). */
  headingLevel?: 'h1' | 'h2';
  className?: string;
}

/** A calm, recoverable error message. The rest of the page (and navigation) stays usable. */
export function ErrorState({
  title = 'Something went wrong',
  description,
  onRetry,
  reference,
  headingLevel: Heading = 'h2',
  className,
}: ErrorStateProps): ReactNode {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center rounded-2xl border bg-card px-6 py-10 text-center',
        className,
      )}
    >
      <div className="mb-4 grid size-12 place-items-center rounded-full bg-expense/10 text-expense">
        <CloudOff aria-hidden="true" className="size-6" />
      </div>
      <Heading className="text-lg font-semibold tracking-tight">{title}</Heading>
      <p className="mt-2 max-w-md text-pretty text-muted-foreground">{description}</p>
      {reference !== undefined && (
        <p className="mt-3 text-xs text-muted-foreground">
          Reference: <code className="font-mono">{reference}</code>
        </p>
      )}
      {onRetry !== undefined && (
        <Button variant="outline" className="mt-6" onClick={onRetry}>
          <RotateCcw aria-hidden="true" />
          Try again
        </Button>
      )}
    </div>
  );
}
