/**
 * Recorded HTTP responses of GitHub's REST API, for the GitHub Issues adapter's
 * contract test.
 *
 * Each recording says where it comes from:
 * - `documentation`: shape copied verbatim from the documentation (URL in `source`);
 * - `reconstructed`: written for our requests following the documented schema, or an
 *   error response whose status and headers are documented but for which the
 *   documentation gives no example body: the body follows the `message` /
 *   `documentation_url` shape of REST API errors, the message is plausible.
 *
 * None was obtained through a real call: the documentation is authoritative. Read on 2026-10-24:
 * - https://docs.github.com/en/rest/issues/issues#create-an-issue (201, 400, 403, 404,
 *   "410 Gone" when issues are disabled, "422 Validation failed, or the endpoint has
 *   been spammed", 503; issue schema: `html_url`, `number`…);
 * - https://docs.github.com/en/rest/issues/issues#update-an-issue (200; `state`,
 *   `state_reason`);
 * - https://docs.github.com/en/rest/issues/comments#create-an-issue-comment (201);
 * - https://docs.github.com/en/rest/repos/repos#get-a-repository (200, 301, 403, 404;
 *   `has_issues`, `archived`);
 * - https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api
 *   (invalid credentials: 401; insufficient permissions: 404 or 403);
 * - https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
 *   (primary limit: 403 or 429 with `x-ratelimit-remaining: 0`; secondary: 403 or 429,
 *   possibly `retry-after`);
 * - https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api
 *   (422: `errors` property, each error with a `code`).
 */

