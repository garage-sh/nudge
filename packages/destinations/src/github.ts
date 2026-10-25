import {
  presentAlert,
  type Alert,
  type FailureClass,
  type DestinationAdapter,
  type ConfiguredDestination,
  type OutgoingDelivery,
  type DeliveryResult,
} from '@nudge/core';
import {
  SEVERITY_LABELS,
  FEEDBACK_TYPE_LABELS,
  gitHubDefinition,
  parseGitHubRepository,
  type GitHubSecrets,
} from '@nudge/shared';
import {
  DEFAULT_HTTP_TIMEOUT_MS,
  classifyStatus,
  httpFailure,
  errorMessage,
  failureMessage,
  responseText,
} from './http.js';
import { alertToMarkdown, escapePunctuation, isSafeLink } from './markdown.js';
import { titleWithType, truncate } from './text.js';

export interface GitHubOptions {
  readonly fetch?: typeof globalThis.fetch;
  /** GitHub response timeout, beyond which the call is a transient failure. */
  readonly timeoutMs?: number;
}

/** https://docs.github.com/en/rest/about-the-rest-api/api-versions */
const API_VERSION = '2026-03-10';

/** "Requests without a valid User-Agent header will be rejected." */
const USER_AGENT = 'nudge (https://github.com/garage-sh/nudge)';

/**
 * GitHub Issues: one issue per Delivery, created through the REST API with a personal
 * access token (https://docs.github.com/en/rest/issues/issues#create-an-issue).
 */
