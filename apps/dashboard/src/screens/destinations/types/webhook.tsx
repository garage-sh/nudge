import { useT } from '../../../i18n/index.js';
import { Field } from '../../../layout/ui.js';
import type { DestinationTypeForm, TypeFieldsProps } from './destination-type-form.js';

const url = (config: Readonly<Record<string, unknown>>) =>
  typeof config.url === 'string' ? config.url : '';

function WebhookFields({ idPrefix, config, setConfig }: TypeFieldsProps) {
  const t = useT();
  return (
    <Field
      label={t.destinationTypes.webhook.url}
      id={`${idPrefix}-url`}
      type="url"
      required
      placeholder="https://example.com/nudge"
      value={url(config)}
      onChange={(e) => setConfig({ ...config, url: e.target.value })}
      help={t.destinationTypes.webhook.urlHelp}
    />
  );
}

export const webhookForm: DestinationTypeForm<'webhook'> = {
  label: 'Webhook',
  initialConfig: { url: '' },
  Fields: WebhookFields,
  summary: url,
  generatedSecrets: {
    signingSecret: (t) => ({
      label: t.destinationTypes.webhook.signingSecret,
      help: t.destinationTypes.webhook.signingSecretHelp,
    }),
  },
};
