import { useT } from '../../../i18n/index.js';
import { Field } from '../../../layout/ui.js';
import type { DestinationTypeForm, TypeFieldsProps } from './destination-type-form.js';

/** The webhook URL carries its token: a secret, typed in and never shown again. */
function DiscordFields({ idPrefix, secrets, setSecrets, savedSecrets }: TypeFieldsProps) {
  const t = useT();
  const kept = savedSecrets.includes('url');
  return (
    <Field
      label={t.destinationTypes.webhookUrl}
      id={`${idPrefix}-discord-url`}
      type="password"
      autoComplete="off"
      required={!kept}
      placeholder="https://discord.com/api/webhooks/…"
      value={secrets.url ?? ''}
      onChange={(e) => setSecrets({ ...secrets, url: e.target.value })}
      help={kept ? t.destinationTypes.savedUrl : t.destinationTypes.discord.urlHelp}
    />
  );
}

export const discordForm: DestinationTypeForm<'discord'> = {
  label: 'Discord',
  initialConfig: {},
  Fields: DiscordFields,
  summary: (_config, t) => t.destinationTypes.discord.summary,
  generatedSecrets: {},
};
