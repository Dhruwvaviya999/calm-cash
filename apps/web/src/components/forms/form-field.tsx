import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** Accessibility wiring for the control inside a `FormField`. */
export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
}

export interface FormFieldProps {
  id: string;
  label: string;
  /** Persistent guidance below the control (e.g. requirements). */
  hint?: ReactNode;
  /** Validation message; marks the control invalid and is announced with it. */
  error?: string | undefined;
  /** Trailing element on the label row, e.g. a "Forgot password?" link. */
  labelAction?: ReactNode;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
}

/**
 * Label, control, hint, and error message for one form field. The control is rendered through a
 * function so it receives the matching `id`, `aria-describedby`, and `aria-invalid` attributes.
 */
export function FormField({
  id,
  label,
  hint,
  error,
  labelAction,
  className,
  children,
}: FormFieldProps): ReactNode {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint === undefined ? undefined : hintId, error === undefined ? undefined : errorId]
      .filter((value) => value !== undefined)
      .join(' ') || undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {labelAction}
      </div>
      {children({
        id,
        ...(describedBy === undefined ? {} : { 'aria-describedby': describedBy }),
        ...(error === undefined ? {} : { 'aria-invalid': true }),
      })}
      {hint !== undefined && (
        <div id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </div>
      )}
      {error !== undefined && (
        <p id={errorId} className="flex items-start gap-1.5 text-sm text-expense">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
