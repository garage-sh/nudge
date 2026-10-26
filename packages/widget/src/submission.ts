import type { Context, FeedbackInput, FeedbackType } from '@nudge/shared';
import type { EncodedCapture } from './capture.js';
import { LIMITS } from './domain.js';
import { retryAfterMinutes, type Messages } from './locales/index.js';
import type { DeclaredAuthor, Metadata, RedactUrl, WidgetOptions } from './options.js';

/** What the Author entered in the form. */
export interface FormInput {
  readonly text: string;
  readonly type?: FeedbackType;
  readonly email?: string;
  /** The Capture the Author chose to attach, already masked and blurred. */
  readonly capture?: EncodedCapture;
}

export type SubmissionResult =
  { readonly status: 'sent' } | { readonly status: 'error'; readonly message: string };

/**
 * The page URL to send: the integrator's redaction of it or, by default, the URL without
 * its fragment. A redaction that fails (throws, returns something other than an absolute
 * URL) sends no URL rather than the unredacted one.
 */
export function pageUrl(redactUrl?: RedactUrl): string | null {
  if (!redactUrl) {
    const url = new URL(window.location.href);
    url.hash = '';
    return url.href;
  }
  try {
    const redacted = redactUrl(new URL(window.location.href));
    return redacted === null ? null : new URL(String(redacted)).href;
  } catch {
    return null;
  }
}

/**
 * Context gathered automatically: page URL, browser and OS (user agent), screen
 * (viewport), plus the host metadata. A value beyond the ingestion bounds is left out
 * rather than getting the Feedback rejected.
 */
export function pageContext(metadata?: Metadata, redactUrl?: RedactUrl): Context {
  const url = pageUrl(redactUrl);
  return {
    ...(url && url.length <= LIMITS.url ? { url } : {}),
    userAgent: navigator.userAgent.slice(0, LIMITS.userAgent),
    viewport: { width: window.innerWidth, height: window.innerHeight },
    ...(metadata && Object.keys(metadata).length > 0 ? { metadata: { ...metadata } } : {}),
  };
}

/** The email the Author typed wins over the one the host declared. */
function feedbackAuthor(host: DeclaredAuthor | undefined, email: string | undefined) {
  const author = { ...host, ...(email ? { email } : {}) };
  return Object.keys(author).length > 0 ? author : undefined;
}

/**
 * Posts the Feedback to the Instance's public API with the Project's public key
 * (Source `widget`) and turns the outcome into a message for the Author.
 */
export async function postFeedback(
  options: WidgetOptions,
  input: FormInput,
  messages: Messages,
): Promise<SubmissionResult> {
  const author = feedbackAuthor(options.author, input.email);
  const body: FeedbackInput = {
    text: input.text,
    ...(input.type ? { type: input.type } : {}),
    ...(author ? { author } : {}),
    context: pageContext(options.metadata, options.redactUrl),
    ...(input.capture ? { capture: input.capture } : {}),
  };
  let response: Response;
  try {
    response = await fetch(`${options.api.replace(/\/+$/, '')}/v1/feedbacks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${options.publicKey}` },
      body: JSON.stringify(body),
      credentials: 'omit',
    });
  } catch {
    return error(messages.network);
  }
  if (response.ok) return { status: 'sent' };
  if (response.status === 429) {
    return error(messages.rateLimited(retryAfterMinutes(response.headers.get('retry-after'))));
  }
  if (response.status === 400) return error(messages.invalid);
  if (response.status >= 500) return error(messages.unavailable);
  return error(messages.configuration);
}

const error = (message: string): SubmissionResult => ({ status: 'error', message });
