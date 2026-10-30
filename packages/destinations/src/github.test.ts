import type { ConfiguredDestination, OutgoingDelivery } from '@nudge/core';
import MarkdownIt from 'markdown-it';
import { describe, expect, it } from 'vitest';
import { gitHubAdapter } from './github.js';
import { resolveDestinationAdapter } from './index.js';
import { HELD_SUMMARY, IN_REVIEW_ALERT, SUSPENSION_ALERT } from './test/alerts.js';
import { incidentClosing, incidentOpenedThenClosed, incidentOpening } from './test/incidents.js';
import {
  GITHUB,
  ISSUE_NUMBER,
  ISSUE_URL,
  TOKEN,
  REPOSITORY_NAME,
  OWNER,
  type Recording,
} from './test/github-recordings.js';

const REPOSITORY_API = `https://api.github.com/repos/${OWNER}/${REPOSITORY_NAME}`;

const DESTINATION: ConfiguredDestination = {
  id: '6f1c2a40-0000-4000-8000-000000000041',
  projectId: '6f1c2a40-0000-4000-8000-000000000042',
  name: 'Issues shop-web',
  type: 'github',
  config: { repository: `${OWNER}/${REPOSITORY_NAME}` },
  secrets: { token: TOKEN },
};

const DELIVERY: OutgoingDelivery = {
  deliveryId: '6f1c2a40-0000-4000-8000-000000000043',
  isTest: false,
  project: { id: DESTINATION.projectId!, name: 'Shop' },
  feedback: {
    id: '6f1c2a40-0000-4000-8000-000000000044',
    text: 'The cart empties when I change pages.\nSince this morning.',
    source: 'widget',
    resolvedType: 'bug',
    severity: 'major',
    uncertain: false,
    author: { id: 'u-42', email: 'ada@client.test', trust: 'declared' },
    context: { url: 'https://shop.test/cart' },
    capture: null,
    receivedAt: new Date('2026-10-24T09:29:58.000Z'),
    dashboardUrl: 'https://nudge.example/feedbacks/6f1c2a40-0000-4000-8000-000000000044',
  },
};

interface ReceivedRequest {
  readonly url: string;
  readonly init: RequestInit;
  readonly headers: Headers;
  readonly body: string | null;
}

type Reply = Recording | Error | 'hang';

