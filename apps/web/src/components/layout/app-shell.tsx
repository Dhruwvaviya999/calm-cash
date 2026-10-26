import type { ReactNode } from 'react';

import { AppHeader } from './app-header';
import { DesktopSidebar } from './desktop-sidebar';
import { MobileBottomNav } from './mobile-bottom-nav';

/**
 * Layout shared by every in-app page. A Server Component: only the navigation pieces that need
 * the current route or user input are Client Components, and page content stays server-rendered.
 * `accountMenu` fills the header's account slot (the signed-in user's menu).
 */
export function AppShell({
  children,
  accountMenu,
}: {
  children: ReactNode;
  accountMenu: ReactNode;
}): ReactNode {
  return (
    <div className="min-h-dvh">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <DesktopSidebar />

      <div className="motion-safe:transition-[padding] motion-safe:duration-200 motion-safe:ease-out md:pl-(--sidebar-width-collapsed) lg:pl-(--sidebar-width) lg:sidebar-collapsed:pl-(--sidebar-width-collapsed)">
        <AppHeader accountMenu={accountMenu} />
        {/* Bottom padding keeps the last content above the fixed mobile navigation bar. */}
        <main
          id="main-content"
          tabIndex={-1}
          className="pb-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom,0px)+1.5rem)] outline-none md:pb-12"
        >
          {children}
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
}
