import { useId } from 'react';
import { DICTIONARIES, LOCALES, useI18n, type Locale } from '../i18n/index.js';

/** The dashboard's language, per browser. Each language is named in itself. */
export function LocaleSelect() {
  const { locale, setLocale, t } = useI18n();
  const id = useId();
  return (
    <div className="locale">
      <label htmlFor={id}>{t.common.language}</label>
      <select id={id} value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
        {LOCALES.map((value) => (
          <option key={value} value={value} lang={value}>
            {DICTIONARIES[value].localeName}
          </option>
        ))}
      </select>
    </div>
  );
}
