import {
  presentAlert,
  presentIncident,
  type FailureClass,
  type DestinationAdapter,
  type ConfiguredDestination,
  type OutgoingDelivery,
  type DeliveryResult,
} from '@nudge/core';
import {
  SEVERITY_LABELS,
  FEEDBACK_TYPE_LABELS,
  linearDefinition,
  captureFileName,
  type LinearSecrets,
} from '@nudge/shared';
import { readCapture, type CaptureImage } from './capture.js';
import {
  DEFAULT_HTTP_TIMEOUT_MS,
  EXCERPT_MAX,
  classifyStatus,
  httpFailure,
  errorMessage,
  externalLink,
} from './http.js';
import { alertToMarkdown, escapePunctuation, incidentToMarkdown, isSafeLink } from './markdown.js';
import { titleWithType, truncate } from './text.js';

export interface LinearOptions {
  readonly fetch?: typeof globalThis.fetch;
  /** Linear response timeout, beyond which the call is a transient failure. */
  readonly timeoutMs?: number;
  /** Team and labels already read, per Destination (tests: a fresh cache). */
  readonly teams?: Map<string, LoadedTeam>;
}

/** A Destination's team, as read from Linear: its id, its labels by name, its Done state. */
export interface LoadedTeam {
  readonly id: string;
  /** The first workflow state of type `completed` by position, where a closed issue goes. */
  readonly completedStateId: string | null;
  /** Id of each applicable label, by lowercase name. */
  readonly labels: ReadonlyMap<string, string>;
}

const TEAMS_BY_DESTINATION = new Map<string, LoadedTeam>();

/** https://linear.app/developers/graphql */
const ENDPOINT = 'https://api.linear.app/graphql';

/**
 * The team by its key with its workflow states, and the labels an issue of this team
 * can carry: its own and the workspace's (`team` null).
 */
const TEAM_QUERY = `query NudgeTeam($team: String!) {
  teams(filter: { key: { eqIgnoreCase: $team } }) {
    nodes { id key states { nodes { id type position } } }
  }
  issueLabels(
    first: 250
    filter: { or: [{ team: { key: { eqIgnoreCase: $team } } }, { team: { null: true } }] }
  ) { nodes { id name isGroup } }
}`;

/** https://linear.app/developers/how-to-upload-a-file-to-linear */
const FILE_MUTATION = `mutation NudgeFile($contentType: String!, $filename: String!, $size: Int!) {
  fileUpload(contentType: $contentType, filename: $filename, size: $size) {
    success
    uploadFile { uploadUrl assetUrl headers { key value } }
  }
}`;

const ISSUE_MUTATION = `mutation NudgeIssue($input: IssueCreateInput!) {
  issueCreate(input: $input) { success issue { id identifier url } }
}`;

/** `id`: the issue's identifier (ENG-123), which Linear accepts in place of its UUID. */
const ISSUE_UPDATE_MUTATION = `mutation NudgeIssueUpdate($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) { success issue { id } }
}`;

const COMMENT_MUTATION = `mutation NudgeComment($input: CommentCreateInput!) {
  commentCreate(input: $input) { success }
}`;

/**
 * Linear: one issue per Delivery, created through the GraphQL API with a personal
 * API key (https://linear.app/developers/graphql).
 */
