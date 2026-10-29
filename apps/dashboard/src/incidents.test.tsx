import type {
  IncidentDetailView,
  IncidentPage,
  IncidentSummaryView,
  ProjectView,
} from '@nudge/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SIGNED_IN, fakeApi } from './test/fake-api.js';
import { renderDashboard } from './test/render.js';

const SHOP: ProjectView = {
  id: 'project-1',
  name: 'Shop',
  description: null,
  publicKey: 'nk_pub_shop',
  allowedOrigins: [],
  defaultLevel: 'error',
  createdAt: '2026-10-24T08:00:00.000Z',
};

const TIMEOUT: IncidentSummaryView = {
  id: 'incident-1',
  project: { id: 'project-1', name: 'Shop' },
  state: 'open',
  title: 'Payment provider timed out',
  level: 'critical',
  levelOrigin: 'declared',
  environment: 'production',
  occurrences: 42,
  firstSeenAt: '2026-10-29T08:00:00.000Z',
  lastSeenAt: '2026-10-29T09:30:00.000Z',
};

const SLOW: IncidentSummaryView = {
  ...TIMEOUT,
  id: 'incident-2',
  title: 'Slow search page',
  level: 'warning',
  environment: 'staging',
  occurrences: 1,
};

const TIMEOUT_DETAIL: IncidentDetailView = {
  ...TIMEOUT,
  fingerprint: 'payment-timeout',
  firstReport: {
    title: 'Payment provider timed out',
    message: 'POST /charges took 30 s',
    level: 'error',
    environment: 'production',
    fingerprint: 'payment-timeout',
    context: { service: 'checkout', retried: true },
    receivedAt: '2026-10-29T08:00:00.000Z',
  },
  lastReport: {
    title: 'Payment provider timed out again',
    message: null,
    level: 'critical',
    environment: 'production',
    fingerprint: 'payment-timeout',
    context: { host: 'web-3' },
    receivedAt: '2026-10-29T09:30:00.000Z',
  },
};

const page = (
  incidents: readonly IncidentSummaryView[],
): { status: number; body: IncidentPage } => ({
  status: 200,
  body: { incidents, next: null },
});

const routes = () => ({
  'GET /api/session': SIGNED_IN,
  'GET /api/projects': { status: 200, body: [SHOP] },
  'GET /api/projects/project-1': { status: 200, body: SHOP },
  'GET /api/incidents/environments?project=project-1': {
    status: 200,
    body: ['production', 'staging'],
  },
  'GET /api/incidents?project=project-1': page([TIMEOUT, SLOW]),
});

