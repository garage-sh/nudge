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

  it('signs out', async () => {
    const api = fakeApi({
      'GET /api/session': SIGNED_IN,
      'GET /api/setup': { status: 200, body: { required: false } },
      'GET /api/projects': { status: 200, body: [] },
      'DELETE /api/session': { status: 204 },
    });
    renderDashboard('/projects');

    await userEvent.click(await screen.findByRole('button', { name: /sign out/i }));

    expect(await screen.findByRole('button', { name: /sign in/i })).toBeTruthy();
    expect(api.calls.map((c) => c.route)).toContain('DELETE /api/session');
  });
});
