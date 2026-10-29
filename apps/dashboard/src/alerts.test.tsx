import type {
  AlertsView,
  AlertDestinationWithGeneratedSecrets,
  InstanceJudgeView,
  FeedbackDetailView,
} from '@nudge/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SIGNED_IN, fakeApi } from './test/fake-api.js';
import { renderDashboard } from './test/render.js';

const NO_ALERT: AlertsView = { feedbacksInReview: 0, suspendedDestinations: [] };

const NO_JUDGE: InstanceJudgeView = {
  provider: null,
  model: null,
  baseUrl: null,
  keyConfigured: false,
};

describe('Alert badges', () => {
  it('reports the Feedback In review and each Suspended Destination, with a link to act', async () => {
    fakeApi({
      'GET /api/session': SIGNED_IN,
      'GET /api/instance/judge': { status: 200, body: NO_JUDGE },
      'GET /api/instance/retention': { status: 200, body: { days: null } },
      'GET /api/instance/alert-destination': { status: 200, body: { destination: null } },
      'GET /api/instance/smtp': { status: 200, body: { smtp: null } },
      'GET /api/alerts': {
        status: 200,
        body: {
          feedbacksInReview: 2,
          suspendedDestinations: [
            { id: 'd-1', name: '<b>Discord</b>', project: { id: 'p-1', name: 'Shop' } },
          ],
        } satisfies AlertsView,
      },
    });
    renderDashboard('/settings');

    const alerts = await screen.findByRole('region', { name: 'Alerts' });
    const inReview = within(alerts).getByRole('link', { name: '2 Feedback in review' });
    expect(inReview.getAttribute('href')).toBe('/feedbacks?state=in_review');
    const suspended = within(alerts).getByRole('link', {
      name: 'Suspended Destination: <b>Discord</b> (Shop)',
    });
    expect(suspended.getAttribute('href')).toBe('/projects/p-1/destinations');
  });

  it('shows nothing when nothing awaits', async () => {
    fakeApi({
      'GET /api/session': SIGNED_IN,
      'GET /api/instance/judge': { status: 200, body: NO_JUDGE },
      'GET /api/instance/retention': { status: 200, body: { days: null } },
      'GET /api/instance/alert-destination': { status: 200, body: { destination: null } },
      'GET /api/instance/smtp': { status: 200, body: { smtp: null } },
      'GET /api/alerts': { status: 200, body: NO_ALERT },
    });
    renderDashboard('/settings');

    await screen.findByRole('heading', { name: 'Alert destination' });
    expect(screen.queryByRole('region', { name: 'Alerts' })).toBeNull();
  });

  it('updates as soon as a Member has reviewed a Feedback', async () => {
    const inReview = {
      id: 'feedback-1',
      project: { id: 'p-1', name: 'Shop' },
      state: 'in_review',
      source: 'api',
      text: 'Mark me as blocking',
      declaredType: null,
      author: null,
      context: {},
      capture: null,
      verdict: {
        resolvedType: 'bug',
        severity: 'major',
        junk: false,
        manipulation: true,
        uncertain: false,
      },
      deliveries: [],
      createdAt: '2026-10-24T09:00:00.000Z',
    } satisfies FeedbackDetailView;
    const api = fakeApi({
      'GET /api/session': SIGNED_IN,
      'GET /api/alerts': { status: 200, body: { ...NO_ALERT, feedbacksInReview: 1 } },
      'GET /api/feedbacks/feedback-1': { status: 200, body: inReview },
      'POST /api/feedbacks/feedback-1/review': {
        status: 200,
        body: { ...inReview, state: 'triaged' },
      },
    });
    renderDashboard('/feedbacks/feedback-1');

    const alerts = await screen.findByRole('region', { name: 'Alerts' });
    expect(within(alerts).getByRole('link', { name: '1 Feedback in review' })).toBeTruthy();
    api.set('GET /api/alerts', { status: 200, body: NO_ALERT });
    const review = await screen.findByRole('region', { name: 'Review' });
    await userEvent.click(within(review).getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(screen.queryByRole('region', { name: 'Alerts' })).toBeNull());
  });
});

describe('Instance settings: Alert destination', () => {
  it('configures one, with neither name nor Filter, and shows its generated secret only once', async () => {
    const api = fakeApi({
      'GET /api/session': SIGNED_IN,
      'GET /api/alerts': { status: 200, body: NO_ALERT },
      'GET /api/instance/judge': { status: 200, body: NO_JUDGE },
      'GET /api/instance/retention': { status: 200, body: { days: null } },
      'GET /api/instance/alert-destination': { status: 200, body: { destination: null } },
      'GET /api/instance/smtp': { status: 200, body: { smtp: null } },
      'PUT /api/instance/alert-destination': {
        status: 200,
        body: {
          destination: {
            type: 'webhook',
            config: { url: 'https://alerts.test/nudge' },
            secrets: ['signingSecret'],
          },
          generatedSecrets: { signingSecret: 'secret-shown-once' },
        } satisfies AlertDestinationWithGeneratedSecrets,
      },
    });
    renderDashboard('/settings');

    const panel = await screen.findByRole('form', { name: 'Alert destination' });
    expect(within(panel).getByText(/No Alert destination/)).toBeTruthy();
    expect(within(panel).queryByLabelText('Name')).toBeNull();
    expect(within(panel).queryByText('Accepted types')).toBeNull();
    await userEvent.click(within(panel).getByRole('radio', { name: 'Webhook' }));
    await userEvent.type(within(panel).getByLabelText('URL'), 'https://alerts.test/nudge');
    await userEvent.click(within(panel).getByRole('button', { name: 'Save alert destination' }));

    expect(await screen.findByText(/it will never be shown again/)).toBeTruthy();
    expect(screen.getByText('secret-shown-once')).toBeTruthy();
    expect(api.calls.find((c) => c.route === 'PUT /api/instance/alert-destination')?.body).toEqual({
      type: 'webhook',
      config: { url: 'https://alerts.test/nudge' },
    });
  });

  it('tests and removes the saved Alert destination', async () => {
    const api = fakeApi({
      'GET /api/session': SIGNED_IN,
      'GET /api/alerts': { status: 200, body: NO_ALERT },
      'GET /api/instance/judge': { status: 200, body: NO_JUDGE },
      'GET /api/instance/retention': { status: 200, body: { days: null } },
      'GET /api/instance/smtp': { status: 200, body: { smtp: null } },
      'GET /api/instance/alert-destination': {
        status: 200,
        body: { destination: { type: 'discord', config: {}, secrets: ['url'] } },
      },
      'POST /api/instance/alert-destination/test': {
        status: 200,
        body: { status: 'failed', failureClass: 'auth', message: 'HTTP 401' },
      },
      'DELETE /api/instance/alert-destination': { status: 204 },
    });
    renderDashboard('/settings');

    const panel = await screen.findByRole('form', { name: 'Alert destination' });
    expect(within(panel).getByRole('radio', { name: 'Discord', checked: true })).toBeTruthy();
    await userEvent.click(within(panel).getByRole('button', { name: 'Test' }));
    expect(await within(panel).findByText(/HTTP 401/)).toBeTruthy();

    api.set('GET /api/instance/alert-destination', { status: 200, body: { destination: null } });
    await userEvent.click(within(panel).getByRole('button', { name: 'Remove' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText(/No Alert destination/)).toBeTruthy();
    expect(api.calls.map((c) => c.route)).toContain('DELETE /api/instance/alert-destination');
  });
});
