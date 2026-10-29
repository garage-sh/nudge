import {
  presentAlert,
  presentIncident,
  type Alert,
  type MailMessage,
  type OutgoingDelivery,
  type OutgoingIncidentClosing,
  type OutgoingIncidentDelivery,
} from '@nudge/core';
import {
  FEEDBACK_TYPE_LABELS,
  LEVEL_LABELS,
  SEVERITY_LABELS,
  type Level,
  type Severity,
  type Source,
} from '@nudge/shared';
import { isSafeLink } from './markdown.js';
import { firstLine, truncate } from './text.js';

/*
 * The emails nudge sends, in its own colors: the dashboard's tokens
 * (apps/dashboard/src/styles.css), written inline because most mail clients drop a
 * stylesheet. Tables for the layout, no image (the mark is drawn with cells), no
 * external resource: the message renders the same offline and tracks nobody.
 */

const COLORS = {
  frame: '#e3e9e6',
  canvas: '#f6f8f7',
  surface: '#ffffff',
  text: '#16201c',
  muted: '#5b6762',
  border: '#dce2df',
  accent: '#176a52',
  accentSoft: '#e3f0eb',
  held: '#9a5b00',
  heldSoft: '#fdf1dc',
  review: '#5a48c8',
  reviewSoft: '#eeebfb',
} as const;

/** The Severity ramp of the dashboard, from cosmetic to blocking. */
const SEVERITY_COLORS: Readonly<Record<Severity, string>> = {
  cosmetic: '#87938e',
  minor: '#b7791f',
  major: '#d0531d',
  blocking: '#b4161b',
};

const FONT =
  "'Instrument Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

const SOURCE_LABELS: Readonly<Record<Source, string>> = {
  widget: 'Widget',
  api: 'API',
  extension: 'Extension',
};

/** Longest subject line: clients cut it well before, the rest is noise. */
const SUBJECT_MAX = 150;

/** Text from outside (the Author, a Member, a target) made inert in HTML. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A header carries one line: line breaks and runs of spaces collapse. */
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

const subject = (text: string) => truncate(oneLine(`[nudge] ${text}`), SUBJECT_MAX);

interface Detail {
  readonly label: string;
  readonly value: string;
  /** Monospace: an identifier, a URL. */
  readonly code?: boolean;
}

interface Pill {
  readonly label: string;
  readonly color: string;
  readonly background: string;
  /** A colored dot before the label: the Severity ramp, readable whatever its contrast. */
  readonly dot?: string;
}

interface EmailContent {
  /** Above the title, in small capitals: the kind of message. */
  readonly eyebrow: string;
  readonly title: string;
  readonly pills: readonly Pill[];
  /** A banner above everything (a test). */
  readonly notice: string | null;
  readonly intro: string | null;
  /** The Author's text, kept as written (line breaks included). */
  readonly quote: string | null;
  readonly details: readonly Detail[];
  readonly action: { readonly label: string; readonly url: string } | null;
  readonly footer: string;
  /** Color of the stripe at the top of the card. */
  readonly stripe: string;
}