export function linearAdapter(
  destination: ConfiguredDestination,
  options: LinearOptions = {},
): DestinationAdapter {
  const config = linearDefinition.config.parse(destination.config);
  const apiKey = (destination.secrets as Partial<LinearSecrets>).apiKey;
  if (!apiKey) throw new Error(`Linear ${destination.id} has no API key`);
  const authorization: string = apiKey;
  const fetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
  const teams = options.teams ?? TEAMS_BY_DESTINATION;

  /** A GraphQL call: its data, or the classified failure (never an exception). */
  async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<Call<T>> {
    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        // Personal key: "Authorization: <API_KEY>", without "Bearer".
        headers: { 'content-type': 'application/json', authorization },
        body: JSON.stringify({ query, variables }),
      });
    } catch (error) {
      return { ok: false, failureClass: 'transient', message: errorMessage(error) };
    }
    const body = await graphQLBody<T>(response);
    if (!response.ok && !body?.errors?.length)
      return { ok: false, ...(await httpFailure(response)) };
    await response.body?.cancel();
    if (body?.errors?.length) return { ok: false, ...graphQLFailure(response.status, body.errors) };
    if (!body?.data) {
      return {
        ok: false,
        failureClass: 'transient',
        message: `Linear (HTTP ${response.status}): unreadable response`,
      };
    }
    return { ok: true, data: body.data };
  }

  /** Cache per Destination and per team: switching teams does not reuse the old one. */
  const cacheKey = `${destination.id}:${config.team}`;

  /** Reads the team and its labels from Linear; a team out of the key's reach is a refusal. */
  async function readTeam(): Promise<Call<LoadedTeam>> {
    const call = await graphql<TeamData>(TEAM_QUERY, { team: config.team });
    if (!call.ok) return call;
    const [found] = call.data.teams.nodes;
    if (!found) {
      return refusal(`Linear team "${config.team}" not found with this API key`);
    }
    const labels = new Map<string, string>();
    for (const label of call.data.issueLabels.nodes) {
      if (!label.isGroup) labels.set(labelKey(label.name), label.id);
    }
    const completed = (found.states?.nodes ?? [])
      .filter((state) => state.type === 'completed')
      .sort((a, b) => a.position - b.position);
    const loaded = { id: found.id, completedStateId: completed[0]?.id ?? null, labels };
    teams.set(cacheKey, loaded);
    return { ok: true, data: loaded };
  }

  /**
   * The team and the ids of the named labels. The team read is kept: it is only read
   * again if a name is missing (label created since). A name still not found — or a
   * label group, which an issue cannot carry — rejects the Destination: every Delivery
   * would fail.
   */
  async function resolve(
    names: readonly string[],
    { reread = false } = {},
  ): Promise<Call<TeamAndLabels>> {
    const knowsAll = (team: LoadedTeam) => names.every((name) => team.labels.has(labelKey(name)));
    const kept = reread ? undefined : teams.get(cacheKey);
    let team: LoadedTeam;
    if (kept && knowsAll(kept)) {
      team = kept;
    } else {
      const loaded = await readTeam();
      if (!loaded.ok) return loaded;
      team = loaded.data;
    }
    const missing = names.find((name) => !team.labels.has(labelKey(name)));
    if (missing !== undefined) {
      return refusal(`Linear label "${missing}" not found in team ${config.team}`);
    }
    return {
      ok: true,
      data: {
        teamId: team.id,
        labelIds: names.map((name) => team.labels.get(labelKey(name))!),
      },
    };
  }

  /**
   * Uploads the image to Linear (https://linear.app/developers/how-to-upload-a-file-to-linear):
   * `fileUpload` prepares a signed URL, a PUT drops the image there with the returned
   * headers, and the returned `assetUrl` points to it in the description. A rejected PUT
   * is temporary: the retried Delivery will ask for a new signed URL.
   */
  async function upload(feedbackId: string, image: CaptureImage): Promise<Call<string>> {
    const preparation = await graphql<FileData>(FILE_MUTATION, {
      contentType: image.contentType,
      filename: captureFileName(feedbackId, image.contentType),
      size: image.bytes.length,
    });
    if (!preparation.ok) return preparation;
    const file = preparation.data.fileUpload.uploadFile;
    if (!preparation.data.fileUpload.success || !file) {
      return {
        ok: false,
        failureClass: 'permanent',
        message: 'Linear did not prepare the Capture upload',
      };
    }
    let response: Response;
    try {
      response = await fetch(file.uploadUrl, {
        method: 'PUT',
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'content-type': image.contentType,
          'cache-control': 'public, max-age=31536000',
          ...Object.fromEntries(file.headers.map(({ key, value }) => [key, value])),
        },
        body: image.bytes,
      });
    } catch (error) {
      return { ok: false, failureClass: 'transient', message: errorMessage(error) };
    }
    await response.body?.cancel();
    if (!response.ok) {
      return {
        ok: false,
        failureClass: 'transient',
        message: `Linear: Capture upload refused (HTTP ${response.status})`,
      };
    }
    return { ok: true, data: file.assetUrl };
  }

  /**
   * The team's completed state, where a closed issue goes: read again if the kept team
   * has none (state created since). A team without one rejects the Destination: no
   * Incident could ever be closed there.
   */
  async function completedState(): Promise<Call<{ teamId: string; stateId: string }>> {
    const kept = teams.get(cacheKey);
    let team: LoadedTeam;
    if (kept?.completedStateId) {
      team = kept;
    } else {
      const loaded = await readTeam();
      if (!loaded.ok) return loaded;
      team = loaded.data;
    }
    if (!team.completedStateId) {
      return refusal(`Linear team ${config.team} has no completed workflow state to close issues`);
    }
    return { ok: true, data: { teamId: team.id, stateId: team.completedStateId } };
  }

  async function createIssue(input: {
    teamId: string;
    title: string;
    description: string;
    labelIds: readonly string[];
    stateId?: string;
  }): Promise<DeliveryResult> {
    const creation = await graphql<CreationData>(ISSUE_MUTATION, { input });
    const issue = creation.ok ? creation.data.issueCreate.issue : null;
    if (!creation.ok || !creation.data.issueCreate.success || !issue) {
      // A label or the team may have changed in Linear: the next Delivery reads them again.
      teams.delete(cacheKey);
      return creation.ok
        ? {
            status: 'failed',
            failureClass: 'permanent',
            message: 'Linear did not create the issue (success: false)',
          }
        : failed(creation);
    }
    return { status: 'delivered', externalUrl: externalLink(issue.url) };
  }

  return {
    async send(delivery) {
      const names = [
        config.labels.types[delivery.feedback.resolvedType],
        delivery.feedback.severity
          ? config.labels.severities[delivery.feedback.severity]
          : undefined,
      ].filter((name): name is string => name !== undefined);
      const target = await resolve(names);
      if (!target.ok) return failed(target);
      const capture = await readCapture(delivery.feedback.capture);
      if (!capture.ok) return failed(capture);
      let assetUrl: string | null = null;
      if (capture.image) {
        const uploaded = await upload(delivery.feedback.id, capture.image);
        if (!uploaded.ok) return failed(uploaded);
        assetUrl = uploaded.data;
      }
      return createIssue({
        teamId: target.data.teamId,
        title: titleWithType(delivery, TITLE_MAX),
        description: description(delivery, assetUrl),
        labelIds: target.data.labelIds,
      });
    },
    /**
     * An issue in the configured team, without labels (they are the Feedback's): its
     * link is what finds it again to close it. "Opened then closed" creates it directly
     * in the team's completed state.
     */
    async deliverIncident(delivery) {
      const issue = {
        title: truncate(presentIncident(delivery).title, TITLE_MAX),
        description: incidentToMarkdown(delivery, escapedText),
        labelIds: [],
      };
      if (delivery.incident.closure) {
        const done = await completedState();
        if (!done.ok) return failed(done);
        return createIssue({ ...issue, teamId: done.data.teamId, stateId: done.data.stateId });
      }
      const target = await resolve([]);
      if (!target.ok) return failed(target);
      return createIssue({ ...issue, teamId: target.data.teamId });
    },
    /**
     * Moves the issue the opening created to the completed state, then comments the
     * closing on it: a retry after a failed comment moves it again harmlessly. Never
     * creates a second issue.
     */
    async closeIncident(closing) {
      const identifier = issueIdentifierOf(closing.opening.externalUrl);
      if (!identifier) {
        return {
          status: 'failed',
          failureClass: 'permanent',
          message: 'The opening kept no link to a Linear issue: nothing to close',
        };
      }
      const target = await completedState();
      if (!target.ok) return failed(target);
      const update = await graphql<UpdateData>(ISSUE_UPDATE_MUTATION, {
        id: identifier,
        input: { stateId: target.data.stateId },
      });
      if (!update.ok) return failed(update);
      const issue = update.data.issueUpdate.issue;
      if (!update.data.issueUpdate.success || !issue) {
        return {
          status: 'failed',
          failureClass: 'permanent',
          message: 'Linear did not close the issue (success: false)',
        };
      }
      const comment = await graphql<CommentData>(COMMENT_MUTATION, {
        input: { issueId: issue.id, body: incidentToMarkdown(closing, escapedText) },
      });
      if (!comment.ok) return failed(comment);
      if (!comment.data.commentCreate.success) {
        return {
          status: 'failed',
          failureClass: 'permanent',
          message: 'Linear did not comment the closing (success: false)',
        };
      }
      return { status: 'delivered', externalUrl: closing.opening.externalUrl };
    },
    /** An issue in the configured team, without labels: the labels are the Feedback's. */
    async alert(alert) {
      const target = await resolve([]);
      if (!target.ok) return failed(target);
      const { title } = presentAlert(alert);
      return createIssue({
        teamId: target.data.teamId,
        title: truncate(title, TITLE_MAX),
        description: alertToMarkdown(alert, escapedText),
        labelIds: [],
      });
    },
    /**
     * Reads the team and all the configured labels again with the key, creating nothing:
     * the Destination is only reachable if every Delivery could be.
     */
    async healthCheck() {
      const all = [
        ...Object.values(config.labels.types),
        ...Object.values(config.labels.severities),
      ];
      const target = await resolve(all, { reread: true });
      if (!target.ok)
        return { reachable: false, failureClass: target.failureClass, message: target.message };
      return { reachable: true };
    },
  };
}

