import { CircleDashed } from 'lucide-react';
import type { ReactNode } from 'react';

/** A short list of what an upcoming area will offer. Informational only, never interactive. */
export function PlannedCapabilities({
  items,
  label,
}: {
  items: readonly string[];
  label: string;
}): ReactNode {
  return (
    <ul aria-label={label} className="flex flex-col gap-2.5 text-left">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2.5 text-sm">
          <CircleDashed aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
