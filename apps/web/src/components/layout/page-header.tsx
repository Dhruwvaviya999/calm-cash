import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface PageHeaderProps {
  title: string;
  description?: string;
  /** Small context shown above the title, e.g. a status badge. */
  eyebrow?: ReactNode;
  /** Primary page actions; placed beside the title on wide screens and below it on mobile. */
  actions?: ReactNode;
}

/** The page's single <h1> with a concise description. */
export function PageHeader({ title, description, eyebrow, actions }: PageHeaderProps): ReactNode {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1.5">
        {eyebrow}
        <h1 className="text-2xl font-semibold tracking-tight text-balance md:text-3xl">{title}</h1>
        {description !== undefined && (
          <p className="max-w-2xl text-pretty text-muted-foreground">{description}</p>
        )}
      </div>
      {actions !== undefined && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  );
}

export interface SectionHeaderProps {
  /** Used for `aria-labelledby` on the enclosing section. */
  id: string;
  title: string;
  description?: string;
  /** A trailing action, typically a "See all" link or a badge. */
  action?: ReactNode;
  className?: string;
}

/** An <h2> heading for a page section, with an optional trailing action. */
export function SectionHeader({
  id,
  title,
  description,
  action,
  className,
}: SectionHeaderProps): ReactNode {
  return (
    <div className={cn('flex items-start justify-between gap-3', className)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 id={id} className="text-base font-semibold tracking-tight">
          {title}
        </h2>
        {description !== undefined && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action !== undefined && <div className="shrink-0">{action}</div>}
    </div>
  );
}
