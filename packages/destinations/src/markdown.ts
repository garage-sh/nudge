import { presentAlert, type Alert } from '@nudge/core';

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
