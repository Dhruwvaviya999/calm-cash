'use client';

import { ChevronRight } from 'lucide-react';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { findActiveNavItem, getNavGroupLabel } from '@/lib/navigation';

/** Desktop header breadcrumb: tells users which area of the app they are in. */
export function HeaderContext(): ReactNode {
  const item = findActiveNavItem(usePathname());
  if (item === undefined) {
    return null;
  }

  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex items-center gap-1.5 text-sm">
        <li className="text-muted-foreground">{getNavGroupLabel(item.group)}</li>
        <li aria-hidden="true" className="text-muted-foreground/60">
          <ChevronRight className="size-4" />
        </li>
        <li aria-current="page" className="font-medium text-foreground">
          {item.label}
        </li>
      </ol>
    </nav>
  );
}