export function gitHubAdapter(
  destination: ConfiguredDestination,
  options: GitHubOptions = {},
): DestinationAdapter {
  const config = gitHubDefinition.config.parse(destination.config);
  const repository = parseGitHubRepository(config.repository);
  if (!repository) throw new Error(`GitHub ${destination.id} has no valid repository`);
  const token = (destination.secrets as Partial<GitHubSecrets>).token;
  if (!token) throw new Error(`GitHub ${destination.id} has no access token`);
  const fetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
  const endpoint = `https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;

  const call = (url: string, init: RequestInit = {}) =>
    fetch(url, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': API_VERSION,
        'user-agent': USER_AGENT,
        ...init.headers,
      },
    });

  /** "Create an issue": delivered with its link, or the classified failure. */
  async function createIssue(issue: { title: string; body: string }): Promise<DeliveryResult> {
    let response: Response;
    try {
      response = await call(`${endpoint}/issues`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(issue),
      });
    } catch (error) {
      return { status: 'failed', failureClass: 'transient', message: errorMessage(error) };
    }
    if (!response.ok) return { status: 'failed', ...(await gitHubFailure(response)) };
    const created = (await response.json().catch(() => ({}))) as { html_url?: unknown };
    return {
      status: 'delivered',
      externalUrl: typeof created.html_url === 'string' ? created.html_url : null,
    };
  }

  return {
    send: (delivery) => createIssue({ title: title(delivery), body: body(delivery) }),
    alert: (alert) => createIssue(alertIssue(alert)),
    /**
     * "Get a repository": the token sees the repository, its issues are enabled and it
     * is not archived (read-only). Does not check the permission to write issues, which
     * only a creation would prove.
     */
    async healthCheck() {
      let response: Response;
      try {
        response = await call(endpoint);
      } catch (error) {
        return { reachable: false, failureClass: 'transient', message: errorMessage(error) };
      }
      if (!response.ok) return { reachable: false, ...(await gitHubFailure(response)) };
      const read = (await response.json().catch(() => ({}))) as {
        has_issues?: unknown;
        archived?: unknown;
      };
      if (read.has_issues === false) {
        return {
          reachable: false,
          failureClass: 'auth',
          message: `Issues are disabled on ${config.repository}`,
        };
      }
      if (read.archived === true) {
        return {
          reachable: false,
          failureClass: 'auth',
          message: `Repository ${config.repository} is archived: it no longer accepts issues`,
        };
      }
      return { reachable: true };
    },
  };
}

/**
 * Class of a GitHub refusal:
 * - a rate limit, primary (`x-ratelimit-remaining: 0`) or secondary (`retry-after`,
 *   "secondary rate limit" message), comes as a 403 or 429: temporary
 *   (https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api);
 * - 401 (invalid token), 403 (permission denied), 404 (unknown repository or out of
 *   the token's reach), 410 (issues disabled) and a redirect (repository renamed or
 *   transferred) reject the Destination: every Delivery would fail (D21);
 * - 400 and 422 (validation, content deemed spam) target this issue.
 */
async function gitHubFailure(
  response: Response,
): Promise<{ failureClass: FailureClass; message: string }> {
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    return {
      failureClass: 'auth',
      message: `HTTP ${response.status}: repository renamed or transferred, configure its current name`,
    };
  }
  if ((response.status === 403 || response.status === 429) && (await isRateLimited(response))) {
    return { failureClass: 'transient', message: await failureMessage(response) };
  }
  return httpFailure(response, (status) =>
    status === 404 || status === 410 ? 'auth' : classifyStatus(status),
  );
}

async function isRateLimited(response: Response): Promise<boolean> {
  if (response.headers.get('x-ratelimit-remaining') === '0') return true;
  if (response.headers.has('retry-after')) return true;
  return /rate limit/i.test(await responseText(response));
}

/** Maximum length of an issue title, in UTF-16 units. */
const TITLE_MAX = 120;

/**
 * Title (plain text on GitHub): the Type and the first line of the text, its `@`
 * broken by a zero-width space so as to mention nobody.
 */
const title = (delivery: OutgoingDelivery) => withoutMention(titleWithType(delivery, TITLE_MAX));

/** Body (GitHub markdown): the Author's text, then a footer written by nudge. */
function body({ project, feedback }: OutgoingDelivery): string {
  const severity = feedback.severity ? SEVERITY_LABELS[feedback.severity] : 'Not assessed';
  const footer = [
    `**Project**: ${escapeMarkdown(project.name)}`,
    `**Type**: ${FEEDBACK_TYPE_LABELS[feedback.resolvedType]} · **Severity**: ${severity}`,
    ...(feedback.uncertain
      ? ['**Uncertain verdict**: the Judge hesitated, check it in nudge.']
      : []),
    ...(isSafeLink(feedback.dashboardUrl)
      ? [`[View the feedback in nudge](<${feedback.dashboardUrl}>)`]
      : []),
  ];
  return [codeBlock(feedback.text), '---', ...footer].join('\n\n');
}

/**
 * The issue of an alert: plain-text title without mentions; body written by nudge,
 * where the names (typed by a Member) and the refusal (worded by the target) are literal.
 */
function alertIssue(alert: Alert): { title: string; body: string } {
  const { title: alertTitle } = presentAlert(alert);
  return {
    title: withoutMention(truncate(alertTitle, TITLE_MAX)),
    body: alertToMarkdown(alert, escapeMarkdown),
  };
}

/**
 * Maximum length of an issue body: 65,536 characters according to GitHub's 422
 * message ("body is too long (maximum is 65536 characters)"), which the REST API
 * documentation does not quantify.
 */
const BODY_MAX = 65_536;

/** Room left for the footer written by nudge (Project name included, 100 characters). */
const FOOTER_MAX = 1_000;

/** Room for the code block of the Author's text, fences included. */
const TEXT_MAX = BODY_MAX - FOOTER_MAX;

/**
 * The Author's text in a fenced code block: its content is literal (GFM,
 * https://github.github.com/gfm/#fenced-code-blocks), with no formatting, link, image,
 * HTML, mention or issue reference. The fence has one more backtick than the text's
 * longest run, which therefore cannot close it.
 */
function codeBlock(text: string): string {
  let lines = text.replace(/\r\n?/g, '\n');
  let fence: string;
  // The fence depends on the text kept; truncating can only shorten it: the loop
  // stops as soon as text and fences fit together.
  for (;;) {
    const longest = (lines.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
    fence = '`'.repeat(Math.max(3, longest + 1));
    const room = TEXT_MAX - 2 * (fence.length + 1);
    if (lines.length <= room) break;
    lines = truncate(lines, room);
  }
  return `${fence}\n${lines}\n${fence}`;
}

/** A Member's text (Project name) in markdown: literal, and without mentions. */
const escapeMarkdown = (text: string) => withoutMention(escapePunctuation(text));

const withoutMention = (text: string) => text.replaceAll('@', '@​');
