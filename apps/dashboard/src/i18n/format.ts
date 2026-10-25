import type { Messages } from './en.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Midnight of `date`'s day, to compare calendar days. */
const startOfDay = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

const daysBetween = (date: Date, now: Date): number =>
  Math.round((startOfDay(now) - startOfDay(date)) / (24 * HOUR));

/** Dates, sizes and numbers written for a locale (BCP 47 tag) with its copy. */
export function createFormat(locale: string, t: Messages) {
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });
  const time = new Intl.DateTimeFormat(locale, { timeStyle: 'short' });
  const shortDay = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
  const longDay = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const longDate = new Intl.DateTimeFormat(locale, { dateStyle: 'long' });
  const longDateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short' });
  const decimal = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });

  return {
    /** Exact date and time, short. */
    date: (iso: string): string => dateTime.format(new Date(iso)),

    /** A date, long ("October 20, 2026"). */
    longDate: (iso: string): string => longDate.format(new Date(iso)),

    /** A date and time, long. */
    longDateTime: (iso: string): string => longDateTime.format(new Date(iso)),

    /**
     * A relative date, for lists: "just now", "5 min ago", "3 h ago" the same day, then
     * "yesterday" and the short date. The exact date goes in `title`.
     */
    dateRelative(iso: string, now = new Date()): string {
      const date = new Date(iso);
      const elapsed = now.getTime() - date.getTime();
      if (elapsed < MINUTE) return t.time.justNow;
      if (elapsed < HOUR) return t.time.minutesAgo(Math.floor(elapsed / MINUTE));
      const days = daysBetween(date, now);
      if (days === 0) return t.time.hoursAgo(Math.floor(elapsed / HOUR));
      if (days === 1) return t.time.yesterdayAt(time.format(date));
      return shortDay.format(date);
    },

    /** The day of a date, to group a list: "Today", "Yesterday", "Wednesday, October 22". */
    day(iso: string, now = new Date()): string {
      const date = new Date(iso);
      const days = daysBetween(date, now);
      if (days === 0) return t.time.today;
      if (days === 1) return t.time.yesterday;
      const label = longDay.format(date);
      return label.charAt(0).toUpperCase() + label.slice(1);
    },

    /** A size in bytes, in powers of 1024. */
    bytes(bytes: number): string {
      if (bytes < 1024) return `${bytes} ${t.units.bytes}`;
      if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} ${t.units.kibibytes}`;
      return `${decimal.format(bytes / (1024 * 1024))} ${t.units.mebibytes}`;
    },
  };
}

export type Format = ReturnType<typeof createFormat>;