describe('A Project’s Incidents', () => {
  it('lists the Incidents with their Level, Environment and counter', async () => {
    fakeApi(routes());
    renderDashboard('/projects/project-1/incidents');

    const row = (await screen.findByRole('link', { name: 'Payment provider timed out' })).closest(
      'li',
    );
    expect(row).toBeTruthy();
    const cells = within(row as HTMLElement);
    expect(cells.getByText('Critical')).toBeTruthy();
    expect(cells.getByText('production')).toBeTruthy();
    expect(cells.getByText('42 Occurrences')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Slow search page' })).toBeTruthy();
  });

  it('filters by state, Level and Environment through the API', async () => {
    const api = fakeApi({
      ...routes(),
      'GET /api/incidents?project=project-1&state=open': page([TIMEOUT, SLOW]),
      'GET /api/incidents?project=project-1&state=open&level=critical': page([TIMEOUT]),
      'GET /api/incidents?project=project-1&state=open&level=critical&environment=production': page(
        [TIMEOUT],
      ),
    });
    renderDashboard('/projects/project-1/incidents');

    await userEvent.click(await screen.findByRole('link', { name: 'Open' }));
    await userEvent.selectOptions(await screen.findByLabelText('Level'), 'critical');
    await userEvent.selectOptions(screen.getByLabelText('Environment'), 'production');

    await screen.findByRole('link', { name: 'Payment provider timed out' });
    expect(screen.queryByRole('link', { name: 'Slow search page' })).toBeNull();
    expect(api.calls.map((call) => call.route)).toContain(
      'GET /api/incidents?project=project-1&state=open&level=critical&environment=production',
    );
  });

  it('says how to report a first Incident when there is none', async () => {
    fakeApi({ ...routes(), 'GET /api/incidents?project=project-1': page([]) });
    renderDashboard('/projects/project-1/incidents');

    expect(await screen.findByText('No Incident reported yet.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See how to report one' })).toBeTruthy();
  });

  it('offers to clear the filters when none matches', async () => {
    fakeApi({ ...routes(), 'GET /api/incidents?project=project-1&level=info': page([]) });
    renderDashboard('/projects/project-1/incidents?level=info');

    await userEvent.click(await screen.findByRole('button', { name: 'Clear filters' }));

    expect(await screen.findByRole('link', { name: 'Slow search page' })).toBeTruthy();
  });

  it('shows an error with a way to retry', async () => {
    const api = fakeApi({
      ...routes(),
      'GET /api/incidents?project=project-1': { status: 500, body: { error: 'server_error' } },
    });
    renderDashboard('/projects/project-1/incidents');

    const retry = await screen.findByRole('button', { name: 'Retry' });
    api.set('GET /api/incidents?project=project-1', page([TIMEOUT]));
    await userEvent.click(retry);

    expect(await screen.findByRole('link', { name: 'Payment provider timed out' })).toBeTruthy();
  });
});

describe('An Incident’s detail', () => {
  it('shows its Level and origin, counter, first and last report with their context', async () => {
    fakeApi({
      ...routes(),
      'GET /api/incidents/incident-1': { status: 200, body: TIMEOUT_DETAIL },
    });
    renderDashboard('/projects/project-1/incidents/incident-1');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Payment provider timed out' }),
    ).toBeTruthy();
    const properties = within(screen.getByRole('region', { name: 'Incident' }));
    expect(properties.getByText('Critical')).toBeTruthy();
    expect(properties.getByText('Declared by the sender')).toBeTruthy();
    expect(properties.getByText('42')).toBeTruthy();
    expect(properties.getByText('payment-timeout')).toBeTruthy();

    const first = within(screen.getByRole('region', { name: 'First Occurrence' }));
    expect(first.getByText('POST /charges took 30 s')).toBeTruthy();
    expect(first.getByText('checkout')).toBeTruthy();
    expect(first.getByText('true')).toBeTruthy();
    const last = within(screen.getByRole('region', { name: 'Last Occurrence' }));
    expect(last.getByText('Payment provider timed out again')).toBeTruthy();
    expect(last.getByText('web-3')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to Incidents' })).toBeTruthy();
  });

  it('says when the Incident does not exist', async () => {
    fakeApi({
      ...routes(),
      'GET /api/incidents/incident-9': { status: 404, body: { error: 'incident_not_found' } },
    });
    renderDashboard('/projects/project-1/incidents/incident-9');

    expect(await screen.findByText('This Incident does not exist.')).toBeTruthy();
  });
});

describe('A Project’s Incident settings', () => {
  it('saves the default Level and shows an example request', async () => {
    const api = fakeApi({
      ...routes(),
      'PATCH /api/projects/project-1': { status: 200, body: { ...SHOP, defaultLevel: 'warning' } },
    });
    renderDashboard('/projects/project-1');

    await userEvent.selectOptions(await screen.findByLabelText('Default Level'), 'warning');
    await userEvent.click(screen.getByRole('button', { name: 'Save default Level' }));

    expect(await screen.findByText('Saved.')).toBeTruthy();
    expect(api.calls.find((call) => call.route === 'PATCH /api/projects/project-1')?.body).toEqual({
      defaultLevel: 'warning',
    });
    const example = screen.getByLabelText('Example request').textContent ?? '';
    expect(example).toContain('/v1/incidents');
    expect(example).toContain('Authorization: Bearer $NUDGE_SECRET_KEY');
  });
});
