import type { MemberListItemView } from '@nudge/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { MEMBER, SIGNED_IN, fakeApi } from './test/fake-api.js';
import { renderDashboard } from './test/render.js';

const BOB: MemberListItemView = {
  id: 'member-2',
  email: 'bob@nudge.test',
  since: '2026-10-20T09:00:00.000Z',
};
const ME: MemberListItemView = { ...MEMBER, since: '2026-10-01T09:00:00.000Z' };

const routes = (members: MemberListItemView[] = [ME, BOB]) => ({
  'GET /api/session': SIGNED_IN,
  'GET /api/members': { status: 200, body: members },
});

describe('Members: removal', () => {
  it('removes another Member after confirmation, never oneself', async () => {
    const api = fakeApi({ ...routes(), 'DELETE /api/members/member-2': { status: 204 } });
    renderDashboard('/members');

    const list = await screen.findByRole('list', { name: 'Members of the Instance' });
    const [me] = within(list).getAllByRole('listitem') as [HTMLElement];
    expect(within(me).queryByRole('button')).toBeNull();

    await userEvent.click(within(list).getByRole('button', { name: 'Remove bob@nudge.test' }));
    expect(api.calls.some((c) => c.route.startsWith('DELETE'))).toBe(false);
    // Focus is on Cancel, the safe choice.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    api.set('GET /api/members', { status: 200, body: [ME] });
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('bob@nudge.test is no longer a Member.')).toBeTruthy();
    expect(api.calls.map((c) => c.route)).toContain('DELETE /api/members/member-2');
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
  });

  it('says why a removal is refused', async () => {
    fakeApi({
      ...routes(),
      'DELETE /api/members/member-2': { status: 404, body: { error: 'member_not_found' } },
    });
    renderDashboard('/members');

    await userEvent.click(await screen.findByRole('button', { name: 'Remove bob@nudge.test' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'This Member no longer exists.',
    );
  });
});

describe('Members: own account', () => {
  it('changes the password with the current one, then empties the fields', async () => {
    const api = fakeApi({ ...routes(), 'PUT /api/account/password': { status: 204 } });
    renderDashboard('/members');

    await userEvent.type(await screen.findByLabelText('Current password'), 'the old password');
    await userEvent.type(screen.getByLabelText('New password'), 'a brand new password');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(
      await screen.findByText('Password changed. Your other sessions are signed out.'),
    ).toBeTruthy();
    expect(api.calls.find((c) => c.route === 'PUT /api/account/password')?.body).toEqual({
      currentPassword: 'the old password',
      newPassword: 'a brand new password',
    });
    expect((screen.getByLabelText('Current password') as HTMLInputElement).value).toBe('');
  });

  it('says the current password is wrong, and stays signed in', async () => {
    fakeApi({
      ...routes(),
      'PUT /api/account/password': { status: 403, body: { error: 'invalid_current_password' } },
    });
    renderDashboard('/members');

    await userEvent.type(await screen.findByLabelText('Current password'), 'not the password');
    await userEvent.type(screen.getByLabelText('New password'), 'a brand new password');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Your current password is incorrect.',
    );
    expect(screen.getByRole('heading', { name: 'Members' })).toBeTruthy();
  });

  it('signs out everywhere else and says how many sessions ended', async () => {
    const api = fakeApi({
      ...routes(),
      'DELETE /api/account/other-sessions': { status: 200, body: { revoked: 2 } },
    });
    renderDashboard('/members');

    await userEvent.click(await screen.findByRole('button', { name: 'Sign out everywhere else' }));

    expect(await screen.findByText('2 other sessions signed out.')).toBeTruthy();
    expect(api.calls.map((c) => c.route)).toContain('DELETE /api/account/other-sessions');
    expect(screen.getByRole('heading', { name: 'Members' })).toBeTruthy();
  });
});
