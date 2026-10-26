import type { FailureClass } from '@nudge/core';
import { truncate } from './text.js';

/** Maximum length of an external service's response carried over into a failure message. */
export const EXCERPT_MAX = 300;

/** External service response timeout, beyond which the call is a transient failure. */
export const DEFAULT_HTTP_TIMEOUT_MS = 10_000;

/**
 * Failure class of an HTTP status, shared by the Destinations called over HTTP:
 * 408, 425, 429 and 5xx are temporary; 401 and 403 reject the credentials;
 * any other refusal targets this specific request.
 */
export function classifyStatus(status: number): FailureClass {
  if (status === 408 || status === 425 || status === 429 || status >= 500) return 'transient';
  if (status === 401 || status === 403) return 'auth';
  return 'permanent';
}

/**
 * Class and message of a failed HTTP response. Redirects are never followed
 * (`redirect: 'manual'`): a 3xx is permanent, the final URL must be configured.
 */
export async function httpFailure(
  response: Response,
  classify: (status: number) => FailureClass = classifyStatus,
): Promise<{ failureClass: FailureClass; message: string }> {
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    return {
      failureClass: 'permanent',
      message: `HTTP ${response.status}: redirect refused, configure the final URL`,
    };
  }
  return { failureClass: classify(response.status), message: await failureMessage(response) };
}

/** "422: <start of the response>", bounded. */
export async function failureMessage(response: Response): Promise<string> {
  const text = (await response.text().catch(() => '')).trim();
  const excerpt = truncate(text, EXCERPT_MAX);
  return excerpt ? `HTTP ${response.status}: ${excerpt}` : `HTTP ${response.status}`;
}

/** A response body as text, read from a clone (the body stays readable), or `''`. */
export async function responseText(response: Response): Promise<string> {
  return (
    await response
      .clone()
      .text()
      .catch(() => '')
  ).trim();
}

/** Longest link to a created issue that a Delivery keeps. */
export const EXTERNAL_URL_MAX = 2048;

/**
 * The link to what the target created, as the service returned it: kept only if it is
 * an https URL of bounded length, otherwise the Delivery has no link. The dashboard
 * shows it as a link: a third-party value never sets its scheme.
 */
export function externalLink(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > EXTERNAL_URL_MAX) return null;
  return URL.parse(value)?.protocol === 'https:' ? value : null;
}

/** Message of a `fetch` exception (network, timeout). */
export { errorMessage } from '@nudge/shared';