/** A Feedback dispatched to an email Destination. */
export function feedbackEmail(delivery: OutgoingDelivery, to: readonly string[]): MailMessage {
  const { isTest, project, feedback } = delivery;
  const type = FEEDBACK_TYPE_LABELS[feedback.resolvedType];
  const severity = feedback.severity;
  const author = feedback.author;
  const authorText = author
    ? [author.name, author.email ? `<${author.email}>` : null, author.id ? `(${author.id})` : null]
        .filter(Boolean)
        .join(' ') || 'Anonymous'
    : 'Anonymous';
  const viewport = feedback.context.viewport;
  const details: Detail[] = [
    { label: 'Project', value: project.name },
    {
      label: 'Author',
      value: author
        ? `${authorText}${author.trust === 'attested' ? ' · attested' : ''}`
        : authorText,
    },
    ...(feedback.context.url ? [{ label: 'Page', value: feedback.context.url, code: true }] : []),
    ...(viewport ? [{ label: 'Viewport', value: `${viewport.width} × ${viewport.height}` }] : []),
    ...(feedback.context.userAgent
      ? [{ label: 'Browser', value: feedback.context.userAgent, code: true }]
      : []),
    { label: 'Source', value: SOURCE_LABELS[feedback.source] },
    { label: 'Received', value: utc(feedback.receivedAt) },
    ...(feedback.capture ? [{ label: 'Capture', value: 'Attached to this email' }] : []),
    { label: 'Feedback', value: feedback.id, code: true },
  ];
  const content: EmailContent = {
    eyebrow: 'New feedback',
    title: `${type} · ${project.name}`,
    pills: [
      { label: type, color: COLORS.accent, background: COLORS.accentSoft },
      severity
        ? {
            label: SEVERITY_LABELS[severity],
            color: COLORS.text,
            background: COLORS.canvas,
            dot: SEVERITY_COLORS[severity],
          }
        : { label: 'Severity not assessed', color: COLORS.muted, background: COLORS.canvas },
      ...(feedback.uncertain
        ? [{ label: 'Uncertain verdict', color: COLORS.review, background: COLORS.reviewSoft }]
        : []),
    ],
    notice: isTest ? 'Test · a sample Feedback, sent to check this Destination.' : null,
    intro: null,
    quote: feedback.text,
    details,
    action: isSafeLink(feedback.dashboardUrl)
      ? { label: 'Open in nudge', url: feedback.dashboardUrl }
      : null,
    footer: `You receive this email because this address is a recipient of an email Destination of the ${project.name} project in nudge.`,
    stripe: severity ? SEVERITY_COLORS[severity] : COLORS.accent,
  };
  const line = firstLine(feedback.text);
  return {
    to,
    subject: subject(
      `${isTest ? 'Test · ' : ''}${type} · ${project.name}${line ? ` · ${line}` : ''}`,
    ),
    html: render(content),
    text: plainText(content),
  };
}

/** An alert for the Members, when an email Destination is the Alert destination. */
export function alertEmail(alert: Alert, to: readonly string[]): MailMessage {
  const { title, summary, details } = presentAlert(alert);
  const content: EmailContent = {
    eyebrow: alert.event === 'feedback_in_review' ? 'Review needed' : 'Destination suspended',
    title,
    pills: [],
    notice: alert.isTest ? 'Test · a sample alert, sent to check the Alert destination.' : null,
    intro: summary,
    quote: null,
    details: [
      ...details.map(({ label, value, long }) => ({ label, value, code: long ?? false })),
      { label: 'At', value: utc(alert.at) },
    ],
    action: isSafeLink(alert.dashboardUrl)
      ? { label: 'Open in nudge', url: alert.dashboardUrl }
      : null,
    footer:
      'You receive this email because this address receives the alerts of a nudge Instance (its Alert destination).',
    stripe: alert.event === 'feedback_in_review' ? COLORS.review : COLORS.held,
  };
  return { to, subject: subject(title), html: render(content), text: plainText(content) };
}

/** The Level ramp, from info to critical, on the Severity one. */
const LEVEL_COLORS: Readonly<Record<Level, string>> = {
  info: '#87938e',
  warning: '#b7791f',
  error: '#d0531d',
  critical: '#b4161b',
};

/**
 * An Incident Delivery to an email Destination: its opening (or a Level rise that reached
 * the Destination), then its closing as a reply to that mail. Both carry the subject of
 * the opening, which names no Level (it may rise in between), and the closing names the
 * opening's Message-ID: mail clients thread them. An Incident that closed before its
 * opening went out is a single mail, in its final state.
 */
