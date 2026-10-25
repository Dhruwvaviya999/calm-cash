'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { getMobileBarItems, isNavItemActive } from '@/lib/navigation';

import { MobileMoreMenu } from './mobile-more-menu';

/**
 * Android-style bottom navigation: four primary destinations plus "More". Each cell is the full
 * bar height (64px) so touch targets comfortably exceed 48px, and the bar clears the gesture area.
 */
export function MobileBottomNav(): ReactNode {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-card pb-safe md:hidden"
    >
      <ul className="grid h-(--bottom-nav-height) grid-cols-5">
        {getMobileBarItems().map((item) => {
          const Icon = item.icon;
          const active = isNavItemActive(item, pathname);
          return (
            <li key={item.id} className="min-w-0">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className="group flex h-full min-w-0 flex-col items-center justify-center gap-1 text-muted-foreground transition-colors aria-[current=page]:text-foreground"
              >
                <span className="grid h-8 w-14 max-w-full place-items-center rounded-full transition-colors group-active:bg-muted group-aria-[current=page]:bg-accent group-aria-[current=page]:text-accent-foreground">
                  <Icon aria-hidden="true" className="size-5" strokeWidth={active ? 2.25 : 2} />
                </span>
                <span className="max-w-full truncate text-2xs font-medium group-aria-[current=page]:font-semibold max-[359px]:text-[0.625rem] max-[359px]:tracking-tight">
                  {item.mobileLabel}
                </span>
              </Link>
            </li>
          );
        })}
        <li className="min-w-0">
          <MobileMoreMenu />
        </li>
      </ul>
    </nav>
  );
}
