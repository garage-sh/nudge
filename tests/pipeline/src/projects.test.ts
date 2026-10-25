import type { ProjectWithSecretKey, ProjectView } from '@nudge/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPipeline, type DashboardClient, type Pipeline } from './harness/index.js';

describe('Projects in the dashboard', () => {
  let pipeline: Pipeline;
  let member: DashboardClient;

  beforeAll(async () => {
    pipeline = await startPipeline();
    member = await pipeline.signIn();
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  const create = async (body: Record<string, unknown>) => {
    const response = await member.post<ProjectWithSecretKey>('/api/projects', body);
    expect(response.status).toBe(201);
    return response.body;
  };

  it('creates a Project with a public key and a secret key that ingests Feedback', async () => {
    const { project, secretKey } = await create({
      name: 'Shop',
      description: 'The checkout flow is critical.',
      allowedOrigins: ['https://shop.example'],
    });

    expect(project).toMatchObject({
      name: 'Shop',
      description: 'The checkout flow is critical.',
      allowedOrigins: ['https://shop.example'],
      publicKey: expect.stringMatching(/^nk_pub_/),
    });
    expect(secretKey).toMatch(/^nk_sec_/);
    expect((await pipeline.postFeedback(secretKey, { text: 'Hello' })).status).toBe(202);
  });

  it('shows every Project to every Member, never with the secret key', async () => {
    const { project } = await create({ name: 'Shared' });
    const invitation = await member.post<{ token: string }>('/api/invitations');
    const other = pipeline.dashboard();
    await other.post(`/api/invitations/${invitation.body.token}/accept`, {
      email: 'other@nudge.test',
      password: 'the other member’s password',
    });

    const list = await other.get<ProjectView[]>('/api/projects');
    const detail = await other.get<ProjectView>(`/api/projects/${project.id}`);

    expect(list.status).toBe(200);
    expect(list.body.map((p) => p.id)).toContain(project.id);
    expect(detail).toMatchObject({ status: 200, body: { id: project.id, name: 'Shared' } });
    expect(JSON.stringify([list.body, detail.body])).not.toMatch(/nk_sec_|Hash"|_hash"/);
  });

  it('regenerates the secret key: the old one is revoked, the new one ingests', async () => {
    const { project, secretKey: oldKey } = await create({ name: 'Leak' });

    const regeneration = await member.post<ProjectWithSecretKey>(
      `/api/projects/${project.id}/secret-key`,
    );

    expect(regeneration.status).toBe(201);
    const newKey = regeneration.body.secretKey;
    expect(newKey).toMatch(/^nk_sec_/);
    expect(newKey).not.toBe(oldKey);
    expect((await pipeline.postFeedback(oldKey, { text: 'Me again' })).status).toBe(401);
    expect((await pipeline.postFeedback(newKey, { text: 'Hello' })).status).toBe(202);
    expect(regeneration.body.project.publicKey).toBe(project.publicKey);
  });

  it('regenerates the public key: the old one disappears, the secret key stays valid', async () => {
    const { project, secretKey } = await create({ name: 'Widget' });

    const regeneration = await member.post<ProjectView>(`/api/projects/${project.id}/public-key`);

    expect(regeneration.status).toBe(201);
    expect(regeneration.body.publicKey).toMatch(/^nk_pub_/);
    expect(regeneration.body.publicKey).not.toBe(project.publicKey);
    const list = await member.get<ProjectView[]>('/api/projects');
    expect(list.body.map((p) => p.publicKey)).not.toContain(project.publicKey);
    expect((await pipeline.postFeedback(secretKey, { text: 'Hello' })).status).toBe(202);
  });

  it('edits the allowed origins (normalized) and the Project description', async () => {
    const { project } = await create({
      name: 'Editing',
      description: 'Old description',
    });

    const edit = await member.patch<ProjectView>(`/api/projects/${project.id}`, {
      allowedOrigins: ['https://App.Example/', 'http://localhost:5173', 'https://app.example'],
      description: '',
    });

    expect(edit).toMatchObject({
      status: 200,
      body: {
        name: 'Editing',
        allowedOrigins: ['https://app.example', 'http://localhost:5173'],
        description: null,
      },
    });
    expect(await member.get(`/api/projects/${project.id}`)).toMatchObject({ body: edit.body });
  });

  it.each([
    ['an origin with a path', { allowedOrigins: ['https://app.example/page'] }],
    ['an origin without an http(s) scheme', { allowedOrigins: ['ftp://app.example'] }],
    ['an empty name', { name: '  ' }],
    ['a description that is too long', { description: 'a'.repeat(2001) }],
    ['an unknown field', { secretKey: 'nk_sec_chosen' }],
  ])('refuses %s', async (_case, body) => {
    const { project } = await create({ name: 'Validation' });

    const response = await member.patch(`/api/projects/${project.id}`, body);

    expect(response).toMatchObject({ status: 400, body: { error: 'invalid_request' } });
  });

  it('answers 404 for an unknown Project', async () => {
    const unknown = '00000000-0000-4000-8000-000000000000';

    expect(await member.get(`/api/projects/${unknown}`)).toMatchObject({
      status: 404,
      body: { error: 'project_not_found' },
    });
    expect(await member.get('/api/projects/not-a-uuid')).toMatchObject({ status: 404 });
    expect(await member.post(`/api/projects/${unknown}/secret-key`)).toMatchObject({
      status: 404,
    });
  });
});
