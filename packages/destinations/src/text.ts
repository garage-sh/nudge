import type { OutgoingDelivery } from '@nudge/core';
import { FEEDBACK_TYPE_LABELS } from '@nudge/shared';

/** Bounded to `max` UTF-16 units, without splitting a surrogate pair, with "…". */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, max - 1);
  if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/** The first non-empty line of a text, whitespace collapsed, or `''`. */
export const firstLine = (text: string): string =>
  text
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .find((line) => line.length > 0) ?? '';

/**
 * Title of an issue (Linear, GitHub): the Type and the first non-empty line of the
 * text, "Test · " in front for the sample Feedback, bounded to `max`.
 */
export function titleWithType({ isTest, feedback }: OutgoingDelivery, max: number): string {
  const line = firstLine(feedback.text);
  const heading = `${isTest ? 'Test · ' : ''}${FEEDBACK_TYPE_LABELS[feedback.resolvedType]}`;
  return truncate(line ? `${heading} · ${line}` : heading, max);
}
