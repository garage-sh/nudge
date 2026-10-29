import { EMAIL_RECIPIENTS_MAX } from '@nudge/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { useInstanceSmtp } from '../../../api/instance.js';
import { useT } from '../../../i18n/index.js';
import type { DestinationTypeForm, TypeFieldsProps } from './destination-type-form.js';
import { TYPE_ICONS } from './type-icon.js';

const recipients = (config: Readonly<Record<string, unknown>>): string[] =>
  Array.isArray(config.recipients)
    ? config.recipients.filter((value): value is string => typeof value === 'string')
    : [];

/** Addresses separated by commas, semicolons, spaces or line breaks. */
const parseRecipients = (text: string) => text.split(/[\s,;]+/).filter(Boolean);

/**
 * The recipients, typed as a list. The text is kept as typed (a trailing comma stays
 * while the next address is being written); the config receives the parsed list.
 */
function EmailFields({ idPrefix, config, setConfig }: TypeFieldsProps) {
  const t = useT();
  const e = t.destinationTypes.email;
  const [text, setText] = useState(() => recipients(config).join(', '));
  const id = `${idPrefix}-email-recipients`;
  return (
    <>
      <SmtpNotice />
      <div className="field">
        <label htmlFor={id}>{e.recipients}</label>
        <textarea
          id={id}
          required
          rows={2}
          autoComplete="off"
          spellCheck={false}
          placeholder="support@example.com, qa@example.com"
          value={text}
          aria-describedby={`${id}-help`}
          onChange={(event) => {
            setText(event.target.value);
            setConfig({ ...config, recipients: parseRecipients(event.target.value) });
          }}
        />
        <p id={`${id}-help`} className="help">
          {e.recipientsHelp(EMAIL_RECIPIENTS_MAX)}
        </p>
      </div>
    </>
  );
}

/** Without an SMTP server, an email Destination can be saved but sends nothing: say so. */
function SmtpNotice() {
  const t = useT();
  const smtp = useInstanceSmtp();
  if (!smtp.data || smtp.data.smtp) return null;
  return (
    <p className="warning" role="note">
      {t.destinationTypes.email.noSmtp}{' '}
      <Link to="/settings#settings-smtp">{t.destinationTypes.email.configureSmtp}</Link>
    </p>
  );
}

export const emailForm: DestinationTypeForm<'email'> = {
  label: 'Email',
  icon: TYPE_ICONS.email,
  initialConfig: { recipients: [] },
  Fields: EmailFields,
  summary: (config) => recipients(config).join(', '),
  generatedSecrets: {},
};
