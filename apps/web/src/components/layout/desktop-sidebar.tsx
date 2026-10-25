'use client';

import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { Wordmark } from '@/components/brand/wordmark';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useSidebarState } from '@/hooks/use-display-preferences';
import { getNavItemsByGroup, isNavItemActive, NAV_GROUPS, type NavItem } from '@/lib/navigation';
import { setSidebarState } from '@/lib/preferences';
import { cn } from '@/lib/utils';

// Visibility rules (pure CSS, so the correct layout renders before hydration):
// - md (tablet): an icon-only navigation rail.
// - lg+: a full sidebar the user can collapse to the rail; the state lives on <html data-sidebar>.
const LABEL_CLASSES = 'md:sr-only lg:not-sr-only lg:sidebar-collapsed:sr-only';
const RAIL_ONLY_CLASSES = 'hidden md:block lg:hidden lg:sidebar-collapsed:block';
const ROW_CLASSES =
  'md:justify-center md:px-0 lg:justify-start lg:px-3 lg:sidebar-collapsed:justify-center lg:sidebar-collapsed:px-0';

function SidebarLink({ item, active }: { item: NavItem; active: boolean }): ReactNode {
  const Icon = item.icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={item.href}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-sidebar-foreground/85 transition-colors',
            'hover:bg-sidebar-accent/60 hover:text-sidebar-foreground active:bg-sidebar-accent',
            'aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-accent-foreground',
            'before:absolute before:inset-y-2 before:-left-3 before:w-1 before:rounded-r-full before:bg-sidebar-primary before:opacity-0 before:transition-opacity aria-[current=page]:before:opacity-100',
            ROW_CLASSES,
          )}
        >
          <Icon aria-hidden="true" className="size-5 shrink-0" strokeWidth={active ? 2.25 : 2} />
          <span className={cn('truncate', LABEL_CLASSES)}>{item.label}</span>
        </Link>
      </TooltipTrigger>
      {/* Only needed when labels are hidden (rail or collapsed sidebar). */}
      <TooltipContent side="right" sideOffset={12} className="lg:hidden lg:sidebar-collapsed:block">
        {item.label}
      </TooltipContent>
    </Tooltip>
  );
}

function CollapseToggle(): ReactNode {
  const collapsed = useSidebarState() === 'collapsed';
  const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';

  return (
    <button
      type="button"
      onClick={() => {
        setSidebarState(collapsed ? 'expanded' : 'collapsed');
      }}
      aria-controls="app-sidebar"
      aria-expanded={!collapsed}
      aria-label={label}
      className={cn(
        'hidden h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors lg:flex',
        'hover:bg-sidebar-accent/60 hover:text-sidebar-foreground active:bg-sidebar-accent',
        ROW_CLASSES,
      )}
    >
      <PanelLeftClose aria-hidden="true" className="size-5 shrink-0 sidebar-collapsed:hidden" />
      <PanelLeftOpen
        aria-hidden="true"
        className="hidden size-5 shrink-0 sidebar-collapsed:block"
      />
      <span className={cn('truncate', LABEL_CLASSES)}>{label}</span>
    </button>
  );
}

/** Desktop and tablet navigation. Hidden on mobile, where `MobileBottomNav` takes over. */
export function DesktopSidebar(): ReactNode {
  const pathname = usePathname();
  const mainGroups = NAV_GROUPS.filter((group) => group.id !== 'system');
  const systemItems = getNavItemsByGroup('system');

  return (
    <TooltipProvider delayDuration={200}>
      <aside
        id="app-sidebar"
        aria-label="Sidebar"
        className={cn(
          'fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-sidebar-border bg-sidebar md:flex',
          'w-(--sidebar-width-collapsed) lg:w-(--sidebar-width) lg:sidebar-collapsed:w-(--sidebar-width-collapsed)',
          'motion-safe:transition-[width] motion-safe:duration-200 motion-safe:ease-out',
        )}
      >
        <div className="flex h-(--app-header-height) shrink-0 items-center border-b border-sidebar-border px-4 md:justify-center md:px-0 lg:justify-start lg:px-5 lg:sidebar-collapsed:justify-center lg:sidebar-collapsed:px-0">
          <Link href="/dashboard" aria-label="CalmCash dashboard" className="rounded-lg">
            <Wordmark className="md:hidden lg:inline-flex lg:sidebar-collapsed:hidden" />
            <Wordmark
              variant="mark"
              className="hidden md:inline-flex lg:hidden lg:sidebar-collapsed:inline-flex"
            />
          </Link>
        </div>

        <nav
          aria-label="Main navigation"
          className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-5"
        >
          {mainGroups.map((group, index) => (
            <div key={group.id} role="group" aria-labelledby={`nav-group-${group.id}`}>
              {index > 0 && (
                <div
                  aria-hidden="true"
                  className={cn('mx-2 mb-4 h-px bg-sidebar-border', RAIL_ONLY_CLASSES)}
                />
              )}
              <p
                id={`nav-group-${group.id}`}
                className={cn(
                  'px-3 pb-2 text-2xs font-semibold tracking-[0.08em] text-muted-foreground uppercase',
                  LABEL_CLASSES,
                )}
              >
                {group.label}
              </p>
              <ul className="flex flex-col gap-1">
                {getNavItemsByGroup(group.id).map((item) => (
                  <li key={item.id}>
                    <SidebarLink item={item} active={isNavItemActive(item, pathname)} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="flex flex-col gap-1 border-t border-sidebar-border px-3 py-3">
          <ul className="flex flex-col gap-1" aria-label="System">
            {systemItems.map((item) => (
              <li key={item.id}>
                <SidebarLink item={item} active={isNavItemActive(item, pathname)} />
              </li>
            ))}
          </ul>
          <CollapseToggle />
        </div>
      </aside>
    </TooltipProvider>
  );
}
