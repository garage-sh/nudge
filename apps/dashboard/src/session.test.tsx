import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CONNECTE, fakeApi, MEMBRE, SANS_SESSION } from './test/fake-api.js';
import { renderDashboard } from './test/render.js';

describe('Session du dashboard', () => {
  it('envoie au setup tant qu’aucun Membre n’existe', async () => {
    fakeApi({
      'GET /api/session': SANS_SESSION,
      'GET /api/setup': { status: 200, body: { requis: true } },
    });

    renderDashboard('/projets');

    expect(await screen.findByRole('heading', { name: /premier compte/i })).toBeTruthy();
  });

  it('envoie à la connexion sans session, puis revient à la page demandée', async () => {
    const api = fakeApi({
      'GET /api/session': SANS_SESSION,
      'GET /api/setup': { status: 200, body: { requis: false } },
      'POST /api/session': CONNECTE,
      'GET /api/projets': { status: 200, body: [] },
    });
    renderDashboard('/projets');

    await userEvent.type(await screen.findByLabelText(/email/i), MEMBRE.email);
    await userEvent.type(screen.getByLabelText(/mot de passe/i), 'un mot de passe solide');
    await userEvent.click(screen.getByRole('button', { name: /se connecter/i }));

    expect(await screen.findByRole('heading', { name: 'Projets' })).toBeTruthy();
    expect(screen.getByText(MEMBRE.email)).toBeTruthy();
    expect(api.appels.find((a) => a.route === 'POST /api/session')?.corps).toEqual({
      email: MEMBRE.email,
      motDePasse: 'un mot de passe solide',
    });
  });

  it('affiche un refus de connexion sans quitter la page', async () => {
    fakeApi({
      'GET /api/session': SANS_SESSION,
      'GET /api/setup': { status: 200, body: { requis: false } },
      'POST /api/session': { status: 401, body: { erreur: 'identifiants_invalides' } },
    });
    renderDashboard('/connexion');

    await userEvent.type(await screen.findByLabelText(/email/i), MEMBRE.email);
    await userEvent.type(screen.getByLabelText(/mot de passe/i), 'mauvais');
    await userEvent.click(screen.getByRole('button', { name: /se connecter/i }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringMatching(/email ou mot de passe incorrect/i),
    );
  });

  it('revient à la connexion quand l’API signale la session perdue', async () => {
    fakeApi({
      'GET /api/session': CONNECTE,
      'GET /api/setup': { status: 200, body: { requis: false } },
      'GET /api/projets': SANS_SESSION,
    });

    renderDashboard('/projets');

    expect(await screen.findByRole('button', { name: /se connecter/i })).toBeTruthy();
  });

  it('se déconnecte', async () => {
    const api = fakeApi({
      'GET /api/session': CONNECTE,
      'GET /api/setup': { status: 200, body: { requis: false } },
      'GET /api/projets': { status: 200, body: [] },
      'DELETE /api/session': { status: 204 },
    });
    renderDashboard('/projets');

    await userEvent.click(await screen.findByRole('button', { name: /se déconnecter/i }));

    expect(await screen.findByRole('button', { name: /se connecter/i })).toBeTruthy();
    expect(api.appels.map((a) => a.route)).toContain('DELETE /api/session');
  });
});
