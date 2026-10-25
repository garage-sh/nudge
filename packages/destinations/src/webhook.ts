import { createHmac } from 'node:crypto';
import {
  presentAlert,
  type Alert,
  type DestinationAdapter,
  type ConfiguredDestination,
  type OutgoingDelivery,
  type DeliveryResult,
} from '@nudge/core';
import {
  webhookDefinition,
  type WebhookAlertEvent,
  type WebhookEventName,
  type WebhookFeedbackEvent,
  type WebhookPingEvent,
  type WebhookSecrets,
} from '@nudge/shared';
import { readCapture, type CaptureImage } from './capture.js';
import { DEFAULT_HTTP_TIMEOUT_MS, httpFailure, errorMessage } from './http.js';

export interface WebhookOptions {
  readonly fetch?: typeof globalThis.fetch;
  /** Clock of the signed timestamp (tests). */
  readonly now?: () => Date;
  /** Receiver response timeout, beyond which the call is a transient failure. */
  readonly timeoutMs?: number;
}

/**
 * Generic webhook (D10): a JSON POST to the configured URL, per event (bodies typed in
 * `@nudge/shared`, whose examples the dashboard shows):
 * - `feedback`: a dispatched piece of Feedback (`isTest: true` for the "test" button);
 * - `alert`: an alert for the Members, when the webhook is the Alert destination;
 * - `ping`: the `healthCheck()` probe, which the receiver answers with a 2xx.
 *
 * Headers: `X-Nudge-Event`, `X-Nudge-Delivery` or `X-Nudge-Alert` (stable id of a
 * Delivery or an alert: a receiver uses it to ignore a retried delivery),
 * `X-Nudge-Timestamp` (Unix seconds) and `X-Nudge-Signature: sha256=<hex>`,
 * HMAC-SHA256 of `<timestamp>.<raw body>` with the Destination's signing secret.
 *
 * The Feedback text is sent raw, as the Author wrote it: it is up to the receiver to
 * encode it for its target. The Capture, if any, is attached in base64
 * (`feedback.capture: { contentType, data }`, `null` otherwise). Redirects are not
 * followed.
 */
export function webhookAdapter(
  destination: ConfiguredDestination,
  options: WebhookOptions = {},
): DestinationAdapter {
  const { url } = webhookDefinition.config.parse(destination.config);
  const { signingSecret } = destination.secrets as Partial<WebhookSecrets>;
  if (!signingSecret) throw new Error(`Webhook ${destination.id} has no signing secret`);
  const fetch = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;

  async function post(
    event: WebhookEventName,
    body: WebhookFeedbackEvent | WebhookAlertEvent | WebhookPingEvent,
    idHeaders: Readonly<Record<string, string>> = {},
  ): Promise<DeliveryResult> {
    const raw = JSON.stringify(body);
    const timestamp = String(Math.floor(now().getTime() / 1000));
    const signature = createHmac('sha256', signingSecret!)
      .update(`${timestamp}.${raw}`)
      .digest('hex');
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'content-type': 'application/json',
          'user-agent': 'nudge-webhook',
          'x-nudge-event': event,
          ...idHeaders,
          'x-nudge-timestamp': timestamp,
          'x-nudge-signature': `sha256=${signature}`,
        },
        body: raw,
      });
    } catch (error) {
      return { status: 'failed', failureClass: 'transient', message: errorMessage(error) };
    }
    if (response.ok) {
      await response.body?.cancel();
      return { status: 'delivered', externalUrl: null };
    }
    return { status: 'failed', ...(await httpFailure(response)) };
  }

  return {
    async send(delivery) {
      const capture = await readCapture(delivery.feedback.capture);
      if (!capture.ok)
        return { status: 'failed', failureClass: capture.failureClass, message: capture.message };
      return post('feedback', feedbackBody(delivery, capture.image), {
        'x-nudge-delivery': delivery.deliveryId,
      });
    },
    alert(alert) {
      return post('alert', alertBody(alert), { 'x-nudge-alert': alert.id });
    },
    async healthCheck() {
      const result = await post('ping', { event: 'ping' });
      return result.status === 'delivered'
        ? { reachable: true }
        : { reachable: false, failureClass: result.failureClass, message: result.message };
    },
  };
}

function feedbackBody(
  { deliveryId, isTest, project, feedback }: OutgoingDelivery,
  capture: CaptureImage | null,
): WebhookFeedbackEvent {
  return {
    event: 'feedback',
    isTest,
    delivery: { id: deliveryId },
    project: { id: project.id, name: project.name },
    feedback: {
      id: feedback.id,
      text: feedback.text,
      source: feedback.source,
      type: feedback.resolvedType,
      severity: feedback.severity,
      uncertain: feedback.uncertain,
      author: feedback.author
        ? {
            id: feedback.author.id ?? null,
            email: feedback.author.email ?? null,
            name: feedback.author.name ?? null,
            trust: feedback.author.trust,
          }
        : null,
      context: feedback.context,
      capture: capture
        ? {
            contentType: capture.contentType,
            data: Buffer.from(capture.bytes).toString('base64'),
          }
        : null,
      receivedAt: feedback.receivedAt.toISOString(),
      dashboardUrl: feedback.dashboardUrl,
    },
  };
}

/** The structured alert, and its text (`title`, `summary`) for whoever relays it as is. */
function alertBody(alert: Alert): WebhookAlertEvent {
  const { title, summary } = presentAlert(alert);
  const common = {
    id: alert.id,
    at: alert.at.toISOString(),
    title,
    summary,
    project: { id: alert.project.id, name: alert.project.name },
    dashboardUrl: alert.dashboardUrl,
  };
  return {
    event: 'alert',
    isTest: alert.isTest,
    alert:
      alert.event === 'feedback_in_review'
        ? { ...common, type: alert.event, feedback: { id: alert.feedback.id } }
        : {
            ...common,
            type: alert.event,
            destination: {
              id: alert.destination.id,
              name: alert.destination.name,
              failureClass: alert.destination.failureClass,
              message: alert.destination.message,
            },
          },
  };
}
