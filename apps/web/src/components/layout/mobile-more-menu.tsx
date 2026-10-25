'use client';

import { ChevronRight, Ellipsis, FileUp, Repeat } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { StatusBadge } from '@/components/feedback/status-badge';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { getMobileMoreItems, isNavItemActive } from '@/lib/navigation';

/** Areas that are planned but not yet available. Shown as information only, never as links. */
const UPCOMING_TOOLS = [
  { label: 'Statement imports', icon: FileUp },
  { label: 'Recurring payments', icon: Repeat },
] as const;

/** Fifth bottom-bar slot: a bottom sheet with secondary destinations. */
export function MobileMoreMenu(): ReactNode {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const items = getMobileMoreItems();
  const active = items.some((item) => isNavItemActive(item, pathname));

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        data-active={active ? '' : undefined}
        className="group flex h-full w-full min-w-0 flex-col items-center justify-center gap-1 text-muted-foreground transition-colors data-active:text-foreground"
      >
        <span className="grid h-8 w-14 max-w-full place-items-center rounded-full transition-colors group-active:bg-muted group-data-active:bg-accent group-data-active:text-accent-foreground">
          <Ellipsis aria-hidden="true" className="size-5" />
        </span>
        <span className="max-w-full truncate text-2xs font-medium group-data-active:font-semibold max-[359px]:text-[0.625rem] max-[359px]:tracking-tight">
          More
        </span>
      </SheetTrigger>

      <SheetContent
        side="bottom"
        className="max-h-[85dvh] gap-0 rounded-t-3xl border-t bg-card pb-safe shadow-lg"
      >
        <div
          aria-hidden="true"
          className="mx-auto mt-3 h-1.5 w-10 rounded-full bg-muted-foreground/25"
        />
        <SheetHeader className="px-5 pt-3 pb-3">
          <SheetTitle className="text-lg">More</SheetTitle>
          <SheetDescription>Insights, settings, and what is coming next.</SheetDescription>
        </SheetHeader>

        <nav aria-label="More destinations" className="overflow-y-auto px-3">
          <ul className="flex flex-col gap-1">
            {items.map((item) => {
              const Icon = item.icon;
              const current = isNavItemActive(item, pathname);
              return (
                <li key={item.id}>
                  <SheetClose asChild>
                    <Link
                      href={item.href}
                      aria-current={current ? 'page' : undefined}
                      className="flex min-h-14 items-center gap-4 rounded-2xl px-3 py-2 transition-colors hover:bg-muted active:bg-muted aria-[current=page]:bg-accent"
                    >
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-foreground">
                        <Icon aria-hidden="true" className="size-5" />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="font-medium">{item.label}</span>
                        <span className="truncate text-sm text-muted-foreground">
                          {item.description}
                        </span>
                      </span>
                      <ChevronRight
                        aria-hidden="true"
                        className="size-5 shrink-0 text-muted-foreground"
                      />
                    </Link>
                  </SheetClose>
                </li>
              );
            })}
          </ul>
        </nav>

        <section aria-labelledby="upcoming-tools-heading" className="mt-3 border-t px-5 pt-4 pb-5">
          <h3
            id="upcoming-tools-heading"
            className="text-2xs font-semibold tracking-[0.08em] text-muted-foreground uppercase"
          >
            Coming later
          </h3>
          <ul className="mt-2 flex flex-col">
            {UPCOMING_TOOLS.map(({ label, icon: Icon }) => (
              <li key={label} className="flex min-h-12 items-center gap-4 text-muted-foreground">
                <Icon aria-hidden="true" className="ml-2.5 size-5 shrink-0" />
                <span className="flex-1 text-sm">{label}</span>
                <StatusBadge tone="neutral" showIcon={false}>
                  Soon
                </StatusBadge>
              </li>
            ))}
          </ul>
        </section>
      </SheetContent>
    </Sheet>
  );
}
