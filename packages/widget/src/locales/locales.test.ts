import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOCALES, resolveLocale, retryAfterMinutes } from './index.js';

afterEach(() => {
  document.documentElement.lang = '';
  vi.unstubAllGlobals();
});

const browserLanguage = (language: string) =>
  vi.stubGlobal('navigator', { ...navigator, language });

describe('resolveLocale', () => {
  it('defaults to English', () => {
    browserLanguage('de-DE');
    expect(resolveLocale()).toBe('en');
  });

  it('picks French from the page language, then from the browser', () => {
    document.documentElement.lang = 'fr-CA';
    browserLanguage('en-US');
    expect(resolveLocale()).toBe('fr');

    document.documentElement.lang = '';
    browserLanguage('fr-FR');
    expect(resolveLocale()).toBe('fr');
  });

  it('lets the requested locale win over detection, and ignores an unsupported one', () => {
    document.documentElement.lang = 'fr';
    expect(resolveLocale('en')).toBe('en');
    expect(resolveLocale('de')).toBe('fr');
    document.documentElement.lang = 'en';
    expect(resolveLocale('FR')).toBe('fr');
  });
});

describe('rate limit message', () => {
  const message = (locale: keyof typeof LOCALES, retryAfter: string | null) =>
    LOCALES[locale].rateLimited(retryAfterMinutes(retryAfter));

  it('says when to retry, from Retry-After in seconds', () => {
    expect(message('en', '120')).toBe(
      'Too much feedback sent in a short time. Try again in 2 minutes.',
    );
    expect(message('en', '30')).toBe(
      'Too much feedback sent in a short time. Try again in a minute.',
    );
    expect(message('en', null)).toBe(
      'Too much feedback sent in a short time. Try again in a few minutes.',
    );
    expect(message('en', 'soon')).toBe(message('en', null));
  });

  it('has the same delay variants in French', () => {
    const variants = ['150', '60', null].map((retryAfter) => message('fr', retryAfter));
    expect(variants[0]).toContain(' 3 ');
    expect(new Set([...variants, ...['150', '60', null].map((r) => message('en', r))]).size).toBe(
      6,
    );
  });
});
