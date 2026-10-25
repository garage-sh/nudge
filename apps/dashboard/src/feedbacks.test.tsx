import type {
  FeedbackPage,
  ProjectView,
  FeedbackDetailView,
  FeedbackSummaryView,
} from '@nudge/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SIGNED_IN, fakeApi } from './test/fake-api.js';
import { renderDashboard } from './test/render.js';

const SHOP: ProjectView = {
  id: 'project-1',
  name: 'Shop',
  description: null,
  publicKey: 'nk_pub_shop',
  allowedOrigins: [],
  createdAt: '2026-10-24T08:00:00.000Z',
};

const FEEDBACK: FeedbackSummaryView = {
  id: 'feedback-1',
  project: { id: 'project-1', name: 'Shop' },
  state: 'dispatched',
  source: 'api',
  preview: 'Checkout crashes',
  declaredType: null,
  verdict: {
    resolvedType: 'bug',
    severity: 'blocking',
    junk: false,
    manipulation: false,
    uncertain: false,
  },
  createdAt: '2026-10-24T09:00:00.000Z',
};

const page = (feedbacks: FeedbackSummaryView[], next: string | null = null) => ({
  status: 200,
  body: { feedbacks, next } satisfies FeedbackPage,
});

const PROJECTS = { status: 200, body: [SHOP] };

