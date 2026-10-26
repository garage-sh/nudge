import type { ConfiguredDestination, OutgoingDelivery } from '@nudge/core';
import MarkdownIt from 'markdown-it';
import { describe, expect, it } from 'vitest';
import { resolveDestinationAdapter } from './index.js';
import { linearAdapter } from './linear.js';
import { IN_REVIEW_ALERT, SUSPENSION_ALERT } from './test/alerts.js';
import {
  API_KEY,
  ASSET_URL,
  ISSUE_URL,
  LABEL_BUG_ID,
  LABEL_URGENT_ID,
  LINEAR,
  TEAM_ID,
  UPLOAD_URL,
  type Recording,
} from './test/linear-recordings.js';

const ENDPOINT = 'https://api.linear.app/graphql';

const DESTINATION: ConfiguredDestination = {
  id: '6f1c2a40-0000-4000-8000-000000000021',
  projectId: '6f1c2a40-0000-4000-8000-000000000022',
  name: 'Linear ENG',
  type: 'linear',
  config: {
    team: 'ENG',
    labels: { types: { bug: 'bug', suggestion: 'Idea' }, severities: { blocking: 'Urgent' } },
  },
  secrets: { apiKey: API_KEY },
};

const DELIVERY: OutgoingDelivery = {
  deliveryId: '6f1c2a40-0000-4000-8000-000000000023',
  isTest: false,
  project: { id: DESTINATION.projectId!, name: 'Shop' },
  feedback: {
    id: '6f1c2a40-0000-4000-8000-000000000024',
    text: 'The cart empties when I change pages.\nSince this morning.',
    source: 'widget',
    resolvedType: 'bug',
    severity: 'blocking',
    uncertain: false,
    author: { id: 'u-42', email: 'ada@client.test', trust: 'declared' },
    context: { url: 'https://shop.test/cart' },
    capture: null,
    receivedAt: new Date('2026-10-24T09:29:58.000Z'),
    dashboardUrl: 'https://nudge.example/feedbacks/6f1c2a40-0000-4000-8000-000000000024',
  },
};

interface GraphQLRequest {
  readonly url: string;
  readonly init: RequestInit;
  readonly headers: Headers;
  readonly query: string;
  readonly variables: Record<string, unknown>;
}

type Reply = Recording | Error | 'hang';