/** Recorded GitHub: returns the given responses, in order, and keeps the requests. */
function github(...replies: Reply[]) {
  const requests: ReceivedRequest[] = [];
  let next = 0;
  const fetch = (async (url: string | URL, init: RequestInit = {}) => {
    requests.push({
      url: String(url),
      init,
      headers: new Headers(init.headers),
      body: init.body === undefined ? null : String(init.body),
    });
    const reply = replies[Math.min(next++, replies.length - 1)];
    if (!reply) throw new Error('No recorded response');
    if (reply instanceof Error) throw reply;
    if (reply === 'hang') {
      // Never answers: only the adapter's timeout (signal) interrupts it.
      return new Promise<Response>((_, reject) =>
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
      );
    }
    const isText = typeof reply.body === 'string';
    return new Response(isText ? (reply.body as string) : JSON.stringify(reply.body), {
      status: reply.status,
      headers: {
        'content-type': isText ? 'text/html' : 'application/json; charset=utf-8',
        ...reply.headers,
      },
    });
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

const adapter = (fetch: typeof globalThis.fetch, timeoutMs?: number) =>
  gitHubAdapter(DESTINATION, { fetch, timeoutMs });

/** What the adapter posts to "Create an issue". */
interface IssueBody {
  readonly title: string;
  readonly body: string;
}

const jsonBody = (request: ReceivedRequest | undefined) => JSON.parse(request!.body!) as IssueBody;

describe('GitHub Issues adapter', () => {
  it('creates an issue in the configured repository and returns its link', async () => {
    const { fetch, requests } = github(GITHUB.issueCreated);

    expect(await adapter(fetch).send(DELIVERY)).toEqual({
      status: 'delivered',
      externalUrl: ISSUE_URL,
    });

    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.url).toBe(`${REPOSITORY_API}/issues`);
    expect(request?.init.method).toBe('POST');
    expect(request?.init.redirect).toBe('manual');
    expect(request?.headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(request?.headers.get('accept')).toBe('application/vnd.github+json');
    expect(request?.headers.get('x-github-api-version')).toBe('2026-03-10');
    // "Requests without a valid User-Agent header will be rejected."
    expect(request?.headers.get('user-agent')).toMatch(/^nudge/);
    expect(request?.headers.get('content-type')).toBe('application/json');
    const body = jsonBody(request);
    expect(Object.keys(body).sort()).toEqual(['body', 'title']);
    expect(body.title).toBe('Bug · The cart empties when I change pages.');
    expect(body.body).toContain('The cart empties when I change pages.\nSince this morning.');
    expect(body.body).toContain('**Type**: Bug · **Severity**: Major');
    expect(body.body).toContain(
      `[View the feedback in nudge](<${DELIVERY.feedback.dashboardUrl}>)`,
    );
  });

  it.each([
    ['a javascript: URL', 'javascript:alert(1)'],
    ['an http URL', 'http://github.com/shop/issues/1'],
    ['an overlong URL', `${ISSUE_URL}?${'a'.repeat(2048)}`],
    ['no URL', 42],
  ])('keeps no link when GitHub returns %s', async (_, htmlUrl) => {
    const recording = {
      ...GITHUB.issueCreated,
      body: { ...GITHUB.issueCreated.body, html_url: htmlUrl },
    };

    expect(await adapter(github(recording).fetch).send(DELIVERY)).toEqual({
      status: 'delivered',
      externalUrl: null,
    });
  });

  it.each([
    ['401 bad credentials', 'auth', GITHUB.badCredentials],
    ['403 permission denied', 'auth', GITHUB.permissionDenied],
    // Unknown repository or out of the token's reach, issues disabled: every Delivery
    // would fail, the Destination is Suspended (D21).
    ['404 repository not found', 'auth', GITHUB.notFound],
    ['410 issues disabled', 'auth', GITHUB.issuesDisabled],
    ['400 invalid request', 'permanent', GITHUB.invalidRequest],
    ['422 validation failed', 'permanent', GITHUB.validationFailed],
    // A rate limit is not a refusal, even as a 403.
    ['403 primary rate limit', 'transient', GITHUB.primaryRateLimit],
    ['403 secondary rate limit', 'transient', GITHUB.secondaryRateLimit],
    ['429 secondary rate limit', 'transient', GITHUB.rateLimit429],
    ['503 unavailable', 'transient', GITHUB.unavailable],
  ] as const)('classifies a %s response: %s', async (_, failureClass, recording) => {
    const { fetch, requests } = github(recording);

    expect(await adapter(fetch).send(DELIVERY)).toEqual({
      status: 'failed',
      failureClass,
      message: expect.stringContaining(String(recording.status)),
    });
    expect(requests).toHaveLength(1);
  });

  it("carries GitHub's message over, never the token", async () => {
    const { fetch } = github(GITHUB.badCredentials);

    const result = await adapter(fetch).send(DELIVERY);

    expect(result).toMatchObject({ message: expect.stringContaining('Bad credentials') });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it('a renamed or transferred repository (3xx, not followed) rejects the Destination', async () => {
    const { fetch, requests } = github(GITHUB.moved);

    expect(await adapter(fetch).send(DELIVERY)).toEqual({
      status: 'failed',
      failureClass: 'auth',
      message: expect.stringContaining('301'),
    });
    expect(requests[0]?.init.redirect).toBe('manual');
  });

  it('a network error or a timeout is transient', async () => {
    expect(await adapter(github(new TypeError('fetch failed')).fetch).send(DELIVERY)).toMatchObject(
      { status: 'failed', failureClass: 'transient', message: 'fetch failed' },
    );
    expect(await adapter(github('hang').fetch, 50).send(DELIVERY)).toMatchObject({
      status: 'failed',
      failureClass: 'transient',
    });
  });

  describe('alert (Alert destination)', () => {
    /** Without `linkify`: only the links the markdown writes (a bare link stays readable). */
    const md = new MarkdownIt({ html: true });
    const tokens = (body: string) =>
      md.parse(body, {}).flatMap((token) => [token, ...(token.children ?? [])]);

    it('creates an issue for the alert, with the link to the dashboard', async () => {
      const { fetch, requests } = github(GITHUB.issueCreated);

      expect(await adapter(fetch).alert(IN_REVIEW_ALERT)).toEqual({
        status: 'delivered',
        externalUrl: ISSUE_URL,
      });

      expect(requests[0]?.url).toBe(`${REPOSITORY_API}/issues`);
      const body = jsonBody(requests[0]);
      expect(body.title).toBe('Feedback in review · @​everyone *Shop*');
      expect(body.body).toContain('influence Triage');
      expect(body.body).toContain(
        `**Feedback**: ${IN_REVIEW_ALERT.feedback.id.replaceAll('-', '\\-')}`,
      );
      const links = tokens(body.body).filter((t) => t.type === 'link_open');
      expect(links.map((t) => t.attrGet('href'))).toEqual([IN_REVIEW_ALERT.dashboardUrl]);
    });

    it("makes the names and the target's refusal literal: no hidden link, HTML or mention", async () => {
      const { fetch, requests } = github(GITHUB.issueCreated);

      await adapter(fetch).alert(SUSPENSION_ALERT);

      const { title, body } = jsonBody(requests[0]);
      expect(title).toBe('Destination suspended · Linear [prod](https://trap.test)');
      const types = tokens(body).map((t) => t.type);
      expect(types).not.toContain('link_open');
      expect(types).not.toContain('html_inline');
      expect(body).not.toMatch(/@here/);
      const text = tokens(body)
        .filter((t) => t.type === 'text' || t.type === 'code_inline')
        .map((t) => t.content)
        .join('');
      expect(text).toContain('Linear [prod](https://trap.test)');
      expect(text).toContain('HTTP 401: <!channel> @​here `token` rejected');
    });

    it('classifies a refusal like a Delivery: repository not found = auth', async () => {
      const { fetch } = github(GITHUB.notFound);

      expect(await adapter(fetch).alert(IN_REVIEW_ALERT)).toMatchObject({
        status: 'failed',
        failureClass: 'auth',
      });
    });
  });

  describe('summarizeHeld', () => {
    const md = new MarkdownIt({ html: true });
    const tokens = (body: string) =>
      md.parse(body, {}).flatMap((token) => [token, ...(token.children ?? [])]);

    it('creates an issue for the summary, the Project name literal and without mention', async () => {
      const { fetch, requests } = github(GITHUB.issueCreated);

      expect(await adapter(fetch).summarizeHeld(HELD_SUMMARY)).toEqual({
        status: 'delivered',
        externalUrl: ISSUE_URL,
      });

      expect(requests[0]?.url).toBe(`${REPOSITORY_API}/issues`);
      const { title, body } = jsonBody(requests[0]);
      expect(title).toBe('Incidents held · @​everyone *Shop* <b>');
      expect(body).toContain('37 Incidents were held');
      const types = tokens(body).map((t) => t.type);
      expect(types).not.toContain('html_inline');
      const links = tokens(body).filter((t) => t.type === 'link_open');
      expect(links.map((t) => t.attrGet('href'))).toEqual([HELD_SUMMARY.dashboardUrl]);
    });
  });

  describe('healthCheck', () => {
    it('reads the repository with the token, creating nothing; issues enabled: reachable', async () => {
      const { fetch, requests } = github(GITHUB.repository);

      expect(await adapter(fetch).healthCheck()).toEqual({ reachable: true });

      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe(REPOSITORY_API);
      expect(requests[0]?.init.method ?? 'GET').toBe('GET');
      expect(requests[0]?.body).toBeNull();
      expect(requests[0]?.headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    });

    it.each([
      ['with issues disabled', { has_issues: false }],
      ['archived', { archived: true }],
    ])('a repository %s rejects the Destination (auth)', async (_, fields) => {
      const repository = { ...GITHUB.repository, body: { ...GITHUB.repository.body, ...fields } };

      expect(await adapter(github(repository).fetch).healthCheck()).toEqual({
        reachable: false,
        failureClass: 'auth',
        message: expect.stringContaining(`${OWNER}/${REPOSITORY_NAME}`),
      });
    });

    it.each([
      ['401 bad credentials', 'auth', GITHUB.badCredentials],
      ['404 repository not found', 'auth', GITHUB.notFound],
      ['301 repository moved', 'auth', GITHUB.moved],
      ['403 primary rate limit', 'transient', GITHUB.primaryRateLimit],
      ['503 unavailable', 'transient', GITHUB.unavailable],
    ] as const)('a %s response makes it unreachable (%s)', async (_, failureClass, recording) => {
      expect(await adapter(github(recording).fetch).healthCheck()).toEqual({
        reachable: false,
        failureClass,
        message: expect.stringContaining(String(recording.status)),
      });
    });

    it('a network error makes it unreachable (transient)', async () => {
      expect(await adapter(github(new TypeError('fetch failed')).fetch).healthCheck()).toEqual({
        reachable: false,
        failureClass: 'transient',
        message: 'fetch failed',
      });
    });
  });

  it('marks the test Feedback and the uncertain Verdict; without Severity or dashboard link', async () => {
    const { fetch, requests } = github(GITHUB.issueCreated);
    const feedback = { ...DELIVERY.feedback, severity: null, uncertain: true, dashboardUrl: null };

    await adapter(fetch).send({ ...DELIVERY, isTest: true, feedback });

    const body = jsonBody(requests[0]);
    expect(body.title).toBe('Test · Bug · The cart empties when I change pages.');
    expect(body.body).toContain('**Severity**: Not assessed');
    expect(body.body).toContain('**Uncertain verdict**');
    expect(body.body).not.toContain('View the feedback');
  });

  describe("encoding of the Author's text", () => {
    const MALICIOUS = [
      '@everyone thanks @octocat and @garage-sh/maintainers',
      'See #1, garage-sh/nudge#2, GH-3 and a5c3785ed8d6a35868bc169f07e40e889087fd2e',
      '[click](https://trap.test/login) ![pixel](https://trap.test/p.png) https://trap.test/direct',
      '<img src=x onerror=alert(1)> <details><summary>open</summary></details>',
      '# Title',
      '```',
      'end of block?',
      '````js',
      '~~~',
      '    indented',
      '- [ ] list',
    ].join('\n');

    const md = new MarkdownIt({ html: true, linkify: true });

    async function issue(text: string, project = DELIVERY.project) {
      const { fetch, requests } = github(GITHUB.issueCreated);
      await adapter(fetch).send({
        ...DELIVERY,
        project,
        feedback: { ...DELIVERY.feedback, text },
      });
      return jsonBody(requests[0]);
    }

    /** The markdown-it tokens (CommonMark, HTML and bare links recognized) of the body. */
    const tokens = (body: string) =>
      md.parse(body, {}).flatMap((token) => [token, ...(token.children ?? [])]);

    it('renders the text in a code block it cannot close, as is', async () => {
      const { body } = await issue(MALICIOUS);

      const [first] = md.parse(body, {});
      expect(first?.type).toBe('fence');
      expect(first?.content).toBe(`${MALICIOUS}\n`);
      // A code block is literal (GFM spec, "Fenced code blocks"): no mention, issue
      // reference, link, image or HTML.
      expect(tokens(body).filter((t) => t.type === 'fence')).toHaveLength(1);
    });

    it('leaves no link, image or HTML besides the link to nudge', async () => {
      const { body } = await issue(MALICIOUS);

      const types = tokens(body).map((t) => t.type);
      expect(types).not.toContain('image');
      expect(types).not.toContain('html_block');
      expect(types).not.toContain('html_inline');
      const links = tokens(body).filter((t) => t.type === 'link_open');
      expect(links.map((t) => t.attrGet('href'))).toEqual([DELIVERY.feedback.dashboardUrl]);
    });

    it('keeps line breaks and indentation; normalizes line endings', async () => {
      const { body } = await issue('a\r\n  b\rc');

      expect(md.parse(body, {})[0]?.content).toBe('a\n  b\nc\n');
    });

    it('truncates a text too long for an issue, code block included', async () => {
      const { body } = await issue('a'.repeat(70_000));

      expect(body.length).toBeLessThanOrEqual(65_536);
      const [first] = md.parse(body, {});
      expect(first?.type).toBe('fence');
      expect(first?.content.endsWith('…\n')).toBe(true);
    });

    it('stays under the limit even when the fence grows (long run of backticks)', async () => {
      const text = `${'`'.repeat(40_000)}\n${'a'.repeat(40_000)}`;
      const { body } = await issue(text);

      expect(body.length).toBeLessThanOrEqual(65_536);
      const [first] = md.parse(body, {});
      expect(first?.type).toBe('fence');
      expect(md.parse(body, {}).filter((t) => t.type === 'fence')).toHaveLength(1);
    });

    it('breaks the mentions of the title, which takes the first line', async () => {
      const { title } = await issue('@everyone @octocat the cart empties');

      expect(title).not.toMatch(/@(everyone|octocat)/);
      expect(title.replaceAll('​', '')).toBe('Bug · @everyone @octocat the cart empties');
    });

    it('escapes the Project name: no link, no mention', async () => {
      const { body } = await issue('Hello', {
        ...DELIVERY.project,
        name: '[Shop](https://trap.test) @garage-sh/maintainers',
      });

      const links = tokens(body).filter((t) => t.type === 'link_open');
      expect(links.map((t) => t.attrGet('href'))).toEqual([DELIVERY.feedback.dashboardUrl]);
      const text = tokens(body)
        .filter((t) => t.type === 'text')
        .map((t) => t.content)
        .join('');
      expect(text).toContain('[Shop](https://trap.test)');
      expect(text).not.toContain('@garage-sh');
    });
  });

  describe('Incidents', () => {
    const OPENING = incidentOpening(DESTINATION.projectId!);
    const CLOSING = incidentClosing(DESTINATION.projectId!, ISSUE_URL);
    const md = new MarkdownIt({ html: true, linkify: true });
    const tokens = (body: string) =>
      md.parse(body, {}).flatMap((token) => [token, ...(token.children ?? [])]);

    it('creates an issue for an opened Incident and returns its link to close it later', async () => {
      const { fetch, requests } = github(GITHUB.issueCreated);

      expect(await adapter(fetch).deliverIncident(OPENING)).toEqual({
        status: 'delivered',
        externalUrl: ISSUE_URL,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe(`${REPOSITORY_API}/issues`);
      expect(requests[0]?.init.method).toBe('POST');
      const { title, body } = jsonBody(requests[0]);
      expect(title).toBe('Error · @​everyone <b>Payment</b> timed out');
      expect(body).toContain('An Incident opened in Shop \\(production\\)\\.');
      expect(body).toContain('**Level**: Error \\(declared\\)');
      expect(body).toContain('**Occurrences**: 3');
      const links = tokens(body).filter((t) => t.type === 'link_open');
      expect(links.map((t) => t.attrGet('href'))).toEqual([OPENING.incident.dashboardUrl]);
    });

    it('lets no text of the sender make a link, HTML or a mention', async () => {
      const { fetch, requests } = github(GITHUB.issueCreated);
      const hostile = '@octocat [login](https://trap.test) <img src=x> https://trap.test/direct';

      await adapter(fetch).deliverIncident({
        ...OPENING,
        incident: {
          ...OPENING.incident,
          title: hostile,
          message: hostile,
          environment: hostile,
          context: { service: hostile },
        },
      });

      const { title, body } = jsonBody(requests[0]);
      expect(title).not.toContain('@octocat');
      const types = tokens(body).map((t) => t.type);
      expect(types).not.toContain('html_inline');
      expect(types).not.toContain('html_block');
      const links = tokens(body).filter((t) => t.type === 'link_open');
      expect(links.map((t) => t.attrGet('href'))).toEqual([OPENING.incident.dashboardUrl]);
      expect(body).not.toContain('@octocat');
    });

    it('closes the issue its opening created, then comments the closing on it', async () => {
      const { fetch, requests } = github(GITHUB.issueClosed, GITHUB.commentCreated);

      expect(await adapter(fetch).closeIncident(CLOSING)).toEqual({
        status: 'delivered',
        externalUrl: ISSUE_URL,
      });

      expect(requests.map((r) => [r.init.method, r.url])).toEqual([
        ['PATCH', `${REPOSITORY_API}/issues/${ISSUE_NUMBER}`],
        ['POST', `${REPOSITORY_API}/issues/${ISSUE_NUMBER}/comments`],
      ]);
      expect(JSON.parse(requests[0]!.body!)).toEqual({
        state: 'closed',
        state_reason: 'completed',
      });
      const comment = JSON.parse(requests[1]!.body!) as { body: string };
      expect(Object.keys(comment)).toEqual(['body']);
      expect(comment.body).toContain('An Incident of Shop was resolved by its sender\\.');
      expect(comment.body).toContain('**Closed**: 2026\\-10\\-24T09\\:31\\:00\\.000Z');
    });

    it.each([
      ['401 bad credentials', 'auth', GITHUB.badCredentials],
      ['403 permission denied', 'auth', GITHUB.permissionDenied],
      ['404 not found', 'auth', GITHUB.notFound],
      ['422 validation failed', 'permanent', GITHUB.validationFailed],
      // The issue alone is gone: the Destination keeps working, it is not Suspended.
      ['410 issue deleted', 'permanent', GITHUB.issuesDisabled],
      ['301 issue transferred', 'permanent', GITHUB.moved],
      ['403 primary rate limit', 'transient', GITHUB.primaryRateLimit],
      ['503 unavailable', 'transient', GITHUB.unavailable],
    ] as const)(
      'classifies a closing refused with %s like a Delivery: %s, nothing commented',
      async (_, failureClass, recording) => {
        const { fetch, requests } = github(recording, GITHUB.commentCreated);

        expect(await adapter(fetch).closeIncident(CLOSING)).toEqual({
          status: 'failed',
          failureClass,
          message: expect.stringContaining(String(recording.status)),
        });
        expect(requests).toHaveLength(1);
      },
    );

    it('a refused closing comment fails the closing, which a retry closes again harmlessly', async () => {
      const { fetch } = github(GITHUB.issueClosed, GITHUB.unavailable);

      expect(await adapter(fetch).closeIncident(CLOSING)).toMatchObject({
        status: 'failed',
        failureClass: 'transient',
      });
    });

    it.each([
      ['no link', null],
      ['a link to another repository', `https://github.com/${OWNER}/other/issues/${ISSUE_NUMBER}`],
      ['a link that is not an issue', `https://github.com/${OWNER}/${REPOSITORY_NAME}/pull/7`],
    ])(
      'never creates a second issue: an opening with %s fails the closing permanently',
      async (_, link) => {
        const { fetch, requests } = github(GITHUB.issueCreated);

        expect(
          await adapter(fetch).closeIncident(incidentClosing(DESTINATION.projectId!, link)),
        ).toMatchObject({ status: 'failed', failureClass: 'permanent' });
        expect(requests).toHaveLength(0);
      },
    );

    it('"opened then closed" after a suspension creates the issue, then closes it at once', async () => {
      const { fetch, requests } = github(GITHUB.issueCreated, GITHUB.issueClosed);

      expect(
        await adapter(fetch).deliverIncident(incidentOpenedThenClosed(DESTINATION.projectId!)),
      ).toEqual({ status: 'delivered', externalUrl: ISSUE_URL });

      expect(requests.map((r) => [r.init.method, r.url])).toEqual([
        ['POST', `${REPOSITORY_API}/issues`],
        ['PATCH', `${REPOSITORY_API}/issues/${ISSUE_NUMBER}`],
      ]);
      expect(jsonBody(requests[0]).title).toMatch(/^Closed · Error · /);
      expect(JSON.parse(requests[1]!.body!)).toMatchObject({ state: 'closed' });
    });

    it('"opened then closed" whose immediate closing fails stays delivered: a replay would make a second issue', async () => {
      const { fetch } = github(GITHUB.issueCreated, GITHUB.unavailable);

      expect(
        await adapter(fetch).deliverIncident(incidentOpenedThenClosed(DESTINATION.projectId!)),
      ).toEqual({ status: 'delivered', externalUrl: ISSUE_URL });
    });

    it('"opened then closed" whose creation is refused closes nothing', async () => {
      const { fetch, requests } = github(GITHUB.badCredentials);

      expect(
        await adapter(fetch).deliverIncident(incidentOpenedThenClosed(DESTINATION.projectId!)),
      ).toMatchObject({ status: 'failed', failureClass: 'auth' });
      expect(requests).toHaveLength(1);
    });
  });

  it('is registered for the "github" type in the adapter registry', () => {
    const resolved = resolveDestinationAdapter(DESTINATION);

    expect(typeof resolved.send).toBe('function');
    expect(typeof resolved.healthCheck).toBe('function');
  });
});