describe('Inbox', () => {
  it('is the home screen and lists the Feedback with its Verdict, Uncertain ones easy to spot', async () => {
    fakeApi({
      'GET /api/session': SIGNED_IN,
      'GET /api/projects': PROJECTS,
      'GET /api/feedbacks': page([
        FEEDBACK,
        {
          ...FEEDBACK,
          id: 'feedback-2',
          preview: 'Hello',
          state: 'triaged',
          verdict: {
            ...FEEDBACK.verdict!,
            resolvedType: 'opinion',
            severity: null,
            uncertain: true,
          },
        },
        {
          ...FEEDBACK,
          id: 'feedback-3',
          preview: 'Just arrived',
          state: 'received',
          verdict: null,
        },
      ]),
    });

    renderDashboard('/');

    expect(await screen.findByRole('heading', { name: 'Inbox' })).toBeTruthy();
    await screen.findByText('Checkout crashes');
    const [bug, uncertain, received] = screen
      .getAllByRole('listitem')
      .filter((li) => li.querySelector('a[href^="/feedbacks/"]')) as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    expect(within(bug).getByRole('link', { name: 'Checkout crashes' })).toHaveProperty(
      'pathname',
      '/feedbacks/feedback-1',
    );
    expect(bug.textContent).toMatch(/Shop/);
    expect(bug.textContent).toMatch(/Bug/);
    expect(bug.textContent).toMatch(/Blocking/);
    expect(bug.textContent).toMatch(/Dispatched/);
    expect(bug.textContent).not.toMatch(/Uncertain/);
    expect(within(uncertain).getByText('Uncertain')).toBeTruthy();
    expect(received.textContent).toMatch(/Received/);
    expect(received.textContent).toMatch(/Not triaged/);
  });

  it('filters by Project, Type, Severity, State, Source and Uncertain Verdict', async () => {
    const base = 'GET /api/feedbacks?project=project-1&type=bug&severity=blocking&state=dispatched';
    const api = fakeApi({
      'GET /api/session': SIGNED_IN,
      'GET /api/projects': PROJECTS,
      'GET /api/feedbacks': page([FEEDBACK]),
      'GET /api/feedbacks?project=project-1': page([FEEDBACK]),
      'GET /api/feedbacks?project=project-1&type=bug': page([FEEDBACK]),
      'GET /api/feedbacks?project=project-1&type=bug&severity=blocking': page([FEEDBACK]),
      [base]: page([FEEDBACK]),
      [`${base}&source=api`]: page([FEEDBACK]),
      [`${base}&source=api&uncertain=true`]: page([]),
    });
    renderDashboard('/feedbacks');
    await screen.findByText('Checkout crashes');

    await userEvent.selectOptions(await screen.findByLabelText('Project'), 'Shop');
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'Bug');
    await userEvent.selectOptions(screen.getByLabelText('Severity'), 'Blocking');
    await userEvent.click(screen.getByRole('link', { name: 'Dispatched' }));
    await userEvent.selectOptions(screen.getByLabelText('Source'), 'API');
    await userEvent.selectOptions(screen.getByLabelText('Verdict'), 'Uncertain only');

    expect(await screen.findByText(/No Feedback matches/)).toBeTruthy();
    expect(api.calls.map((c) => c.route)).toContain(`${base}&source=api&uncertain=true`);
  });

  it('loads the next page on demand', async () => {
    fakeApi({
      'GET /api/session': SIGNED_IN,
      'GET /api/projects': PROJECTS,
      'GET /api/feedbacks?type=bug': page([FEEDBACK], 'cursor-2'),
      'GET /api/feedbacks?type=bug&cursor=cursor-2': page([
        { ...FEEDBACK, id: 'feedback-old', preview: 'An older one' },
      ]),
    });
    renderDashboard('/feedbacks?type=bug');

    await userEvent.click(await screen.findByRole('button', { name: 'Show more' }));

    expect(await screen.findByText('An older one')).toBeTruthy();
    expect(screen.getByText('Checkout crashes')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('shows a Feedback’s text as text, never as HTML', async () => {
    const malicious = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    fakeApi({
      'GET /api/session': SIGNED_IN,
      'GET /api/projects': PROJECTS,
      'GET /api/feedbacks': page([{ ...FEEDBACK, preview: malicious }]),
    });

    renderDashboard('/feedbacks');

    expect(await screen.findByText(malicious)).toBeTruthy();
    expect(document.querySelector('img, script')).toBeNull();
  });
});

const DETAIL: FeedbackDetailView = {
  id: 'feedback-1',
  project: { id: 'project-1', name: 'Shop' },
  state: 'dispatched',
  source: 'api',
  text: 'Checkout crashes\nevery time',
  declaredType: 'bug',
  author: { id: 'u-42', email: 'ada@client.test', name: null, trust: 'attested' },
  context: {
    url: 'https://shop.test/cart',
    userAgent: 'Firefox 140',
    viewport: { width: 1280, height: 800 },
    metadata: { version: '2.3.1' },
  },
  capture: null,
  verdict: {
    resolvedType: 'bug',
    severity: 'major',
    junk: false,
    manipulation: false,
    uncertain: true,
  },
  deliveries: [
    {
      id: 'delivery-1',
      destination: { id: 'dest-1', name: 'Product Linear', type: 'linear', state: 'active' },
      status: 'delivered',
      externalUrl: 'https://linear.app/nudge/issue/NUD-1',
      attempts: 1,
      lastError: null,
      createdAt: '2026-10-24T09:00:01.000Z',
      updatedAt: '2026-10-24T09:00:02.000Z',
    },
    {
      id: 'delivery-2',
      destination: { id: 'dest-2', name: 'Webhook', type: 'webhook', state: 'suspended' },
      status: 'failed',
      externalUrl: null,
      attempts: 3,
      lastError: '503 Service Unavailable',
      createdAt: '2026-10-24T09:00:01.000Z',
      updatedAt: '2026-10-24T09:00:05.000Z',
    },
  ],
  createdAt: '2026-10-24T09:00:00.000Z',
};

describe('Inbox on a large screen', () => {
  /** A screen wide enough to open a Feedback beside the list. */
  const wideScreen = () =>
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));

  const routes = () => ({
    'GET /api/session': SIGNED_IN,
    'GET /api/projects': PROJECTS,
    'GET /api/feedbacks': page([
      FEEDBACK,
      { ...FEEDBACK, id: 'feedback-2', preview: 'The second one' },
    ]),
    'GET /api/feedbacks/feedback-1': { status: 200, body: DETAIL },
    'GET /api/feedbacks/feedback-2': {
      status: 200,
      body: { ...DETAIL, id: 'feedback-2', text: 'The second one' },
    },
  });

  it('opens the Feedback beside the list, like a mail client', async () => {
    wideScreen();
    fakeApi(routes());
    renderDashboard('/feedbacks');

    await userEvent.click(await screen.findByRole('link', { name: 'Checkout crashes' }));

    const pane = await screen.findByRole('complementary', { name: 'Open Feedback' });
    expect(within(pane).getByLabelText('Feedback text').textContent).toMatch(/Checkout/);
    expect(screen.getByRole('heading', { level: 1, name: 'Inbox' })).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Checkout crashes' }).getAttribute('aria-current'),
    ).toBe('true');
  });

  it('moves to the next Feedback with J and closes the pane with Escape', async () => {
    wideScreen();
    fakeApi(routes());
    renderDashboard('/feedbacks');
    await userEvent.click(await screen.findByRole('link', { name: 'Checkout crashes' }));
    await screen.findByRole('complementary', { name: 'Open Feedback' });

    await userEvent.keyboard('j');
    const pane = screen.getByRole('complementary', { name: 'Open Feedback' });
    expect((await within(pane).findByLabelText('Feedback text')).textContent).toBe(
      'The second one',
    );

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('complementary', { name: 'Open Feedback' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Inbox' })).toBeTruthy();
  });
});

describe('A Feedback’s detail', () => {
  it('shows the text, the Author, the context, the Verdict and the Deliveries', async () => {
    fakeApi({
      'GET /api/session': SIGNED_IN,
      'GET /api/feedbacks/feedback-1': { status: 200, body: DETAIL },
    });

    renderDashboard('/feedbacks/feedback-1');

    const text = await screen.findByLabelText('Feedback text');
    expect(text.textContent).toBe('Checkout crashes\nevery time');
    expect(screen.getByRole('link', { name: 'Shop' })).toHaveProperty(
      'pathname',
      '/projects/project-1',
    );

    const author = screen.getByRole('region', { name: 'Author' });
    expect(author.textContent).toMatch(/ada@client\.test/);
    expect(author.textContent).toMatch(/u-42/);
    expect(author.textContent).toMatch(/Attested/);

    const context = screen.getByRole('region', { name: 'Context' });
    expect(context.textContent).toMatch(/https:\/\/shop\.test\/cart/);
    expect(context.textContent).toMatch(/Firefox 140/);
    expect(context.textContent).toMatch(/1280 × 800/);
    expect(context.textContent).toMatch(/version/);
    expect(context.textContent).toMatch(/2\.3\.1/);

    const verdict = screen.getByRole('region', { name: 'Verdict' });
    expect(verdict.textContent).toMatch(/Bug/);
    expect(verdict.textContent).toMatch(/Major/);
    expect(within(verdict).getByText('Uncertain')).toBeTruthy();

    const deliveries = screen.getByRole('region', { name: 'Deliveries' });
    expect(within(deliveries).getByRole('link', { name: /NUD-1/ })).toHaveProperty(
      'href',
      'https://linear.app/nudge/issue/NUD-1',
    );
    expect(deliveries.textContent).toMatch(/Product Linear/);
    expect(deliveries.textContent).toMatch(/Delivered/);
    expect(deliveries.textContent).toMatch(/Webhook/);
    expect(deliveries.textContent).toMatch(/Failed/);
    expect(deliveries.textContent).toMatch(/503 Service Unavailable/);
  });

  it('shows the Capture attached by the Author, and lets the Member open it full size', async () => {
    fakeApi({
      'GET /api/session': SIGNED_IN,
      'GET /api/feedbacks/feedback-1': {
        status: 200,
        body: { ...DETAIL, capture: { contentType: 'image/png', bytes: 48_213 } },
      },
    });

    renderDashboard('/feedbacks/feedback-1');

    const capture = await screen.findByRole('region', { name: 'Capture' });
    expect(
      within(capture).getByRole('img', { name: 'Capture of the page attached by the Author' }),
    ).toHaveProperty('src', 'http://localhost:3000/api/feedbacks/feedback-1/capture');
    const open = within(capture).getByRole('link', { name: /Open the image/ });
    expect(open.getAttribute('href')).toBe('/api/feedbacks/feedback-1/capture');
    expect(open.getAttribute('target')).toBe('_blank');
    expect(open.getAttribute('rel')).toBe('noopener noreferrer');
    expect(capture.textContent).toMatch(/PNG · 47 KiB/);
  });

  it('without a Capture, shows none', async () => {
    fakeApi({
      'GET /api/session': SIGNED_IN,
      'GET /api/feedbacks/feedback-1': { status: 200, body: DETAIL },
    });

    renderDashboard('/feedbacks/feedback-1');

    await screen.findByLabelText('Feedback text');
    expect(screen.queryByRole('region', { name: 'Capture' })).toBeNull();
  });

  it('shows an anonymous Feedback, not triaged yet, without a Delivery', async () => {
    fakeApi({
      'GET /api/session': SIGNED_IN,
      'GET /api/feedbacks/feedback-1': {
        status: 200,
        body: {
          ...DETAIL,
          state: 'received',
          author: null,
          context: {},
          verdict: null,
          deliveries: [],
        },
      },
    });

    renderDashboard('/feedbacks/feedback-1');

    expect((await screen.findByRole('region', { name: 'Author' })).textContent).toMatch(
      /Anonymous/,
    );
    expect(screen.getByRole('region', { name: 'Verdict' }).textContent).toMatch(/not triaged yet/);
    expect(screen.getByRole('region', { name: 'Deliveries' }).textContent).toMatch(/No Delivery/);
  });

  it('never interprets the Author’s text or context as HTML or an active link', async () => {
    fakeApi({
      'GET /api/session': SIGNED_IN,
      'GET /api/feedbacks/feedback-1': {
        status: 200,
        body: {
          ...DETAIL,
          text: '<script>alert(1)</script><img src=x onerror="alert(2)">',
          context: { url: 'javascript:alert(3)', metadata: { '<b>key</b>': '<i>v</i>' } },
          deliveries: [{ ...DETAIL.deliveries[0]!, externalUrl: 'javascript:alert(4)' }],
        },
      },
    });

    renderDashboard('/feedbacks/feedback-1');

    expect((await screen.findByLabelText('Feedback text')).textContent).toBe(
      '<script>alert(1)</script><img src=x onerror="alert(2)">',
    );
    expect(document.querySelector('script, img, b, i')).toBeNull();
    expect(screen.getByText('javascript:alert(3)').closest('a')).toBeNull();
    expect(screen.getByText('javascript:alert(4)').closest('a')).toBeNull();
  });

  it('explains that a Feedback does not exist', async () => {
    fakeApi({
      'GET /api/session': SIGNED_IN,
      'GET /api/feedbacks/unknown': { status: 404, body: { error: 'feedback_not_found' } },
    });

    renderDashboard('/feedbacks/unknown');

    expect((await screen.findByRole('alert')).textContent).toMatch(/This Feedback does not exist/);
  });
});
