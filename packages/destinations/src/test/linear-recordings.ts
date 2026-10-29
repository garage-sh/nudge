/**
 * Recorded HTTP responses of Linear's GraphQL API, for the Linear adapter's contract
 * test.
 *
 * Each recording says where it comes from:
 * - `documentation`: shape or body taken from the documentation (URL in `source`);
 * - `reconstructed`: written for our requests, following the documented shape and the
 *   GraphQL schema published by Linear (URL in `source`).
 *
 * None was obtained through a real call: the documentation and the schema are
 * authoritative. Documentation read on 2026-10-24:
 * - https://linear.app/developers/graphql (endpoint, authentication, `issueCreate`,
 *   errors in an `errors` array, partial success possible with a 200);
 * - https://linear.app/developers/rate-limiting (rate limit: HTTP 400, code
 *   `RATELIMITED` in `extensions`);
 * - schema: https://github.com/linear/linear/blob/master/packages/sdk/src/schema.graphql
 *   (`IssueCreateInput.teamId` / `labelIds`, `IssuePayload`, `Issue.url`, `IssueLabel.team`
 *   null for a workspace label, `TeamFilter.key`, `Team.states`, `WorkflowState.type` /
 *   `position`, `IssueUpdateInput.stateId`, `issueUpdate(id:)` taking the UUID or the
 *   identifier, `commentCreate`, `CommentCreateInput.issueId` / `body`);
 * - error types (`extensions.type`): https://github.com/linear/linear/blob/master/packages/sdk/src/error.ts.
 */

