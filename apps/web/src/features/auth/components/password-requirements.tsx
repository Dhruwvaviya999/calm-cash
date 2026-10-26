import { isWeakPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@calmcash/shared';
import { Check, Circle } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface Requirement {
  label: string;
  met: boolean;
}

export function getPasswordRequirements(password: string): Requirement[] {
  return [
    {
      label: `At least ${PASSWORD_MIN_LENGTH} characters (a short phrase works well)`,
      met: password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH,
    },
    {
      label: 'Not a common or repeated password',
      met: password.length > 0 && !isWeakPassword(password),
    },
  ];
}

/**
 * Live checklist under a new-password field. It mirrors the shared policy (the API enforces it);
 * there are no composition rules, so password-manager output always qualifies.
 */
export function PasswordRequirements({ password }: { password: string }): ReactNode {
  return (
    <ul className="flex flex-col gap-1">
      {getPasswordRequirements(password).map(({ label, met }) => (
        <li
          key={label}
          className={cn('flex items-start gap-2', met ? 'text-income' : 'text-muted-foreground')}
        >
          {met ? (
            <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          ) : (
            <Circle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          )}
          <span>
            {label}
            <span className="sr-only">{met ? ' (met)' : ' (not met yet)'}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
