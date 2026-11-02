import { addDaysToIsoDate, addMonthsToIsoDate, isoDateSchema } from '@calmcash/shared';

// Dates written in words, resolved deterministically in the user's calendar ("today" is passed in,
// computed in their time zone). A language model is never trusted with date arithmetic: drafts
// and searches use only what this module reads from the person's own text.

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

export type DateReading =
  | { kind: 'date'; date: string; words: string }
  | { kind: 'future'; words: string }
  | { kind: 'none' };

function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00.000Z`).getUTCDay();
}

function monthIndex(word: string): number {
  return MONTHS.findIndex((month) => month.startsWith(word.toLowerCase().slice(0, 3)));
}

function validDate(year: number, month: number, day: number): string | undefined {
  const text = `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
  return isoDateSchema.safeParse(text).success ? text : undefined;
}

/** The date a person's text refers to, relative to `today`; `future` for tomorrow and later. */
export function readDate(text: string, today: string): DateReading {
  const lower = text.toLowerCase();
  if (
    /\b(tomorrow|next (week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/.test(
      lower,
    )
  ) {
    return { kind: 'future', words: 'a future date' };
  }
  if (/\bday before yesterday\b/.test(lower)) {
    return { kind: 'date', date: addDaysToIsoDate(today, -2), words: 'the day before yesterday' };
  }
  if (/\byesterday\b/.test(lower))
    return { kind: 'date', date: addDaysToIsoDate(today, -1), words: 'yesterday' };
  if (/\b(today|tonight|this morning|this evening|this afternoon)\b/.test(lower)) {
    return { kind: 'date', date: today, words: 'today' };
  }
  const ago = /\b(\d{1,3}|a|one|two|three|four|five|six|seven) (day|days|week|weeks) ago\b/.exec(
    lower,
  );
  if (ago !== null) {
    const words: Record<string, number> = {
      a: 1,
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
    };
    const count = words[ago[1] ?? ''] ?? Number(ago[1]);
    const days = (ago[2] ?? '').startsWith('week') ? count * 7 : count;
    if (days > 0 && days <= 366)
      return { kind: 'date', date: addDaysToIsoDate(today, -days), words: ago[0] };
  }
  const weekday =
    /\b(last|this|on)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(lower);
  if (weekday !== null) {
    const target = WEEKDAYS.indexOf(weekday[2] ?? '');
    const current = weekdayOf(today);
    let back = (current - target + 7) % 7;
    // "last Sunday" on a Sunday means a week ago; a bare weekday means the most recent one.
    if (back === 0 && weekday[1] === 'last') back = 7;
    return { kind: 'date', date: addDaysToIsoDate(today, -back), words: weekday[0].trim() };
  }
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(lower);
  if (iso !== null) {
    const date = validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (date !== undefined)
      return date > today
        ? { kind: 'future', words: iso[0] }
        : { kind: 'date', date, words: iso[0] };
  }
  const dayMonth =
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?(?:\s+(\d{4}))?\b/.exec(
      lower,
    ) ?? null;
  const monthDay =
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/.exec(
      lower,
    ) ?? null;
  const parts =
    dayMonth !== null
      ? {
          day: Number(dayMonth[1]),
          month: monthIndex(dayMonth[2] ?? '') + 1,
          year: dayMonth[3],
          words: dayMonth[0],
        }
      : monthDay !== null
        ? {
            day: Number(monthDay[2]),
            month: monthIndex(monthDay[1] ?? '') + 1,
            year: monthDay[3],
            words: monthDay[0],
          }
        : undefined;
  if (parts !== undefined && parts.month > 0) {
    const thisYear = Number(today.slice(0, 4));
    let date = validDate(
      parts.year === undefined ? thisYear : Number(parts.year),
      parts.month,
      parts.day,
    );
    // Without a year, a date later than today means last year's.
    if (date !== undefined && parts.year === undefined && date > today) {
      date = validDate(thisYear - 1, parts.month, parts.day);
    }
    if (date !== undefined)
      return date > today
        ? { kind: 'future', words: parts.words }
        : { kind: 'date', date, words: parts.words };
  }
  return { kind: 'none' };
}

/** A calendar month named in text ("in January", "last month"), as a date range up to today. */
export function readMonthRange(
  text: string,
  today: string,
): { from: string; to: string } | undefined {
  const lower = text.toLowerCase();
  const thisMonth = `${today.slice(0, 7)}-01`;
  if (/\bthis month\b/.test(lower)) return { from: thisMonth, to: today };
  if (/\blast month\b/.test(lower)) {
    const from = addMonthsToIsoDate(thisMonth, -1);
    return { from, to: addDaysToIsoDate(thisMonth, -1) };
  }
  const named =
    /\b(?:(in|during|for|since)\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(\d{4}))?\b/.exec(
      lower,
    );
  // "may" is also a verb ("I may have paid"): it names the month only after "in"/"for" or before a year.
  if (named !== null && !(named[2] === 'may' && named[1] === undefined && named[3] === undefined)) {
    const month = MONTHS.indexOf(named[2] ?? '') + 1;
    const thisYear = Number(today.slice(0, 4));
    let year = named[3] === undefined ? thisYear : Number(named[3]);
    let from = `${year.toString()}-${month.toString().padStart(2, '0')}-01`;
    if (named[3] === undefined && from > today) {
      year -= 1;
      from = `${year.toString()}-${month.toString().padStart(2, '0')}-01`;
    }
    if (from > today) return undefined;
    const end = addDaysToIsoDate(addMonthsToIsoDate(from, 1), -1);
    return { from, to: end < today ? end : today };
  }
  return undefined;
}

/** `HH:mm` from "at 7pm", "at 19:30", "7:15 am". */
export function readTime(text: string): string | undefined {
  const match = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b([01]?\d|2[0-3]):([0-5]\d)\b/i.exec(text);
  if (match === null) return undefined;
  if (match[3] !== undefined) {
    let hour = Number(match[1]);
    if (hour < 1 || hour > 12) return undefined;
    if (match[3].toLowerCase() === 'pm' && hour !== 12) hour += 12;
    if (match[3].toLowerCase() === 'am' && hour === 12) hour = 0;
    return `${hour.toString().padStart(2, '0')}:${match[2] ?? '00'}`;
  }
  return `${(match[4] ?? '').padStart(2, '0')}:${match[5] ?? '00'}`;
}
