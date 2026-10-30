import type {
  ApiErrorBody,
  IncidentDetailView,
  IncidentPage,
  ReceivedIncident,
} from '@nudge/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPipeline, type DashboardClient, type Pipeline } from './harness/index.js';

const anyLevel = { minimumLevel: 'info', environments: [], conditions: [] } as const;

/** Reports one Occurrence, expecting it accepted. */
async function report(pipeline: Pipeline, secretKey: string, body: Record<string, unknown>) {
  const response = await pipeline.postIncident(secretKey, body);
  expect(response.status).toBe(202);
  return (await response.json()) as ReceivedIncident & { readonly id: string };
}

/** Waits until the Incident, as the Member reads it, satisfies `condition`. */
async function waitForIncident(
  member: DashboardClient,
  id: string,
  condition: (incident: IncidentDetailView) => boolean,
) {
  const deadline = Date.now() + 5000;
  for (;;) {
    const response = await member.get<IncidentDetailView>(`/api/incidents/${id}`);
    expect(response.status).toBe(200);
    if (condition(response.body)) return response.body;
    if (Date.now() > deadline) {
      throw new Error(`Incident ${id} never met the condition: ${JSON.stringify(response.body)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const delivered = (incident: IncidentDetailView) =>
  incident.deliveries.length > 0 && incident.deliveries.every((d) => d.status === 'delivered');

const status = async (member: DashboardClient, id: string) =>
  (await member.get(`/api/incidents/${id}`)).status;

describe('Deletion of an Incident', () => {
  let pipeline: Pipeline;
  let member: DashboardClient;

  beforeAll(async () => {
    pipeline = await startPipeline();
    member = await pipeline.signIn();
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  it('deletes the Incident and its Deliveries; what the Destination received remains', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'Leaked data' });
    const { fake } = await pipeline.createDestination(project.id, { incidentFilter: anyLevel });
    const occurrence = { title: 'Payment failed for jane@example.com', level: 'error' };
    const opened = await report(pipeline, secretKey, occurrence);
    await waitForIncident(member, opened.id, delivered);

    const deletion = await member.delete(`/api/incidents/${opened.id}`);

    expect(deletion.status).toBe(204);
    expect(await member.get<ApiErrorBody>(`/api/incidents/${opened.id}`)).toEqual({
      status: 404,
      body: { error: 'incident_not_found' },
    });
    const page = await member.get<IncidentPage>(`/api/incidents?project=${project.id}`);
    expect(page.body.incidents).toEqual([]);
    expect(fake.incidents.filter((d) => d.incident.id === opened.id)).toHaveLength(1);

    // Its Delivery went with it: the same report opens a new Incident, delivered anew.
    const again = await report(pipeline, secretKey, occurrence);
    expect(again.opened).toBe(true);
    expect(again.id).not.toBe(opened.id);
    const reopened = await waitForIncident(member, again.id, delivered);
    expect(reopened.deliveries).toHaveLength(1);
    expect(fake.incidents).toHaveLength(2);
  });

  it('deletes a Closed Incident too', async () => {
    const { secretKey } = await pipeline.createProject({ name: 'Closed then erased' });
    const opened = await report(pipeline, secretKey, { title: 'Disk full', level: 'warning' });
    await report(pipeline, secretKey, { title: 'Disk full', resolved: true });
    await waitForIncident(member, opened.id, (incident) => incident.state === 'closed');

    expect((await member.delete(`/api/incidents/${opened.id}`)).status).toBe(204);
    expect(await status(member, opened.id)).toBe(404);
  });

  it('returns 404 for an unknown or already deleted Incident', async () => {
    const { secretKey } = await pipeline.createProject({ name: 'Deleted twice' });
    const { id } = await report(pipeline, secretKey, { title: 'Queue backed up' });
    expect((await member.delete(`/api/incidents/${id}`)).status).toBe(204);

    expect(await member.delete<ApiErrorBody>(`/api/incidents/${id}`)).toEqual({
      status: 404,
      body: { error: 'incident_not_found' },
    });
    expect((await member.delete('/api/incidents/not-a-uuid')).status).toBe(404);
    expect((await member.post(`/api/incidents/${id}/close`)).status).toBe(404);
    expect((await member.post(`/api/incidents/${id}/redispatch`)).status).toBe(404);
  });

  it('is reserved for a signed-in Member', async () => {
    const { secretKey } = await pipeline.createProject({ name: 'Hands off' });
    const { id } = await report(pipeline, secretKey, { title: 'Cron failed' });

    expect((await pipeline.dashboard().delete(`/api/incidents/${id}`)).status).toBe(401);
    expect(await status(member, id)).toBe(200);
  });
});

describe('Incident Retention', () => {
  let pipeline: Pipeline;
  let member: DashboardClient;

  beforeAll(async () => {
    pipeline = await startPipeline({
      purge: { intervalMs: 100 },
      // Long enough that no Incident here closes on its own while it is aged.
      incidents: { quietPeriodMs: 365 * 24 * 60 * 60_000, sweepIntervalMs: 100, judgeWaitMs: 0 },
    });
    member = await pipeline.signIn();
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  it('unlimited by default: an old Incident stays', async () => {
    const { secretKey } = await pipeline.createProject({ name: 'No retention' });
    const { id } = await report(pipeline, secretKey, { title: 'Old but kept', level: 'info' });
    await pipeline.ageIncident(id, 3650);

    // Several purge passes: nothing moves.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await status(member, id)).toBe(200);
  });

  it('purges the Incidents last seen before the chosen duration, with their Deliveries, and keeps the others', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: '30-day retention' });
    const { fake } = await pipeline.createDestination(project.id, { incidentFilter: anyLevel });
    const open = async (title: string) => {
      const { id } = await report(pipeline, secretKey, { title, level: 'error' });
      await waitForIncident(member, id, delivered);
      return id;
    };
    const expired = await open('Thirty-one days');
    const recent = await open('Twenty-nine days');
    const fresh = await open('Today');
    // Opened long ago but still reporting: its last Occurrence is recent, so it stays.
    const ongoing = await open('Still failing');
    await pipeline.ageIncident(expired, 31);
    await pipeline.ageIncident(recent, 29);
    await pipeline.ageIncident(ongoing, 40);
    const absorbed = await report(pipeline, secretKey, { title: 'Still failing', level: 'error' });
    expect(absorbed).toEqual({ id: ongoing, state: 'open', opened: false });

    expect(await member.put('/api/instance/retention', { days: 30 })).toEqual({
      status: 200,
      body: { days: 30 },
    });

    await expect.poll(() => status(member, expired), { timeout: 5000 }).toBe(404);
    for (const kept of [recent, fresh, ongoing]) expect(await status(member, kept)).toBe(200);
    const page = await member.get<IncidentPage>(`/api/incidents?project=${project.id}`);
    expect(page.body.incidents.map((incident) => incident.id).sort()).toEqual(
      [recent, fresh, ongoing].sort(),
    );

    // Its Delivery went with it: the same report opens a new Incident, delivered anew.
    const again = await report(pipeline, secretKey, { title: 'Thirty-one days', level: 'error' });
    expect(again.opened).toBe(true);
    await waitForIncident(member, again.id, delivered);
    expect(fake.incidents.filter((d) => d.incident.title === 'Thirty-one days')).toHaveLength(2);

    await member.put('/api/instance/retention', { days: null });
  });
});
