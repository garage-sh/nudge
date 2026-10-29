import { INCIDENT_LEVEL_QUEUE } from '@nudge/core';
import { LEVELS, type IncidentDetailView, type ReceivedIncident } from '@nudge/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeJudge, startPipeline, type DashboardClient, type Pipeline } from './harness/index.js';

const anyLevel = { minimumLevel: 'info', environments: [], conditions: [] } as const;

/** How long Dispatch waits for the Judge in these pipelines. */
const JUDGE_WAIT_MS = 1000;

const incidentOptions = {
  quietPeriodMs: 60 * 60_000,
  sweepIntervalMs: 100,
  judgeWaitMs: JUDGE_WAIT_MS,
};

/** The helpers every pipeline of this file shares. */
function helpers(pipeline: () => Pipeline, member: () => DashboardClient) {
  const report = async (secretKey: string, body: Record<string, unknown>) => {
    const response = await pipeline().postIncident(secretKey, body);
    expect(response.status).toBe(202);
    return (await response.json()) as ReceivedIncident & { readonly id: string };
  };

  const read = async (id: string) => {
    const response = await member().get<IncidentDetailView>(`/api/incidents/${id}`);
    expect(response.status).toBe(200);
    return response.body;
  };

  const waitForIncident = async (
    id: string,
    condition: (incident: IncidentDetailView) => boolean,
    timeoutMs = 5000,
  ) => {
    let incident = await read(id);
    const deadline = Date.now() + timeoutMs;
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

  return { report, read, waitForIncident, delivered };
}

/**
 * An Incident whose sender declares no Level is assessed by the Judge, in the worker: its
 * Dispatch waits for the answer only for a bounded time, then falls back to the
 * Project's default Level. Reporting never waits for the Judge.
 */
describe('The Level of an Incident assessed by the Judge', () => {
  let pipeline: Pipeline;
  let member: DashboardClient;
  const { report, read, waitForIncident, delivered } = helpers(
    () => pipeline,
    () => member,
  );

  beforeAll(async () => {
    pipeline = await startPipeline({ incidents: incidentOptions });
    member = await pipeline.signIn();
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  /** The Judge requests that asked for an Incident's Level. */
  const levelRequests = (judge: FakeJudge) =>
    judge.requests.filter((request) => 'level' in request.questions);

  it('an undeclared Level is the Judge’s: the Incident is dispatched at it, with origin judge', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'Judged' });
    const onCall = await pipeline.createDestination(project.id, {
      name: 'On-call',
      incidentFilter: { minimumLevel: 'critical', environments: [], conditions: [] },
    });
    pipeline.judge.script({ level: 'critical' });
    const before = levelRequests(pipeline.judge).length;

    const opened = await report(secretKey, {
      title: 'Database unreachable',
      message: 'connect ECONNREFUSED 10.0.0.12:5432',
      environment: 'production',
      context: { service: 'billing' },
    });

    expect(opened).toEqual({ id: opened.id, state: 'open', opened: true });
    const incident = await waitForIncident(opened.id, delivered);
    expect(incident).toMatchObject({ level: 'critical', levelOrigin: 'judge' });
    expect(onCall.fake.incidentAttempts).toMatchObject([
      { moment: 'opened', incident: { id: opened.id, level: 'critical' } },
    ]);
    const asked = levelRequests(pipeline.judge).slice(before);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      state: {
        title: 'Database unreachable',
        message: 'connect ECONNREFUSED 10.0.0.12:5432',
        environment: 'production',
        context: { service: 'billing' },
      },
      questions: { level: { kind: 'choice', choices: [...LEVELS] } },
    });
  });

  it('a declared Level never asks the Judge', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'Declared' });
    await pipeline.createDestination(project.id, { incidentFilter: anyLevel });
    pipeline.judge.script({ level: 'critical' });
    const before = levelRequests(pipeline.judge).length;

    const opened = await report(secretKey, { title: 'Cache cold', level: 'info' });

    const incident = await waitForIncident(opened.id, delivered);
    expect(incident).toMatchObject({ level: 'info', levelOrigin: 'declared' });
    expect(levelRequests(pipeline.judge)).toHaveLength(before);
  });

  it('a Judge slower than the bound: the default Level applies and the Incident is still dispatched, while reporting never waited', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'Slow Judge' });
    const { fake } = await pipeline.createDestination(project.id, { incidentFilter: anyLevel });
    const release = pipeline.judge.hold();
    try {
      const before = pipeline.judge.cancelled.length;
      const startedAt = Date.now();
      const opened = await report(secretKey, { title: 'Queue backing up' });
      // The response came back while the Judge holds every request.
      expect(Date.now() - startedAt).toBeLessThan(JUDGE_WAIT_MS);
      expect(await read(opened.id)).toMatchObject({ deliveries: [] });

      const incident = await waitForIncident(opened.id, delivered);
      expect(incident).toMatchObject({ level: 'error', levelOrigin: 'default' });
      expect(fake.incidentAttempts).toMatchObject([
        { moment: 'opened', incident: { id: opened.id, level: 'error' } },
      ]);
      // The request in flight was abandoned at the bound, not left running.
      expect(pipeline.judge.cancelled.length).toBe(before + 1);
    } finally {
      release();
    }
  });

  it('a failing Judge: the default Level applies and the Incident is still dispatched', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'Failing Judge' });
    const { fake } = await pipeline.createDestination(project.id, { incidentFilter: anyLevel });
    pipeline.judge.script({ level: 'critical' });
    pipeline.judge.fail(1);

    const opened = await report(secretKey, { title: 'Nightly export failed' });

    const incident = await waitForIncident(opened.id, delivered);
    expect(incident).toMatchObject({ level: 'error', levelOrigin: 'default' });
    expect(fake.incidentAttempts).toMatchObject([
      { moment: 'opened', incident: { id: opened.id, level: 'error' } },
    ]);
  });

  it('a Level declared while the Judge assesses wins: the Incident opens once, at that Level', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'Declared meanwhile' });
    const { fake } = await pipeline.createDestination(project.id, { incidentFilter: anyLevel });
    pipeline.judge.script({ level: 'info' });
    const release = pipeline.judge.hold();
    let opened: ReceivedIncident & { readonly id: string };
    try {
      opened = await report(secretKey, { title: 'Payments failing' });
      await report(secretKey, { title: 'Payments failing', level: 'critical' });
    } finally {
      release();
    }

    const incident = await waitForIncident(opened.id, delivered);
    expect(incident).toMatchObject({ level: 'critical', levelOrigin: 'declared', occurrences: 2 });
    expect(fake.incidentAttempts).toMatchObject([
      { moment: 'opened', incident: { id: opened.id, level: 'critical' } },
    ]);
  });

  it('a Level declared while the Judge assesses wins even below the default, and a Redispatch meanwhile sends nothing early', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'Declared lower' });
    const { fake } = await pipeline.createDestination(project.id, { incidentFilter: anyLevel });
    pipeline.judge.script({ level: 'critical' });
    const release = pipeline.judge.hold();
    let opened: ReceivedIncident & { readonly id: string };
    try {
      opened = await report(secretKey, { title: 'Thumbnail worker slow' });
      await report(secretKey, { title: 'Thumbnail worker slow', level: 'info' });
      const redispatch = await member.post(`/api/incidents/${opened.id}/redispatch`, {});
      expect(redispatch.status).toBe(200);
      expect(await read(opened.id)).toMatchObject({ deliveries: [] });
    } finally {
      release();
    }

    const incident = await waitForIncident(opened.id, delivered);
    expect(incident).toMatchObject({ level: 'info', levelOrigin: 'declared' });
    expect(fake.incidentAttempts).toMatchObject([
      { moment: 'opened', incident: { id: opened.id, level: 'info' } },
    ]);
  });

  it('an Incident resolved while the Judge assesses goes out once, opened then closed', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'Resolved meanwhile' });
    const { fake } = await pipeline.createDestination(project.id, { incidentFilter: anyLevel });
    pipeline.judge.script({ level: 'warning' });
    const release = pipeline.judge.hold();
    let opened: ReceivedIncident & { readonly id: string };
    try {
      opened = await report(secretKey, { title: 'Webhook relay down' });
      await report(secretKey, { title: 'Webhook relay down', resolved: true });
    } finally {
      release();
    }

    const incident = await waitForIncident(opened.id, (i) => i.state === 'closed' && delivered(i));
    expect(incident.deliveries).toHaveLength(1);
    expect(fake.incidentAttempts).toMatchObject([
      {
        moment: 'opened',
        incident: { id: opened.id, state: 'closed', closure: { cause: 'resolved' } },
      },
    ]);
    expect(fake.closingAttempts).toHaveLength(0);
  });

  it('an Incident whose assessment could not be queued is still assessed, then dispatched', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'Lost assessment' });
    const { fake } = await pipeline.createDestination(project.id, { incidentFilter: anyLevel });
    pipeline.judge.script({ level: 'warning' });
    const repair = await pipeline.breakEnqueue(INCIDENT_LEVEL_QUEUE);
    let opened: ReceivedIncident & { readonly id: string };
    try {
      opened = await report(secretKey, { title: 'Certificate expires soon' });
    } finally {
      await repair();
    }

    const incident = await waitForIncident(opened.id, delivered, JUDGE_WAIT_MS + 5000);
    // Past the bound, the default Level applies: the Judge is not asked any more.
    expect(incident).toMatchObject({ level: 'error', levelOrigin: 'default' });
    expect(fake.incidentAttempts).toMatchObject([
      { moment: 'opened', incident: { id: opened.id, level: 'error' } },
    ]);
  });
});

describe('The Level of an Incident without a Judge', () => {
  let pipeline: Pipeline;
  let member: DashboardClient;
  const { report, waitForIncident, delivered } = helpers(
    () => pipeline,
    () => member,
  );

  beforeAll(async () => {
    pipeline = await startPipeline({ judge: null, incidents: incidentOptions });
    member = await pipeline.signIn();
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  it('with no Judge, an undeclared Level is the Project’s default and the Incident is dispatched', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'No Judge' });
    const { fake } = await pipeline.createDestination(project.id, { incidentFilter: anyLevel });

    const opened = await report(secretKey, { title: 'Healthcheck failed' });

    const incident = await waitForIncident(opened.id, delivered);
    expect(incident).toMatchObject({ level: 'error', levelOrigin: 'default' });
    expect(fake.incidentAttempts).toMatchObject([
      { moment: 'opened', incident: { id: opened.id, level: 'error' } },
    ]);
  });
});
