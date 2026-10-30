import { createHmac } from 'node:crypto';
import {
  presentAlert,
  presentHeldSummary,
  presentIncident,
  type Alert,
  type OutgoingHeldSummary,
  type OutgoingIncident,
  type DestinationAdapter,
  type ConfiguredDestination,
  type OutgoingDelivery,
  type DeliveryResult,
} from '@nudge/core';
import {
  webhookDefinition,
  type WebhookAlertEvent,
  type WebhookHeldSummaryEvent,
  type WebhookEventName,
  type WebhookFeedbackEvent,
  type WebhookIncidentEvent,
  type WebhookPingEvent,
  type WebhookSecrets,
} from '@nudge/shared';
import { readCapture, type CaptureImage } from './capture.js';
import { DEFAULT_HTTP_TIMEOUT_MS, httpFailure, networkFailure } from './http.js';

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
 * - `incident.opened`, `incident.raised`: an Incident that opened, or whose Level rose to
 *   reach this Destination, with its stable id;
 * - `incident.closed`: the closing of that Incident, on the same Delivery; also the single
 *   event of an Incident that closed before its opening could be delivered;
 * - `incidents.held`: the summary of the Incidents a storm held, once the Project is back
 *   under its Opening cap;
 * - `alert`: an alert for the Members, when the webhook is the Alert destination;
 * - `ping`: the `healthCheck()` probe, which the receiver answers with a 2xx.
 *
 * Headers: `X-Nudge-Event`, `X-Nudge-Delivery`, `X-Nudge-Summary` or `X-Nudge-Alert`
 * (stable id of a Delivery, a summary or an alert: a receiver uses it to ignore a retried
 * delivery),
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
    body:
      | WebhookFeedbackEvent
      | WebhookIncidentEvent
      | WebhookHeldSummaryEvent
      | WebhookAlertEvent
      | WebhookPingEvent,
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
      return { status: 'failed', ...networkFailure(error) };
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
    deliverIncident(delivery) {
      const body = incidentBody(delivery);
      return post(body.event, body, { 'x-nudge-delivery': delivery.deliveryId });
    },
    closeIncident(closing) {
      const body = incidentBody(closing);
      return post(body.event, body, { 'x-nudge-delivery': closing.deliveryId });
    },
    summarizeHeld(summary) {
      return post('incidents.held', heldSummaryBody(summary), { 'x-nudge-summary': summary.id });
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

/**
 * The structured Incident, and its text (`title`, `summary`) for whoever relays it as is.
 * A Closed Incident is always `incident.closed`: its closing, or its single delivery.
 */
function incidentBody(delivery: OutgoingIncident): WebhookIncidentEvent {
  const { deliveryId, project, moment, incident } = delivery;
  const { title, summary } = presentIncident(delivery);
  const { closure } = incident;
  return {
    event: closure
      ? 'incident.closed'
      : moment === 'raised'
        ? 'incident.raised'
        : 'incident.opened',
    delivery: { id: deliveryId },
    project: { id: project.id, name: project.name },
    title,
    summary,
    incident: {
      id: incident.id,
      state: incident.state,
      title: incident.title,
      message: incident.message,
      environment: incident.environment,
      context: incident.context,
      level: incident.level,
      levelOrigin: incident.levelOrigin,
      fingerprint: incident.fingerprint,
      occurrences: incident.occurrences,
      firstSeenAt: incident.firstSeenAt.toISOString(),
      lastSeenAt: incident.lastSeenAt.toISOString(),
      closure: closure ? { cause: closure.cause, closedAt: closure.closedAt.toISOString() } : null,
      dashboardUrl: incident.dashboardUrl,
    },
  };
}

/** The structured summary of Held Incidents, and its text for whoever relays it as is. */
function heldSummaryBody(summary: OutgoingHeldSummary): WebhookHeldSummaryEvent {
  const { title, summary: text } = presentHeldSummary(summary);
  return {
    event: 'incidents.held',
    id: summary.id,
    project: { id: summary.project.id, name: summary.project.name },
    title,
    summary: text,
    held: {
      count: summary.held.count,
      firstOpenedAt: summary.held.firstOpenedAt.toISOString(),
      lastOpenedAt: summary.held.lastOpenedAt.toISOString(),
    },
    dashboardUrl: summary.dashboardUrl,
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
  return { event: 'alert', isTest: alert.isTest, alert: alertDetails(alert, common) };
}

function alertDetails<Common extends object>(alert: Alert, common: Common) {
  switch (alert.event) {
    case 'feedback_in_review':
      return { ...common, type: alert.event, feedback: { id: alert.feedback.id } };
    case 'destination_suspended':
      return {
        ...common,
        type: alert.event,
        destination: {
          id: alert.destination.id,
          name: alert.destination.name,
          failureClass: alert.destination.failureClass,
          message: alert.destination.message,
        },
      };
    case 'incident_storm':
      return {
        ...common,
        type: alert.event,
        storm: {
          held: alert.storm.held,
          cap: alert.storm.cap,
          startedAt: alert.storm.startedAt.toISOString(),
        },
      };
  }
}
