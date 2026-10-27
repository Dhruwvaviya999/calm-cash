import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface SectionTab<TValue extends string> {
  value: TValue;
  label: string;
  icon: LucideIcon;
  href: ComponentProps<typeof Link>['href'];
}

export interface SectionTabsProps<TValue extends string> {
  /** Accessible name of the navigation, e.g. "Planning sections". */
  label: string;
  tabs: readonly SectionTab<TValue>[];
  current: TValue;
  className?: string;
}

/**
 * Sub-navigation between the sections of one page, as links (each section has its own URL, so it
 * survives refresh and can be bookmarked). The current one carries `aria-current="page"`. On narrow
 * screens the row scrolls sideways inside itself; the page never does.
 */
export function SectionTabs<TValue extends string>({
  label,
  tabs,
  current,
  className,
}: SectionTabsProps<TValue>): ReactNode {
  return (
    <nav aria-label={label} className={cn('min-w-0', className)}>
      <ul className="-mx-1 flex [scrollbar-width:none] gap-1 overflow-x-auto border-b px-1">
        {tabs.map(({ value, label: tabLabel, icon: Icon, href }) => {
          const active = value === current;
          return (
            <li key={value} className="shrink-0">
              <Link
                href={href}
                scroll={false}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  '-mb-px inline-flex h-11 items-center gap-2 rounded-t-md border-b-2 px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                  active
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon aria-hidden="true" className="size-4" />
                {tabLabel}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
