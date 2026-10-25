'use client';

import { RotateCcw } from 'lucide-react';
import type { ReactNode } from 'react';

import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { Button } from '@/components/ui/button';
import { resetDisplayPreferences } from '@/lib/preferences';

/** Restores the default theme and sidebar layout on this device, after confirmation. */
export function ResetDisplayPreferences(): ReactNode {
  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline">
          <RotateCcw aria-hidden="true" />
          Reset display preferences
        </Button>
      }
      title="Reset display preferences?"
      description="The theme goes back to following your device and the sidebar is expanded again. Your financial data is not affected."
      confirmLabel="Reset preferences"
      onConfirm={resetDisplayPreferences}
    />
  );
}