export interface Recording {
  readonly provenance: 'documentation' | 'reconstructed';
  readonly source: string;
  readonly status: number;
  /** JSON body; a string is returned as is (a proxy's error page). */
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

const ISSUES = 'https://docs.github.com/en/rest/issues/issues#create-an-issue';
const UPDATE = 'https://docs.github.com/en/rest/issues/issues#update-an-issue';
const COMMENTS = 'https://docs.github.com/en/rest/issues/comments#create-an-issue-comment';
const REPOSITORY_DOCS = 'https://docs.github.com/en/rest/repos/repos#get-a-repository';
const AUTH = 'https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api';
const RATE_LIMITS =
  'https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api';
const TROUBLESHOOTING =
  'https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api';

export const OWNER = 'shop-inc';
export const REPOSITORY_NAME = 'shop-web';
export const TOKEN =
  'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ';
export const ISSUE_NUMBER = 1347;
export const ISSUE_URL = `https://github.com/${OWNER}/${REPOSITORY_NAME}/issues/${ISSUE_NUMBER}`;

/** REST API error body: a `message`, a link to the documentation. */
const error = (message: string, extra: Record<string, unknown> = {}) => ({
  message,
  documentation_url: 'https://docs.github.com/rest',
  ...extra,
});

const API = `https://api.github.com/repos/${OWNER}/${REPOSITORY_NAME}`;

export const GITHUB = {
  /** The created issue: required fields of the 201 response schema. */
  issueCreated: {
    provenance: 'reconstructed',
    source: `${ISSUES} (Response schema, Status: 201)`,
    status: 201,
    body: {
      id: 1296269,
      node_id: 'I_kwDOABCD5M5MXc0N',
      url: `${API}/issues/${ISSUE_NUMBER}`,
      repository_url: API,
      labels_url: `${API}/issues/${ISSUE_NUMBER}/labels{/name}`,
      comments_url: `${API}/issues/${ISSUE_NUMBER}/comments`,
      events_url: `${API}/issues/${ISSUE_NUMBER}/events`,
      html_url: ISSUE_URL,
      number: ISSUE_NUMBER,
      state: 'open',
      title: 'Bug · The cart empties when I change pages.',
      body: '…',
      labels: [],
      milestone: null,
      locked: false,
      comments: 0,
      closed_at: null,
      created_at: '2026-10-24T09:30:00Z',
      updated_at: '2026-10-24T09:30:00Z',
      author_association: 'OWNER',
    },
  },
  /** The issue closed by "Update an issue": `state` closed, completed. */
  issueClosed: {
    provenance: 'reconstructed',
    source: `${UPDATE} (Response schema, Status: 200)`,
    status: 200,
    body: {
      id: 1296269,
      url: `${API}/issues/${ISSUE_NUMBER}`,
      html_url: ISSUE_URL,
      number: ISSUE_NUMBER,
      state: 'closed',
      state_reason: 'completed',
      closed_at: '2026-10-24T09:31:00Z',
    },
  },
  /** The comment created on the issue. */
  commentCreated: {
    provenance: 'reconstructed',
    source: `${COMMENTS} (Response schema, Status: 201)`,
    status: 201,
    body: {
      id: 1,
      url: `${API}/issues/comments/1`,
      html_url: `${ISSUE_URL}#issuecomment-1`,
      body: '…',
      created_at: '2026-10-24T09:31:00Z',
    },
  },
  /** The repository, issues enabled. */
  repository: {
    provenance: 'reconstructed',
    source: `${REPOSITORY_DOCS} (Response schema, Status: 200)`,
    status: 200,
    body: {
      id: 1296269,
      name: REPOSITORY_NAME,
      full_name: `${OWNER}/${REPOSITORY_NAME}`,
      private: true,
      html_url: `https://github.com/${OWNER}/${REPOSITORY_NAME}`,
      has_issues: true,
      archived: false,
      disabled: false,
      permissions: { admin: false, push: false, pull: true },
    },
  },
  badCredentials: {
    provenance: 'reconstructed',
    source: AUTH,
    status: 401,
    body: error('Bad credentials', { status: '401' }),
  },
  /** Token without the "Issues: write" permission on this repository. */
  permissionDenied: {
    provenance: 'reconstructed',
    source: AUTH,
    status: 403,
    body: error('Resource not accessible by personal access token', { status: '403' }),
  },
  /** Repository that does not exist, or is out of the token's reach. */
  notFound: {
    provenance: 'reconstructed',
    source: `${ISSUES}; ${AUTH}`,
    status: 404,
    body: error('Not Found', { status: '404' }),
  },
  issuesDisabled: {
    provenance: 'reconstructed',
    source: ISSUES,
    status: 410,
    body: error('Issues are disabled for this repo', { status: '410' }),
  },
  validationFailed: {
    provenance: 'reconstructed',
    source: `${ISSUES}; ${TROUBLESHOOTING}`,
    status: 422,
    body: error('Validation Failed', {
      status: '422',
      errors: [{ resource: 'Issue', code: 'custom', field: 'body', message: 'body is too long' }],
    }),
  },
  invalidRequest: {
    provenance: 'reconstructed',
    source: ISSUES,
    status: 400,
    body: error('Problems parsing JSON', { status: '400' }),
  },
  primaryRateLimit: {
    provenance: 'reconstructed',
    source: RATE_LIMITS,
    status: 403,
    body: error('API rate limit exceeded for user ID 1.', { status: '403' }),
    headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1792834200' },
  },
  secondaryRateLimit: {
    provenance: 'reconstructed',
    source: RATE_LIMITS,
    status: 403,
    body: error('You have exceeded a secondary rate limit. Please wait a few minutes.', {
      status: '403',
    }),
    headers: { 'retry-after': '60', 'x-ratelimit-remaining': '4990' },
  },
  rateLimit429: {
    provenance: 'reconstructed',
    source: RATE_LIMITS,
    status: 429,
    body: error('You have exceeded a secondary rate limit.', { status: '429' }),
    headers: { 'retry-after': '30' },
  },
  unavailable: {
    provenance: 'reconstructed',
    source: ISSUES,
    status: 503,
    body: error('Service unavailable', { status: '503' }),
  },
  /** Repository renamed or transferred. */
  moved: {
    provenance: 'reconstructed',
    source: REPOSITORY_DOCS,
    status: 301,
    body: error('Moved Permanently', { url: 'https://api.github.com/repositories/1296269' }),
    headers: { location: 'https://api.github.com/repositories/1296269' },
  },
} as const satisfies Record<string, Recording>;
