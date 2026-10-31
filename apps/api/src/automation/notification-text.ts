import {
  CURRENCIES,
  daysBetween,
  divideRounded,
  minorUnitsToDecimalString,
  NOTIFICATION_TEXT_LIMITS,
  type CurrencyCode,
  type IsoDateString,
  type MonthlySummaryDto,
  type RatioDto,
} from '@calmcash/shared';

// Plain-text wording of every notification. Amounts are exact (minor units → decimal string →
// Intl, never floating point), expected amounts are always called expected, and nothing here says
// a payment happened. The web app renders these strings as text, never as markup.

/** Same conventions as the web app's default display (Indian digit grouping). */
const LOCALE = 'en-IN';
const DECIMAL_LITERAL = /^-?\d+(?:\.\d+)?$/;
const MINUS_SIGN = '−';

function isDecimalLiteral(value: string): value is `${number}` {
  return DECIMAL_LITERAL.test(value);
}

const moneyFormatters = new Map<CurrencyCode, Intl.NumberFormat>();

/** `"245000"` INR → `"₹2,450.00"`; negatives get a typographic minus. */
export function formatMoney(amount: bigint | string, currency: CurrencyCode): string {
  const value = typeof amount === 'bigint' ? amount : BigInt(amount);
  let formatter = moneyFormatters.get(currency);
  if (formatter === undefined) {
    const digits = CURRENCIES[currency].minorUnitDigits;
    formatter = new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    moneyFormatters.set(currency, formatter);
  }
  const decimal = minorUnitsToDecimalString(value < 0n ? -value : value, currency);
  if (!isDecimalLiteral(decimal)) {
    throw new RangeError('Amount could not be converted to a decimal string.');
  }
  const magnitude = formatter.format(decimal);
  return value < 0n ? `${MINUS_SIGN}${magnitude}` : magnitude;
}

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** A calendar date as words, e.g. `"Fri, 31 Oct 2026"` (calendar dates have no time zone). */
export function formatDate(date: IsoDateString): string {
  return dateFormatter.format(new Date(`${date}T12:00:00.000Z`));
}

const shortDateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

export function formatRange(from: IsoDateString, to: IsoDateString): string {
  const format = (date: IsoDateString): string =>
    shortDateFormatter.format(new Date(`${date}T12:00:00.000Z`));
  return from === to ? format(from) : `${format(from)} – ${format(to)}`;
}

