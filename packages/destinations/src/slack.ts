import {
  presentAlert,
  presentHeldSummary,
  presentIncident,
  type Alert,
  type OutgoingHeldSummary,
  type PresentedAlert,
  type OutgoingIncidentClosing,
  type OutgoingIncidentDelivery,
  type FailureClass,
  type DestinationAdapter,
  type ConfiguredDestination,
  type OutgoingDelivery,
  type DeliveryResult,
} from '@nudge/core';
import {
  SEVERITY_LABELS,
  FEEDBACK_TYPE_LABELS,
  parseSlackWebhook,
  type SlackSecrets,
} from '@nudge/shared';
import { truncate } from './text.js';
import {
  DEFAULT_HTTP_TIMEOUT_MS,
  classifyStatus,
  httpFailure,
  errorMessage,
  responseText,
} from './http.js';

export interface SlackOptions {
  readonly fetch?: typeof globalThis.fetch;
  /** Slack response timeout, beyond which the call is a transient failure. */
  readonly timeoutMs?: number;
}

/**
 * Slack: an incoming webhook, tied to a channel
 * (https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks). It answers
 * `ok` and nothing else: a posted message cannot be found again, to reply in its thread
 * or edit it.
 */
export function slackAdapter(
  destination: ConfiguredDestination,
  options: SlackOptions = {},
): DestinationAdapter {
  const url = parseSlackWebhook((destination.secrets as Partial<SlackSecrets>).url ?? '');
  if (!url) throw new Error(`Slack ${destination.id} has no valid webhook URL`);
  const fetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;

  const post = (body: unknown) =>
    fetch(url, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  /** The incoming webhook returns no permalink: a delivered message has no link. */
  async function publish(body: unknown): Promise<DeliveryResult> {
    let response: Response;
    try {
      response = await post(body);
    } catch (error) {
      return { status: 'failed', failureClass: 'transient', message: errorMessage(error) };
    }
    if (!response.ok) return { status: 'failed', ...(await slackFailure(response)) };
    await response.body?.cancel();
    return { status: 'delivered', externalUrl: null };
  }

  return {
    send: (delivery) => publish(slackBody(delivery)),
    deliverIncident: (delivery) => publish(incidentBody(delivery)),
    /**
     * An incoming webhook returns no message id: the closing cannot go in the opening's
     * thread nor edit it. It is a message of its own, titled like the opening.
     */
    closeIncident: (closing) => publish(incidentBody(closing)),
    summarizeHeld: (summary) => publish(heldSummaryBody(summary)),
    alert: (alert) => publish(alertBody(alert)),
    /**
     * An incoming webhook cannot be read: the probe posts it an empty message, which it
     * rejects without publishing anything. `no_text` ("the `text` attribute was missing
     * from the payload") or `invalid_payload` prove that the webhook exists and accepts
     * posts; a deleted webhook answers `no_service`, a rejected token `invalid_token`.
     */
    async healthCheck() {
      let response: Response;
      try {
        response = await post({});
      } catch (error) {
        return { reachable: false, failureClass: 'transient', message: errorMessage(error) };
      }
      const code = await responseText(response);
      if (response.ok || (response.status === 400 && EMPTY_MESSAGE_CODES.has(code))) {
        await response.body?.cancel();
        return { reachable: true };
      }
      return { reachable: false, ...(await slackFailure(response)) };
    },
  };
}

/**
 * Incoming webhook error codes that reject every Delivery, not just this message:
 * webhook deleted or disabled, invalid token, inactive workspace, channel or user not
 * found, archived channel, posting forbidden by an admin
 * (https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks). The
 * Destination is then Suspended rather than each Delivery failing (D21).
 */
const REJECTED_WEBHOOK_CODES = new Set([
  'action_prohibited',
  'channel_is_archived',
  'channel_not_found',
  'invalid_token',
  'no_active_hooks',
  'no_service',
  'no_service_id',
  'no_team',
  'posting_to_general_channel_denied',
  'team_disabled',
  'user_not_found',
]);

/** Answers of a live webhook to the probe's empty message. */
const EMPTY_MESSAGE_CODES = new Set(['no_text', 'invalid_payload']);

/**
 * Class of a Slack refusal, which answers in plain text with an error code. 404 and 410
 * (webhook or channel gone) reject the Destination like 401 and 403; the other 4xx
 * (`invalid_payload`, `no_text`…) target this message.
 */
async function slackFailure(
  response: Response,
): Promise<{ failureClass: FailureClass; message: string }> {
  const code = await responseText(response);
  return httpFailure(response, (status) =>
    REJECTED_WEBHOOK_CODES.has(code) || status === 404 || status === 410
      ? 'auth'
      : classifyStatus(status),
  );
}

function slackBody({ isTest, project, feedback }: OutgoingDelivery) {
  const type = FEEDBACK_TYPE_LABELS[feedback.resolvedType];
  const severity = feedback.severity ? SEVERITY_LABELS[feedback.severity] : 'Not assessed';
  // Typed by a Member: no `@channel` either, as in the alerts.
  const projectName = slackText(project.name);
  const title = `${isTest ? 'Test · ' : ''}${type} · ${projectName}`;
  const footer = [
    feedback.uncertain ? 'nudge · Uncertain verdict' : 'nudge',
    ...(isSafeSlackLink(feedback.dashboardUrl)
      ? [`<${feedback.dashboardUrl}|View the feedback in nudge>`]
      : []),
  ];
  return {
    // Fallback text of notifications: never the Author's text.
    text: title,
    blocks: [
      { type: 'section', text: mrkdwn(`*${title}*`) },
      { type: 'section', text: mrkdwn(codeBlock(feedback.text)) },
      {
        type: 'section',
        fields: [
          mrkdwn(`*Type*\n${type}`),
          mrkdwn(`*Severity*\n${severity}`),
          mrkdwn(`*Project*\n${projectName}`),
        ],
      },
      { type: 'context', elements: [mrkdwn(footer.join(' · '))] },
    ],
  };
}

/**
 * The alert as blocks: the names (typed by a Member) and the refusal (worded by the
 * target) go through control-character escaping, with mentions broken.
 */
function alertBody(alert: Alert) {
  return noticeBody(
    presentAlert(alert),
    alert.isTest ? 'nudge · test alert' : 'nudge · alert',
    alert.dashboardUrl,
  );
}

/** The summary of Held Incidents, as blocks like an alert: the Project name is escaped. */
function heldSummaryBody(summary: OutgoingHeldSummary) {
  return noticeBody(presentHeldSummary(summary), 'nudge · Incidents held', summary.dashboardUrl);
}

/**
 * A message written by nudge (alert, summary of Held Incidents): its title and details
 * escaped, its summary as is, a footer and the dashboard link.
 */
function noticeBody(
  { title, summary, details }: PresentedAlert,
  label: string,
  dashboardUrl: string | null,
) {
  const footer = [
    label,
    ...(isSafeSlackLink(dashboardUrl) ? [`<${dashboardUrl}|Open in nudge>`] : []),
  ];
  return {
    text: slackText(title),
    blocks: [
      { type: 'section', text: mrkdwn(`*${slackText(title)}*`) },
      { type: 'section', text: mrkdwn(summary) },
      {
        type: 'section',
        fields: details.map(({ label, value }) =>
          mrkdwn(`*${label}*\n${truncate(slackText(value), FIELD_MAX)}`),
        ),
      },
      { type: 'context', elements: [mrkdwn(footer.join(' · '))] },
    ],
  };
}

/**
 * An Incident as blocks: its title, what happened, the short details as fields and the
 * long ones (message, context) in code blocks. Every text of the sender goes through
 * the same encoding as the Author's text of a Feedback.
 */
function incidentBody(delivery: OutgoingIncidentDelivery | OutgoingIncidentClosing) {
  const { title, summary, details } = presentIncident(delivery);
  const short = details.filter((detail) => !detail.long);
  const long = details.filter((detail) => detail.long);
  const { dashboardUrl } = delivery.incident;
  const footer = [
    'nudge · Incident',
    ...(isSafeSlackLink(dashboardUrl) ? [`<${dashboardUrl}|Open in nudge>`] : []),
  ];
  return {
    text: truncate(slackText(title), FIELD_MAX),
    blocks: [
      { type: 'section', text: mrkdwn(`*${truncate(slackText(title), FIELD_MAX)}*`) },
      { type: 'section', text: mrkdwn(slackText(summary)) },
      {
        type: 'section',
        fields: short.map(({ label, value }) =>
          mrkdwn(`*${label}*\n${truncate(slackText(value), FIELD_MAX)}`),
        ),
      },
      ...long.flatMap(({ label, value }) => [
        { type: 'section', text: mrkdwn(`*${label}*`) },
        { type: 'section', text: mrkdwn(codeBlock(value)) },
      ]),
      { type: 'context', elements: [mrkdwn(footer.join(' · '))] },
    ],
  };
}

/** Length of a section field (docs.slack.dev, Section block: 2000), margin included. */
const FIELD_MAX = 1900;

/**
 * A `verbatim` mrkdwn text object: Slack does not transform its raw text ("URLs
 * will [not] be auto-converted into links, conversation names will [not] be
 * link-ified", https://docs.slack.dev/reference/block-kit/composition-objects/text-object).
 */
const mrkdwn = (text: string) => ({ type: 'mrkdwn', text, verbatim: true });

/** A dashboard link that can be written as is in `<url|text>`. */
const isSafeSlackLink = (link: string | null): link is string =>
  link !== null && /^https?:\/\/[^\s<>|]+$/.test(link);

/** Maximum length of a section's text (docs.slack.dev, Section block). */
const SECTION_MAX = 3000;

const ZERO_WIDTH = '​';
const OPENING = '```\n';
const CLOSING = '\n```';

/**
 * The Author's text in a code block: Slack applies no formatting there.
 * `&`, `<` and `>`, Slack's "control characters", are escaped: no mention
 * (`<!channel>`, `<@U…>`), link or date is interpreted. A run of backticks is broken
 * by a zero-width space, so the text never closes the block; `@channel`, `@here` and
 * `@everyone` are too, in case the text escaped it. Bounded to a section's length,
 * without splitting an entity.
 */
function codeBlock(text: string): string {
  const max = SECTION_MAX - OPENING.length - CLOSING.length;
  const encoded = neutralizeBroadMentions(text).replace(/`(?=`)/g, `\`${ZERO_WIDTH}`);
  let bounded = '';
  for (const char of encoded) {
    const part = escapeControls(char);
    if (bounded.length + part.length > max - 1) {
      bounded += '…';
      break;
    }
    bounded += part;
  }
  return `${OPENING}${bounded}${CLOSING}`;
}

/** A text from outside nudge shown as is: control characters escaped, broad mentions broken. */
const slackText = (raw: string) => escapeControls(neutralizeBroadMentions(raw));

/** Escaping of Slack's control characters (docs.slack.dev, Formatting message text). */
const escapeControls = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const neutralizeBroadMentions = (text: string) =>
  text.replace(/@(channel|here|everyone)/gi, `@${ZERO_WIDTH}$1`);
