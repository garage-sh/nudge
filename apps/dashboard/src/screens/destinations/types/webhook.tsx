import { WEBHOOK_EXAMPLES, type WebhookEventName } from '@nudge/shared';
import { useId, useState } from 'react';
import { useT } from '../../../i18n/index.js';
import { CopyableValue, Field } from '../../../layout/ui.js';
import type { DestinationTypeForm, TypeFieldsProps } from './destination-type-form.js';
import { TYPE_ICONS } from './type-icon.js';

const url = (config: Readonly<Record<string, unknown>>) =>
  typeof config.url === 'string' ? config.url : '';

const PLACEHOLDER = 'https://example.com/nudge';

/** The receiver's check, in Node: code, the same in every locale. */
const VERIFY_SNIPPET = `import { createHmac, timingSafeEqual } from 'node:crypto';

// rawBody: the request body as received, before JSON.parse
const timestamp = request.headers['x-nudge-timestamp'];
const expected = Buffer.from(
  'sha256=' +
    createHmac('sha256', process.env.NUDGE_SIGNING_SECRET)
      .update(\`\${timestamp}.\${rawBody}\`)
      .digest('hex'),
);
const received = Buffer.from(request.headers['x-nudge-signature'] ?? '');
const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) < 300;
const valid = fresh && received.length === expected.length && timingSafeEqual(received, expected);`;

function WebhookFields({ idPrefix, config, setConfig, purpose }: TypeFieldsProps) {
  const t = useT();
  return (
    <>
      <Field
        label={t.destinationTypes.webhook.url}
        id={`${idPrefix}-url`}
        type="url"
        required
        placeholder={PLACEHOLDER}
        value={url(config)}
        onChange={(e) => setConfig({ ...config, url: e.target.value })}
        help={t.destinationTypes.webhook.urlHelp}
      />
      <WebhookPayload url={url(config) || PLACEHOLDER} purpose={purpose} />
    </>
  );
}

/**
 * What the receiver gets, per event: the request line, the headers and the JSON body
 * (the examples of `@nudge/shared`, typed like the adapter's bodies), then how to
 * check the signature.
 */
function WebhookPayload({ url, purpose }: { url: string; purpose: TypeFieldsProps['purpose'] }) {
  const t = useT();
  const p = t.destinationTypes.webhook.payload;
  const id = useId();
  // A Project's Destination receives Feedback and Incidents; the Alert destination, alerts.
  const events: readonly WebhookEventName[] =
    purpose === 'feedback'
      ? [
          'feedback',
          'incident.opened',
          'incident.raised',
          'incident.closed',
          'incidents.held',
          'ping',
        ]
      : [purpose, 'ping'];
  const [event, setEvent] = useState<WebhookEventName>(purpose);
  const example = WEBHOOK_EXAMPLES[event];
  const idHeader =
    'delivery' in example
      ? {
          name: 'X-Nudge-Delivery',
          value: example.delivery.id,
          help: p.headerHelp.delivery,
        }
      : event === 'incidents.held'
        ? {
            name: 'X-Nudge-Summary',
            value: WEBHOOK_EXAMPLES['incidents.held'].id,
            help: p.headerHelp.summary,
          }
        : event === 'alert'
          ? {
              name: 'X-Nudge-Alert',
              value: WEBHOOK_EXAMPLES.alert.alert.id,
              help: p.headerHelp.alert,
            }
          : null;
  const headers = [
    { name: 'Content-Type', value: 'application/json', help: null },
    { name: 'X-Nudge-Event', value: event, help: p.headerHelp.event },
    ...(idHeader ? [idHeader] : []),
    { name: 'X-Nudge-Timestamp', value: '1792834200', help: p.headerHelp.timestamp },
    { name: 'X-Nudge-Signature', value: 'sha256=5d41402a…', help: p.headerHelp.signature },
  ];
  return (
    <details className="payload" open>
      <summary>{p.show}</summary>
      <div className="payload-body">
        <fieldset className="segmented">
          <legend className="visually-hidden">{p.event}</legend>
          {events.map((name) => (
            <label key={name}>
              <input
                type="radio"
                name={`${id}-event`}
                value={name}
                checked={event === name}
                onChange={() => setEvent(name)}
              />
              {p.events[name]}
            </label>
          ))}
        </fieldset>
        <p className="help">{p.eventHelp[event]}</p>

        <h4>{p.request}</h4>
        <p className="payload-request">
          <code>POST</code> <code>{url}</code>
        </p>

        <h4>{p.headers}</h4>
        <dl className="payload-headers">
          {headers.map((header) => (
            <div key={header.name}>
              <dt>
                <code>{header.name}</code>
              </dt>
              <dd>
                <code>{header.value}</code>
                {header.help ? <span className="help">{header.help}</span> : null}
              </dd>
            </div>
          ))}
        </dl>

        <h4>{p.body}</h4>
        <CopyableValue
          label={`${p.body} (${p.events[event]})`}
          value={JSON.stringify(example, null, 2)}
          multiline
        />

        <h4>{p.verify}</h4>
        <p className="help">{p.verifyHelp}</p>
        <CopyableValue label={p.verify} value={VERIFY_SNIPPET} multiline />
      </div>
    </details>
  );
}

export const webhookForm: DestinationTypeForm<'webhook'> = {
  label: 'Webhook',
  icon: TYPE_ICONS.webhook,
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
