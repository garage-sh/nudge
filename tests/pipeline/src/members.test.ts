import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../../../apps/api/src/dashboard/auth/password.js';
import { startPipeline, type Pipeline } from './harness/index.js';

// A spy that still hashes: a refusal must not cost an argon2id derivation.
vi.mock(import('../../../apps/api/src/dashboard/auth/password.js'), async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, hashPassword: vi.fn(original.hashPassword) };
});

const ADA = { email: 'ada@nudge.test', password: 'a strong password' };

/** Creates Ada as the first Member, with the setup token of the api logs. */
async function setUp(pipeline: Pipeline): Promise<void> {
  const setup = await pipeline
    .dashboard()
    .post('/api/setup', { ...ADA, setupToken: pipeline.setupToken });
  expect(setup.status).toBe(201);
}

describe('Members: setup, session, invitation', () => {
  let pipeline: Pipeline;

  beforeEach(async () => {
    pipeline = await startPipeline();
  });

  afterEach(async () => {
    await pipeline?.stop();
  });

  describe('setup', () => {
    it('creates the first Member, signs them in, then closes', async () => {
      const browser = pipeline.dashboard();
      expect(await browser.get('/api/setup')).toMatchObject({
        status: 200,
        body: { required: true },
      });

      const setup = await browser.post('/api/setup', { ...ADA, setupToken: pipeline.setupToken });

      expect(setup).toMatchObject({ status: 201, body: { member: { email: ADA.email } } });
      expect(await browser.get('/api/session')).toMatchObject({
        status: 200,
        body: { member: { email: ADA.email } },
      });
      expect(await browser.get('/api/setup')).toMatchObject({ body: { required: false } });

      const intruder = await pipeline.dashboard().post('/api/setup', {
        email: 'intruder@nudge.test',
        password: 'i am taking over',
        setupToken: pipeline.setupToken,
      });
      expect(intruder).toMatchObject({ status: 409, body: { error: 'setup_completed' } });
    });

    it('refuses the setup of a claimed Instance without hashing the password', async () => {
      await setUp(pipeline);
      vi.mocked(hashPassword).mockClear();

      const intruder = await pipeline.dashboard().post('/api/setup', {
        email: 'intruder@nudge.test',
        password: 'i am taking over',
        setupToken: pipeline.setupToken,
      });

      expect(intruder).toMatchObject({ status: 409, body: { error: 'setup_completed' } });
      expect(hashPassword).not.toHaveBeenCalled();
    });

    it('refuses a setup without the setup token printed in the api logs', async () => {
      const withoutToken = await pipeline.dashboard().post('/api/setup', ADA);
      const wrongToken = await pipeline.dashboard().post('/api/setup', {
        ...ADA,
        setupToken: `${pipeline.setupToken}x`,
      });

      expect(withoutToken).toMatchObject({ status: 400, body: { error: 'invalid_request' } });
      expect(wrongToken).toMatchObject({ status: 403, body: { error: 'invalid_setup_token' } });
      expect(await pipeline.dashboard().get('/api/setup')).toMatchObject({
        body: { required: true },
      });
    });

    it('takes the setup token set in NUDGE_SETUP_TOKEN', async () => {
      const chosen = await startPipeline({ setupToken: 'a token chosen by the self-hoster' });
      try {
        const setup = await chosen.dashboard().post('/api/setup', {
          ...ADA,
          setupToken: 'a token chosen by the self-hoster',
        });

        expect(setup.status).toBe(201);
      } finally {
        await chosen.stop();
      }
    });

    it('creates a single first Member when several setups arrive together', async () => {
      const statuses = await Promise.all(
        ['a', 'b', 'c'].map(async (letter) => {
          const response = await pipeline.dashboard().post('/api/setup', {
            email: `${letter}@nudge.test`,
            password: 'a strong password',
            setupToken: pipeline.setupToken,
          });
          return response.status;
        }),
      );

      expect(statuses.sort()).toEqual([201, 409, 409]);
    });

    it('refuses an invalid email or a too short password', async () => {
      const invalidEmail = await pipeline.dashboard().post('/api/setup', {
        email: 'not-an-email',
        password: 'a strong password',
        setupToken: pipeline.setupToken,
      });
      const shortPassword = await pipeline.dashboard().post('/api/setup', {
        email: ADA.email,
        password: 'short',
        setupToken: pipeline.setupToken,
      });

      expect(invalidEmail).toMatchObject({ status: 400, body: { error: 'invalid_request' } });
      expect(shortPassword).toMatchObject({ status: 400, body: { error: 'invalid_request' } });
      expect(await pipeline.dashboard().get('/api/setup')).toMatchObject({
        body: { required: true },
      });
    });
  });

  describe('sign in and sign out', () => {
    beforeEach(async () => {
      await setUp(pipeline);
    });

    it('signs a Member in by email and password, ignoring the email’s case', async () => {
      const browser = pipeline.dashboard();

      const signIn = await browser.post('/api/session', {
        email: 'Ada@Nudge.test',
        password: ADA.password,
      });

      expect(signIn).toMatchObject({ status: 200, body: { member: { email: ADA.email } } });
      expect(await browser.get('/api/session')).toMatchObject({ status: 200 });
    });

    it('refuses a wrong password or an unknown email, without saying which', async () => {
      const wrongPassword = await pipeline.dashboard().post('/api/session', {
        email: ADA.email,
        password: 'not the right password',
      });
      const unknownEmail = await pipeline.dashboard().post('/api/session', {
        email: 'unknown@nudge.test',
        password: ADA.password,
      });

      for (const response of [wrongPassword, unknownEmail]) {
        expect(response).toMatchObject({ status: 401, body: { error: 'invalid_credentials' } });
      }
    });

    it('requires a session on the dashboard routes', async () => {
      const anonymous = pipeline.dashboard();
      const forgedCookie = pipeline.dashboard().withSessionCookie('forged-token');

      for (const browser of [anonymous, forgedCookie]) {
        expect(await browser.get('/api/session')).toMatchObject({
          status: 401,
          body: { error: 'session_required' },
        });
        expect(await browser.get('/api/projects')).toMatchObject({ status: 401 });
        expect(await browser.post('/api/invitations')).toMatchObject({ status: 401 });
      }
    });

    it('revokes the session on sign out, even replayed with the old cookie', async () => {
      const browser = pipeline.dashboard();
      await browser.post('/api/session', ADA);
      const oldCookie = browser.sessionCookie;

      const signOut = await browser.delete('/api/session');

      expect(signOut.status).toBe(204);
      expect(browser.sessionCookie).toBeNull();
      const replay = pipeline.dashboard().withSessionCookie(oldCookie);
      expect(await replay.get('/api/session')).toMatchObject({ status: 401 });
    });

    it('revokes the session a browser already had when it signs in again', async () => {
      const browser = pipeline.dashboard();
      await browser.post('/api/session', ADA);
      const oldCookie = browser.sessionCookie;

      expect(await browser.post('/api/session', ADA)).toMatchObject({ status: 200 });

      expect(browser.sessionCookie).not.toBe(oldCookie);
      expect(await browser.get('/api/session')).toMatchObject({ status: 200 });
      const replay = pipeline.dashboard().withSessionCookie(oldCookie);
      expect(await replay.get('/api/session')).toMatchObject({ status: 401 });
    });
  });

  describe('public route protections', () => {
    beforeEach(async () => {
      await setUp(pipeline);
    });

    it('refuses a write that does not come from the dashboard (CSRF)', async () => {
      const browser = pipeline.dashboard();
      await browser.post('/api/session', ADA);
      const withoutHeader = (path: string, body?: unknown) =>
        fetch(`${pipeline.url}${path}`, {
          method: 'POST',
          headers: {
            cookie: `nudge_session=${browser.sessionCookie}`,
            'content-type': 'text/plain',
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });

      for (const response of [
        await withoutHeader('/api/invitations'),
        await withoutHeader('/api/session', ADA),
      ]) {
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ error: 'missing_header' });
      }
    });

    it('does not announce the framework it runs on', async () => {
      const response = await fetch(`${pipeline.url}/api/setup`);

      expect(response.headers.get('x-powered-by')).toBeNull();
    });

    it('throttles repeated sign-in attempts from the same address', async () => {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const failure = await pipeline.dashboard().post('/api/session', {
          email: ADA.email,
          password: `attempt ${attempt}`,
        });
        expect(failure.status).toBe(401);
      }

      const rightPassword = await pipeline.dashboard().post('/api/session', ADA);

      expect(rightPassword).toMatchObject({
        status: 429,
        body: { error: 'too_many_attempts' },
      });
    });
  });

  describe('invitation', () => {
    const BOB = { email: 'bob@nudge.test', password: 'bob’s own password' };

    async function invite(): Promise<string> {
      const ada = await pipeline.signIn();
      const invitation = await ada.post<{ token: string; expiresAt: string }>('/api/invitations');
      expect(invitation.status).toBe(201);
      return invitation.body.token;
    }

    it('lets the invited person create their account from the link, then sign in', async () => {
      const token = await invite();
      const bob = pipeline.dashboard();

      expect(await bob.get(`/api/invitations/${token}`)).toMatchObject({
        status: 200,
        body: { expiresAt: expect.any(String) },
      });
      const acceptance = await bob.post(`/api/invitations/${token}/accept`, BOB);

      expect(acceptance).toMatchObject({ status: 201, body: { member: { email: BOB.email } } });
      expect(await bob.get('/api/session')).toMatchObject({
        body: { member: { email: BOB.email } },
      });
      expect(await pipeline.dashboard().post('/api/session', BOB)).toMatchObject({ status: 200 });
    });

    it('works only once', async () => {
      const token = await invite();
      await pipeline.dashboard().post(`/api/invitations/${token}/accept`, BOB);

      const secondTime = await pipeline.dashboard().post(`/api/invitations/${token}/accept`, {
        email: 'eve@nudge.test',
        password: 'eve’s own password',
      });

      expect(secondTime).toMatchObject({ status: 404, body: { error: 'invalid_invitation' } });
      expect(await pipeline.dashboard().get(`/api/invitations/${token}`)).toMatchObject({
        status: 404,
      });
    });

    it('expires after seven days', async () => {
      const token = await invite();
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        vi.setSystemTime(Date.now() + 7 * 24 * 60 * 60 * 1000 + 60_000);

        const late = await pipeline.dashboard().post(`/api/invitations/${token}/accept`, BOB);

        expect(late).toMatchObject({ status: 404, body: { error: 'invalid_invitation' } });
      } finally {
        vi.useRealTimers();
      }
    });

    it('refuses an unknown link, without hashing the password', async () => {
      vi.mocked(hashPassword).mockClear();

      const unknown = await pipeline.dashboard().post('/api/invitations/unknown/accept', BOB);

      expect(unknown).toMatchObject({ status: 404, body: { error: 'invalid_invitation' } });
      expect(hashPassword).not.toHaveBeenCalled();
    });

    it('refuses an email already taken without consuming the link', async () => {
      const token = await invite();

      const duplicate = await pipeline.dashboard().post(`/api/invitations/${token}/accept`, {
        email: 'first@nudge.test',
        password: 'another password',
      });

      expect(duplicate).toMatchObject({ status: 409, body: { error: 'email_already_used' } });
      const retry = await pipeline.dashboard().post(`/api/invitations/${token}/accept`, BOB);
      expect(retry.status).toBe(201);
    });
  });
});