export function incidentEmail(
  delivery: OutgoingIncidentDelivery | OutgoingIncidentClosing,
  to: readonly string[],
): MailMessage {
  const { deliveryId, project, incident } = delivery;
  const { title, summary, details } = presentIncident(delivery);
  const closing = delivery.moment === 'closed';
  const level = LEVEL_LABELS[incident.level];
  const content: EmailContent = {
    eyebrow: incident.closure
      ? 'Incident closed'
      : delivery.moment === 'raised'
        ? 'Incident Level raised'
        : 'Incident opened',
    title,
    pills: [
      {
        label: level,
        color: COLORS.text,
        background: COLORS.canvas,
        dot: LEVEL_COLORS[incident.level],
      },
      ...(incident.environment
        ? [{ label: incident.environment, color: COLORS.muted, background: COLORS.canvas }]
        : []),
      ...(incident.closure
        ? [{ label: 'Closed', color: COLORS.accent, background: COLORS.accentSoft }]
        : []),
    ],
    notice: null,
    intro: summary,
    quote: null,
    details: [
      ...details.map(({ label, value, long }) => ({ label, value, code: long ?? false })),
      { label: 'Incident', value: incident.id, code: true },
    ],
    action: isSafeLink(incident.dashboardUrl)
      ? { label: 'Open in nudge', url: incident.dashboardUrl }
      : null,
    footer: `You receive this email because this address is a recipient of an email Destination of the ${project.name} project in nudge.`,
    stripe: incident.closure ? COLORS.accent : LEVEL_COLORS[incident.level],
  };
  const openingId = `incident.${deliveryId}`;
  const openingSubject = subject(`Incident · ${project.name} · ${incident.title}`);
  return {
    to,
    subject: closing ? `Re: ${openingSubject}` : openingSubject,
    html: render(content),
    text: plainText(content),
    ...(closing
      ? { messageId: `${openingId}.closed`, inReplyTo: openingId }
      : { messageId: openingId }),
  };
}

/** The message sent by the "send a test email" button of the SMTP settings. */
export function smtpTestEmail(to: string): MailMessage {
  const content: EmailContent = {
    eyebrow: 'SMTP settings',
    title: 'Your SMTP server works',
    pills: [],
    notice: null,
    intro:
      'nudge reached your SMTP server and sent this message through it. Email Destinations and an email Alert destination will use the same server.',
    quote: null,
    details: [{ label: 'Sent', value: utc(new Date()) }],
    action: null,
    footer: 'You receive this email because you asked for a test email in the settings of nudge.',
    stripe: COLORS.accent,
  };
  return {
    to: [to],
    subject: subject('Test email'),
    html: render(content),
    text: plainText(content),
  };
}

