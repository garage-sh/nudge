import type { DeliveryView, FeedbackDetailView } from '@nudge/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SIGNED_IN, fakeApi } from './test/fake-api.js';
import { renderDashboard } from './test/render.js';

const DELIVERED: DeliveryView = {
  id: 'delivery-1',
  destination: { id: 'dest-1', name: 'Product Linear', type: 'linear', state: 'active' },
  status: 'delivered',
  externalUrl: 'https://linear.app/nudge/issue/NUD-1',
  attempts: 1,
  lastError: null,
  createdAt: '2026-10-24T09:00:01.000Z',
  updatedAt: '2026-10-24T09:00:02.000Z',
};

const FEEDBACK: FeedbackDetailView = {
  id: 'feedback-1',
  project: { id: 'project-1', name: 'Shop' },
  state: 'dispatched',
  source: 'api',
  text: 'Checkout crashes',
  declaredType: null,
  author: null,
  context: {},
  capture: null,
  verdict: {
    resolvedType: 'bug',
    severity: 'major',
    junk: false,
    manipulation: false,
    uncertain: false,
  },
  deliveries: [DELIVERED],
  createdAt: '2026-10-24T09:00:00.000Z',
};

const IN_REVIEW: FeedbackDetailView = {
  ...FEEDBACK,
  state: 'in_review',
  verdict: { ...FEEDBACK.verdict!, manipulation: true },
  deliveries: [],
};

const DISCARDED: FeedbackDetailView = {
  ...FEEDBACK,
  state: 'discarded',
  verdict: { ...FEEDBACK.verdict!, resolvedType: 'opinion', junk: true },
  deliveries: [],
};

const detail = (feedback: FeedbackDetailView) => ({ status: 200, body: feedback });

