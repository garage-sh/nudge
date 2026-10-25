import type { FeedbackPage } from '@nudge/shared';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { fr } from './i18n/fr.js';
import { LOCALE_STORAGE_KEY } from './i18n/index.js';
import { SIGNED_IN, fakeApi } from './test/fake-api.js';
import { renderDashboard } from './test/render.js';

const routes = () => ({
  'GET /api/session': SIGNED_IN,
  'GET /api/projects': { status: 200, body: [] },
  'GET /api/feedbacks': {
    status: 200,
    body: { feedbacks: [], next: null } satisfies FeedbackPage,
  },
});

describe('Dashboard language', () => {
  it('switches to French from the sidebar, and remembers it for the next visit', async () => {
    fakeApi(routes());
    const { unmount } = renderDashboard('/feedbacks');

    expect(await screen.findByRole('heading', { name: 'Inbox' })).toBeTruthy();
    expect(document.documentElement.lang).toBe('en');
    await userEvent.selectOptions(screen.getByLabelText('Language'), 'fr');

    expect(await screen.findByRole('heading', { name: fr.inbox.title })).toBeTruthy();
    expect(screen.getByRole('button', { name: fr.layout.signOut })).toBeTruthy();
    expect(document.documentElement.lang).toBe('fr');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('fr');

    unmount();
    renderDashboard('/feedbacks', { locale: null });
    expect(await screen.findByRole('heading', { name: fr.inbox.title })).toBeTruthy();
  });

  it('follows a French-speaking browser when nothing is remembered', async () => {
    vi.stubGlobal('navigator', { ...navigator, language: 'fr-CA' });
    fakeApi(routes());

    renderDashboard('/feedbacks', { locale: null });

    expect(await screen.findByRole('heading', { name: fr.inbox.title })).toBeTruthy();
  });

  it('speaks English to any other browser', async () => {
    vi.stubGlobal('navigator', { ...navigator, language: 'de-DE' });
    fakeApi(routes());

    renderDashboard('/feedbacks', { locale: null });

    expect(await screen.findByRole('heading', { name: 'Inbox' })).toBeTruthy();
  });
});
