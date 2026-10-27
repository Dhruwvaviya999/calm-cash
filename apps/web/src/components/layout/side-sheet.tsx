'use client';

import type { ReactNode } from 'react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

export interface SideSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string | undefined;
  children: ReactNode;
}

/**
 * A form or details panel in a side sheet: full width on phones, a panel on larger screens. Focus
 * moves into the sheet, Escape closes it, and focus returns to the control that opened it. The
 * body scrolls on its own, so the on-screen keyboard never hides the fields.
 */
export function SideSheet({
  open,
  onClose,
  title,
  description,
  children,
}: SideSheetProps): ReactNode {
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader className="border-b px-5 pt-5 pr-14 pb-4">
          <SheetTitle className="text-lg">{title}</SheetTitle>
          {description !== undefined && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>
        <div className="px-5 py-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
