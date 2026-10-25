/**
 * Recorded HTTP responses of a Slack incoming webhook, for the Slack adapter's
 * contract test.
 *
 * Each recording says where it comes from:
 * - `documentation`: status and body described by the documentation (URL in `source`);
 * - `reconstructed`: a status the documentation does not tie to the error code, chosen
 *   from the examples it gives (400, 403, 404), or the response of an intermediary.
 *
 * An incoming webhook answers in plain text: `ok`, or the error code. No response was
 * obtained through a real call: the documentation is authoritative. Read on 2026-10-24:
 * - https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks ("HTTP 200
 *   response with a plain text `ok`", list of error codes);
 * - https://docs.slack.dev/changelog/2016-05-17-changes-to-errors-for-incoming-webhooks
 *   (invalid_payload and user_not_found: 400, action_prohibited: 403,
 *   channel_not_found: 404, channel_is_archived: 410, rollup_error: 500);
 * - https://docs.slack.dev/apis/web-api/rate-limits (incoming webhooks: 1 message per
 *   second, "HTTP 429 Too Many Requests" with `Retry-After`).
 */

export interface Recording {
  readonly provenance: 'documentation' | 'reconstructed';
  readonly source: string;
  readonly status: number;
  /** Plain-text body. */
  readonly body: string;
  readonly headers?: Readonly<Record<string, string>>;
}

const WEBHOOKS = 'https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks';
const CHANGELOG =
  'https://docs.slack.dev/changelog/2016-05-17-changes-to-errors-for-incoming-webhooks';
const RATE_LIMITS = 'https://docs.slack.dev/apis/web-api/rate-limits';

/** The tests' webhook, shaped like the documentation's example. */
export const TEAM_ID = 'T00000000';
export const SERVICE_ID = 'B00000000';
export const WEBHOOK_TOKEN = 'XXXXXXXXXXXXXXXXXXXXXXXX';

const error = (
  status: number,
  code: string,
  provenance: Recording['provenance'],
  source: string,
): Recording => ({ provenance, source, status, body: code });

export const SLACK = {
  /** "In most cases you'll receive a 'HTTP 200' response with a plain text `ok`." */
  ok: { provenance: 'documentation', source: WEBHOOKS, status: 200, body: 'ok' },
  /** Malformed body; also the answer the probe expects from a live webhook. */
  invalidPayload: error(400, 'invalid_payload', 'documentation', CHANGELOG),
  /** "`no_text` means the `text` attribute was missing from the payload." */
  noText: error(400, 'no_text', 'reconstructed', WEBHOOKS),
  tooManyAttachments: error(400, 'too_many_attachments', 'reconstructed', WEBHOOKS),
  userNotFound: error(400, 'user_not_found', 'documentation', CHANGELOG),
  actionProhibited: error(403, 'action_prohibited', 'documentation', CHANGELOG),
  invalidToken: error(403, 'invalid_token', 'reconstructed', WEBHOOKS),
  postingToGeneralChannelDenied: error(
    403,
    'posting_to_general_channel_denied',
    'reconstructed',
    WEBHOOKS,
  ),
  channelNotFound: error(404, 'channel_not_found', 'documentation', CHANGELOG),
  /** "`no_service` means the incoming webhook is either disabled, removed, or invalid." */
  noService: error(404, 'no_service', 'reconstructed', WEBHOOKS),
  channelIsArchived: error(410, 'channel_is_archived', 'documentation', CHANGELOG),
  rollupError: error(500, 'rollup_error', 'documentation', CHANGELOG),
  /** Documented status and header; the body is not. */
  rateLimited: {
    provenance: 'reconstructed',
    source: RATE_LIMITS,
    status: 429,
    body: 'rate_limited',
    headers: { 'retry-after': '30' },
  },
  /** Error page of an intermediary, without a Slack code. */
  badGateway: {
    provenance: 'reconstructed',
    source: WEBHOOKS,
    status: 502,
    body: '<html><body>502 Bad Gateway</body></html>',
  },
} as const satisfies Record<string, Recording>;
