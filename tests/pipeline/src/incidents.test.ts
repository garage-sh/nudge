import type {
  IncidentDetailView,
  IncidentPage,
  ProjectView,
  ReceivedIncident,
} from '@nudge/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPipeline, type DashboardClient, type Pipeline } from './harness/index.js';

describe('Reporting an Incident', () => {
  let pipeline: Pipeline;
  let member: DashboardClient;

  beforeAll(async () => {
    pipeline = await startPipeline();
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

  it('opens an Incident on a first Occurrence, then absorbs the same Occurrence', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'Payments' });
    const occurrence = {
      title: 'Payment provider timed out',
      message: 'POST /charges took 30 s',
      level: 'error',
      environment: 'production',
      context: { service: 'checkout', version: '3.1.0', retried: true },
    };

    const first = await report(secretKey, occurrence);
    const second = await report(secretKey, { ...occurrence, context: { service: 'checkout' } });

    expect(first).toEqual({ id: expect.any(String), state: 'open', opened: true });
    expect(second).toEqual({ id: first.id, state: 'open', opened: false });
    const incident = await read(first.id);
    expect(incident).toMatchObject({
      id: first.id,
      project: { id: project.id, name: 'Payments' },
      state: 'open',
      title: 'Payment provider timed out',
      level: 'error',
      levelOrigin: 'declared',
      environment: 'production',
      occurrences: 2,
      firstReport: {
        title: 'Payment provider timed out',
        message: 'POST /charges took 30 s',
        level: 'error',
        environment: 'production',
        fingerprint: null,
        context: { service: 'checkout', version: '3.1.0', retried: true },
      },
      lastReport: { context: { service: 'checkout' } },
    });
    expect(incident.firstReport.receivedAt).toBe(incident.firstSeenAt);
    expect(incident.lastReport.receivedAt).toBe(incident.lastSeenAt);
    expect(Date.parse(incident.lastSeenAt)).toBeGreaterThanOrEqual(
      Date.parse(incident.firstSeenAt),
    );
  });

  it('opens a single Incident for Occurrences arriving together', async () => {
    const { secretKey } = await pipeline.createProject({ name: 'Together' });

    const received = await Promise.all(
      Array.from({ length: 8 }, () => report(secretKey, { title: 'Burst', environment: 'prod' })),
    );

    expect(new Set(received.map((r) => r.id)).size).toBe(1);
    expect(received.filter((r) => r.opened)).toHaveLength(1);
    expect(await read(received[0]!.id)).toMatchObject({ occurrences: 8 });
  });

  it('groups two different titles under a declared Fingerprint', async () => {
    const { secretKey } = await pipeline.createProject({ name: 'Orders' });

    const first = await report(secretKey, {
      title: 'Order 1041 failed',
      fingerprint: 'order-failed',
    });
    const second = await report(secretKey, {
      title: 'Order 1042 failed',
      fingerprint: 'order-failed',
    });

    expect(second).toMatchObject({ id: first.id, opened: false });
    expect(await read(first.id)).toMatchObject({
      title: 'Order 1041 failed',
      fingerprint: 'order-failed',
      occurrences: 2,
      lastReport: { title: 'Order 1042 failed', fingerprint: 'order-failed' },
    });
  });

  it('opens one Incident per Environment, and per Project, without a declared Fingerprint', async () => {
    const { secretKey } = await pipeline.createProject({ name: 'Queues' });
    const { secretKey: otherKey } = await pipeline.createProject({ name: 'Other' });

    const production = await report(secretKey, {
      title: 'Queue backed up',
      environment: 'production',
    });
    const staging = await report(secretKey, { title: 'Queue backed up', environment: 'staging' });
    const none = await report(secretKey, { title: 'Queue backed up' });
    const elsewhere = await report(otherKey, {
      title: 'Queue backed up',
      environment: 'production',
    });

    expect([production, staging, none, elsewhere].every((r) => r.opened)).toBe(true);
    expect(new Set([production.id, staging.id, none.id, elsewhere.id]).size).toBe(4);
  });

  it('raises the Level on a higher declared Level, never lowers it', async () => {
    const { secretKey } = await pipeline.createProject({ name: 'Raise' });

    const { id } = await report(secretKey, { title: 'Disk filling up', level: 'warning' });
    await report(secretKey, { title: 'Disk filling up', level: 'critical' });
    await report(secretKey, { title: 'Disk filling up', level: 'info' });
    await report(secretKey, { title: 'Disk filling up' });

    expect(await read(id)).toMatchObject({
      level: 'critical',
      levelOrigin: 'declared',
      occurrences: 4,
    });
  });

  it('applies the Project’s default Level when none is declared and the Judge gives none, and a Member can change it', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'Defaults' });
    const titles = new Set(['Nightly job failed', 'Cache miss storm']);
    pipeline.judge.refuse((request) => titles.has(String(request.state['title'])));
    const view = await member.get<ProjectView>(`/api/projects/${project.id}`);
    expect(view.body.defaultLevel).toBe('error');

    const before = await report(secretKey, { title: 'Nightly job failed' });
    const updated = await member.patch<ProjectView>(`/api/projects/${project.id}`, {
      defaultLevel: 'warning',
    });
    const after = await report(secretKey, { title: 'Cache miss storm' });

    expect(updated).toMatchObject({ status: 200, body: { defaultLevel: 'warning' } });
    expect(await read(before.id)).toMatchObject({ level: 'error', levelOrigin: 'default' });
    expect(await read(after.id)).toMatchObject({ level: 'warning', levelOrigin: 'default' });
    const refused = await member.patch(`/api/projects/${project.id}`, { defaultLevel: 'fatal' });
    expect(refused.status).toBe(400);
  });

  it('refuses the public key: Incidents are only reported from a server', async () => {
    const { publicKey } = await pipeline.createProject({
      name: 'Browser',
      allowedOrigins: ['https://app.example'],
    });

    const response = await fetch(`${pipeline.url}/v1/incidents`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${publicKey}`,
        origin: 'https://app.example',
      },
      body: JSON.stringify({ title: 'From the browser' }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'secret_key_required' });
  });

  it('refuses a call without a key or with an unknown key', async () => {
    const withoutKey = await fetch(`${pipeline.url}/v1/incidents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Hello' }),
    });
    const unknownKey = await pipeline.postIncident('nk_sec_unknown', { title: 'Hello' });

    expect(withoutKey.status).toBe(401);
    expect(unknownKey.status).toBe(401);
  });

  it.each([
    ['a missing title', { message: 'No title' }, 'title'],
    ['a blank title', { title: '   ' }, 'title'],
    ['an unknown Level', { title: 'Hello', level: 'fatal' }, 'level'],
    ['an unknown field', { title: 'Hello', priority: 'high' }, ''],
    [
      'a context value that is not a scalar',
      { title: 'Hello', context: { nested: { a: 1 } } },
      'context.nested',
    ],
    [
      'an oversized context',
      {
        title: 'Hello',
        context: Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, i])),
      },
      'context',
    ],
    [
      'an oversized context value',
      { title: 'Hello', context: { trace: 'x'.repeat(1001) } },
      'context.trace',
    ],
  ])('refuses %s', async (_case, body, path) => {
    const { secretKey } = await pipeline.createProject({ name: 'Refusals' });

    const response = await pipeline.postIncident(secretKey, body);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: 'invalid_incident',
      details: expect.arrayContaining([expect.objectContaining({ path })]),
    });
  });
});

