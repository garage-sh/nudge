import type { MemberListItemView } from '@nudge/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_MEMBER,
  startPipeline,
  type DashboardClient,
  type Pipeline,
} from './harness/index.js';

const BOB = { email: 'bob@nudge.test', password: 'bob’s own password' };

describe('Member lifecycle: password, sessions, removal', () => {
  let pipeline: Pipeline;
  let ada: DashboardClient;

  beforeEach(async () => {
    pipeline = await startPipeline();
    ada = await pipeline.signIn();
  });

  afterEach(async () => {
    await pipeline?.stop();
  });

  /** A Member invited by `inviter`, signed in from their own browser. */
  async function invite(inviter: DashboardClient, credentials = BOB): Promise<DashboardClient> {
    const invitation = await inviter.post<{ token: string }>('/api/invitations');
    const browser = pipeline.dashboard();
    const acceptance = await browser.post(
      `/api/invitations/${invitation.body.token}/accept`,
      credentials,
    );
    expect(acceptance.status).toBe(201);
    return browser;
  }

  async function idOf(email: string): Promise<string> {
    const list = await ada.get<MemberListItemView[]>('/api/members');
    const member = list.body.find((m) => m.email === email);
    if (!member) throw new Error(`${email} is not a Member`);
    return member.id;
  }

  describe('password change', () => {
    const NEW_PASSWORD = 'a brand new password';

    it('requires the current password, then signs out the other sessions only', async () => {
      const laptop = pipeline.dashboard();
      await laptop.post('/api/session', DEFAULT_MEMBER);

      const change = await ada.put('/api/account/password', {
        currentPassword: DEFAULT_MEMBER.password,
        newPassword: NEW_PASSWORD,
      });

      expect(change.status).toBe(204);
      expect(await ada.get('/api/session')).toMatchObject({ status: 200 });
      expect(await laptop.get('/api/session')).toMatchObject({ status: 401 });
      expect(await pipeline.dashboard().post('/api/session', DEFAULT_MEMBER)).toMatchObject({
        status: 401,
      });
      expect(
        await pipeline
          .dashboard()
          .post('/api/session', { email: DEFAULT_MEMBER.email, password: NEW_PASSWORD }),
      ).toMatchObject({ status: 200 });
    });

    it('refuses a wrong current password and keeps everything as it was', async () => {
      const laptop = pipeline.dashboard();
      await laptop.post('/api/session', DEFAULT_MEMBER);

      const change = await ada.put('/api/account/password', {
        currentPassword: 'not the right password',
        newPassword: NEW_PASSWORD,
      });

      expect(change).toMatchObject({ status: 403, body: { error: 'invalid_current_password' } });
      expect(await laptop.get('/api/session')).toMatchObject({ status: 200 });
      expect(await pipeline.dashboard().post('/api/session', DEFAULT_MEMBER)).toMatchObject({
        status: 200,
      });
    });

    it('applies the password policy to the new password', async () => {
      const change = await ada.put('/api/account/password', {
        currentPassword: DEFAULT_MEMBER.password,
        newPassword: 'short',
      });

      expect(change).toMatchObject({ status: 400, body: { error: 'invalid_request' } });
    });

    it('requires a session', async () => {
      const change = await pipeline.dashboard().put('/api/account/password', {
        currentPassword: DEFAULT_MEMBER.password,
        newPassword: NEW_PASSWORD,
      });

      expect(change).toMatchObject({ status: 401, body: { error: 'session_required' } });
    });
  });

  describe('sign out everywhere else', () => {
    it('revokes every other session of the Member, not this one nor other Members’', async () => {
      const phone = pipeline.dashboard();
      const laptop = pipeline.dashboard();
      await phone.post('/api/session', DEFAULT_MEMBER);
      await laptop.post('/api/session', DEFAULT_MEMBER);
      const bob = await invite(ada);

      const signOut = await ada.delete('/api/account/other-sessions');

      expect(signOut).toMatchObject({ status: 200, body: { revoked: 2 } });
      expect(await ada.get('/api/session')).toMatchObject({ status: 200 });
      expect(await phone.get('/api/session')).toMatchObject({ status: 401 });
      expect(await laptop.get('/api/session')).toMatchObject({ status: 401 });
      expect(await bob.get('/api/session')).toMatchObject({ status: 200 });
    });

    it('refuses a request that does not come from the dashboard (CSRF)', async () => {
      const response = await fetch(`${pipeline.url}/api/account/other-sessions`, {
        method: 'DELETE',
        headers: { cookie: `nudge_session=${ada.sessionCookie}` },
      });

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: 'missing_header' });
    });
  });

  describe('removal', () => {
    it('removes another Member, whose sessions stop working at once', async () => {
      const bob = await invite(ada);
      const bobId = await idOf(BOB.email);

      expect(await ada.delete(`/api/members/${bobId}`)).toMatchObject({ status: 204 });

      expect(await bob.get('/api/session')).toMatchObject({ status: 401 });
      expect(await bob.get('/api/projects')).toMatchObject({ status: 401 });
      expect(await pipeline.dashboard().post('/api/session', BOB)).toMatchObject({ status: 401 });
      const list = await ada.get<MemberListItemView[]>('/api/members');
      expect(list.body.map((m) => m.email)).toEqual([DEFAULT_MEMBER.email]);
    });

    it('revokes the invitation links the removed Member left unused', async () => {
      const bob = await invite(ada);
      const pending = await bob.post<{ token: string }>('/api/invitations');

      await ada.delete(`/api/members/${await idOf(BOB.email)}`);

      expect(
        await pipeline.dashboard().get(`/api/invitations/${pending.body.token}`),
      ).toMatchObject({ status: 404, body: { error: 'invalid_invitation' } });
    });

    it('does not let a Member remove themselves', async () => {
      const removal = await ada.delete(`/api/members/${await idOf(DEFAULT_MEMBER.email)}`);

      expect(removal).toMatchObject({ status: 409, body: { error: 'cannot_remove_self' } });
      expect(await ada.get('/api/session')).toMatchObject({ status: 200 });
    });

    it('answers 404 for an unknown or malformed id', async () => {
      for (const id of ['00000000-0000-4000-8000-000000000000', 'not-an-id']) {
        expect(await ada.delete(`/api/members/${id}`)).toMatchObject({
          status: 404,
          body: { error: 'member_not_found' },
        });
      }
    });

    it('never leaves the Instance without a Member when two remove each other', async () => {
      const bob = await invite(ada);
      const [adaId, bobId] = [await idOf(DEFAULT_MEMBER.email), await idOf(BOB.email)];

      const [byAda, byBob] = await Promise.all([
        ada.delete(`/api/members/${bobId}`),
        bob.delete(`/api/members/${adaId}`),
      ]);

      expect([byAda.status, byBob.status].sort()).toEqual([204, 401]);
      const survivor = byAda.status === 204 ? ada : bob;
      const list = await survivor.get<MemberListItemView[]>('/api/members');
      expect(list.body).toHaveLength(1);
    });

    it('requires a session', async () => {
      await invite(ada);

      const removal = await pipeline.dashboard().delete(`/api/members/${await idOf(BOB.email)}`);

      expect(removal).toMatchObject({
        status: 401,
      });
    });
  });
});
