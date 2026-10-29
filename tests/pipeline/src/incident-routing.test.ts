import type {
  DeliveryView,
  DestinationView,
  IncidentDetailView,
  IncidentRedispatchView,
  ReceivedIncident,
} from '@nudge/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { failure, startPipeline, type DashboardClient, type Pipeline } from './harness/index.js';

/**
 * An Incident reaches the Destinations whose Incident Filter accepts it: when it opens,
 * then, when its Level rises, only the Destinations the higher Level newly reaches.
 */
describe('Routing an Incident through the Incident Filter', () => {
  let pipeline: Pipeline;
  let member: DashboardClient;

  beforeAll(async () => {
    pipeline = await startPipeline({
      suspension: { failureThreshold: 3, cooldownMs: 300, probeIntervalMs: 100 },
    });
    member = await pipeline.signIn();
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  const report = async (secretKey: string, body: Record<string, unknown>) => {
    const response = await pipeline.postIncident(secretKey, body);
    expect(response.status).toBe(202);
    return (await response.json()) as ReceivedIncident;
  };

  const read = async (id: string) => {
    const response = await member.get<IncidentDetailView>(`/api/incidents/${id}`);
    expect(response.status).toBe(200);
    return response.body;
  };

  /** The Incident once `condition` holds on it (its Deliveries are sent by the worker). */
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

  const allDelivered = (count: number) => (incident: IncidentDetailView) =>
    incident.deliveries.length === count &&
    incident.deliveries.every((delivery) => delivery.status === 'delivered');

  const destinationsOf = (deliveries: readonly DeliveryView[]) =>
    deliveries.map((delivery) => delivery.destination.id).sort();

  it('with the Incident Filter off, a Destination never receives Incidents and its Feedback routing is unchanged', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'Feedback only' });
    const feedbackOnly = await pipeline.createDestination(project.id, { name: 'Feedback only' });
    const incidents = await pipeline.createDestination(project.id, {
      name: 'Incidents only',
      filter: null,
      incidentFilter: { minimumLevel: 'info', environments: [], conditions: [] },
    });

    const incident = await report(secretKey, { title: 'Queue backing up', level: 'critical' });
    pipeline.judge.script({ type: 'bug', severity: 'major' });
    const response = await pipeline.postFeedback(secretKey, { text: 'The cart is empty' });
    const { id: feedbackId } = (await response.json()) as { id: string };

    const routed = await waitForIncident(incident.id, allDelivered(1));
    expect(destinationsOf(routed.deliveries)).toEqual([incidents.destination.id]);
    const feedback = await pipeline.waitForFeedback(feedbackId, (r) =>
      r.deliveries.some((d) => d.status === 'delivered'),
    );
    expect(feedback.deliveries.map((d) => d.destinationId)).toEqual([feedbackOnly.destination.id]);
    expect(feedbackOnly.fake.incidentAttempts).toHaveLength(0);
    expect(incidents.fake.attempts).toHaveLength(0);
    expect(incidents.fake.incidents).toMatchObject([
      {
        moment: 'opened',
        project: { id: project.id, name: 'Feedback only' },
        incident: { id: incident.id, title: 'Queue backing up', level: 'critical', state: 'open' },
      },
    ]);
  });

  it('an error Incident reaches the error Destination only; raised to critical, it reaches the critical one, and the first receives nothing new', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'Escalation' });
    const team = await pipeline.createDestination(project.id, {
      name: 'Team channel',
      incidentFilter: { minimumLevel: 'error', environments: [], conditions: [] },
    });
    const onCall = await pipeline.createDestination(project.id, {
      name: 'On-call',
      incidentFilter: { minimumLevel: 'critical', environments: [], conditions: [] },
    });
    const occurrence = { title: 'Payment provider timed out', environment: 'production' };

    const opened = await report(secretKey, { ...occurrence, level: 'error' });
    await waitForIncident(opened.id, allDelivered(1));
    // Absorbed without a higher Level: no Dispatch.
    await report(secretKey, { ...occurrence, level: 'warning' });
    await report(secretKey, occurrence);
    const raised = await report(secretKey, { ...occurrence, level: 'critical' });
    await report(secretKey, { ...occurrence, level: 'critical' });

    expect(raised).toEqual({ id: opened.id, state: 'open', opened: false });
    const incident = await waitForIncident(opened.id, allDelivered(2));
    expect(incident).toMatchObject({ level: 'critical', occurrences: 5 });
    expect(destinationsOf(incident.deliveries)).toEqual(
      [team.destination.id, onCall.destination.id].sort(),
    );
    expect(team.fake.incidentAttempts).toMatchObject([
      { moment: 'opened', incident: { id: opened.id, level: 'error' } },
    ]);
    expect(onCall.fake.incidentAttempts).toMatchObject([
      { moment: 'raised', incident: { id: opened.id, level: 'critical' } },
    ]);
  });

  it('an undeclared Level does not raise the Incident: the default Level never dispatches it again', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'No raise' });
    const any = await pipeline.createDestination(project.id, {
      incidentFilter: { minimumLevel: 'info', environments: [], conditions: [] },
    });

    const opened = await report(secretKey, { title: 'Disk almost full', level: 'info' });
    await report(secretKey, { title: 'Disk almost full' });

    const incident = await waitForIncident(opened.id, allDelivered(1));
    expect(incident).toMatchObject({ level: 'info', occurrences: 2 });
    expect(any.fake.incidentAttempts).toHaveLength(1);
  });

  it('the Environment and the context conditions decide which Destinations accept it', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'Routing' });
    const production = await pipeline.createDestination(project.id, {
      name: 'Production',
      incidentFilter: { minimumLevel: 'info', environments: ['production'], conditions: [] },
    });
    const payments = await pipeline.createDestination(project.id, {
      name: 'Payments team',
      incidentFilter: {
        minimumLevel: 'info',
        environments: [],
        conditions: [{ key: 'service', values: ['checkout', 'billing'] }],
      },
    });

    const staging = await report(secretKey, {
      title: 'Search index stale',
      environment: 'staging',
      context: { service: 'search' },
    });
    const unlabelled = await report(secretKey, {
      title: 'Invoice job failed',
      context: { service: 'billing' },
    });
    const checkout = await report(secretKey, {
      title: 'Checkout down',
      environment: 'production',
      context: { service: 'checkout' },
    });

    expect((await waitForIncident(checkout.id, allDelivered(2))).deliveries).toHaveLength(2);
    expect(
      destinationsOf((await waitForIncident(unlabelled.id, allDelivered(1))).deliveries),
    ).toEqual([payments.destination.id]);
    expect((await read(staging.id)).deliveries).toEqual([]);
    expect(production.fake.incidentAttempts.map((d) => d.incident.id)).toEqual([checkout.id]);
  });

  it('a failed Incident Delivery can be replayed', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'Replay' });
    const { fake } = await pipeline.createDestination(project.id, {
      incidentFilter: { minimumLevel: 'info', environments: [], conditions: [] },
    });
    fake.scriptSends(failure('permanent', 'HTTP 422: refused'));

    const opened = await report(secretKey, { title: 'Cron job failed', level: 'error' });
    const failed = await waitForIncident(opened.id, (i) =>
      i.deliveries.some((d) => d.status === 'failed'),
    );
    expect(failed.deliveries).toMatchObject([{ status: 'failed', attempts: 1 }]);

    const replay = await member.post(`/api/deliveries/${failed.deliveries[0]!.id}/replay`);
    expect(replay.status).toBe(202);

    const replayed = await waitForIncident(opened.id, allDelivered(1));
    expect(replayed.deliveries[0]).toMatchObject({ id: failed.deliveries[0]!.id, attempts: 2 });
    expect(fake.incidents.map((d) => d.incident.id)).toEqual([opened.id]);
  });

  it('Redispatch after a Filter change creates only the missing Deliveries', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'Redispatch' });
    const team = await pipeline.createDestination(project.id, {
      name: 'Team channel',
      incidentFilter: { minimumLevel: 'info', environments: [], conditions: [] },
    });
    // Created by a Member: its Filters are then edited like any Destination's.
    const creation = await member.post<{ destination: DestinationView }>(
      `/api/projects/${project.id}/destinations`,
      { type: 'webhook', name: 'Turned on later', config: { url: 'https://hooks.test/nudge' } },
    );
    expect(creation.status).toBe(201);
    expect(creation.body.destination.incidentFilter).toBeNull();
    const added = {
      destination: creation.body.destination,
      fake: pipeline.fakeDestination(creation.body.destination.id),
    };
    const opened = await report(secretKey, { title: 'Webhook backlog', level: 'warning' });
    await waitForIncident(opened.id, allDelivered(1));

    const update = await member.patch<DestinationView>(
      `/api/destinations/${added.destination.id}`,
      {
        incidentFilter: { minimumLevel: 'warning', environments: [], conditions: [] },
      },
    );
    expect(update.status).toBe(200);
    expect(update.body.incidentFilter).toEqual({
      minimumLevel: 'warning',
      environments: [],
      conditions: [],
    });
    const redispatch = await member.post<IncidentRedispatchView>(
      `/api/incidents/${opened.id}/redispatch`,
    );
    expect(redispatch.status).toBe(200);
    expect(redispatch.body.deliveriesCreated).toBe(1);
    const again = await member.post<IncidentRedispatchView>(
      `/api/incidents/${opened.id}/redispatch`,
    );
    expect(again.body.deliveriesCreated).toBe(0);

    const incident = await waitForIncident(opened.id, allDelivered(2));
    expect(destinationsOf(incident.deliveries)).toEqual(
      [team.destination.id, added.destination.id].sort(),
    );
    expect(team.fake.incidentAttempts).toHaveLength(1);
    expect(added.fake.incidentAttempts).toMatchObject([{ moment: 'opened' }]);
    expect((await member.post('/api/incidents/not-an-id/redispatch')).status).toBe(404);
  });

  it('a Suspended Destination holds Incident Deliveries like Feedback ones, and sends them once active again', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'Suspension' });
    const { destination, fake } = await pipeline.createDestination(project.id, {
      incidentFilter: { minimumLevel: 'info', environments: [], conditions: [] },
    });
    fake.scriptSends(failure('auth', 'HTTP 401: token refused'));

    const first = await report(secretKey, { title: 'Broker unreachable', level: 'error' });
    const held = await waitForIncident(first.id, (i) =>
      i.deliveries.some((d) => d.status === 'held'),
    );
    expect(held.deliveries).toMatchObject([{ status: 'held', attempts: 1 }]);
    expect((await pipeline.destinationRow(destination.id))?.state).toBe('suspended');

    const delivered = await waitForIncident(first.id, allDelivered(1));
    expect(delivered.deliveries).toMatchObject([{ status: 'delivered', lastError: null }]);
    expect(fake.incidents.map((d) => d.incident.id)).toEqual([first.id]);
  });
});