describe('Review of a Feedback', () => {
  it('approves a Feedback In review', async () => {
    const api = fakeApi({
      'GET /api/session': SIGNED_IN,
      'GET /api/feedbacks/feedback-1': detail(IN_REVIEW),
      'POST /api/feedbacks/feedback-1/review': detail({ ...IN_REVIEW, state: 'triaged' }),
    });
    renderDashboard('/feedbacks/feedback-1');

    const review = await screen.findByRole('region', { name: 'Review' });
    expect(review.textContent).toMatch(/Manipulation/);
    await userEvent.click(within(review).getByRole('button', { name: 'Approve' }));

    expect(api.calls).toContainEqual({
      route: 'POST /api/feedbacks/feedback-1/review',
      body: { action: 'approve' },
    });
    expect(await screen.findByText('Triaged')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Review' })).toBeNull();
  });

  it('rejects a Feedback In review after confirmation', async () => {
    const api = fakeApi({
      'GET /api/session': SIGNED_IN,
      'GET /api/feedbacks/feedback-1': detail(IN_REVIEW),
      'POST /api/feedbacks/feedback-1/review': detail({ ...IN_REVIEW, state: 'discarded' }),
    });
    renderDashboard('/feedbacks/feedback-1');

    const review = await screen.findByRole('region', { name: 'Review' });
    await userEvent.click(within(review).getByRole('button', { name: 'Reject' }));
    expect(api.calls.map((c) => c.route)).not.toContain('POST /api/feedbacks/feedback-1/review');
    await userEvent.click(within(review).getByRole('button', { name: 'Confirm' }));

    expect(api.calls).toContainEqual({
      route: 'POST /api/feedbacks/feedback-1/review',
      body: { action: 'reject' },
    });
    expect(await screen.findByText('Discarded')).toBeTruthy();
    // Rejected after review: it cannot be reinstated.
    expect(screen.queryByRole('region', { name: 'Review' })).toBeNull();
  });

  it('reinstates a Feedback Discarded as Junk', async () => {
    const api = fakeApi({
      'GET /api/session': SIGNED_IN,
      'GET /api/feedbacks/feedback-1': detail(DISCARDED),
      'POST /api/feedbacks/feedback-1/review': detail({ ...DISCARDED, state: 'triaged' }),
    });
    renderDashboard('/feedbacks/feedback-1');

    const review = await screen.findByRole('region', { name: 'Review' });
    expect(within(review).queryByRole('button', { name: 'Approve' })).toBeNull();
    await userEvent.click(within(review).getByRole('button', { name: 'Reinstate' }));

    expect(api.calls).toContainEqual({
      route: 'POST /api/feedbacks/feedback-1/review',
      body: { action: 'reinstate' },
    });
    expect(await screen.findByText('Triaged')).toBeTruthy();
  });

  it('offers no review to a dispatched Feedback', async () => {
    fakeApi({ 'GET /api/session': SIGNED_IN, 'GET /api/feedbacks/feedback-1': detail(FEEDBACK) });
    renderDashboard('/feedbacks/feedback-1');

    await screen.findByRole('region', { name: 'Verdict' });
    expect(screen.queryByRole('region', { name: 'Review' })).toBeNull();
  });

  it('explains a refusal: the Feedback changed in the meantime, and is read again', async () => {
    const api = fakeApi({
      'GET /api/session': SIGNED_IN,
      'GET /api/feedbacks/feedback-1': detail(IN_REVIEW),
      'POST /api/feedbacks/feedback-1/review': {
        status: 409,
        body: { error: 'transition_refused', state: 'dispatched' },
      },
    });
    renderDashboard('/feedbacks/feedback-1');

    const review = await screen.findByRole('region', { name: 'Review' });
    await userEvent.click(within(review).getByRole('button', { name: 'Approve' }));

    expect((await within(review).findByRole('alert')).textContent).toMatch(
      /changed in the meantime/,
    );
    expect(
      api.calls.filter((c) => c.route === 'GET /api/feedbacks/feedback-1').length,
    ).toBeGreaterThan(1);
  });
});

describe('Verdict correction', () => {
  it('corrects the type and the Severity, and recalls that served Destinations do not change', async () => {
    const corrected = {
      ...FEEDBACK,
      verdict: { ...FEEDBACK.verdict!, resolvedType: 'question', severity: 'cosmetic' },
    } satisfies FeedbackDetailView;
    const api = fakeApi({
      'GET /api/session': SIGNED_IN,
      'GET /api/feedbacks/feedback-1': detail({
        ...FEEDBACK,
        verdict: { ...FEEDBACK.verdict!, uncertain: true },
      }),
      'PATCH /api/feedbacks/feedback-1/verdict': detail(corrected),
    });
    renderDashboard('/feedbacks/feedback-1');

    const verdict = await screen.findByRole('region', { name: 'Verdict' });
    await userEvent.click(within(verdict).getByRole('button', { name: 'Correct' }));
    expect(verdict.textContent).toMatch(/replay a Delivery/);
    await userEvent.selectOptions(within(verdict).getByLabelText('Resolved type'), 'Question');
    await userEvent.selectOptions(within(verdict).getByLabelText('Severity'), 'Cosmetic');
    await userEvent.click(within(verdict).getByRole('button', { name: 'Save' }));

    expect(api.calls).toContainEqual({
      route: 'PATCH /api/feedbacks/feedback-1/verdict',
      body: { resolvedType: 'question', severity: 'cosmetic' },
    });
    expect(await within(verdict).findByText('Question')).toBeTruthy();
    expect(within(verdict).getByText('Cosmetic')).toBeTruthy();
    expect(within(verdict).queryByText('Uncertain')).toBeNull();
    expect(within(verdict).queryByLabelText('Resolved type')).toBeNull();
  });

  it('offers no correction to a Feedback not triaged yet', async () => {
    fakeApi({
      'GET /api/session': SIGNED_IN,
      'GET /api/feedbacks/feedback-1': detail({
        ...FEEDBACK,
        state: 'received',
        verdict: null,
        deliveries: [],
      }),
    });
    renderDashboard('/feedbacks/feedback-1');

    const verdict = await screen.findByRole('region', { name: 'Verdict' });
    expect(within(verdict).queryByRole('button', { name: 'Correct' })).toBeNull();
  });
});

describe('Replay of a Delivery', () => {
  const FAILED: DeliveryView = {
    ...DELIVERED,
    id: 'delivery-2',
    destination: { id: 'dest-2', name: 'Webhook', type: 'webhook', state: 'active' },
    status: 'failed',
    externalUrl: null,
    attempts: 3,
    lastError: 'permanent: HTTP 422',
  };
  const PENDING: DeliveryView = {
    ...DELIVERED,
    id: 'delivery-3',
    destination: { id: 'dest-3', name: 'Discord', type: 'discord', state: 'active' },
    status: 'pending',
  };
  const HELD: DeliveryView = {
    ...DELIVERED,
    id: 'delivery-4',
    destination: { id: 'dest-4', name: 'Slack', type: 'slack', state: 'suspended' },
    status: 'held',
  };

  it('replays a delivered or failed Delivery, not a pending or held one, then follows the new attempt', async () => {
    const api = fakeApi({
      'GET /api/session': SIGNED_IN,
      'GET /api/feedbacks/feedback-1': detail({
        ...FEEDBACK,
        deliveries: [DELIVERED, FAILED, PENDING, HELD],
      }),
    });
    api.set('POST /api/deliveries/delivery-2/replay', () => {
      api.set(
        'GET /api/feedbacks/feedback-1',
        detail({
          ...FEEDBACK,
          deliveries: [DELIVERED, { ...FAILED, status: 'pending', lastError: null }],
        }),
      );
      return { status: 202, body: { ...FAILED, status: 'pending', lastError: null } };
    });
    renderDashboard('/feedbacks/feedback-1');

    const deliveries = await screen.findByRole('region', { name: 'Deliveries' });
    const [delivered, failed, pending, held] = within(deliveries).getAllByRole('listitem') as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    expect(within(delivered).getByRole('link', { name: /NUD-1/ })).toBeTruthy();
    expect(
      within(delivered).getByRole('button', { name: /^Replay the Delivery to / }),
    ).toBeTruthy();
    expect(within(pending).queryByRole('button', { name: /^Replay the Delivery to / })).toBeNull();
    expect(within(held).queryByRole('button', { name: /^Replay the Delivery to / })).toBeNull();
    expect(failed.textContent).toMatch(/HTTP 422/);
    await userEvent.click(within(failed).getByRole('button', { name: /^Replay the Delivery to / }));

    expect(api.calls.map((c) => c.route)).toContain('POST /api/deliveries/delivery-2/replay');
    expect(await within(deliveries).findByText('Pending')).toBeTruthy();
    expect(deliveries.textContent).not.toMatch(/HTTP 422/);
  });

  it('explains a refused replay', async () => {
    fakeApi({
      'GET /api/session': SIGNED_IN,
      'GET /api/feedbacks/feedback-1': detail({ ...FEEDBACK, deliveries: [FAILED] }),
      'POST /api/deliveries/delivery-2/replay': {
        status: 409,
        body: { error: 'delivery_not_replayable', status: 'pending' },
      },
    });
    renderDashboard('/feedbacks/feedback-1');

    const deliveries = await screen.findByRole('region', { name: 'Deliveries' });
    await userEvent.click(
      within(deliveries).getByRole('button', { name: /^Replay the Delivery to / }),
    );

    expect((await within(deliveries).findByRole('alert')).textContent).toMatch(
      /cannot be replayed now/,
    );
  });
});

describe('Redispatch of a Feedback', () => {
  const TRIAGED: FeedbackDetailView = { ...FEEDBACK, state: 'triaged', deliveries: [] };

  it('creates the missing Deliveries of a Triaged Feedback and says how many', async () => {
    const api = fakeApi({
      'GET /api/session': SIGNED_IN,
      'GET /api/feedbacks/feedback-1': detail(TRIAGED),
    });
    api.set('POST /api/feedbacks/feedback-1/redispatch', () => {
      const after = {
        ...TRIAGED,
        state: 'dispatched',
        deliveries: [{ ...DELIVERED, status: 'pending' }],
      };
      api.set('GET /api/feedbacks/feedback-1', detail(after as FeedbackDetailView));
      return { status: 200, body: { deliveriesCreated: 1, feedback: after } };
    });
    renderDashboard('/feedbacks/feedback-1');

    const deliveries = await screen.findByRole('region', { name: 'Deliveries' });
    expect(deliveries.textContent).toMatch(/No Delivery/);
    await userEvent.click(within(deliveries).getByRole('button', { name: 'Redispatch' }));

    expect(api.calls.map((c) => c.route)).toContain('POST /api/feedbacks/feedback-1/redispatch');
    expect(await within(deliveries).findByText('1 Delivery created.')).toBeTruthy();
    expect(within(deliveries).getByText('Product Linear')).toBeTruthy();
    expect(await screen.findByText('Dispatched')).toBeTruthy();
  });

  it('says when no further Destination accepts the Feedback', async () => {
    fakeApi({
      'GET /api/session': SIGNED_IN,
      'GET /api/feedbacks/feedback-1': detail(FEEDBACK),
      'POST /api/feedbacks/feedback-1/redispatch': {
        status: 200,
        body: { deliveriesCreated: 0, feedback: FEEDBACK },
      },
    });
    renderDashboard('/feedbacks/feedback-1');

    const deliveries = await screen.findByRole('region', { name: 'Deliveries' });
    await userEvent.click(within(deliveries).getByRole('button', { name: 'Redispatch' }));

    expect(
      await within(deliveries).findByText(/No other Destination accepts this Feedback/),
    ).toBeTruthy();
  });

  it.each([
    ['Received', { ...FEEDBACK, state: 'received', verdict: null, deliveries: [] }],
    ['Discarded', DISCARDED],
    ['In review', IN_REVIEW],
  ] as const)('offers no redispatch to a %s Feedback', async (_label, feedback) => {
    fakeApi({ 'GET /api/session': SIGNED_IN, 'GET /api/feedbacks/feedback-1': detail(feedback) });
    renderDashboard('/feedbacks/feedback-1');

    const deliveries = await screen.findByRole('region', { name: 'Deliveries' });
    expect(within(deliveries).queryByRole('button', { name: 'Redispatch' })).toBeNull();
  });

  it('explains a refused redispatch', async () => {
    fakeApi({
      'GET /api/session': SIGNED_IN,
      'GET /api/feedbacks/feedback-1': detail(TRIAGED),
      'POST /api/feedbacks/feedback-1/redispatch': {
        status: 409,
        body: { error: 'feedback_not_redispatchable', state: 'received' },
      },
    });
    renderDashboard('/feedbacks/feedback-1');

    const deliveries = await screen.findByRole('region', { name: 'Deliveries' });
    await userEvent.click(within(deliveries).getByRole('button', { name: 'Redispatch' }));

    expect((await within(deliveries).findByRole('alert')).textContent).toMatch(
      /cannot be redispatched/,
    );
  });
});
