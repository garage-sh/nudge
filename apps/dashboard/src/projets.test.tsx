import type { ProjetVu } from '@nudge/shared';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CONNECTE, fakeApi } from './test/fake-api.js';
import { renderDashboard } from './test/render.js';

const BOUTIQUE: ProjetVu = {
  id: 'projet-1',
  nom: 'Boutique',
  description: null,
  clePublique: 'nk_pub_boutique',
  originesAutorisees: [],
  createdAt: '2026-10-24T08:00:00.000Z',
};

describe('Projets', () => {
  it('crée un Projet et montre sa clé secrète une seule fois', async () => {
    const api = fakeApi({
      'GET /api/session': CONNECTE,
      'GET /api/projets': { status: 200, body: [] },
      'POST /api/projets': { status: 201, body: { projet: BOUTIQUE, cleSecrete: 'nk_sec_unique' } },
      'GET /api/projets/projet-1': { status: 200, body: BOUTIQUE },
    });
    renderDashboard('/projets');

    await userEvent.type(await screen.findByLabelText('Nom du Projet'), 'Boutique');
    await userEvent.click(screen.getByRole('button', { name: 'Créer le Projet' }));

    expect(await screen.findByRole('heading', { name: 'Boutique' })).toBeTruthy();
    expect(screen.getByLabelText('Clé secrète').textContent).toBe('nk_sec_unique');
    expect(screen.getByLabelText('Clé publique').textContent).toBe('nk_pub_boutique');
    expect(api.appels.find((a) => a.route === 'POST /api/projets')?.corps).toEqual({
      nom: 'Boutique',
    });
  });

  it('ne montre plus la clé secrète en revenant sur le Projet', async () => {
    fakeApi({
      'GET /api/session': CONNECTE,
      'GET /api/projets/projet-1': { status: 200, body: BOUTIQUE },
    });

    renderDashboard('/projets/projet-1');

    expect(await screen.findByRole('heading', { name: 'Boutique' })).toBeTruthy();
    expect(screen.queryByLabelText('Clé secrète')).toBeNull();
  });

  it('régénère la clé secrète après confirmation et montre la nouvelle', async () => {
    const api = fakeApi({
      'GET /api/session': CONNECTE,
      'GET /api/projets/projet-1': { status: 200, body: BOUTIQUE },
      'POST /api/projets/projet-1/cle-secrete': {
        status: 201,
        body: { projet: BOUTIQUE, cleSecrete: 'nk_sec_nouvelle' },
      },
    });
    renderDashboard('/projets/projet-1');

    await userEvent.click(await screen.findByRole('button', { name: 'Régénérer la clé secrète' }));
    expect(api.appels.map((a) => a.route)).not.toContain('POST /api/projets/projet-1/cle-secrete');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmer' }));

    expect((await screen.findByLabelText('Clé secrète')).textContent).toBe('nk_sec_nouvelle');
  });

  it('enregistre les origines autorisées et affiche un refus de l’API', async () => {
    const api = fakeApi({
      'GET /api/session': CONNECTE,
      'GET /api/projets/projet-1': { status: 200, body: BOUTIQUE },
      'PATCH /api/projets/projet-1': {
        status: 400,
        body: {
          erreur: 'requete_invalide',
          details: [{ chemin: 'originesAutorisees.1', message: 'Origine invalide : pas-une-url' }],
        },
      },
    });
    renderDashboard('/projets/projet-1');

    await userEvent.type(
      await screen.findByLabelText('Une origine par ligne'),
      'https://app.exemple{Enter}pas-une-url',
    );
    await userEvent.click(
      screen.getAllByRole('button', { name: 'Enregistrer' }).at(-1) as HTMLElement,
    );

    expect((await screen.findByRole('alert')).textContent).toMatch(
      /Origine invalide : pas-une-url/,
    );
    expect(api.appels.find((a) => a.route === 'PATCH /api/projets/projet-1')?.corps).toEqual({
      originesAutorisees: ['https://app.exemple', 'pas-une-url'],
    });
  });

  it('affiche le texte d’un Projet comme du texte, jamais comme du HTML', async () => {
    fakeApi({
      'GET /api/session': CONNECTE,
      'GET /api/projets': {
        status: 200,
        body: [{ ...BOUTIQUE, description: '<img src=x onerror="alert(1)">' }],
      },
    });

    renderDashboard('/projets');

    expect(await screen.findByText('<img src=x onerror="alert(1)">')).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('Invitation', () => {
  it('crée le compte de la personne invitée et la connecte', async () => {
    const api = fakeApi({
      'GET /api/session': { status: 401, body: { erreur: 'session_requise' } },
      'GET /api/invitations/jeton-1': { status: 200, body: { expireLe: '2026-10-31T00:00:00Z' } },
      'POST /api/invitations/jeton-1/acceptation': {
        status: 201,
        body: { membre: { id: 'membre-2', email: 'bob@nudge.test' } },
      },
      'GET /api/projets': { status: 200, body: [] },
    });
    renderDashboard('/invitation/jeton-1');

    await userEvent.type(await screen.findByLabelText('Email'), 'bob@nudge.test');
    await userEvent.type(screen.getByLabelText('Mot de passe'), 'le mot de passe de bob');
    await userEvent.click(screen.getByRole('button', { name: 'Créer mon compte' }));

    expect(await screen.findByRole('heading', { name: 'Projets' })).toBeTruthy();
    expect(screen.getByText('bob@nudge.test')).toBeTruthy();
    expect(api.appels.map((a) => a.route)).toContain('POST /api/invitations/jeton-1/acceptation');
  });

  it('explique qu’un lien invalide ne sert plus', async () => {
    fakeApi({
      'GET /api/invitations/vieux': { status: 404, body: { erreur: 'invitation_invalide' } },
    });

    renderDashboard('/invitation/vieux');

    expect((await screen.findByRole('alert')).textContent).toMatch(
      /invalide, expiré ou déjà utilisé/,
    );
  });
});