export interface Recording {
  readonly provenance: 'documentation' | 'reconstructed';
  readonly source: string;
  readonly status: number;
  /** JSON body; a string is returned as is (a proxy's error page). */
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

const GRAPHQL = 'https://linear.app/developers/graphql';
const RATE_LIMITS = 'https://linear.app/developers/rate-limiting';
const SCHEMA = 'https://github.com/linear/linear/blob/master/packages/sdk/src/schema.graphql';
const ERRORS = 'https://github.com/linear/linear/blob/master/packages/sdk/src/error.ts';
const UPLOAD = 'https://linear.app/developers/how-to-upload-a-file-to-linear';

/** The tests' team: id from the documentation's `issueCreate` example. */
export const TEAM_ID = '9cfb482a-81e3-4154-b5b9-2c805e70a02d';
export const LABEL_BUG_ID = '5f6b9a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
export const LABEL_URGENT_ID = '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d';
/** Signed upload URL and permanent image URL, returned by `fileUpload`. */
export const UPLOAD_URL =
  'https://storage.googleapis.com/linear-uploads/8c3f/capture.png?X-Goog-Signature=abc123';
export const ASSET_URL = 'https://uploads.linear.app/8c3f/1b2c/capture.png';
export const LABEL_IDEA_ID = '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';
export const ISSUE_ID = '590a1127-f98b-49fc-ba74-2df8751c089e';
export const ISSUE_IDENTIFIER = 'ENG-123';
/** The team's workflow states: "Done" is the first `completed` one by position. */
export const DONE_STATE_ID = '3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b';
export const ISSUE_URL = 'https://linear.app/shop/issue/ENG-123/bug-the-cart-empties';
export const API_KEY = 'lin_api_0123456789abcdefghijklmnopqrstuvwxyzABCD';

/** A GraphQL error, in the shape the documentation describes and the SDK reads. */
const error = (message: string, extensions: Record<string, unknown>) => ({
  message,
  path: null,
  extensions: { userPresentableMessage: message, ...extensions },
});

export const LINEAR = {
  /**
   * The ENG team and the labels it can apply: its own (`team` set) and the
   * workspace's (`team: null`). "Type" is a label group, which an issue cannot carry.
   */
  team: {
    provenance: 'reconstructed',
    source: `${SCHEMA} (Query.teams, Query.issueLabels)`,
    status: 200,
    body: {
      data: {
        teams: {
          nodes: [
            {
              id: TEAM_ID,
              key: 'ENG',
              name: 'Engineering',
              states: {
                nodes: [
                  { id: '0a1b2c3d-0000-4000-8000-000000000001', type: 'backlog', position: 0 },
                  { id: '0a1b2c3d-0000-4000-8000-000000000002', type: 'started', position: 1 },
                  { id: '0a1b2c3d-0000-4000-8000-000000000003', type: 'completed', position: 4 },
                  { id: DONE_STATE_ID, type: 'completed', position: 3 },
                  { id: '0a1b2c3d-0000-4000-8000-000000000004', type: 'canceled', position: 5 },
                ],
              },
            },
          ],
        },
        issueLabels: {
          nodes: [
            { id: LABEL_BUG_ID, name: 'Bug', isGroup: false, team: { id: TEAM_ID } },
            { id: LABEL_URGENT_ID, name: 'Urgent', isGroup: false, team: null },
            { id: LABEL_IDEA_ID, name: 'Idea', isGroup: false, team: { id: TEAM_ID } },
            {
              id: '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f',
              name: 'Type',
              isGroup: true,
              team: { id: TEAM_ID },
            },
          ],
        },
      },
    },
  },
  /** The ENG team without any `completed` workflow state, nor labels. */
  teamWithoutCompletedState: {
    provenance: 'reconstructed',
    source: `${SCHEMA} (Query.teams, Team.states)`,
    status: 200,
    body: {
      data: {
        teams: {
          nodes: [
            {
              id: TEAM_ID,
              key: 'ENG',
              states: {
                nodes: [
                  { id: '0a1b2c3d-0000-4000-8000-000000000001', type: 'backlog', position: 0 },
                ],
              },
            },
          ],
        },
        issueLabels: { nodes: [] },
      },
    },
  },
  /** No team with key ENG visible with this API key. */
  unknownTeam: {
    provenance: 'reconstructed',
    source: `${SCHEMA} (Query.teams)`,
    status: 200,
    body: { data: { teams: { nodes: [] }, issueLabels: { nodes: [] } } },
  },
  /**
   * Successful `issueCreate`: `success` and the requested issue. The documentation only
   * selects `issue { id title }`; `identifier` and `url` follow the schema.
   */
  issueCreated: {
    provenance: 'reconstructed',
    source: `${GRAPHQL} (issueCreate); ${SCHEMA} (IssuePayload, Issue.url)`,
    status: 200,
    body: {
      data: {
        issueCreate: {
          success: true,
          issue: { id: ISSUE_ID, identifier: 'ENG-123', url: ISSUE_URL },
        },
      },
    },
  },
  /** Successful `issueUpdate` (moved to the completed state): the issue's UUID. */
  issueUpdated: {
    provenance: 'reconstructed',
    source: `${SCHEMA} (issueUpdate, IssuePayload)`,
    status: 200,
    body: { data: { issueUpdate: { success: true, issue: { id: ISSUE_ID } } } },
  },
  /** Successful `commentCreate`. */
  commentCreated: {
    provenance: 'reconstructed',
    source: `${SCHEMA} (commentCreate, CommentPayload)`,
    status: 200,
    body: { data: { commentCreate: { success: true } } },
  },
  /**
   * Successful `fileUpload`: the signed URL to upload to (PUT), the image's permanent
   * URL and the headers the PUT must carry over (without them, 403).
   */
  filePrepared: {
    provenance: 'reconstructed',
    source: `${UPLOAD}; ${SCHEMA} (fileUpload, UploadPayload, UploadFile, UploadFileHeader)`,
    status: 200,
    body: {
      data: {
        fileUpload: {
          success: true,
          uploadFile: {
            uploadUrl: UPLOAD_URL,
            assetUrl: ASSET_URL,
            headers: [{ key: 'x-goog-content-length-range', value: '9,9' }],
          },
        },
      },
    },
  },
  /** `fileUpload` without a prepared file: `uploadFile` null ("the upload could not be prepared"). */
  fileNotPrepared: {
    provenance: 'reconstructed',
    source: `${SCHEMA} (UploadPayload.uploadFile: null if the upload could not be prepared)`,
    status: 200,
    body: { data: { fileUpload: { success: false, uploadFile: null } } },
  },
  /** The image PUT to the signed URL: 200, with no useful body. */
  upload: {
    provenance: 'reconstructed',
    source: `${UPLOAD} (PUT to uploadUrl)`,
    status: 200,
    body: '',
  },
  /** The PUT rejected by the storage (headers not carried over, URL expired): 403. */
  uploadRefused: {
    provenance: 'reconstructed',
    source: `${UPLOAD} ("a 403 Forbidden response" without the returned headers)`,
    status: 403,
    body: '<?xml version="1.0"?><Error><Code>AccessDenied</Code></Error>',
  },
  /** `issueCreate` without an error but without an issue: `success` false, `issue` null. */
  creationRefused: {
    provenance: 'reconstructed',
    source: `${SCHEMA} (IssuePayload: success: Boolean!, issue: Issue)`,
    status: 200,
    body: { data: { issueCreate: { success: false, issue: null } } },
  },
  /** Revoked or invalid API key: GraphQL error of type "authentication error". */
  keyRejected: {
    provenance: 'reconstructed',
    source: `${GRAPHQL} (Errors); ${ERRORS}`,
    status: 400,
    body: {
      data: null,
      errors: [
        error('Authentication required, not authenticated', {
          type: 'authentication error',
          code: 'AUTHENTICATION_ERROR',
          userError: true,
        }),
      ],
    },
  },
  /** The key has no access to this team: "forbidden". */
  accessDenied: {
    provenance: 'reconstructed',
    source: `${GRAPHQL} (Errors); ${ERRORS}`,
    status: 200,
    body: {
      data: null,
      errors: [
        error('You do not have access to this team', {
          type: 'forbidden',
          code: 'FORBIDDEN',
          userError: true,
        }),
      ],
    },
  },
  /** An input rejected for this specific issue: "invalid input". */
  invalidInput: {
    provenance: 'reconstructed',
    source: `${GRAPHQL} (Errors); ${ERRORS}`,
    status: 200,
    body: {
      data: null,
      errors: [
        error('Argument Validation Error', {
          type: 'invalid input',
          code: 'INVALID_INPUT',
          userError: true,
        }),
      ],
    },
  },
  /** Rate limit: "the response http status code will be 400", code RATELIMITED. */
  rateLimited: {
    provenance: 'documentation',
    source: RATE_LIMITS,
    status: 400,
    headers: {
      'x-ratelimit-requests-limit': '2500',
      'x-ratelimit-requests-remaining': '0',
      'x-ratelimit-requests-reset': '1793006400000',
    },
    body: {
      errors: [{ message: 'Rate limit exceeded', extensions: { code: 'RATELIMITED' } }],
    },
  },
  /** Linear internal error: "internal error". */
  internalError: {
    provenance: 'reconstructed',
    source: `${GRAPHQL} (Errors); ${ERRORS}`,
    status: 200,
    body: {
      data: null,
      errors: [error('Internal server error', { type: 'internal error', code: 'INTERNAL_ERROR' })],
    },
  },
  /** A proxy's error page, without JSON. */
  serviceUnavailable: {
    provenance: 'reconstructed',
    source: `${GRAPHQL} ("Monitor HTTP status codes for server errors (5xx)")`,
    status: 503,
    body: '<html><body>503 Service Temporarily Unavailable</body></html>',
  },
  /** Key rejected by an intermediary before GraphQL: 401 without a JSON body. */
  unauthorized: {
    provenance: 'reconstructed',
    source: GRAPHQL,
    status: 401,
    body: 'Unauthorized',
  },
} as const satisfies Record<string, Recording>;