/** Recorded Linear: returns the given responses, in order, and keeps the requests. */
function linear(...replies: Reply[]) {
  const requests: GraphQLRequest[] = [];
  let next = 0;
  const fetch = (async (url: string | URL, init: RequestInit = {}) => {
    // Outside the GraphQL endpoint: a Capture upload, binary body.
    const { query, variables } = (
      String(url) === ENDPOINT ? JSON.parse(String(init.body)) : { query: '' }
    ) as {
      query: string;
      variables?: Record<string, unknown>;
    };
    requests.push({
      url: String(url),
      init,
      headers: new Headers(init.headers),
      query,
      variables: variables ?? {},
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

/** A fresh adapter, with its own team cache. */
const adapter = (
  fetch: typeof globalThis.fetch,
  {
    destination = DESTINATION,
    timeoutMs,
  }: { destination?: ConfiguredDestination; timeoutMs?: number } = {},
) => linearAdapter(destination, { fetch, timeoutMs, teams: new Map() });

/** The `issueCreate` input of a creation request. */
const creationInput = (request: GraphQLRequest | undefined) =>
  request!.variables.input as {
    teamId: string;
    title: string;
    description: string;
    labelIds: string[];
  };

describe('Linear adapter, Capture', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff]);
  const withCapture = (read: () => Promise<Uint8Array | null>): OutgoingDelivery => ({
    ...DELIVERY,
    feedback: { ...DELIVERY.feedback, capture: { contentType: 'image/png', bytes: 9, read } },
  });

  it("uploads the Capture to Linear, then shows it in the issue's description", async () => {
    const { fetch, requests } = linear(
      LINEAR.team,
      LINEAR.filePrepared,
      LINEAR.upload,
      LINEAR.issueCreated,
    );

    const result = await adapter(fetch).send(withCapture(async () => PNG));

    expect(result).toEqual({ status: 'delivered', externalUrl: ISSUE_URL });
    expect(requests.map((request) => request.url)).toEqual([
      ENDPOINT,
      ENDPOINT,
      UPLOAD_URL,
      ENDPOINT,
    ]);
    expect(requests[1]?.query).toMatch(/mutation[\s\S]*fileUpload\(/);
    expect(requests[1]?.variables).toEqual({
      contentType: 'image/png',
      filename: `capture-${DELIVERY.feedback.id}.png`,
      size: 9,
    });
    const put = requests[2]!;
    expect(put.init.method).toBe('PUT');
    expect(new Uint8Array(put.init.body as Uint8Array)).toEqual(PNG);
    expect(put.headers.get('content-type')).toBe('image/png');
    expect(put.headers.get('cache-control')).toBe('public, max-age=31536000');
    expect(put.headers.get('x-goog-content-length-range')).toBe('9,9');
    // The API key only goes to Linear, never to the signed URL's storage.
    expect(put.headers.get('authorization')).toBeNull();
    const html = new MarkdownIt().render(creationInput(requests[3]).description);
    expect(html).toContain(`<img src="${ASSET_URL}" alt="Page capture">`);
  });

  it('creates the issue without an image if storage no longer has the Capture', async () => {
    const { fetch, requests } = linear(LINEAR.team, LINEAR.issueCreated);

    const result = await adapter(fetch).send(withCapture(async () => null));

    expect(result).toEqual({ status: 'delivered', externalUrl: ISSUE_URL });
    expect(requests).toHaveLength(2);
    expect(creationInput(requests[1]).description).not.toContain('Capture');
  });

  it('unreachable storage: transient failure, no issue created', async () => {
    const { fetch, requests } = linear(LINEAR.team, LINEAR.issueCreated);

    const result = await adapter(fetch).send(
      withCapture(() => Promise.reject(new Error('unreadable disk'))),
    );

    expect(result).toEqual({
      status: 'failed',
      failureClass: 'transient',
      message: 'Unreadable Capture: unreadable disk',
    });
    expect(requests.some((request) => /issueCreate/.test(request.query))).toBe(false);
  });

  it.each([
    ['the upload refused (403)', [LINEAR.filePrepared, LINEAR.uploadRefused]],
    ['the upload unreachable', [LINEAR.filePrepared, new TypeError('fetch failed')]],
    ['the preparation rate-limited', [LINEAR.rateLimited]],
  ] as const)(
    '%s: transient failure, no issue created',
    async (_case, replies: readonly Reply[]) => {
      const { fetch, requests } = linear(LINEAR.team, ...replies, LINEAR.issueCreated);

      const result = await adapter(fetch).send(withCapture(async () => PNG));

      expect(result).toMatchObject({ status: 'failed', failureClass: 'transient' });
      expect(requests.some((request) => /issueCreate/.test(request.query))).toBe(false);
    },
  );

  it('Linear does not prepare the upload: permanent failure, no issue created', async () => {
    const { fetch, requests } = linear(LINEAR.team, LINEAR.fileNotPrepared, LINEAR.issueCreated);

    const result = await adapter(fetch).send(withCapture(async () => PNG));

    expect(result).toMatchObject({ status: 'failed', failureClass: 'permanent' });
    expect(requests.some((request) => /issueCreate/.test(request.query))).toBe(false);
  });
});

describe('Linear adapter', () => {
  it('creates an issue in the configured team, with the Type and Severity labels, and returns its link', async () => {
    const { fetch, requests } = linear(LINEAR.team, LINEAR.issueCreated);

    const result = await adapter(fetch).send(DELIVERY);

    expect(result).toEqual({ status: 'delivered', externalUrl: ISSUE_URL });
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.url).toBe(ENDPOINT);
      expect(request.init.method).toBe('POST');
      expect(request.headers.get('content-type')).toBe('application/json');
      // Personal API key: "Authorization: <API_KEY>", without "Bearer".
      expect(request.headers.get('authorization')).toBe(API_KEY);
    }
    expect(requests[0]?.variables).toEqual({ team: 'ENG' });
    expect(requests[1]?.query).toMatch(/mutation[\s\S]*issueCreate\(input: \$input\)/);
    const input = creationInput(requests[1]);
    expect(input.teamId).toBe(TEAM_ID);
    expect(input.labelIds).toEqual([LABEL_BUG_ID, LABEL_URGENT_ID]);
    expect(input.title).toBe('Bug · The cart empties when I change pages.');
    expect(input.description).toContain('The cart empties when I change pages');
  });

  it.each([
    ['400 key rejected (authentication error)', 'auth', LINEAR.keyRejected],
    ['401 without a GraphQL body', 'auth', LINEAR.unauthorized],
    ['forbidden', 'auth', LINEAR.accessDenied],
    ['invalid input', 'permanent', LINEAR.invalidInput],
    ['400 RATELIMITED', 'transient', LINEAR.rateLimited],
    ['internal error', 'transient', LINEAR.internalError],
    ['503 without JSON', 'transient', LINEAR.serviceUnavailable],
  ] as const)('classifies a creation refusal "%s": %s', async (_, failureClass, recording) => {
    const { fetch, requests } = linear(LINEAR.team, recording);

    expect(await adapter(fetch).send(DELIVERY)).toEqual({
      status: 'failed',
      failureClass,
      message: expect.stringContaining(String(recording.status)),
    });
    expect(requests).toHaveLength(2);
  });

  it.each([
    ['key rejected', 'auth', LINEAR.keyRejected],
    ['rate limit', 'transient', LINEAR.rateLimited],
    ['503', 'transient', LINEAR.serviceUnavailable],
  ] as const)(
    'classifies a team read refusal "%s": %s, without creating an issue',
    async (_, failureClass, recording) => {
      const { fetch, requests } = linear(recording);

      expect(await adapter(fetch).send(DELIVERY)).toMatchObject({
        status: 'failed',
        failureClass,
      });
      expect(requests).toHaveLength(1);
    },
  );

  it("carries over Linear's error message, never the API key", async () => {
    const { fetch } = linear(LINEAR.team, LINEAR.keyRejected);

    const result = await adapter(fetch).send(DELIVERY);

    expect(result).toMatchObject({
      message: expect.stringContaining('Authentication required, not authenticated'),
    });
    expect(JSON.stringify(result)).not.toContain(API_KEY);
  });

  it('does not follow redirects: a 3xx is a permanent failure', async () => {
    const { fetch, requests } = linear({ provenance: 'reconstructed', source: '', status: 301 });

    expect(await adapter(fetch).send(DELIVERY)).toMatchObject({
      status: 'failed',
      failureClass: 'permanent',
    });
    expect(requests[0]?.init.redirect).toBe('manual');
  });

  it('a network error or a timeout is transient', async () => {
    expect(await adapter(linear(new TypeError('fetch failed')).fetch).send(DELIVERY)).toMatchObject(
      { status: 'failed', failureClass: 'transient', message: 'fetch failed' },
    );
    expect(
      await adapter(linear(LINEAR.team, 'hang').fetch, { timeoutMs: 50 }).send(DELIVERY),
    ).toMatchObject({ status: 'failed', failureClass: 'transient' });
  });

  describe('team and labels', () => {
    const withLabels = (labels: unknown): ConfiguredDestination => ({
      ...DESTINATION,
      config: { team: 'ENG', labels },
    });

    it('a team not found with this key rejects the Destination (auth), without creating an issue', async () => {
      const { fetch, requests } = linear(LINEAR.unknownTeam);

      expect(await adapter(fetch).send(DELIVERY)).toEqual({
        status: 'failed',
        failureClass: 'auth',
        message: expect.stringContaining('ENG'),
      });
      expect(requests).toHaveLength(1);
    });

    it('a configured label not found in Linear rejects the Destination (auth), naming it', async () => {
      const destination = withLabels({ types: { bug: 'Defect' }, severities: {} });
      const { fetch, requests } = linear(LINEAR.team);

      expect(await adapter(fetch, { destination }).send(DELIVERY)).toEqual({
        status: 'failed',
        failureClass: 'auth',
        message: expect.stringContaining('"Defect"'),
      });
      expect(requests).toHaveLength(1);
    });

    it('a label group, which an issue cannot carry, counts as not found', async () => {
      const destination = withLabels({ types: { bug: 'Type' }, severities: {} });
      const { fetch } = linear(LINEAR.team);

      expect(await adapter(fetch, { destination }).send(DELIVERY)).toMatchObject({
        status: 'failed',
        failureClass: 'auth',
      });
    });

    it('with no label mapped for this Type or Severity, creates the issue without labels', async () => {
      const { fetch, requests } = linear(LINEAR.team, LINEAR.issueCreated);
      const feedback = { ...DELIVERY.feedback, resolvedType: 'question' as const, severity: null };

      expect(await adapter(fetch).send({ ...DELIVERY, feedback })).toMatchObject({
        status: 'delivered',
      });
      expect(creationInput(requests[1]).labelIds).toEqual([]);
    });

    it('only reads the team again if a label is missing: once read, an issue costs a single call', async () => {
      const teams = new Map();
      const { fetch, requests } = linear(LINEAR.team, LINEAR.issueCreated, LINEAR.issueCreated);

      for (let i = 0; i < 2; i++) {
        expect(await linearAdapter(DESTINATION, { fetch, teams }).send(DELIVERY)).toMatchObject({
          status: 'delivered',
        });
      }

      expect(requests.map((r) => Object.keys(r.variables))).toEqual([
        ['team'],
        ['input'],
        ['input'],
      ]);
    });

    it('reads the team again when a configured label is not known yet (label created since)', async () => {
      const teams = new Map();
      const first = linear(LINEAR.team, LINEAR.issueCreated);
      await linearAdapter(DESTINATION, { fetch: first.fetch, teams }).send(DELIVERY);
      const suggestion = {
        ...DELIVERY.feedback,
        resolvedType: 'suggestion' as const,
        severity: null,
      };
      const created = withLabels({ types: { suggestion: 'New' }, severities: {} });
      const second = linear(LINEAR.team);

      expect(
        await linearAdapter(created, { fetch: second.fetch, teams }).send({
          ...DELIVERY,
          feedback: suggestion,
        }),
      ).toMatchObject({ status: 'failed', failureClass: 'auth' });
      expect(Object.keys(second.requests[0]!.variables)).toEqual(['team']);
    });
  });

  describe('alert (Alert destination)', () => {
    const md = new MarkdownIt({ html: true });
    const tokens = (body: string) =>
      md.parse(body, {}).flatMap((token) => [token, ...(token.children ?? [])]);

    it('creates an issue for the alert in the team, without labels, with the link to the dashboard', async () => {
      const { fetch, requests } = linear(LINEAR.team, LINEAR.issueCreated);

      expect(await adapter(fetch).alert(IN_REVIEW_ALERT)).toEqual({
        status: 'delivered',
        externalUrl: ISSUE_URL,
      });

      const input = creationInput(requests[1]);
      expect(input.teamId).toBe(TEAM_ID);
      expect(input.labelIds).toEqual([]);
      expect(input.title).toBe('Feedback in review · @everyone *Shop*');
      expect(input.description).toContain('influence Triage');
      const links = tokens(input.description).filter((j) => j.type === 'link_open');
      expect(links.map((j) => j.attrGet('href'))).toEqual([IN_REVIEW_ALERT.dashboardUrl]);
    });

    it("makes the names and the target's refusal literal: no link, no HTML", async () => {
      const { fetch, requests } = linear(LINEAR.team, LINEAR.issueCreated);

      await adapter(fetch).alert(SUSPENSION_ALERT);

      const { description } = creationInput(requests[1]);
      const types = tokens(description).map((j) => j.type);
      expect(types).not.toContain('link_open');
      expect(types).not.toContain('html_inline');
      const text = tokens(description)
        .filter((j) => j.type === 'text')
        .map((j) => j.content)
        .join('');
      expect(text).toContain('Linear [prod](https://trap.test)');
      expect(text).toContain('HTTP 401: <!channel> @here `token` rejected');
    });

    it('classifies a refusal like a Delivery: key rejected = auth', async () => {
      const { fetch } = linear(LINEAR.keyRejected);

      expect(await adapter(fetch).alert(IN_REVIEW_ALERT)).toMatchObject({
        status: 'failed',
        failureClass: 'auth',
      });
    });
  });

  describe('healthCheck', () => {
    it('reads the team and its labels with the key, creating nothing; all found, makes it reachable', async () => {
      const { fetch, requests } = linear(LINEAR.team);

      expect(await adapter(fetch).healthCheck()).toEqual({ reachable: true });

      expect(requests).toHaveLength(1);
      expect(requests[0]?.query).not.toMatch(/mutation/);
      expect(requests[0]?.variables).toEqual({ team: 'ENG' });
    });

    it("checks every configured label, not only a Delivery's", async () => {
      const destination: ConfiguredDestination = {
        ...DESTINATION,
        config: {
          team: 'ENG',
          labels: { types: { bug: 'Bug' }, severities: { minor: 'Annoyance' } },
        },
      };
      const { fetch } = linear(LINEAR.team);

      expect(await adapter(fetch, { destination }).healthCheck()).toEqual({
        reachable: false,
        failureClass: 'auth',
        message: expect.stringContaining('"Annoyance"'),
      });
    });

    it.each([
      ['key rejected', 'auth', LINEAR.keyRejected],
      ['team not found', 'auth', LINEAR.unknownTeam],
      ['rate limit', 'transient', LINEAR.rateLimited],
      ['503', 'transient', LINEAR.serviceUnavailable],
    ] as const)('a "%s" response makes it unreachable (%s)', async (_, failureClass, recording) => {
      const { fetch } = linear(recording);

      expect(await adapter(fetch).healthCheck()).toEqual({
        reachable: false,
        failureClass,
        message: expect.any(String),
      });
    });

    it('a network error makes it unreachable (transient)', async () => {
      expect(await adapter(linear(new TypeError('fetch failed')).fetch).healthCheck()).toEqual({
        reachable: false,
        failureClass: 'transient',
        message: 'fetch failed',
      });
    });
  });

  describe('created issue', () => {
    async function inputOf(delivery: OutgoingDelivery) {
      const { fetch, requests } = linear(LINEAR.team, LINEAR.issueCreated);
      await adapter(fetch).send(delivery);
      return creationInput(requests[1]);
    }

    it('title: the Type and the first line of the text, bounded', async () => {
      const text = `\n  ${'Very long '.repeat(30)}\nrest`;

      const { title } = await inputOf({ ...DELIVERY, feedback: { ...DELIVERY.feedback, text } });

      expect(title.startsWith('Bug · Very long Very long')).toBe(true);
      expect(title.length).toBeLessThanOrEqual(120);
      expect(title.endsWith('…')).toBe(true);
      expect(title).not.toContain('\n');
    });

    it('description: the text, then the Project, the Type, the Severity and the link to the Feedback', async () => {
      const { description } = await inputOf(DELIVERY);
      const html = new MarkdownIt().render(description);

      expect(html).toContain('The cart empties when I change pages.<br>\nSince this morning.');
      expect(html).toContain('<strong>Project</strong>: Shop');
      expect(html).toContain('<strong>Type</strong>: Bug');
      expect(html).toContain('<strong>Severity</strong>: Blocking');
      expect(html).toContain(
        `<a href="${DELIVERY.feedback.dashboardUrl}">View the feedback in nudge</a>`,
      );
      expect(html).not.toContain('Uncertain');
    });

    it('marks the test Feedback and the uncertain Verdict; without Severity or dashboard link', async () => {
      const feedback = {
        ...DELIVERY.feedback,
        severity: null,
        uncertain: true,
        dashboardUrl: null,
      };

      const { title, description } = await inputOf({ ...DELIVERY, isTest: true, feedback });
      const html = new MarkdownIt().render(description);

      expect(title).toBe('Test · Bug · The cart empties when I change pages.');
      expect(html).toContain('<strong>Severity</strong>: Not assessed');
      expect(html).toContain('Uncertain verdict');
      expect(html).not.toContain('<a ');
    });
  });

  describe("encoding of the Author's text", () => {
    const MALICIOUS = [
      '# Trapped heading',
      '[click here](https://trap.test/login) ![pixel](https://trap.test/pixel.png)',
      '<https://trap.test/auto> https://trap.test/direct www.trap.test',
      '**bold** _italic_ ~~struck~~ `code` <img src=x onerror=alert(1)> &lt;b&gt;',
      '> quote',
      '- list',
      '1. numbered',
      '| a | b |',
      '```',
      'end of block? \\ @everyone :smile: $x$',
    ].join('\n');

    /** The markdown-it tokens (CommonMark, bare links recognized) of the Author's text. */
    async function render(text: string, project = DELIVERY.project) {
      const { description } = await (async () => {
        const { fetch, requests } = linear(LINEAR.team, LINEAR.issueCreated);
        const feedback = { ...DELIVERY.feedback, text, dashboardUrl: null };
        await adapter(fetch).send({ ...DELIVERY, project, feedback });
        return creationInput(requests[1]);
      })();
      const md = new MarkdownIt({ html: true, linkify: true });
      const tokens = md
        .parse(description, {})
        .flatMap((token) => [token, ...(token.children ?? [])]);
      return { description, tokens };
    }

    it("no link, image, HTML or formatting comes out of the Author's text", async () => {
      const { tokens } = await render(MALICIOUS);

      const forbidden = tokens.filter((token) =>
        /^(link_open|image|html_inline|html_block|heading_open|em_open|s_open|code_inline|fence|code_block|blockquote_open|bullet_list_open|ordered_list_open|table_open|hr)$/.test(
          token.type,
        ),
      );
      // The description's footer, written by nudge, is the only one with bold and a rule.
      expect(forbidden.map((token) => token.type)).toEqual(['hr']);
    });

    it('the text shows as the Author wrote it, line by line', async () => {
      const { tokens } = await render(MALICIOUS);

      const paragraph = tokens.find((token) => token.type === 'inline')!;
      const shown = (paragraph.children ?? [])
        .map((token) =>
          token.type === 'hardbreak' || token.type === 'softbreak' ? '\n' : token.content,
        )
        .join('');
      expect(shown).toBe(MALICIOUS);
    });

    it('also escapes the Project name', async () => {
      const { tokens } = await render('Nothing to report', {
        ...DELIVERY.project,
        name: '[Shop](https://trap.test) <b>',
      });

      expect(tokens.some((token) => /^(link_open|html_inline)$/.test(token.type))).toBe(false);
    });
  });

  it.each([
    ['a javascript: URL', 'javascript:alert(1)'],
    ['an http URL', 'http://linear.app/shop/issue/ENG-123'],
    ['an overlong URL', `${ISSUE_URL}?${'a'.repeat(2048)}`],
    ['no URL', null],
  ])('keeps no link when Linear returns %s', async (_, url) => {
    const created = {
      ...LINEAR.issueCreated,
      body: {
        data: {
          issueCreate: { success: true, issue: { id: 'issue-1', identifier: 'ENG-1', url } },
        },
      },
    };
    const { fetch } = linear(LINEAR.team, created);

    expect(await adapter(fetch).send(DELIVERY)).toEqual({ status: 'delivered', externalUrl: null });
  });

  it('a creation without an issue (success false) is a permanent failure', async () => {
    const { fetch } = linear(LINEAR.team, LINEAR.creationRefused);

    expect(await adapter(fetch).send(DELIVERY)).toMatchObject({
      status: 'failed',
      failureClass: 'permanent',
    });
  });

  it('after a creation refusal, reads the team again: a label deleted since shows up', async () => {
    const teams = new Map();
    const { fetch, requests } = linear(
      LINEAR.team,
      LINEAR.invalidInput,
      LINEAR.team,
      LINEAR.issueCreated,
    );

    await linearAdapter(DESTINATION, { fetch, teams }).send(DELIVERY);
    await linearAdapter(DESTINATION, { fetch, teams }).send(DELIVERY);

    expect(requests.map((r) => Object.keys(r.variables)[0])).toEqual([
      'team',
      'input',
      'team',
      'input',
    ]);
  });

  it('is registered for the "linear" type in the adapter registry', () => {
    const registered = resolveDestinationAdapter(DESTINATION);

    expect(typeof registered.send).toBe('function');
    expect(typeof registered.healthCheck).toBe('function');
  });
});
