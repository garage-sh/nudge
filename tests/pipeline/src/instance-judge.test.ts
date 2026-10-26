import type { InstanceJudgeView } from '@nudge/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FakeDecisionsServer } from './harness/fake-decisions-server.js';
import { startPipeline, type Pipeline } from './harness/index.js';

const TYPESAFE_KEY = 'ts-test-key-0123456789';

describe('Judge chosen for the Instance', () => {
  let pipeline: Pipeline;
  let provider: FakeDecisionsServer;

  beforeAll(async () => {
    provider = await FakeDecisionsServer.start();
    pipeline = await startPipeline({ judge: 'instance' });
  });

  afterAll(async () => {
    await pipeline?.stop();
    await provider?.stop();
  });

  afterEach(async () => {
    const dashboard = await pipeline.signIn();
    await dashboard.put('/api/instance/judge', { provider: null });
  });

  async function triage(text: string) {
    const { project, secretKey } = await pipeline.createProject({
      name: `Project ${text}`,
    });
    await pipeline.createDestination(project.id);
    const response = await pipeline.postFeedback(secretKey, { text });
    const { id } = (await response.json()) as { id: string };
    return pipeline.waitForFeedback(id, (r) => r.state === 'dispatched');
  }

  it('with no Judge chosen and no NUDGE_JUDGE_* variables, Triage runs in degraded mode', async () => {
    const dashboard = await pipeline.signIn();
    const read = await dashboard.get('/api/instance/judge');
    expect(read.body).toEqual({
      provider: null,
      model: null,
      baseUrl: null,
      keyConfigured: false,
    } satisfies InstanceJudgeView);

    const feedback = await triage('No Judge');
    expect(feedback.verdict).toMatchObject({ uncertain: true, severity: null });
  });

  it('a Member chooses TypeSafe: the key is encrypted in the database and Triage calls the systemone API', async () => {
    const dashboard = await pipeline.signIn();
    const choice = await dashboard.put('/api/instance/judge', {
      provider: 'typesafe',
      apiKey: TYPESAFE_KEY,
      baseUrl: provider.url,
    });
    expect(choice.status).toBe(200);
    expect(choice.body).toEqual({
      provider: 'typesafe',
      model: null,
      baseUrl: provider.url,
      keyConfigured: true,
    } satisfies InstanceJudgeView);

    const row = await pipeline.instanceSettings();
    expect(row?.judgeEncryptedKey).toBeTruthy();
    expect(row?.judgeEncryptedKey).not.toContain(TYPESAFE_KEY);

    provider.respondWith({ type: 'suggestion', severity: 2, junk: 0.01 });
    const text = 'Please add a dark mode';
    const feedback = await triage(text);

    expect(feedback.verdict).toMatchObject({
      resolvedType: 'suggestion',
      severity: 'major',
      junk: false,
      uncertain: false,
    });
    const call = provider.requests.find((r) => r.body.state.text === text);
    expect(call).toMatchObject({ method: 'POST', path: '/v1/systemone' });
    expect(call?.headers.authorization).toBe(`Bearer ${TYPESAFE_KEY}`);
    expect(call?.body.model).toBe('jev-latest');
  });

  it('never returns the key; keeps it if only the model changes, forgets it if the provider or host changes', async () => {
    const dashboard = await pipeline.signIn();
    await dashboard.put('/api/instance/judge', {
      provider: 'openrouter',
      apiKey: 'sk-or-secret',
    });

    const model = await dashboard.put('/api/instance/judge', {
      provider: 'openrouter',
      model: 'typesafe/jev-1.14',
    });
    expect(model.body).toMatchObject({ model: 'typesafe/jev-1.14', keyConfigured: true });
    expect(JSON.stringify((await dashboard.get('/api/instance/judge')).body)).not.toContain(
      'sk-or-secret',
    );

    // The key does not follow a host change: it would go to an unknown server.
    const otherHost = await dashboard.put('/api/instance/judge', {
      provider: 'openrouter',
      baseUrl: 'https://elsewhere.example',
    });
    expect(otherHost.status).toBe(400);

    const other = await dashboard.put('/api/instance/judge', { provider: 'typesafe' });
    expect(other.status).toBe(400);
    expect(other.body).toMatchObject({
      error: 'invalid_request',
      details: [{ path: 'apiKey' }],
    });
  });

  it('keeps the key when the host is written differently, forgets it when the path changes', async () => {
    const dashboard = await pipeline.signIn();
    await dashboard.put('/api/instance/judge', {
      provider: 'openrouter',
      apiKey: 'sk-or-secret',
      baseUrl: 'https://proxy.example/judge',
    });

    // Same server: host case, default port and trailing slash do not change it.
    const sameServer = await dashboard.put('/api/instance/judge', {
      provider: 'openrouter',
      baseUrl: 'https://PROXY.example:443/judge/',
    });
    expect(sameServer.status).toBe(200);
    expect(sameServer.body).toMatchObject({ keyConfigured: true });

    const otherPath = await dashboard.put('/api/instance/judge', {
      provider: 'openrouter',
      baseUrl: 'https://proxy.example/other',
    });
    expect(otherPath.status).toBe(400);
  });

  it('a self-hosted Decisions API server serves as Judge, without a key', async () => {
    const dashboard = await pipeline.signIn();
    const withoutUrl = await dashboard.put('/api/instance/judge', { provider: 'self_hosted' });
    expect(withoutUrl.status).toBe(400);

    const choice = await dashboard.put('/api/instance/judge', {
      provider: 'self_hosted',
      baseUrl: provider.url,
    });
    expect(choice.body).toMatchObject({ provider: 'self_hosted', keyConfigured: false });

    provider.respondWith({ type: 'question', severity: 0 });
    const text = 'How do I export my data?';
    const feedback = await triage(text);

    expect(feedback.verdict).toMatchObject({ resolvedType: 'question', severity: 'cosmetic' });
    const call = provider.requests.find((r) => r.body.state.text === text);
    expect(call).toMatchObject({ path: '/v1/decisions' });
    expect(call?.headers.authorization).toBeUndefined();
  });

  it('refuses choosing the Judge without a session', async () => {
    const anonymous = pipeline.dashboard();
    expect((await anonymous.get('/api/instance/judge')).status).toBe(401);
    expect((await anonymous.put('/api/instance/judge', { provider: null })).status).toBe(401);
  });
});

