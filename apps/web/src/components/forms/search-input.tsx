import { Search } from 'lucide-react';
import type { ChangeEvent, ReactNode } from 'react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface SearchInputProps {
  /** Visible to assistive technology; the placeholder alone is not a label. */
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

/** Search field with an icon. 16px text on mobile prevents iOS from zooming on focus. */
export function SearchInput({
  label,
  value,
  onValueChange,
  placeholder,
  className,
}: SearchInputProps): ReactNode {
  return (
    <div className={cn('relative', className)}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        aria-label={label}
        value={value}
        placeholder={placeholder}
        enterKeyHint="search"
        autoComplete="off"
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          onValueChange(event.target.value);
        }}
        className="h-11 rounded-xl bg-card pl-10 text-base sm:h-10 sm:text-sm"
      />
    </div>
  );
}
