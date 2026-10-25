import type { ProjectActivityView, MemberListItemView, ProjectView } from '@nudge/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SIGNED_IN, fakeApi, MEMBER } from './test/fake-api.js';
import { renderDashboard } from './test/render.js';

const SHOP: ProjectView = {
  id: 'project-1',
  name: 'Shop',
  description: null,
  publicKey: 'nk_pub_shop',
  allowedOrigins: [],
  createdAt: '2026-10-24T08:00:00.000Z',
};

describe('Projects', () => {
  it('creates a Project and shows its secret key only once', async () => {
    const api = fakeApi({
      'GET /api/session': SIGNED_IN,
      'GET /api/projects': { status: 200, body: [] },
      'POST /api/projects': {
        status: 201,
        body: { project: SHOP, secretKey: 'nk_sec_unique' },
      },
      'GET /api/projects/project-1': { status: 200, body: SHOP },
    });
    renderDashboard('/projects');

    await userEvent.type(await screen.findByLabelText('Project name'), 'Shop');
    await userEvent.click(screen.getByRole('button', { name: 'Create Project' }));

    expect(await screen.findByRole('heading', { name: 'Shop' })).toBeTruthy();
    expect(screen.getByLabelText('Secret key').textContent).toBe('nk_sec_unique');
    expect(screen.getByLabelText('Public key').textContent).toBe('nk_pub_shop');
    expect(api.calls.find((c) => c.route === 'POST /api/projects')?.body).toEqual({
      name: 'Shop',
    });
  });

  it('no longer shows the secret key when coming back to the Project', async () => {
    fakeApi({
      'GET /api/session': SIGNED_IN,
      'GET /api/projects/project-1': { status: 200, body: SHOP },
    });

    renderDashboard('/projects/project-1');

    expect(await screen.findByRole('heading', { name: 'Shop' })).toBeTruthy();
    expect(screen.queryByLabelText('Secret key')).toBeNull();
  });

  it('regenerates the secret key after confirmation and shows the new one', async () => {
    const api = fakeApi({
      'GET /api/session': SIGNED_IN,
      'GET /api/projects/project-1': { status: 200, body: SHOP },
      'POST /api/projects/project-1/secret-key': {
        status: 201,
        body: { project: SHOP, secretKey: 'nk_sec_new' },
      },
    });
    renderDashboard('/projects/project-1');

    await userEvent.click(await screen.findByRole('button', { name: 'Regenerate secret key' }));
    expect(api.calls.map((c) => c.route)).not.toContain('POST /api/projects/project-1/secret-key');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect((await screen.findByLabelText('Secret key')).textContent).toBe('nk_sec_new');
  });

  it('saves the allowed origins and shows a refusal from the API', async () => {
    const api = fakeApi({
      'GET /api/session': SIGNED_IN,
      'GET /api/projects/project-1': { status: 200, body: SHOP },
      'PATCH /api/projects/project-1': {
        status: 400,
        body: {
          error: 'invalid_request',
          details: [{ path: 'allowedOrigins.1', message: 'Invalid origin: not-a-url' }],
        },
      },
    });
    renderDashboard('/projects/project-1');

    await userEvent.type(
      await screen.findByLabelText('One origin per line'),
      'https://app.example{Enter}not-a-url',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save origins' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/Invalid origin: not-a-url/);
    expect(api.calls.find((c) => c.route === 'PATCH /api/projects/project-1')?.body).toEqual({
      allowedOrigins: ['https://app.example', 'not-a-url'],
    });
  });

  it('shows a Project’s text as text, never as HTML', async () => {
    fakeApi({
      'GET /api/session': SIGNED_IN,
      'GET /api/projects': {
        status: 200,
        body: [{ ...SHOP, description: '<img src=x onerror="alert(1)">' }],
      },
    });

    renderDashboard('/projects');

    expect(await screen.findByText('<img src=x onerror="alert(1)">')).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('Projects activity', () => {
  it('shows for each Project its Feedback of the week, In review, and its Destinations', async () => {
    fakeApi({
      'GET /api/session': SIGNED_IN,
      'GET /api/projects': { status: 200, body: [SHOP] },
      'GET /api/projects/activity': {
        status: 200,
        body: [
          {
            projectId: SHOP.id,
            feedbacksThisWeek: 12,
            feedbacksInReview: 2,
            destinations: 3,
            suspendedDestinations: 1,
          },
        ] satisfies ProjectActivityView[],
      },
    });

    renderDashboard('/projects');

    const list = await screen.findByRole('list', { name: 'Projects of the Instance' });
    const row = within(list).getByRole('listitem');
    expect(await within(row).findByText('12 Feedback this week')).toBeTruthy();
    expect(within(row).getByText('2 In review')).toBeTruthy();
    expect(within(row).getByText('3 Destinations, 1 Suspended')).toBeTruthy();
  });

  it('flags a Project without a Destination: its Feedback goes nowhere', async () => {
    fakeApi({
      'GET /api/session': SIGNED_IN,
      'GET /api/projects': { status: 200, body: [SHOP] },
      'GET /api/projects/activity': {
        status: 200,
        body: [
          {
            projectId: SHOP.id,
            feedbacksThisWeek: 0,
            feedbacksInReview: 0,
            destinations: 0,
            suspendedDestinations: 0,
          },
        ] satisfies ProjectActivityView[],
      },
    });

    renderDashboard('/projects');

    const list = await screen.findByRole('list', { name: 'Projects of the Instance' });
    const row = within(list).getByRole('listitem');
    expect(await within(row).findByText('No Destination')).toBeTruthy();
  });
});

describe('Members', () => {
  it('lists the Instance’s Members and marks the signed-in Member', async () => {
    fakeApi({
      'GET /api/session': SIGNED_IN,
      'GET /api/members': {
        status: 200,
        body: [
          { id: MEMBER.id, email: MEMBER.email, since: '2026-10-01T09:00:00.000Z' },
          { id: 'member-2', email: 'bob@nudge.test', since: '2026-10-20T09:00:00.000Z' },
        ] satisfies MemberListItemView[],
      },
    });

    renderDashboard('/members');

    const list = await screen.findByRole('list', { name: 'Members of the Instance' });
    const [me, bob] = within(list).getAllByRole('listitem') as [HTMLElement, HTMLElement];
    expect(me.textContent).toMatch(MEMBER.email);
    expect(me.textContent).toMatch(/you/);
    expect(bob.textContent).toMatch(/bob@nudge\.test/);
    expect(bob.textContent).toMatch(/since October 20, 2026/);
  });
});

describe('Invitation', () => {
  it('creates the invited person’s account and signs them in', async () => {
    const api = fakeApi({
      'GET /api/session': { status: 401, body: { error: 'session_required' } },
      'GET /api/invitations/token-1': { status: 200, body: { expiresAt: '2026-10-31T00:00:00Z' } },
      'POST /api/invitations/token-1/accept': {
        status: 201,
        body: { member: { id: 'member-2', email: 'bob@nudge.test' } },
      },
      'GET /api/projects': { status: 200, body: [] },
    });
    renderDashboard('/invitation/token-1');

    await userEvent.type(await screen.findByLabelText('Email'), 'bob@nudge.test');
    await userEvent.type(screen.getByLabelText('Password'), 'bob’s own password');
    await userEvent.click(screen.getByRole('button', { name: 'Create my account' }));

    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeTruthy();
    expect(screen.getByText('bob@nudge.test')).toBeTruthy();
    expect(api.calls.map((c) => c.route)).toContain('POST /api/invitations/token-1/accept');
  });

  it('explains that an invalid link no longer works', async () => {
    fakeApi({
      'GET /api/invitations/old': { status: 404, body: { error: 'invalid_invitation' } },
    });

    renderDashboard('/invitation/old');

    expect((await screen.findByRole('alert')).textContent).toMatch(
      /invalid, expired or already used/,
    );
  });
});
