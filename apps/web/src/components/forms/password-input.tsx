'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useState, type ComponentProps, type ReactNode } from 'react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export type PasswordInputProps = Omit<ComponentProps<'input'>, 'type'> & {
  id: string;
};

/**
 * Password field with a show/hide control. Hidden by default; the toggle is a real button with a
 * state-reflecting label, and the field keeps password-manager friendly `autocomplete` values.
 */
export function PasswordInput({ className, id, ...props }: PasswordInputProps): ReactNode {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? 'text' : 'password'}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={cn('h-11 pr-12', className)}
        {...props}
      />
      <button
        type="button"
        aria-controls={id}
        aria-label={visible ? 'Hide password' : 'Show password'}
        onClick={() => {
          setVisible((current) => !current);
        }}
        className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        {visible ? (
          <EyeOff aria-hidden="true" className="size-5" />
        ) : (
          <Eye aria-hidden="true" className="size-5" />
        )}
      </button>
    </div>
  );
}
