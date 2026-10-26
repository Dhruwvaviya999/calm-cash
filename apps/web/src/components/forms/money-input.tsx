import { CURRENCIES, type CurrencyCode } from '@calmcash/shared';
import type { ComponentProps, ReactNode } from 'react';

import { Input } from '@/components/ui/input';
import { DISPLAY_LOCALE } from '@/lib/format';
import { cn } from '@/lib/utils';

function currencySymbol(currency: CurrencyCode): string {
  const part = new Intl.NumberFormat(DISPLAY_LOCALE, { style: 'currency', currency })
    .formatToParts(0)
    .find((entry) => entry.type === 'currency');
  return part?.value ?? currency;
}

export type MoneyInputProps = Omit<ComponentProps<'input'>, 'type' | 'inputMode'> & {
  currency: CurrencyCode;
};

/**
 * Text field for an amount in major units ("12,500.50"), with the currency symbol in front. It is
 * a text input on purpose: the value is parsed exactly (never as a floating-point number), and the
 * placeholder shows how many decimal places the currency allows.
 */
export function MoneyInput({ currency, className, ...props }: MoneyInputProps): ReactNode {
  const digits = CURRENCIES[currency].minorUnitDigits;
  const symbol = currencySymbol(currency);

  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 grid min-w-10 place-items-center px-3 text-sm text-muted-foreground"
      >
        {symbol}
      </span>
      <Input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder={digits === 0 ? '0' : `0.${'0'.repeat(digits)}`}
        className={cn('h-11 pl-11 tabular-nums', symbol.length > 2 && 'pl-14', className)}
        {...props}
      />
    </div>
  );
}
