import {
  presentAlert,
  presentHeldSummary,
  presentIncident,
  type Alert,
  type OutgoingHeldSummary,
  type OutgoingIncidentClosing,
  type OutgoingIncidentDelivery,
} from '@nudge/core';

/**
 * CommonMark escaping shared by the Destinations that render markdown (Linear,
 * GitHub): every ASCII punctuation character may be preceded by a backslash, which
 * makes it literal (https://spec.commonmark.org/0.31.2/#backslash-escapes).
 */
export const escapePunctuation = (text: string): string => text.replace(/[!-/:-@[-`{-~]/g, '\\$&');

/** A dashboard link that can be written as is between angle brackets: `[text](<link>)`. */
export const isSafeLink = (link: string | null): link is string =>
  link !== null && /^https?:\/\/[^\s<>]+$/.test(link);

/**
 * The markdown body of an alert (Linear, GitHub issue): the summary, each detail as a
 * paragraph, its value passed through `escape`, then the link to the dashboard.
 */
export function alertToMarkdown(alert: Alert, escape: (text: string) => string): string {
  const { summary, details } = presentAlert(alert);
  return [
    summary,
    ...details.map(({ label, value }) => `**${label}**: ${escape(value)}`),
    ...(isSafeLink(alert.dashboardUrl) ? [`[Open in nudge](<${alert.dashboardUrl}>)`] : []),
  ].join('\n\n');
}

/**
 * The markdown of an Incident (Linear, GitHub issue or closing comment): the summary,
 * each detail as a paragraph, then the link to the dashboard. The summary and the
 * values carry the sender's and the Members' text: both go through `escape`.
 */
export function incidentToMarkdown(
  delivery: OutgoingIncidentDelivery | OutgoingIncidentClosing,
  escape: (text: string) => string,
): string {
  const { summary, details } = presentIncident(delivery);
  const { dashboardUrl } = delivery.incident;
  return [
    escape(summary),
    ...details.map(({ label, value }) => `**${label}**: ${escape(value)}`),
    ...(isSafeLink(dashboardUrl) ? [`[View the Incident in nudge](<${dashboardUrl}>)`] : []),
  ].join('\n\n');
}

/**
 * The markdown body of the summary of Held Incidents (Linear, GitHub issue): the summary,
 * each detail as a paragraph, its value passed through `escape` (the Project name is
 * typed by a Member), then the link to the Held Incidents in the dashboard.
 */
export function heldSummaryToMarkdown(
  held: OutgoingHeldSummary,
  escape: (text: string) => string,
): string {
  const { summary, details } = presentHeldSummary(held);
  return [
    summary,
    ...details.map(({ label, value }) => `**${label}**: ${escape(value)}`),
    ...(isSafeLink(held.dashboardUrl)
      ? [`[View the Held Incidents in nudge](<${held.dashboardUrl}>)`]
      : []),
  ].join('\n\n');
}