const utc = (date: Date) => `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

function render(content: EmailContent): string {
  const e = escapeHtml;
  const pills = content.pills
    .map(
      (pill) =>
        `<span style="display:inline-block;margin:0 6px 6px 0;padding:2px 10px;border-radius:999px;background:${pill.background};color:${pill.color};font-size:12px;font-weight:600;line-height:18px;">${pill.dot ? `<span style="color:${pill.dot};">&#9679;</span>&nbsp;` : ''}${e(pill.label)}</span>`,
    )
    .join('');
  const notice = content.notice
    ? `<tr><td style="padding:10px 28px;background:${COLORS.heldSoft};color:${COLORS.held};font-size:13px;font-weight:600;">${e(content.notice)}</td></tr>`
    : '';
  const intro = content.intro
    ? `<p style="margin:0 0 20px;font-size:15px;line-height:22px;color:${COLORS.text};">${e(content.intro)}</p>`
    : '';
  const quote = content.quote
    ? `<div class="nudge-quote" style="margin:0 0 24px;padding:14px 16px;background:${COLORS.canvas};border:1px solid ${COLORS.border};border-left:3px solid ${COLORS.accent};border-radius:6px;font-size:15px;line-height:23px;color:${COLORS.text};white-space:pre-wrap;word-break:break-word;">${e(content.quote)}</div>`
    : '';
  const details = content.details
    .map(
      (detail, index) =>
        `<tr><td class="nudge-label" valign="top" style="padding:8px 12px 8px 0;${index > 0 ? `border-top:1px solid ${COLORS.border};` : ''}width:110px;font-size:13px;line-height:20px;color:${COLORS.muted};">${e(detail.label)}</td><td valign="top" style="padding:8px 0;${index > 0 ? `border-top:1px solid ${COLORS.border};` : ''}font-size:13px;line-height:20px;color:${COLORS.text};word-break:break-word;${detail.code ? `font-family:${MONO};font-size:12px;` : ''}">${e(detail.value)}</td></tr>`,
    )
    .join('');
  const action = content.action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0;"><tr><td style="border-radius:6px;background:${COLORS.accent};"><a href="${e(content.action.url)}" style="display:inline-block;padding:10px 18px;font-size:14px;font-weight:600;line-height:20px;color:#ffffff;text-decoration:none;border-radius:6px;">${e(content.action.label)} &rarr;</a></td></tr></table>`
    : '';
  // The mark: four rising bars, as in docs/assets/mark.svg.
  const bar = (height: number) =>
    `<td valign="bottom" style="padding:0 2px 0 0;"><div style="width:4px;height:${height}px;background:${COLORS.accent};border-radius:1px;font-size:0;line-height:0;">&nbsp;</div></td>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${e(content.title)}</title>
<style>
  @media (prefers-color-scheme: dark) {
    .nudge-frame { background: #0b0f0d !important; }
    .nudge-card { background: #1a211e !important; border-color: #2a3430 !important; }
    .nudge-card td, .nudge-card p, .nudge-title { color: #e6ece9 !important; }
    .nudge-card .nudge-label, .nudge-muted { color: #9aa7a1 !important; }
    .nudge-quote { background: #131917 !important; border-color: #2a3430 !important; color: #e6ece9 !important; }
    .nudge-wordmark { color: #e6ece9 !important; }
  }
  @media (max-width: 600px) {
    .nudge-pad { padding-left: 20px !important; padding-right: 20px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${COLORS.frame};">
<table role="presentation" class="nudge-frame" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.frame};font-family:${FONT};">
<tr><td align="center" style="padding:32px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
<tr><td style="padding:0 4px 16px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${bar(6)}${bar(9)}${bar(12)}${bar(15)}<td class="nudge-wordmark" valign="bottom" style="padding:0 0 0 6px;font-size:18px;font-weight:700;line-height:16px;letter-spacing:-0.02em;color:${COLORS.text};">nudge</td></tr></table>
</td></tr>
<tr><td>
<table role="presentation" class="nudge-card" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:10px;overflow:hidden;">
<tr><td style="height:4px;background:${content.stripe};font-size:0;line-height:0;">&nbsp;</td></tr>
${notice}
<tr><td class="nudge-pad" style="padding:24px 28px 28px;">
<p class="nudge-muted" style="margin:0 0 6px;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${COLORS.muted};">${e(content.eyebrow)}</p>
<h1 class="nudge-title" style="margin:0 0 14px;font-size:22px;line-height:28px;font-weight:700;letter-spacing:-0.01em;color:${COLORS.text};word-break:break-word;">${e(content.title)}</h1>
${pills ? `<div style="margin:0 0 14px;">${pills}</div>` : ''}
${intro}
${quote}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${details}</table>
${action}
</td></tr>
</table>
</td></tr>
<tr><td class="nudge-muted" style="padding:16px 4px 0;font-size:12px;line-height:18px;color:${COLORS.muted};">${e(content.footer)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function plainText(content: EmailContent): string {
  return [
    ...(content.notice ? [content.notice, ''] : []),
    content.title,
    ...(content.pills.length ? [content.pills.map((pill) => pill.label).join(' · ')] : []),
    '',
    ...(content.intro ? [content.intro, ''] : []),
    ...(content.quote ? [content.quote, ''] : []),
    ...content.details.map((detail) => `${detail.label}: ${detail.value}`),
    ...(content.action ? ['', `${content.action.label}: ${content.action.url}`] : []),
    '',
    '—',
    content.footer,
  ].join('\n');
}
