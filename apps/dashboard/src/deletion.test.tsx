import type { FeedbackPage, FeedbackDetailView } from '@nudge/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SIGNED_IN, fakeApi } from './test/fake-api.js';
import { renderDashboard } from './test/render.js';

const FEEDBACK: FeedbackDetailView = {
  id: 'feedback-1',
  project: { id: 'project-1', name: 'Shop' },
  state: 'dispatched',
  source: 'widget',
  text: 'Erase my data',
  declaredType: null,
  author: null,
  context: {},
  capture: { contentType: 'image/png', bytes: 2048 },
  verdict: null,
  deliveries: [],
  createdAt: '2026-10-24T09:00:00.000Z',
};

const EMPTY_INBOX = { status: 200, body: { feedbacks: [], next: null } satisfies FeedbackPage };

describe('Deletion of a Feedback', () => {
  it('deletes the Feedback and its Capture after confirmation, then goes back to the inbox', async () => {
    const api = fakeApi({
      'GET /api/session': SIGNED_IN,
      'GET /api/feedbacks/feedback-1': { status: 200, body: FEEDBACK },
      'DELETE /api/feedbacks/feedback-1': { status: 204 },
      'GET /api/feedbacks': EMPTY_INBOX,
      'GET /api/projects': { status: 200, body: [] },
    });
    renderDashboard('/feedbacks/feedback-1');

    const deletion = await screen.findByRole('region', { name: 'Deletion' });
    expect(deletion.textContent).toMatch(/Capture/);
    await userEvent.click(within(deletion).getByRole('button', { name: 'Delete' }));
    expect(api.calls.map((c) => c.route)).not.toContain('DELETE /api/feedbacks/feedback-1');
    await userEvent.click(within(deletion).getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByRole('heading', { name: 'Inbox' })).toBeTruthy();
    expect(api.calls.map((c) => c.route)).toContain('DELETE /api/feedbacks/feedback-1');
  });

  it('explains a refusal and keeps the Feedback shown', async () => {
    fakeApi({
      'GET /api/session': SIGNED_IN,
      'GET /api/feedbacks/feedback-1': { status: 200, body: FEEDBACK },
      'DELETE /api/feedbacks/feedback-1': { status: 503, body: { error: 'storage_unavailable' } },
    });
    renderDashboard('/feedbacks/feedback-1');

    const deletion = await screen.findByRole('region', { name: 'Deletion' });
    await userEvent.click(within(deletion).getByRole('button', { name: 'Delete' }));
    await userEvent.click(within(deletion).getByRole('button', { name: 'Confirm' }));

    expect((await within(deletion).findByRole('alert')).textContent).toMatch(
      /Capture could not be erased/,
    );
    expect(screen.getByLabelText('Feedback text').textContent).toBe('Erase my data');
  });
});
