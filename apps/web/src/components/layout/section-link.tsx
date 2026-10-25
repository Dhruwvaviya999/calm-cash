import { ChevronRight } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

/** Compact "See all" style link for section headers, with a 40px touch target. */
export function SectionLink({ href, children }: { href: Route; children: ReactNode }): ReactNode {
  return (
    <Link
      href={href}
      className="-mr-2 inline-flex h-10 items-center gap-0.5 rounded-lg px-2 text-sm font-medium text-primary transition-colors hover:bg-accent"
    >
      {children}
      <ChevronRight aria-hidden="true" className="size-4" />
    </Link>
  );
}