interface TeamData {
  readonly teams: {
    readonly nodes: readonly {
      readonly id: string;
      readonly states?: {
        readonly nodes: readonly {
          readonly id: string;
          readonly type: string;
          readonly position: number;
        }[];
      };
    }[];
  };
  readonly issueLabels: {
    readonly nodes: readonly {
      readonly id: string;
      readonly name: string;
      readonly isGroup: boolean;
    }[];
  };
}

interface FileData {
  readonly fileUpload: {
    readonly success: boolean;
    readonly uploadFile: {
      readonly uploadUrl: string;
      readonly assetUrl: string;
      readonly headers: readonly { readonly key: string; readonly value: string }[];
    } | null;
  };
}

interface CreationData {
  readonly issueCreate: {
    readonly success: boolean;
    readonly issue: { readonly url: unknown } | null;
  };
}

interface UpdateData {
  readonly issueUpdate: {
    readonly success: boolean;
    readonly issue: { readonly id: string } | null;
  };
}

interface CommentData {
  readonly commentCreate: { readonly success: boolean };
}

/**
 * The identifier (ENG-123) of the issue a Linear link points at
 * (`https://linear.app/<workspace>/issue/<identifier>/<slug>`), or `null`.
 */
function issueIdentifierOf(link: string | null): string | null {
  const match = link
    ? /^https:\/\/linear\.app\/[^/]+\/issue\/([A-Za-z0-9]+-\d+)(?:\/[^/]*)?$/.exec(link)
    : null;
  return match?.[1] ?? null;
}