const monthFormatter = new Intl.DateTimeFormat('en-GB', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** `"2026-10"` → `"October 2026"`. */
export function formatMonth(month: string): string {
  return monthFormatter.format(new Date(`${month}-15T12:00:00.000Z`));
}

/** Basis points as a percentage with at most one decimal: 8000 → `"80%"`, 3654 → `"36.5%"`. */
export function formatBasisPoints(basisPoints: bigint): string {
  const tenths = divideRounded(basisPoints, 10n);
  const sign = tenths < 0n ? MINUS_SIGN : '';
  const absolute = tenths < 0n ? -tenths : tenths;
  const whole = absolute / 10n;
  const fraction = absolute % 10n;
  return `${sign}${whole.toString()}${fraction === 0n ? '' : `.${fraction.toString()}`}%`;
}

/** Shortens text to `max` characters (whole text when it fits), never cutting mid-character. */
export function clip(text: string, max: number): string {
  const characters = Array.from(text);
  return characters.length <= max ? text : `${characters.slice(0, max - 1).join('')}…`;
}

export interface NotificationText {
  title: string;
  body: string;
}

function bounded({ title, body }: NotificationText): NotificationText {
  return {
    title: clip(title, NOTIFICATION_TEXT_LIMITS.title),
    body: clip(body, NOTIFICATION_TEXT_LIMITS.body),
  };
}

function days(count: number): string {
  return count === 1 ? '1 day' : `${count.toString()} days`;
}

// --- Budgets -------------------------------------------------------------------------------------

export interface BudgetAlertFacts {
  name: string;
  currency: CurrencyCode;
  limitMinor: bigint;
  spentMinor: bigint;
  from: IsoDateString;
  to: IsoDateString;
  /** The alert reached: a configured threshold, or 10 000 for the limit itself. */
  thresholdBp: number;
}

const BASIS_POINTS = 10_000n;

export function budgetAlertText(facts: BudgetAlertFacts): NotificationText {
  const { name, currency, limitMinor, spentMinor, from, to, thresholdBp } = facts;
  const period = formatRange(from, to);
  const spent = formatMoney(spentMinor, currency);
  const limit = formatMoney(limitMinor, currency);
  if (thresholdBp >= 10_000) {
    const over = spentMinor - limitMinor;
    return bounded(
      over > 0n
        ? {
            title: `${name} is over budget`,
            body: `${spent} spent of ${limit} for ${period} — ${formatMoney(over, currency)} over the limit.`,
          }
        : {
            title: `${name} reached its budget limit`,
            body: `${spent} of ${limit} spent for ${period}. Nothing is left for this period.`,
          },
    );
  }
  const used = formatBasisPoints(divideRounded(spentMinor * BASIS_POINTS, limitMinor));
  return bounded({
    title: `${name} has used ${used} of its budget`,
    body: `${spent} of ${limit} spent for ${period}; ${formatMoney(limitMinor - spentMinor, currency)} left. You asked to be told at ${formatBasisPoints(BigInt(thresholdBp))}.`,
  });
}

// --- Recurring payments and subscriptions --------------------------------------------------------

export interface ReminderFacts {
  name: string;
  /** `expense` for bills and subscriptions, `income` for expected income. */
  type: 'income' | 'expense';
  amountMinor: bigint;
  currency: CurrencyCode;
  dueDate: IsoDateString;
  today: IsoDateString;
}

export function upcomingReminderText(facts: ReminderFacts): NotificationText {
  const amount = formatMoney(facts.amountMinor, facts.currency);
  const inDays = days(daysBetween(facts.today, facts.dueDate));
  const when = formatDate(facts.dueDate);
  return bounded(
    facts.type === 'income'
      ? {
          title: `${facts.name} expected in ${inDays}`,
          body: `${amount} is expected on ${when}. Record it in CalmCash once it arrives.`,
        }
      : {
          title: `${facts.name} is due in ${inDays}`,
          body: `${amount} is expected on ${when}. This is a reminder only — nothing has been paid or recorded.`,
        },
  );
}

export function dueReminderText(facts: ReminderFacts): NotificationText {
  const amount = formatMoney(facts.amountMinor, facts.currency);
  return bounded(
    facts.type === 'income'
      ? {
          title: `${facts.name} is expected today`,
          body: `${amount} is expected today. Record it in CalmCash once it arrives.`,
        }
      : {
          title: `${facts.name} is due today`,
          body: `${amount} is expected today. Record it in CalmCash once you have paid it.`,
        },
  );
}

export function overdueReminderText(facts: ReminderFacts): NotificationText {
  const amount = formatMoney(facts.amountMinor, facts.currency);
  const when = formatDate(facts.dueDate);
  return bounded(
    facts.type === 'income'
      ? {
          title: `${facts.name} has not been recorded`,
          body: `${amount} was expected on ${when} and has not been recorded. Record it if it arrived, or skip or postpone it.`,
        }
      : {
          title: `${facts.name} is overdue`,
          body: `${amount} was expected on ${when} and has not been recorded. If you already paid it, record it; otherwise skip or postpone it.`,
        },
  );
}

export function subscriptionReminderText(facts: ReminderFacts): NotificationText {
  const amount = formatMoney(facts.amountMinor, facts.currency);
  const inDays = days(daysBetween(facts.today, facts.dueDate));
  return bounded({
    title: `${facts.name} renews in ${inDays}`,
    body: `Expected charge: ${amount} on ${formatDate(facts.dueDate)}. This is an estimate from your subscription details, not a charge that has happened.`,
  });
}

// --- Monthly summary -----------------------------------------------------------------------------

export function describeRatio(ratio: RatioDto): string {
  return ratio.status === 'available'
    ? formatBasisPoints(BigInt(ratio.basisPoints))
    : 'not available (no income recorded)';
}

export function monthlySummaryText(summary: MonthlySummaryDto): NotificationText {
  const { currency } = summary;
  return bounded({
    title: `Your ${formatMonth(summary.month)} summary (${currency})`,
    body: [
      `Income ${formatMoney(summary.incomeMinor, currency)}`,
      `spending ${formatMoney(summary.expenseMinor, currency)}`,
      `net ${formatMoney(summary.netMinor, currency)}`,
      `savings rate ${describeRatio(summary.savingsRate)}.`,
    ].join(' · '),
  });
}

// --- Service notices -----------------------------------------------------------------------------

export function deliveryProblemText(): NotificationText {
  return {
    title: 'An e-mail notification could not be delivered',
    body: 'CalmCash could not deliver a notification e-mail to your address. Your notifications are still here in the app. Check your notification settings if this keeps happening.',
  };
}