describe('Incidents in the dashboard', () => {
  let pipeline: Pipeline;
  let member: DashboardClient;

  beforeAll(async () => {
    pipeline = await startPipeline();
    member = await pipeline.signIn();
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  it('lists a Project’s Incidents, newest first, filtered by Level and Environment', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'Listed' });
    const { secretKey: otherKey } = await pipeline.createProject({ name: 'Elsewhere' });
    const post = async (body: Record<string, unknown>) =>
      ((await (await pipeline.postIncident(secretKey, body)).json()) as ReceivedIncident).id;
    const critical = await post({
      title: 'Database down',
      level: 'critical',
      environment: 'production',
    });
    const warning = await post({ title: 'Slow page', level: 'warning', environment: 'staging' });
    const plain = await post({ title: 'Healthcheck failed', level: 'error' });
    await pipeline.postIncident(otherKey, { title: 'Not mine' });

    const list = (query = '') =>
      member.get<IncidentPage>(`/api/incidents?project=${project.id}${query}`);
    const ids = async (query = '') => (await list(query)).body.incidents.map((i) => i.id);

    const all = await list();
    expect(all.status).toBe(200);
    expect(all.body.incidents.map((i) => i.id)).toEqual([plain, warning, critical]);
    expect(all.body.incidents[2]).toMatchObject({
      title: 'Database down',
      state: 'open',
      level: 'critical',
      environment: 'production',
      occurrences: 1,
    });
    expect(await ids('&level=critical')).toEqual([critical]);
    expect(await ids('&environment=staging')).toEqual([warning]);
    expect(await ids('&state=open')).toEqual([plain, warning, critical]);
    expect(await ids('&state=closed')).toEqual([]);
    expect((await list('&level=fatal')).status).toBe(400);

    const environments = await member.get<string[]>(
      `/api/incidents/environments?project=${project.id}`,
    );
    expect(environments.body).toEqual(['production', 'staging']);
  });

  it('pages through the Incidents with a cursor', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'Paged' });
    for (const title of ['One', 'Two', 'Three']) {
      await pipeline.postIncident(secretKey, { title });
    }

    const first = await member.get<IncidentPage>(`/api/incidents?project=${project.id}&limit=2`);
    const second = await member.get<IncidentPage>(
      `/api/incidents?project=${project.id}&limit=2&cursor=${first.body.next}`,
    );

    expect(first.body.incidents.map((i) => i.title)).toEqual(['Three', 'Two']);
    expect(second.body).toMatchObject({ incidents: [{ title: 'One' }], next: null });
  });

  it('answers 404 for an unknown Incident, and requires a session', async () => {
    const unknown = await member.get('/api/incidents/00000000-0000-4000-8000-000000000000');
    const anonymous = await pipeline
      .dashboard()
      .get('/api/incidents?project=00000000-0000-4000-8000-000000000000');

    expect(unknown).toMatchObject({ status: 404, body: { error: 'incident_not_found' } });
    expect(anonymous.status).toBe(401);
  });
});