/** Maximum length of an issue title (plain text on Linear), in UTF-16 units. */
const TITLE_MAX = 120;

/**
 * Description (markdown): the Author's escaped text, the Capture (image already
 * uploaded to Linear, referenced by its `assetUrl`), then a footer written by nudge.
 */
function description({ project, feedback }: OutgoingDelivery, assetUrl: string | null): string {
  const severity = feedback.severity ? SEVERITY_LABELS[feedback.severity] : 'Not assessed';
  const footer = [
    `**Project**: ${escapePunctuation(project.name)}`,
    `**Type**: ${FEEDBACK_TYPE_LABELS[feedback.resolvedType]} · **Severity**: ${severity}`,
    ...(feedback.uncertain
      ? ['**Uncertain verdict**: the Judge hesitated, check it in nudge.']
      : []),
    ...(isSafeLink(feedback.dashboardUrl)
      ? [`[View the feedback in nudge](<${feedback.dashboardUrl}>)`]
      : []),
  ];
  const capture = isSafeLink(assetUrl) ? [`![Page capture](<${assetUrl}>)`] : [];
  return [escapedText(feedback.text), ...capture, '---', ...footer].join('\n\n');
}

/**
 * The Author's text, shown as written and never interpreted: every ASCII punctuation
 * character is escaped with a backslash, which CommonMark allows for all of them. No
 * link (even bare), image (which Linear would fetch), HTML, heading, list or
 * formatting. Lines are kept by hard line breaks; leading indentation, which would make
 * a code block, becomes non-breaking spaces.
 */
