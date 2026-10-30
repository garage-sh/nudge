import { DISPATCH_QUEUE, type Alert, type IncidentStormAlert } from '@nudge/core';
import { incidentStorms, recordOccurrence } from '@nudge/database';
import type {
  IncidentDetailView,
  IncidentPage,
  IncidentRedispatchView,
  ProjectView,
  ReceivedIncident,
} from '@nudge/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startPipeline, type DashboardClient, type Pipeline } from './harness/index.js';

const anyLevel = { minimumLevel: 'info', environments: [], conditions: [] } as const;

/** The window the Opening cap counts openings in, shortened so a storm calms down fast. */
const WINDOW_MS = 600;

/**
 * The Opening cap: past it, a Project's new Incidents are recorded but Held, not
 * dispatched. The Members are alerted once per storm; once the Project is back under its
 * cap, each Destination that would have received a Held Incident receives one summary.
 */
describe('The Opening cap and Held Incidents', () => {
  let pipeline: Pipeline;
  let member: DashboardClient;

  beforeAll(async () => {
    pipeline = await startPipeline({
      dashboardUrl: 'https://nudge.test/',
      openingCap: { limit: 20, windowMs: WINDOW_MS },
      incidents: {
        quietPeriodMs: 60 * 60_000,
        sweepIntervalMs: 100,
        judgeWaitMs: 300,
        openingWindowMs: WINDOW_MS,
      },
    });
    member = await pipeline.signIn();
    const configured = await member.put('/api/instance/alert-destination', {
      type: 'webhook',
      config: { url: 'https://alerts.test/nudge' },
    });
    expect(configured.status).toBe(200);
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

  /** A Project whose Opening cap is `cap` openings per window, set from its settings. */
  const projectWithCap = async (name: string, cap: number) => {
    const created = await pipeline.createProject({ name });
    const updated = await member.patch<ProjectView>(`/api/projects/${created.project.id}`, {
      openingCap: cap,
    });
    expect(updated.status).toBe(200);
    expect(updated.body.openingCap).toBe(cap);
    return created;
  };

  const stormAlerts = (projectId: string) =>
    pipeline.fakeAlert.alerts.filter(
      (alert: Alert): alert is IncidentStormAlert =>
        alert.event === 'incident_storm' && alert.project.id === projectId,
    );

  /** How many sessions of the pipeline's database wait for a lock. */
  const waitingForALock = async () => {
    const { rows } = await pipeline.db.execute<{ waiting: number }>(
      sql`select count(*)::int as waiting from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'`,
    );
    return rows[0]?.waiting ?? 0;
  };

  const heldIds = async (projectId: string) => {
    const response = await member.get<IncidentPage>(
      `/api/incidents?project=${projectId}&held=true`,
    );
    expect(response.status).toBe(200);
    return response.body.incidents.map((incident) => incident.id).sort();
  };

  it('past the cap, Incidents are recorded but Held: none is dispatched, the Members are alerted once, each concerned Destination gets one summary', async () => {
    const { project, secretKey } = await projectWithCap('Storm', 2);
    const team = await pipeline.createDestination(project.id, {
      name: 'Team',
      incidentFilter: anyLevel,
    });
    const onCall = await pipeline.createDestination(project.id, {
      name: 'On-call',
      incidentFilter: { minimumLevel: 'critical', environments: [], conditions: [] },
    });

    const opened = [];
    for (let n = 1; n <= 5; n += 1) {
      opened.push(await report(secretKey, { title: `Job ${n} failed`, level: 'error' }));
    }
    expect(opened.every((incident) => incident.opened && incident.state === 'open')).toBe(true);

    const [first, second, ...held] = opened;
    await vi.waitFor(() => expect(team.fake.incidents).toHaveLength(2), { timeout: 5000 });
    expect(team.fake.incidents.map((d) => d.incident.id).sort()).toEqual(
      [first!.id, second!.id].sort(),
    );
    for (const incident of held) {
      expect(await read(incident.id)).toMatchObject({ held: true, deliveries: [] });
    }
    expect(await read(first!.id)).toMatchObject({ held: false });
    expect(await heldIds(project.id)).toEqual(held.map((incident) => incident.id).sort());

    // An Occurrence raising a Held Incident's Level dispatches nothing either.
    await report(secretKey, { title: 'Job 3 failed', level: 'critical' });

    const [alert] = await vi.waitFor(
      () => {
        const alerts = stormAlerts(project.id);
        expect(alerts).toHaveLength(1);
        return alerts;
      },
      { timeout: 5000 },
    );
    expect(alert).toMatchObject({
      event: 'incident_storm',
      isTest: false,
      project: { id: project.id, name: 'Storm' },
      storm: { held: expect.any(Number), cap: 2 },
      dashboardUrl: `https://nudge.test/projects/${project.id}/incidents?held=true`,
    });
    expect(alert!.storm.held).toBeGreaterThanOrEqual(1);

    const [summary] = await vi.waitFor(
      () => {
        expect(team.fake.heldSummaries).toHaveLength(1);
        return team.fake.heldSummaries;
      },
      { timeout: 5000 },
    );
    expect(summary).toMatchObject({
      project: { id: project.id, name: 'Storm' },
      held: { count: 3 },
      dashboardUrl: `https://nudge.test/projects/${project.id}/incidents?held=true`,
    });
    expect(summary!.held.firstOpenedAt.getTime()).toBeLessThanOrEqual(
      summary!.held.lastOpenedAt.getTime(),
    );
    // Job 3, raised to critical, is the only Held Incident the on-call Filter accepts.
    await vi.waitFor(() => expect(onCall.fake.heldSummaries).toHaveLength(1), { timeout: 5000 });
    expect(onCall.fake.heldSummaries[0]).toMatchObject({ held: { count: 1 } });

    // Calm again: nothing more arrives, no Incident was dispatched.
    await new Promise((resolve) => setTimeout(resolve, 3 * WINDOW_MS));
    expect(team.fake.incidentAttempts).toHaveLength(2);
    expect(onCall.fake.incidentAttempts).toHaveLength(0);
    expect(team.fake.heldSummaries).toHaveLength(1);
    expect(stormAlerts(project.id)).toHaveLength(1);
  });

  it('a new storm after the Project calmed down alerts the Members again', async () => {
    const { project, secretKey } = await projectWithCap('Two storms', 1);
    const team = await pipeline.createDestination(project.id, { incidentFilter: anyLevel });

    await report(secretKey, { title: 'A', level: 'warning' });
    await report(secretKey, { title: 'B', level: 'warning' });
    await report(secretKey, { title: 'C', level: 'warning' });
    await vi.waitFor(() => expect(team.fake.heldSummaries).toHaveLength(1), { timeout: 5000 });
    expect(team.fake.heldSummaries[0]).toMatchObject({ held: { count: 2 } });
    expect(stormAlerts(project.id)).toHaveLength(1);

    await new Promise((resolve) => setTimeout(resolve, WINDOW_MS));
    await report(secretKey, { title: 'D', level: 'warning' });
    await report(secretKey, { title: 'E', level: 'warning' });
    await vi.waitFor(() => expect(stormAlerts(project.id)).toHaveLength(2), { timeout: 5000 });
    await vi.waitFor(() => expect(team.fake.heldSummaries).toHaveLength(2), { timeout: 5000 });
    expect(team.fake.heldSummaries[1]).toMatchObject({ held: { count: 1 } });
  });

  it('an Incident opened past the cap without a declared Level is Held with the default Level, without asking the Judge', async () => {
    const { project, secretKey } = await projectWithCap('Undeclared', 1);
    const team = await pipeline.createDestination(project.id, { incidentFilter: anyLevel });
    const judged = pipeline.judge.requests.length;

    const dispatched = await report(secretKey, { title: 'Disk full' });
    const held = await report(secretKey, { title: 'Disk full again' });
    expect(await read(held.id)).toMatchObject({ level: 'error', levelOrigin: 'default' });

    await vi.waitFor(() => expect(team.fake.incidents).toHaveLength(1), { timeout: 5000 });
    expect(team.fake.incidents[0]?.incident.id).toBe(dispatched.id);
    await vi.waitFor(() => expect(team.fake.heldSummaries).toHaveLength(1), { timeout: 5000 });
    expect(team.fake.incidentAttempts).toHaveLength(1);
    expect(await read(held.id)).toMatchObject({ held: true, deliveries: [] });
    expect(pipeline.judge.requests).toHaveLength(judged + 1);
  });

  it('an opening absorbed after all by a concurrent opening of its Fingerprint leaves no storm behind', async () => {
    const { project, secretKey } = await projectWithCap('Same Fingerprint', 1);
    const occurrence = {
      projectId: project.id,
      fingerprint: 'burst',
      level: 'error',
      openingCap: { limit: 1, windowMs: WINDOW_MS },
      report: {
        title: 'Burst',
        message: null,
        level: 'error',
        environment: null,
        fingerprint: 'burst',
        context: {},
        quietPeriod: null,
        resolved: false,
        receivedAt: new Date().toISOString(),
      },
    } as const;

    // The first opening holds the Project's lock until it commits. The second finds no
    // Open Incident, waits for that lock, then counts the first opening: past the cap,
    // it would be Held, but its insert conflicts and it is absorbed.
    let firstRecorded!: () => void;
    let commitFirst!: () => void;
    const recordedFirst = new Promise<void>((resolve) => (firstRecorded = resolve));
    const committing = new Promise<void>((resolve) => (commitFirst = resolve));
    const first = pipeline.db.transaction(async (tx) => {
      const recorded = await recordOccurrence(tx, occurrence);
      firstRecorded();
      await committing;
      return recorded;
    });
    await recordedFirst;
    const second = pipeline.db.transaction((tx) => recordOccurrence(tx, occurrence));
    await vi.waitFor(async () => expect(await waitingForALock()).toBe(1), { timeout: 5000 });
    commitFirst();

    const [opened, absorbed] = await Promise.all([first, second]);
    expect(opened).toMatchObject({ opened: true, held: false });
    expect(absorbed).toMatchObject({ id: opened!.id, opened: false, startedStormId: null });
    expect(
      await pipeline.db
        .select()
        .from(incidentStorms)
        .where(eq(incidentStorms.projectId, project.id)),
    ).toEqual([]);

    // The real storm that follows starts its own, and alerts the Members.
    await report(secretKey, { title: 'Another', level: 'error' });
    await vi.waitFor(() => expect(stormAlerts(project.id)).toHaveLength(1), { timeout: 5000 });
  });

  it('a Member Redispatches a Held Incident that is still Open; a Closed one is not offered', async () => {
    const { project, secretKey } = await projectWithCap('Hidden', 1);
    const team = await pipeline.createDestination(project.id, { incidentFilter: anyLevel });

    await report(secretKey, { title: 'Noise', level: 'info' });
    const real = await report(secretKey, { title: 'Payments down', level: 'critical' });
    const closed = await report(secretKey, { title: 'Cache cold', level: 'warning' });
    await report(secretKey, { title: 'Cache cold', level: 'warning', resolved: true });
    expect(await read(real.id)).toMatchObject({ held: true });
    expect(await read(closed.id)).toMatchObject({ held: true, state: 'closed' });

    const redispatch = await member.post<IncidentRedispatchView>(
      `/api/incidents/${real.id}/redispatch`,
    );
    expect(redispatch.status).toBe(200);
    expect(redispatch.body.deliveriesCreated).toBe(1);
    expect(redispatch.body.incident.held).toBe(false);
    await vi.waitFor(
      () => expect(team.fake.incidents.map((d) => d.incident.id)).toContain(real.id),
      { timeout: 5000 },
    );

    const refused = await member.post(`/api/incidents/${closed.id}/redispatch`);
    expect(refused.status).toBe(409);
    expect(team.fake.incidentAttempts.map((d) => d.incident.id)).not.toContain(closed.id);

    // Released, it is no longer Held, and the summary counts only the one still Held.
    await vi.waitFor(() => expect(team.fake.heldSummaries).toHaveLength(1), { timeout: 5000 });
    expect(team.fake.heldSummaries[0]).toMatchObject({ held: { count: 1 } });
  });

  it('a Redispatch of a Held Incident whose queueing fails leaves it Held, without a Delivery', async () => {
    const { project, secretKey } = await projectWithCap('Redispatch undone', 1);
    const team = await pipeline.createDestination(project.id, { incidentFilter: anyLevel });
    // Its Delivery is created held, not queued: it must not be left to go out on release.
    const suspended = await pipeline.createDestination(project.id, { incidentFilter: anyLevel });
    await pipeline.suspend(suspended.destination.id);
    await report(secretKey, { title: 'Noise', level: 'info' });
    const held = await report(secretKey, { title: 'Ledger out of sync', level: 'critical' });
    expect(await read(held.id)).toMatchObject({ held: true, deliveries: [] });

    const repair = await pipeline.breakEnqueue(DISPATCH_QUEUE);
    try {
      const redispatch = await member.post(`/api/incidents/${held.id}/redispatch`);
      expect(redispatch.status).toBe(500);
    } finally {
      await repair();
    }

    expect(await read(held.id)).toMatchObject({ held: true, deliveries: [] });
    expect(await heldIds(project.id)).toEqual([held.id]);
    expect(team.fake.incidentAttempts.map((d) => d.incident.id)).not.toContain(held.id);
  });

  it('a Project without a cap of its own follows the Instance default', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'Default cap' });
    const team = await pipeline.createDestination(project.id, { incidentFilter: anyLevel });
    expect(
      (await member.get<ProjectView>(`/api/projects/${project.id}`)).body.openingCap,
    ).toBeNull();

    // Together, so that all 21 open within the window.
    await Promise.all(
      Array.from({ length: 21 }, (_, n) =>
        report(secretKey, { title: `Healthcheck ${n}`, level: 'warning' }),
      ),
    );
    await vi.waitFor(() => expect(team.fake.incidents).toHaveLength(20), { timeout: 5000 });
    await vi.waitFor(() => expect(team.fake.heldSummaries).toHaveLength(1), { timeout: 5000 });
    expect(team.fake.heldSummaries[0]).toMatchObject({ held: { count: 1 } });
  });
});
