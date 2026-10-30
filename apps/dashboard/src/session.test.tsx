import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SIGNED_IN, fakeApi, MEMBER, NO_SESSION } from './test/fake-api.js';
import { renderDashboard } from './test/render.js';

describe('Dashboard session', () => {
  it('sends to the setup while no Member exists', async () => {
    fakeApi({
      'GET /api/session': NO_SESSION,
      'GET /api/setup': { status: 200, body: { required: true } },
    });

    renderDashboard('/projects');

    expect(await screen.findByRole('heading', { name: /first account/i })).toBeTruthy();
  });

  it('says under each field what is wrong, without sending anything', async () => {
    const api = fakeApi({
      'GET /api/session': NO_SESSION,
      'GET /api/setup': { status: 200, body: { required: true } },
    });
    renderDashboard('/setup');

    const email = await screen.findByLabelText('Email');
    await userEvent.type(email, 'not-an-email');
    await userEvent.type(screen.getByLabelText('Password'), 'a long enough password');
    await userEvent.click(screen.getByRole('button', { name: /create/i }));

    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(email);
    expect(screen.getByText(/Enter an email address/)).toBeTruthy();
    expect(api.calls.some((c) => c.route === 'POST /api/setup')).toBe(false);

    await userEvent.clear(email);
    await userEvent.type(email, 'ada@example.com');
    expect(email.getAttribute('aria-invalid')).toBeNull();
  });

  it('creates the first account with the setup token printed in the server logs', async () => {
    const api = fakeApi({
      'GET /api/session': NO_SESSION,
      'GET /api/setup': { status: 200, body: { required: true } },
      'POST /api/setup': { status: 403, body: { error: 'invalid_setup_token' } },
    });
    renderDashboard('/setup');

    await userEvent.type(await screen.findByLabelText('Setup token'), 'a-wrong-token');
    await userEvent.type(screen.getByLabelText('Email'), MEMBER.email);
    await userEvent.type(screen.getByLabelText('Password'), 'a long enough password');
    await userEvent.click(screen.getByRole('button', { name: /create/i }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringMatching(/setup token is incorrect/i),
    );
    expect(api.calls.find((c) => c.route === 'POST /api/setup')?.body).toEqual({
      email: MEMBER.email,
      password: 'a long enough password',
      setupToken: 'a-wrong-token',
    });

    api.set('POST /api/setup', { status: 201, body: { member: MEMBER } });
    api.set('GET /api/projects', { status: 200, body: [] });
    await userEvent.click(screen.getByRole('button', { name: /create/i }));

    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeTruthy();
  });

  it('sends to sign in without a session, then back to the requested page', async () => {
    const api = fakeApi({
      'GET /api/session': NO_SESSION,
      'GET /api/setup': { status: 200, body: { required: false } },
      'POST /api/session': SIGNED_IN,
      'GET /api/projects': { status: 200, body: [] },
    });
    renderDashboard('/projects');

    await userEvent.type(await screen.findByLabelText(/email/i), MEMBER.email);
    await userEvent.type(screen.getByLabelText(/password/i), 'a strong password');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeTruthy();
    expect(screen.getByText(MEMBER.email)).toBeTruthy();
    expect(api.calls.find((c) => c.route === 'POST /api/session')?.body).toEqual({
      email: MEMBER.email,
      password: 'a strong password',
    });
  });

  it('shows a refused sign-in without leaving the page', async () => {
    fakeApi({
      'GET /api/session': NO_SESSION,
      'GET /api/setup': { status: 200, body: { required: false } },
      'POST /api/session': { status: 401, body: { error: 'invalid_credentials' } },
    });
    renderDashboard('/sign-in');

    await userEvent.type(await screen.findByLabelText(/email/i), MEMBER.email);
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringMatching(/incorrect email or password/i),
    );
  });

  it('goes back to sign in when the API reports the session lost', async () => {
    fakeApi({
      'GET /api/session': SIGNED_IN,
      'GET /api/setup': { status: 200, body: { required: false } },
      'GET /api/projects': NO_SESSION,
    });

    renderDashboard('/projects');

    expect(await screen.findByRole('button', { name: /sign in/i })).toBeTruthy();
  });

  it('signs out from the account menu', async () => {
    const api = fakeApi({
      'GET /api/session': SIGNED_IN,
      'GET /api/setup': { status: 200, body: { required: false } },
      'GET /api/projects': { status: 200, body: [] },
      'DELETE /api/session': { status: 204 },
    });
    renderDashboard('/projects');

    await userEvent.click(await screen.findByRole('button', { name: MEMBER.email }));
    await userEvent.click(screen.getByRole('button', { name: /sign out/i }));

    expect(await screen.findByRole('button', { name: /sign in/i })).toBeTruthy();
    expect(api.calls.map((c) => c.route)).toContain('DELETE /api/session');
  });
});