function escapedText(text: string): string {
  const paragraphs = text
    .split(/\r\n|\r|\n/)
    .map((line) =>
      escapePunctuation(line.trimEnd()).replace(/^[ \t]+/, (indentation) =>
        indentation.replaceAll('\t', '    ').replaceAll(' ', ' '),
      ),
    )
    .join('\n')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.split('\n').join('\\\n'))
    .filter((paragraph) => paragraph.length > 0);
  return paragraphs.length > 0 ? paragraphs.join('\n\n') : '_(empty text)_';
}

/** A label name as Linear compares it: case-insensitively. */
const labelKey = (name: string) => name.toLowerCase();

type Failure = {
  readonly ok: false;
  readonly failureClass: FailureClass;
  readonly message: string;
};
type Call<T> = { readonly ok: true; readonly data: T } | Failure;

interface TeamAndLabels {
  readonly teamId: string;
  readonly labelIds: readonly string[];
}

/**
 * A configuration Linear refuses (team, label): the Destination is Suspended as for a
 * rejected key, rather than each Delivery failing.
 */
const refusal = (message: string): Failure => ({ ok: false, failureClass: 'auth', message });

const failed = ({ failureClass, message }: Failure): DeliveryResult => ({
  status: 'failed',
  failureClass,
  message,
});

interface GraphQLError {
  readonly message?: unknown;
  readonly extensions?: {
    readonly type?: unknown;
    readonly code?: unknown;
    readonly userPresentableMessage?: unknown;
  };
}

interface GraphQLBody<T> {
  readonly data?: T | null;
  readonly errors?: readonly GraphQLError[];
}

/** The JSON body of a response, read from a clone (the body stays readable), or `null`. */
async function graphQLBody<T>(response: Response): Promise<GraphQLBody<T> | null> {
  try {
    const body = (await response.clone().json()) as unknown;
    return body && typeof body === 'object' ? (body as GraphQLBody<T>) : null;
  } catch {
    return null;
  }
}

/**
 * Error types of the Linear API (`extensions.type`, or `extensions.code` brought to the
 * same shape: RATELIMITED, AUTHENTICATION_ERROR…), per the Linear SDK
 * (https://github.com/linear/linear/blob/master/packages/sdk/src/error.ts).
 */
const AUTH_TYPES = new Set(['authentication error', 'forbidden']);
const TRANSIENT_TYPES = new Set([
  'ratelimited',
  'internal error',
  'lock timeout',
  'network error',
  'bootstrap error',
]);

const errorType = ({ extensions }: GraphQLError): string => {
  const raw = typeof extensions?.type === 'string' ? extensions.type : extensions?.code;
  return typeof raw === 'string' ? raw.toLowerCase().replaceAll('_', ' ') : '';
};

/**
 * Class of a response carrying GraphQL errors: a rejected key ("authentication
 * error", "forbidden") rejects the Destination; a rate limit (HTTP 400, code
 * RATELIMITED, https://linear.app/developers/rate-limiting) or an internal error is
 * temporary; any other refusal targets this issue (invalid input…). Several errors:
 * the most severe wins.
 */
function graphQLFailure(
  status: number,
  errors: readonly GraphQLError[],
): { failureClass: FailureClass; message: string } {
  const classes = errors.map((error): FailureClass => {
    const type = errorType(error);
    if (AUTH_TYPES.has(type)) return 'auth';
    if (TRANSIENT_TYPES.has(type)) return 'transient';
    return status < 300 ? 'permanent' : classifyStatus(status);
  });
  const failureClass = classes.includes('auth')
    ? 'auth'
    : classes.includes('transient')
      ? 'transient'
      : 'permanent';
  const messages = errors.map(({ message, extensions }) =>
    String(extensions?.userPresentableMessage ?? message ?? 'error without a message'),
  );
  return {
    failureClass,
    message: truncate(`Linear (HTTP ${status}): ${messages.join('; ')}`, EXCERPT_MAX),
  };
}
