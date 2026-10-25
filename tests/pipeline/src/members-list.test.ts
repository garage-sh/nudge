import type { MemberListItemView } from '@nudge/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPipeline, type DashboardClient, type Pipeline } from './harness/index.js';

describe('Member list', () => {
  let pipeline: Pipeline;
  let first: DashboardClient;

  beforeAll(async () => {
    pipeline = await startPipeline();
    first = await pipeline.signIn();
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  it('shows a Member every Member of the Instance, from oldest to newest', async () => {
    const invitation = await first.post<{ token: string }>('/api/invitations');
    const acceptance = await pipeline
      .dashboard()
      .post(`/api/invitations/${invitation.body.token}/accept`, {
        email: 'bob@nudge.test',
        password: 'bob’s password',
      });
    expect(acceptance.status).toBe(201);

    const list = await first.get<MemberListItemView[]>('/api/members');

    expect(list.status).toBe(200);
    expect(list.body).toEqual([
      { id: expect.any(String), email: 'first@nudge.test', since: expect.any(String) },
      { id: expect.any(String), email: 'bob@nudge.test', since: expect.any(String) },
    ]);
    // Never a password hash.
    expect(JSON.stringify(list.body)).not.toMatch(/argon2|hash/i);
  });

  it('refuses a browser without a session', async () => {
    expect(await pipeline.dashboard().get('/api/members')).toMatchObject({
      status: 401,
      body: { error: 'session_required' },
    });
  });
});
