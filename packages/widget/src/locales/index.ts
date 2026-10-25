import { en, type Messages } from './en.js';
import { fr } from './fr.js';

export type { Messages } from './en.js';

/** The languages the Widget speaks. */
export const LOCALES = { en, fr } as const satisfies Record<string, Messages>;
export type Locale = keyof typeof LOCALES;

const supported = (tag: string | null | undefined): Locale | undefined => {
  const language = tag?.trim().toLowerCase().split(/[-_]/)[0];
  return language && Object.hasOwn(LOCALES, language) ? (language as Locale) : undefined;
};

/**
 * The Widget's language: the one the host asked for (`locale`) if supported; otherwise
 * French when the page (`<html lang>`) or, without one, the browser speaks it; else English.
 */
export function resolveLocale(requested?: string | null): Locale {
  const explicit = supported(requested);
  if (explicit) return explicit;
  const detected = document.documentElement.lang || navigator.language;
  return supported(detected) === 'fr' ? 'fr' : 'en';
}

/** 429: minutes until a retry, from `Retry-After` (seconds) when readable, else `null`. */
export function retryAfterMinutes(retryAfter: string | null): number | null {
  const seconds = Number(retryAfter);
  if (!retryAfter || !Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.ceil(seconds / 60);
}
