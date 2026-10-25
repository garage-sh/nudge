import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { en, type Messages } from './en.js';
import { createFormat, type Format } from './format.js';
import { fr } from './fr.js';

export type { Messages } from './en.js';

/** The languages the dashboard speaks; English is the default. */
export const DICTIONARIES = { en, fr } as const satisfies Record<string, Messages>;
export type Locale = keyof typeof DICTIONARIES;
export const LOCALES = Object.keys(DICTIONARIES) as Locale[];

const isLocale = (value: unknown): value is Locale =>
  typeof value === 'string' && Object.hasOwn(DICTIONARIES, value);

/** The Member's choice, per browser: a convenience, so storage may be missing or blocked. */
export const LOCALE_STORAGE_KEY = 'nudge.locale';

function storedLocale(): Locale | null {
  try {
    const value = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

function storeLocale(locale: Locale) {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Not remembered: the dashboard still switches for this visit.
  }
}

/** The stored choice; without one, French for a French-speaking browser, else English. */
export function detectLocale(): Locale {
  return storedLocale() ?? (navigator.language.toLowerCase().startsWith('fr') ? 'fr' : 'en');
}

interface I18n {
  readonly locale: Locale;
  readonly setLocale: (locale: Locale) => void;
  readonly t: Messages;
  readonly format: Format;
}

const I18nContext = createContext<I18n | null>(null);

/**
 * The active locale, its copy and its formats. `locale` forces the starting locale
 * (tests); otherwise it is detected. A change is remembered and sets `<html lang>`.
 */
export function I18nProvider({
  locale: initial,
  children,
}: {
  locale?: Locale;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(() => initial ?? detectLocale());
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const value = useMemo<I18n>(() => {
    const t = DICTIONARIES[locale];
    return {
      locale,
      t,
      format: createFormat(locale, t),
      setLocale: (next) => {
        storeLocale(next);
        setLocaleState(next);
      },
    };
  }, [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const i18n = useContext(I18nContext);
  if (!i18n) throw new Error('useI18n outside of I18nProvider');
  return i18n;
}

/** The active locale's copy. */
export const useT = (): Messages => useI18n().t;
