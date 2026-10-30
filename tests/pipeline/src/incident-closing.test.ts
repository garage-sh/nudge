import {
  QUIET_PERIOD_BOUNDS,
  type IncidentDetailView,
  type IncidentPage,
  type ProjectView,
  type ReceivedIncident,
} from '@nudge/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPipeline, type DashboardClient, type Pipeline } from './harness/index.js';

const anyLevel = { minimumLevel: 'info', environments: [], conditions: [] } as const;

/**
 * An Incident closes when its sender reports it resolved, when a Member closes it, or
 * after its Quiet period without a new Occurrence; each Destination that received its
 * opening then receives its closing. A Closed Incident never reopens.
 */
describe('Closing an Incident', () => {
  let pipeline: Pipeline;
  let member: DashboardClient;

  beforeAll(async () => {
    pipeline = await startPipeline({
      suspension: { failureThreshold: 3, cooldownMs: 300, probeIntervalMs: 100 },
      incidents: { quietPeriodMs: 60 * 60_000, sweepIntervalMs: 100, judgeWaitMs: 10_000 },
    });
    member = await pipeline.signIn();
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  const report = async (secretKey: string, body: Record<string, unknown>) => {
    const response = await pipeline.postIncident(secretKey, body);
    expect(response.status).toBe(202);
    return (await response.json()) as ReceivedIncident & { readonly id: string };
  };

  const read = async (id: string) => {
    const response = await member.get<IncidentDetailView>(`/api/incidents/${id}`);
    expect(response.status).toBe(200);
    return response.body;
  };

  const waitForIncident = async (
    id: string,
    condition: (incident: IncidentDetailView) => boolean,
  ) => {
    let incident = await read(id);
    const deadline = Date.now() + 5000;
    while (!condition(incident)) {
      if (Date.now() > deadline) {
        throw new Error(`Incident ${id} never met the condition: ${JSON.stringify(incident)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
      incident = await read(id);
    }
    return incident;
  };

  const delivered = (incident: IncidentDetailView) =>
    incident.deliveries.length > 0 && incident.deliveries.every((d) => d.status === 'delivered');

  const closedAndDelivered = (incident: IncidentDetailView) =>
    incident.state === 'closed' && delivered(incident);

  it('an Occurrence reported resolved closes the Open Incident, and the Destination receives the closing of what it opened', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'Resolved' });
    const { fake } = await pipeline.createDestination(project.id, { incidentFilter: anyLevel });
    const occurrence = { title: 'Payment provider timed out', level: 'error' };

    const opened = await report(secretKey, occurrence);
    await waitForIncident(opened.id, delivered);
    const resolved = await report(secretKey, { ...occurrence, resolved: true });

    expect(resolved).toEqual({ id: opened.id, state: 'closed', opened: false });
    const incident = await waitForIncident(
      opened.id,
      (i) => closedAndDelivered(i) && fake.closings.length === 1,
    );
    expect(incident).toMatchObject({
      state: 'closed',
      closeCause: 'resolved',
      closedAt: expect.any(String),
      occurrences: 2,
    });
    expect(fake.incidentAttempts).toHaveLength(1);
    expect(fake.closings).toMatchObject([
      {
        moment: 'closed',
        deliveryId: incident.deliveries[0]!.id,
        opening: {
          externalUrl: `https://destination.test/incidents/${incident.deliveries[0]!.id}`,
        },
        incident: { id: opened.id, state: 'closed', closure: { cause: 'resolved' } },
      },
    ]);
  });

  it('a resolved Occurrence counts but never changes the Level, even when it declares a higher one', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'Resolved higher' });
    const { fake } = await pipeline.createDestination(project.id, { incidentFilter: anyLevel });
    const occurrence = { title: 'Replica lagging' };

    const opened = await report(secretKey, { ...occurrence, level: 'warning' });
    await waitForIncident(opened.id, delivered);
    await report(secretKey, { ...occurrence, level: 'critical', resolved: true });

    const incident = await waitForIncident(
      opened.id,
      (i) => closedAndDelivered(i) && fake.closings.length === 1,
    );
    expect(incident).toMatchObject({
      state: 'closed',
      level: 'warning',
      levelOrigin: 'declared',
      occurrences: 2,
    });
    expect(fake.incidentAttempts).toHaveLength(1);
    expect(fake.closings).toMatchObject([{ incident: { level: 'warning' } }]);
  });

  it('a resolved Occurrence that matches no Open Incident records and dispatches nothing', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'Nothing to resolve' });
    const { fake } = await pipeline.createDestination(project.id, { incidentFilter: anyLevel });

    const response = await pipeline.postIncident(secretKey, {
      title: 'Never opened',
      resolved: true,
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ id: null, state: null, opened: false });
    const list = await member.get<IncidentPage>(`/api/incidents?project=${project.id}`);
    expect(list.body.incidents).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(fake.incidentAttempts).toHaveLength(0);
  });

  it('a Member closes an Open Incident from the dashboard, with the same Dispatch, once', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'By a Member' });
    const { fake } = await pipeline.createDestination(project.id, { incidentFilter: anyLevel });
    const opened = await report(secretKey, { title: 'Nightly export failed', level: 'warning' });
    await waitForIncident(opened.id, delivered);

    const close = await member.post<IncidentDetailView>(`/api/incidents/${opened.id}/close`);

    expect(close.status).toBe(200);
    expect(close.body).toMatchObject({ id: opened.id, state: 'closed', closeCause: 'member' });
    await waitForIncident(opened.id, (i) => closedAndDelivered(i) && fake.closings.length === 1);
    const again = await member.post(`/api/incidents/${opened.id}/close`);
    expect(again).toMatchObject({
      status: 409,
      body: { error: 'incident_not_open', state: 'closed' },
    });
    expect((await member.post('/api/incidents/not-an-id/close')).status).toBe(404);
    const list = await member.get<IncidentPage>(`/api/incidents?project=${project.id}`);
    expect(list.body.incidents).toMatchObject([{ id: opened.id, closeCause: 'member' }]);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(fake.closings).toHaveLength(1);
  });

  it('the sweep closes an Incident silent past its Project’s Quiet period, and honours a per-Occurrence override', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'Quiet period' });
    const { fake } = await pipeline.createDestination(project.id, { incidentFilter: anyLevel });
    const settings = await member.patch<ProjectView>(`/api/projects/${project.id}`, {
      quietPeriod: 1,
    });
    expect(settings).toMatchObject({ status: 200, body: { quietPeriod: 1 } });

    const quiet = await report(secretKey, { title: 'Healthcheck failed' });
    const overridden = await report(secretKey, { title: 'Hourly job failed', quietPeriod: 3600 });

    const closed = await waitForIncident(quiet.id, closedAndDelivered);
    expect(closed).toMatchObject({ closeCause: 'quiet_period' });
    expect((await read(overridden.id)).state).toBe('open');
    expect(fake.closings.map((closing) => closing.incident.id)).toEqual([quiet.id]);
  });

  it('a per-Occurrence Quiet period shorter than the Instance default closes the Incident on its own rhythm', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'Override' });
    await pipeline.createDestination(project.id, { incidentFilter: anyLevel });

    const opened = await report(secretKey, { title: 'Healthcheck failed', quietPeriod: 1 });

    expect(await waitForIncident(opened.id, closedAndDelivered)).toMatchObject({
      closeCause: 'quiet_period',
    });
  });

  it('the longest Quiet period allowed keeps its Incident Open without stopping the sweep', async () => {
    const { secretKey: longKey } = await pipeline.createProject({ name: 'Longest quiet' });
    const { project, secretKey } = await pipeline.createProject({ name: 'Short quiet' });
    await pipeline.createDestination(project.id, { incidentFilter: anyLevel });

    const longest = await report(longKey, {
      title: 'Monthly job failed',
      quietPeriod: QUIET_PERIOD_BOUNDS.max,
    });
    const short = await report(secretKey, { title: 'Healthcheck failed', quietPeriod: 1 });

    expect(await waitForIncident(short.id, closedAndDelivered)).toMatchObject({
      closeCause: 'quiet_period',
    });
    expect((await read(longest.id)).state).toBe('open');
  });

  it('an Occurrence after closing opens a new Incident, notified as opened', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'Recurrence' });
    const { fake } = await pipeline.createDestination(project.id, { incidentFilter: anyLevel });
    const occurrence = { title: 'Queue backing up', fingerprint: 'queue-backlog', level: 'error' };
    const first = await report(secretKey, occurrence);
    await report(secretKey, { ...occurrence, resolved: true });
    await waitForIncident(first.id, (i) => closedAndDelivered(i) && fake.closings.length === 1);

    const second = await report(secretKey, occurrence);

    expect(second).toEqual({ id: expect.any(String), state: 'open', opened: true });
    expect(second.id).not.toBe(first.id);
    await waitForIncident(second.id, delivered);
    expect(fake.incidents.map((d) => [d.incident.id, d.moment])).toEqual([
      [first.id, 'opened'],
      [second.id, 'opened'],
    ]);
    expect((await read(first.id)).state).toBe('closed');
  });

  it('a Destination Suspended while the Incident opened and closed receives it once, opened then closed', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'Suspended' });
    const { destination, fake } = await pipeline.createDestination(project.id, {
      incidentFilter: anyLevel,
    });
    await pipeline.suspend(destination.id);
    const occurrence = { title: 'Broker unreachable', level: 'critical' };

    const opened = await report(secretKey, occurrence);
    await report(secretKey, { ...occurrence, resolved: true });
    const held = await read(opened.id);
    expect(held).toMatchObject({ state: 'closed', deliveries: [{ status: 'held' }] });
    await pipeline.reactivateWithoutReleasing(destination.id);

    const incident = await waitForIncident(opened.id, closedAndDelivered);
    expect(incident.deliveries).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(fake.incidentAttempts).toMatchObject([
      {
        moment: 'opened',
        incident: { id: opened.id, state: 'closed', closure: { cause: 'resolved' } },
      },
    ]);
    expect(fake.closingAttempts).toHaveLength(0);
  });

  it('an Incident that closes while its opening is on its way still gets its closing, once', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'In flight' });
    const { fake } = await pipeline.createDestination(project.id, { incidentFilter: anyLevel });
    const release = fake.hold();
    const occurrence = { title: 'Cache cluster down', level: 'error' };

    const opened = await report(secretKey, occurrence);
    await expect.poll(() => fake.incidentAttempts.length).toBe(1);
    await report(secretKey, { ...occurrence, resolved: true });
    release();

    const incident = await waitForIncident(
      opened.id,
      (i) => closedAndDelivered(i) && fake.closings.length === 1,
    );
    expect(fake.incidents).toMatchObject([{ incident: { state: 'open' } }]);
    expect(fake.closings).toMatchObject([
      {
        deliveryId: incident.deliveries[0]!.id,
        opening: {
          externalUrl: `https://destination.test/incidents/${incident.deliveries[0]!.id}`,
        },
      },
    ]);
    expect(incident.deliveries[0]!.externalUrl).toBe(
      `https://destination.test/incidents/${incident.deliveries[0]!.id}`,
    );
  });

  it('refuses an invalid Quiet period or resolved flag', async () => {
    const { secretKey } = await pipeline.createProject({ name: 'Validation' });
    for (const body of [
      { title: 'x', quietPeriod: 0 },
      { title: 'x', quietPeriod: 1.5 },
      { title: 'x', resolved: 'yes' },
    ]) {
      const response = await pipeline.postIncident(secretKey, body);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: 'invalid_incident' });
    }
  });
});