describe('Judge from environment variables', () => {
  let pipeline: Pipeline;
  let provider: FakeDecisionsServer;

  beforeAll(async () => {
    provider = await FakeDecisionsServer.start();
    pipeline = await startPipeline({
      judge: 'instance',
      defaultJudge: {
        provider: 'openrouter',
        apiKey: 'sk-or-env',
        model: null,
        baseUrl: provider.url,
      },
    });
  });

  afterAll(async () => {
    await pipeline?.stop();
    await provider?.stop();
  });

  it('serve as fallback until the Instance chooses a Judge, then give way', async () => {
    const { project, secretKey } = await pipeline.createProject({
      name: 'Fallback',
    });
    await pipeline.createDestination(project.id);
    provider.respondWith({ type: 'bug', severity: 3 });

    const first = await pipeline.postFeedback(secretKey, { text: 'From the environment' });
    const { id } = (await first.json()) as { id: string };
    await pipeline.waitForFeedback(id, (r) => r.state === 'dispatched');
    expect(provider.requests.at(-1)).toMatchObject({ path: '/api/alpha/decisions' });
    expect(provider.requests.at(-1)?.headers.authorization).toBe('Bearer sk-or-env');

    const dashboard = await pipeline.signIn();
    await dashboard.put('/api/instance/judge', {
      provider: 'self_hosted',
      baseUrl: provider.url,
    });
    const second = await pipeline.postFeedback(secretKey, { text: 'From the Instance' });
    const { id: id2 } = (await second.json()) as { id: string };
    await pipeline.waitForFeedback(id2, (r) => r.state === 'dispatched');
    expect(provider.requests.at(-1)).toMatchObject({ path: '/v1/decisions' });
  });
});

describe('Judge behind the outbound policy (NUDGE_OUTBOUND_ALLOWED_HOSTS empty)', () => {
  let pipeline: Pipeline;
  let provider: FakeDecisionsServer;

  beforeAll(async () => {
    provider = await FakeDecisionsServer.start();
    pipeline = await startPipeline({
      judge: 'instance',
      outboundAllowedHosts: [],
      defaultJudge: { provider: 'self_hosted', apiKey: null, model: null, baseUrl: provider.url },
    });
  });

  afterAll(async () => {
    await pipeline?.stop();
    await provider?.stop();
  });

  it('the NUDGE_JUDGE_* Judge, set by the Self-hoster, reaches an internal host', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'Internal default' });
    await pipeline.createDestination(project.id);
    provider.respondWith({ type: 'bug', severity: 1 });

    const response = await pipeline.postFeedback(secretKey, { text: 'Self-hoster Judge' });
    const { id } = (await response.json()) as { id: string };

    await pipeline.waitForFeedback(id, (r) => r.state === 'dispatched');
  });

  it('the Judge a Member chose at an internal address is refused before any request', async () => {
    const dashboard = await pipeline.signIn();
    await dashboard.put('/api/instance/judge', { provider: 'self_hosted', baseUrl: provider.url });
    const { project } = await pipeline.createProject({ name: 'Internal Instance Judge' });
    const feedbackId = await pipeline.insertFeedbackWithoutTriage(project.id, {
      text: 'Member Judge',
    });
    const before = provider.requests.length;

    await expect(pipeline.replayTriage(feedbackId)).rejects.toThrow('NUDGE_OUTBOUND_ALLOWED_HOSTS');
    expect(provider.requests).toHaveLength(before);
    expect((await pipeline.readFeedback(feedbackId))?.state).toBe('received');
  });
});
