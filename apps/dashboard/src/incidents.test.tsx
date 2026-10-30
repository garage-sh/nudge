import type {
  DeliveryView,
  IncidentDetailView,
  IncidentPage,
  IncidentSummaryView,
  ProjectView,
} from '@nudge/shared';
import { screen, waitFor, within } from '@testing-library/react';
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
  quietPeriod: null,
  openingCap: null,
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
  closeCause: null,
  closedAt: null,
  held: false,
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
    quietPeriod: null,
    resolved: false,
    receivedAt: '2026-10-29T08:00:00.000Z',
  },
  lastReport: {
    title: 'Payment provider timed out again',
    message: null,
    level: 'critical',
    environment: 'production',
    fingerprint: 'payment-timeout',
    context: { host: 'web-3' },
    quietPeriod: null,
    resolved: false,
    receivedAt: '2026-10-29T09:30:00.000Z',
  },
  deliveries: [],
};

const FAILED_DELIVERY: DeliveryView = {
  id: 'delivery-1',
  destination: { id: 'destination-1', name: 'On-call webhook', type: 'webhook', state: 'active' },
  status: 'failed',
  externalUrl: null,
  attempts: 1,
  lastError: 'permanent: HTTP 422',
  createdAt: '2026-10-29T08:00:01.000Z',
  updatedAt: '2026-10-29T08:00:02.000Z',
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

  it('names the empty view', async () => {
    fakeApi({ ...routes(), 'GET /api/incidents?project=project-1&state=closed': page([]) });
    renderDashboard('/projects/project-1/incidents?state=closed');
    expect(await screen.findByText('No Closed Incident.')).toBeTruthy();
  });

  it('offers to clear filters the API refuses, rather than a retry', async () => {
    fakeApi({
      ...routes(),
      'GET /api/incidents?project=project-1&level=urgent': {
        status: 400,
        body: { error: 'invalid_filter' },
      },
    });
    renderDashboard('/projects/project-1/incidents?level=urgent');
    expect(
      await screen.findByText('This address carries filters nudge does not know.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByRole('link', { name: 'Slow search page' })).toBeTruthy();
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

  it('marks the Held Incidents and filters them through the API', async () => {
    const held = { ...SLOW, held: true };
    const api = fakeApi({
      ...routes(),
      'GET /api/incidents?project=project-1': page([TIMEOUT, held]),
      'GET /api/incidents?project=project-1&held=true': page([held]),
    });
    renderDashboard('/projects/project-1/incidents');

    const row = (await screen.findByRole('link', { name: 'Slow search page' })).closest('li');
    expect(within(row as HTMLElement).getByText('Held')).toBeTruthy();
    const other = screen.getByRole('link', { name: 'Payment provider timed out' }).closest('li');
    expect(within(other as HTMLElement).queryByText('Held')).toBeNull();

    await userEvent.selectOptions(screen.getByLabelText('Dispatch'), 'true');

    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Payment provider timed out' })).toBeNull(),
    );
    expect(api.calls.map((call) => call.route)).toContain(
      'GET /api/incidents?project=project-1&held=true',
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
    expect(screen.getByRole('link', { name: 'Incidents' })).toBeTruthy();
  });

  it('shows its Deliveries, replays a failed one but not a delivered one, and redispatches the Open Incident', async () => {
    const delivered: DeliveryView = {
      ...FAILED_DELIVERY,
      id: 'delivery-0',
      destination: { ...FAILED_DELIVERY.destination, id: 'destination-0', name: 'Ops channel' },
      status: 'delivered',
      lastError: null,
    };
    const api = fakeApi({
      ...routes(),
      'GET /api/incidents/incident-1': {
        status: 200,
        body: { ...TIMEOUT_DETAIL, deliveries: [delivered, FAILED_DELIVERY] },
      },
      'POST /api/deliveries/delivery-1/replay': {
        status: 202,
        body: { ...FAILED_DELIVERY, status: 'pending' },
      },
    });
    api.set('POST /api/incidents/incident-1/redispatch', () => {
      const after: IncidentDetailView = {
        ...TIMEOUT_DETAIL,
        deliveries: [
          delivered,
          FAILED_DELIVERY,
          {
            ...FAILED_DELIVERY,
            id: 'delivery-2',
            destination: { ...FAILED_DELIVERY.destination, id: 'destination-2', name: 'Team' },
            status: 'pending',
            attempts: 0,
            lastError: null,
          },
        ],
      };
      api.set('GET /api/incidents/incident-1', { status: 200, body: after });
      return { status: 200, body: { deliveriesCreated: 1, incident: after } };
    });
    renderDashboard('/projects/project-1/incidents/incident-1');

    const deliveries = await screen.findByRole('region', { name: 'Deliveries' });
    expect(within(deliveries).getByText('On-call webhook')).toBeTruthy();
    expect(within(deliveries).getByText('Last error: permanent: HTTP 422')).toBeTruthy();
    // Replaying a delivered Incident Delivery would open its issue or message again.
    expect(
      within(deliveries).getAllByRole('button', { name: /^Replay the Delivery to / }),
    ).toHaveLength(1);
    await userEvent.click(
      within(deliveries).getByRole('button', { name: /^Replay the Delivery to / }),
    );
    expect(api.calls.map((c) => c.route)).toContain('POST /api/deliveries/delivery-1/replay');

    await userEvent.click(within(deliveries).getByRole('button', { name: 'Redispatch' }));
    expect(await within(deliveries).findByText('1 Delivery created.')).toBeTruthy();
    expect(within(deliveries).getByText('Team')).toBeTruthy();
  });

  it('offers no Redispatch for a Closed Incident, and says when it has no Delivery', async () => {
    fakeApi({
      ...routes(),
      'GET /api/incidents/incident-1': {
        status: 200,
        body: { ...TIMEOUT_DETAIL, state: 'closed' },
      },
    });
    renderDashboard('/projects/project-1/incidents/incident-1');

    const deliveries = await screen.findByRole('region', { name: 'Deliveries' });
    expect(within(deliveries).getByText('No Delivery.')).toBeTruthy();
    expect(within(deliveries).queryByRole('button', { name: 'Redispatch' })).toBeNull();
  });

  it('says a Held Incident went to no Destination, and offers its Redispatch while it is Open', async () => {
    fakeApi({
      ...routes(),
      'GET /api/incidents/incident-1': { status: 200, body: { ...TIMEOUT_DETAIL, held: true } },
    });
    renderDashboard('/projects/project-1/incidents/incident-1');

    const deliveries = await screen.findByRole('region', { name: 'Deliveries' });
    expect(within(deliveries).getByText(/past its Opening cap/)).toBeTruthy();
    expect(within(deliveries).getByRole('button', { name: 'Redispatch' })).toBeTruthy();
    const properties = within(screen.getByRole('region', { name: 'Incident' }));
    expect(properties.getByText('Held')).toBeTruthy();
  });

  it('offers no Redispatch for a Held Incident that is Closed', async () => {
    fakeApi({
      ...routes(),
      'GET /api/incidents/incident-1': {
        status: 200,
        body: {
          ...TIMEOUT_DETAIL,
          held: true,
          state: 'closed',
          closeCause: 'resolved',
          closedAt: '2026-10-29T10:00:00.000Z',
        },
      },
    });
    renderDashboard('/projects/project-1/incidents/incident-1');

    const deliveries = await screen.findByRole('region', { name: 'Deliveries' });
    expect(within(deliveries).getByText(/can no longer be Redispatched/)).toBeTruthy();
    expect(within(deliveries).queryByRole('button', { name: 'Redispatch' })).toBeNull();
  });

  it('a Member closes the Open Incident after confirming, and sees why it closed', async () => {
    const closed: IncidentDetailView = {
      ...TIMEOUT_DETAIL,
      state: 'closed',
      closeCause: 'member',
      closedAt: '2026-10-29T10:00:00.000Z',
    };
    const api = fakeApi({
      ...routes(),
      'GET /api/incidents/incident-1': { status: 200, body: TIMEOUT_DETAIL },
      'POST /api/incidents/incident-1/close': { status: 200, body: closed },
    });
    renderDashboard('/projects/project-1/incidents/incident-1');

    await userEvent.click(await screen.findByRole('button', { name: 'Close Incident' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(api.calls.map((c) => c.route)).toContain('POST /api/incidents/incident-1/close');
    const properties = await screen.findByRole('region', { name: 'Incident' });
    expect(await within(properties).findByText('Closed by a Member')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close Incident' })).toBeNull();
    // The button that had focus is gone: focus goes to the panel, the closing is announced.
    expect(document.activeElement).toBe(
      within(properties).getByRole('heading', { name: 'Incident' }),
    );
    expect(within(properties).getByRole('status').textContent).toBe(
      'Incident closed: its Destinations are being told.',
    );
  });

  it('a failed read of the detail keeps the Incident on screen, with the error and a retry', async () => {
    const api = fakeApi({
      ...routes(),
      'GET /api/incidents/incident-1': { status: 200, body: TIMEOUT_DETAIL },
    });
    renderDashboard('/projects/project-1/incidents/incident-1');
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy();

    api.set('GET /api/incidents/incident-1', { status: 500, body: { error: 'internal' } });
    api.set('POST /api/incidents/incident-1/redispatch', {
      status: 500,
      body: { error: 'internal' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Redispatch' }));

    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(1));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(TIMEOUT_DETAIL.title);
    expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThan(0);
  });

  it('a Closed Incident says why it closed, in the list and in the detail', async () => {
    const quiet = { ...TIMEOUT, state: 'closed', closeCause: 'quiet_period' } as const;
    fakeApi({
      ...routes(),
      'GET /api/incidents?project=project-1': page([quiet]),
      'GET /api/incidents/incident-1': {
        status: 200,
        body: { ...TIMEOUT_DETAIL, ...quiet, closedAt: '2026-10-29T10:30:00.000Z' },
      },
    });
    renderDashboard('/projects/project-1/incidents');

    const link = await screen.findByRole('link', { name: 'Payment provider timed out' });
    expect(within(link.closest('li') as HTMLElement).getByText('Quiet period over')).toBeTruthy();
    await userEvent.click(link);
    const properties = await screen.findByRole('region', { name: 'Incident' });
    expect(within(properties).getByText('Quiet period over')).toBeTruthy();
  });

  it('a Member deletes the Incident after confirming, then goes back to the list', async () => {
    const api = fakeApi({
      ...routes(),
      'GET /api/incidents/incident-1': { status: 200, body: TIMEOUT_DETAIL },
      'DELETE /api/incidents/incident-1': { status: 204 },
    });
    renderDashboard('/projects/project-1/incidents/incident-1');

    const deletion = await screen.findByRole('region', { name: 'Deletion' });
    expect(deletion.textContent).toMatch(/personal data/);
    await userEvent.click(within(deletion).getByRole('button', { name: 'Delete' }));
    expect(api.calls.map((c) => c.route)).not.toContain('DELETE /api/incidents/incident-1');
    await userEvent.click(within(deletion).getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByRole('link', { name: 'Payment provider timed out' })).toBeTruthy();
    expect(api.calls.map((c) => c.route)).toContain('DELETE /api/incidents/incident-1');
  });

  it('explains a failed deletion and keeps the Incident shown', async () => {
    fakeApi({
      ...routes(),
      'GET /api/incidents/incident-1': { status: 200, body: TIMEOUT_DETAIL },
      'DELETE /api/incidents/incident-1': { status: 500, body: { error: 'internal' } },
    });
    renderDashboard('/projects/project-1/incidents/incident-1');

    const deletion = await screen.findByRole('region', { name: 'Deletion' });
    await userEvent.click(within(deletion).getByRole('button', { name: 'Delete' }));
    await userEvent.click(within(deletion).getByRole('button', { name: 'Confirm' }));

    expect(await within(deletion).findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Payment provider timed out' })).toBeTruthy();
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

describe('An Incident under another Project’s URL', () => {
  it('is not shown there', async () => {
    fakeApi({
      ...routes(),
      'GET /api/incidents/incident-1': { status: 200, body: TIMEOUT_DETAIL },
    });
    renderDashboard('/projects/project-2/incidents/incident-1');

    expect(await screen.findByText('This Incident does not exist.')).toBeTruthy();
    expect(screen.queryByText('POST /charges took 30 s')).toBeNull();
  });
});

describe('A Project’s Incident settings', () => {
  it('sets the Quiet period in minutes, and empties it back to the Instance default', async () => {
    const api = fakeApi({
      ...routes(),
      'GET /api/projects/project-1': { status: 200, body: { ...SHOP, quietPeriod: 7200 } },
      'PATCH /api/projects/project-1': { status: 200, body: { ...SHOP, quietPeriod: 600 } },
    });
    renderDashboard('/projects/project-1');

    const field = await screen.findByLabelText('Quiet period (minutes)');
    expect((field as HTMLInputElement).value).toBe('120');
    await userEvent.clear(field);
    await userEvent.type(field, '10');
    await userEvent.click(screen.getByRole('button', { name: 'Save Incident settings' }));
    expect(await screen.findByText('Saved.')).toBeTruthy();
    await userEvent.clear(field);
    await userEvent.click(screen.getByRole('button', { name: 'Save Incident settings' }));

    const patches = api.calls.filter((call) => call.route === 'PATCH /api/projects/project-1');
    expect(patches.map((call) => call.body)).toEqual([
      { defaultLevel: 'error', quietPeriod: 600, openingCap: null },
      { defaultLevel: 'error', quietPeriod: null, openingCap: null },
    ]);
  });

  it('keeps a Quiet period that is no whole number of minutes when the field is left alone, and says a refused value under its field', async () => {
    const api = fakeApi({
      ...routes(),
      'GET /api/projects/project-1': { status: 200, body: { ...SHOP, quietPeriod: 30 } },
      'PATCH /api/projects/project-1': (body) => ({
        status: 200,
        body: { ...SHOP, ...(body as object) },
      }),
    });
    renderDashboard('/projects/project-1');

    const cap = await screen.findByLabelText('Opening cap (Incidents per minute)');
    await userEvent.type(cap, '0');
    await userEvent.click(screen.getByRole('button', { name: 'Save Incident settings' }));
    expect(api.calls.some((call) => call.route === 'PATCH /api/projects/project-1')).toBe(false);
    expect(cap.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(cap);

    await userEvent.clear(cap);
    await userEvent.click(screen.getByRole('button', { name: 'Save Incident settings' }));
    expect(await screen.findByText('Saved.')).toBeTruthy();
    expect(api.calls.find((call) => call.route === 'PATCH /api/projects/project-1')?.body).toEqual({
      defaultLevel: 'error',
      quietPeriod: 30,
      openingCap: null,
    });
  });

  it('sets the Opening cap, and empties it back to the Instance default', async () => {
    const api = fakeApi({
      ...routes(),
      'GET /api/projects/project-1': { status: 200, body: { ...SHOP, openingCap: 50 } },
      'PATCH /api/projects/project-1': { status: 200, body: { ...SHOP, openingCap: 5 } },
    });
    renderDashboard('/projects/project-1');

    const field = await screen.findByLabelText('Opening cap (Incidents per minute)');
    expect((field as HTMLInputElement).value).toBe('50');
    await userEvent.clear(field);
    await userEvent.type(field, '5');
    await userEvent.click(screen.getByRole('button', { name: 'Save Incident settings' }));
    expect(await screen.findByText('Saved.')).toBeTruthy();
    await userEvent.clear(field);
    await userEvent.click(screen.getByRole('button', { name: 'Save Incident settings' }));

    const patches = api.calls.filter((call) => call.route === 'PATCH /api/projects/project-1');
    expect(patches.map((call) => call.body)).toEqual([
      { defaultLevel: 'error', quietPeriod: null, openingCap: 5 },
      { defaultLevel: 'error', quietPeriod: null, openingCap: null },
    ]);
  });

  it('saves the default Level and shows an example request', async () => {
    const api = fakeApi({
      ...routes(),
      'PATCH /api/projects/project-1': { status: 200, body: { ...SHOP, defaultLevel: 'warning' } },
    });
    renderDashboard('/projects/project-1');

    await userEvent.selectOptions(await screen.findByLabelText('Default Level'), 'warning');
    await userEvent.click(screen.getByRole('button', { name: 'Save Incident settings' }));

    expect(await screen.findByText('Saved.')).toBeTruthy();
    expect(api.calls.find((call) => call.route === 'PATCH /api/projects/project-1')?.body).toEqual({
      defaultLevel: 'warning',
      quietPeriod: null,
      openingCap: null,
    });
    const example = screen.getByLabelText('Example request').textContent ?? '';
    expect(example).toContain('/v1/incidents');
    expect(example).toContain('Authorization: Bearer $NUDGE_SECRET_KEY');
  });
});
