import { useT } from '../../../i18n/index.js';
import { Field } from '../../../layout/ui.js';
import type { DestinationTypeForm, TypeFieldsProps } from './destination-type-form.js';
import { TYPE_ICONS } from './type-icon.js';

/** The incoming webhook URL carries its token: a secret, typed in and never shown again. */
function SlackFields({ idPrefix, secrets, setSecrets, savedSecrets }: TypeFieldsProps) {
  const t = useT();
  const kept = savedSecrets.includes('url');
  return (
    <Field
      label={t.destinationTypes.webhookUrl}
      id={`${idPrefix}-slack-url`}
      type="password"
      autoComplete="off"
      required={!kept}
      placeholder="https://hooks.slack.com/services/…"
      value={secrets.url ?? ''}
      onChange={(e) => setSecrets({ ...secrets, url: e.target.value })}
      help={kept ? t.destinationTypes.savedUrl : t.destinationTypes.slack.urlHelp}
    />
  );
}

export const slackForm: DestinationTypeForm<'slack'> = {
  label: 'Slack',
  icon: TYPE_ICONS.slack,
  initialConfig: {},
  Fields: SlackFields,
  summary: (_config, t) => t.destinationTypes.slack.summary,
  generatedSecrets: {},
};
