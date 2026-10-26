/**
 * JS client for nudge's public API, for a backend (server, mobile app through its
 * server, support tool): it posts Feedback with the Project's **secret key**.
 * Feedback sent this way has the `api` Source, and the Author provided is **attested**:
 * the Instance trusts the identity passed along, unlike the one the Widget declares
 * from the browser. The secret key must therefore never leave the server.
 *
 * Types come from the shared schemas (`@nudge/shared`); validation stays the
 * Instance's, which returns the detail of the rejected fields. At runtime the client
 * imports nothing: neither zod nor the schemas are loaded in the integrator's code.
 */
import type {
  ApiErrorBody,
  PUBLIC_KEY_PREFIX as INSTANCE_PUBLIC_KEY_PREFIX,
  SECRET_KEY_PREFIX as INSTANCE_SECRET_KEY_PREFIX,
  FeedbackInput,
  ReceivedFeedback,
} from '@nudge/shared';

export type {
  Author,
  CaptureInput,
  Context,
  FeedbackInput,
  ReceivedFeedback,
  FeedbackType,
} from '@nudge/shared';

// Key prefixes copied rather than imported (no runtime dependency); the compiler
// keeps them aligned with `@nudge/shared`.
const PUBLIC_KEY_PREFIX = 'nk_pub_' satisfies typeof INSTANCE_PUBLIC_KEY_PREFIX;
const SECRET_KEY_PREFIX = 'nk_sec_' satisfies typeof INSTANCE_SECRET_KEY_PREFIX;

export interface ClientOptions {
  /**
   * Base URL of the Instance, for example `https://nudge.example.com`. It must use
   * HTTPS, except for `localhost`, `127.0.0.1` and `[::1]`.
   */
  readonly url: string;
  /** The Project's secret key (`nk_sec_…`), shown once in the dashboard. */
  readonly secretKey: string;
  /** `fetch` implementation to use; the runtime's by default. */
  readonly fetch?: typeof fetch;
}

export interface CallOptions {
  /** Aborts the call (timeout, process shutdown…). */
  readonly signal?: AbortSignal;
}

export interface NudgeClient {
  /** Posts a piece of Feedback; resolves once the Instance has stored it (it then awaits Triage). */
  sendFeedback(feedback: FeedbackInput, options?: CallOptions): Promise<ReceivedFeedback>;
}

/**
 * Rejection by the Instance: HTTP `status`, the API's stable error `code` and, for
 * rejected Feedback, the detail of the fields.
 */
export class NudgeError extends Error {
  override readonly name = 'NudgeError';

  constructor(
    readonly status: number,
    readonly code: string | null,
    readonly details: ApiErrorBody['details'] = [],
  ) {
    super(`nudge rejected the feedback (HTTP ${status}${code ? `, ${code}` : ''})`);
  }
}

export function createClient(options: ClientOptions): NudgeClient {
  checkUrl(options.url);
  checkKey(options.secretKey);
  const fetcher = options.fetch ?? globalThis.fetch;
  const endpoint = `${options.url.replace(/\/+$/, '')}/v1/feedbacks`;
  return {
    async sendFeedback(feedback, { signal } = {}) {
      const response = await fetcher(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${options.secretKey}`,
        },
        body: JSON.stringify(feedback),
        ...(signal ? { signal } : {}),
      });
      if (!response.ok) throw await errorFrom(response);
      return (await response.json()) as ReceivedFeedback;
    },
  };
}

/** Hosts reachable over plain HTTP: the secret key then never leaves the machine. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The secret key travels in every request: over plain HTTP, anyone on the path reads
 * it. Only HTTPS is accepted, except towards the machine itself (local development).
 */
function checkUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new TypeError(`Invalid Instance URL: ${url}`);
  }
  if (parsed.protocol === 'https:') return;
  if (parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname)) return;
  throw new TypeError(
    `The Instance URL must use https (${url}): the secret key would travel in clear. ` +
      'Plain http is only accepted for localhost, 127.0.0.1 and [::1].',
  );
}

/**
 * Only the secret key attests the Author's identity: a public key passed here would
 * be rejected by the Instance (no Origin), and the error would explain it poorly.
 */
function checkKey(key: string): void {
  if (key.startsWith(PUBLIC_KEY_PREFIX)) {
    throw new TypeError(
      "Public key received: the SDK uses the Project's secret key (the public key is the Widget's).",
    );
  }
  if (!key.startsWith(SECRET_KEY_PREFIX)) {
    throw new TypeError(`Secret key expected (prefix ${SECRET_KEY_PREFIX}).`);
  }
}

async function errorFrom(response: Response): Promise<NudgeError> {
  const body = (await response.json().catch(() => null)) as Partial<ApiErrorBody> | null;
  return new NudgeError(
    response.status,
    typeof body?.error === 'string' ? body.error : null,
    Array.isArray(body?.details) ? body.details : [],
  );
}
