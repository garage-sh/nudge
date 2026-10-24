import type { JugeInstanceVu } from '@nudge/shared';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CONNECTE, fakeApi } from './test/fake-api.js';
import { renderDashboard } from './test/render.js';

const SANS_JUGE: JugeInstanceVu = {
  fournisseur: null,
  modele: null,
  urlBase: null,
  cleConfiguree: false,
};

const SANS_DESTINATION_ALERTE = { status: 200, body: { destination: null } };

const enregistre = (corps: unknown) => ({
  status: 200,
  body: { ...SANS_JUGE, ...(corps as object), cleConfiguree: true },
});

describe('Paramètres de l’Instance : Juge', () => {
  it('sans Juge choisi, annonce le mode dégradé', async () => {
    fakeApi({
      'GET /api/session': CONNECTE,
      'GET /api/instance/alerte': SANS_DESTINATION_ALERTE,
      'GET /api/instance/juge': { status: 200, body: SANS_JUGE },
    });
    renderDashboard('/parametres');

    expect(await screen.findByRole('heading', { name: 'Juge' })).toBeTruthy();
    expect(
      screen.getByRole('option', { name: 'Aucun (mode dégradé)', selected: true }),
    ).toBeTruthy();
    expect(screen.queryByLabelText('Clé API')).toBeNull();
  });

  it('choisit OpenRouter avec une clé, envoyée une fois et jamais réaffichée', async () => {
    const api = fakeApi({
      'GET /api/session': CONNECTE,
      'GET /api/instance/alerte': SANS_DESTINATION_ALERTE,
      'GET /api/instance/juge': { status: 200, body: SANS_JUGE },
      'PUT /api/instance/juge': enregistre,
    });
    renderDashboard('/parametres');

    await userEvent.selectOptions(await screen.findByLabelText('Fournisseur'), 'openrouter');
    const cle = screen.getByLabelText('Clé API') as HTMLInputElement;
    expect(cle.type).toBe('password');
    expect(screen.getByLabelText('Modèle').getAttribute('placeholder')).toBe(
      'perplexity/pplx-decider-v1.2',
    );
    await userEvent.type(cle, 'sk-or-v1-secret');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByText(/Enregistré/)).toBeTruthy();
    expect(api.appels.find((a) => a.route === 'PUT /api/instance/juge')?.corps).toEqual({
      fournisseur: 'openrouter',
      modele: null,
      urlBase: null,
      cleApi: 'sk-or-v1-secret',
    });
    expect((screen.getByLabelText('Clé API') as HTMLInputElement).value).toBe('');
    expect(screen.getByText(/Une clé est enregistrée/)).toBeTruthy();
  });

  it('garde la clé enregistrée quand le champ reste vide', async () => {
    const api = fakeApi({
      'GET /api/session': CONNECTE,
      'GET /api/instance/alerte': SANS_DESTINATION_ALERTE,
      'GET /api/instance/juge': {
        status: 200,
        body: { ...SANS_JUGE, fournisseur: 'typesafe', cleConfiguree: true },
      },
      'PUT /api/instance/juge': enregistre,
    });
    renderDashboard('/parametres');

    await userEvent.type(await screen.findByLabelText('Modèle'), 'jev-1.14.0');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await screen.findByText(/Enregistré/);
    expect(api.appels.find((a) => a.route === 'PUT /api/instance/juge')?.corps).toEqual({
      fournisseur: 'typesafe',
      modele: 'jev-1.14.0',
      urlBase: null,
    });
  });

  it('auto-hébergé : envoie l’URL du serveur, et affiche un refus de l’API', async () => {
    const api = fakeApi({
      'GET /api/session': CONNECTE,
      'GET /api/instance/alerte': SANS_DESTINATION_ALERTE,
      'GET /api/instance/juge': { status: 200, body: SANS_JUGE },
      'PUT /api/instance/juge': {
        status: 400,
        body: {
          erreur: 'requete_invalide',
          details: [{ chemin: 'urlBase', message: 'URL http(s) attendue' }],
        },
      },
    });
    renderDashboard('/parametres');

    await userEvent.selectOptions(await screen.findByLabelText('Fournisseur'), 'auto_heberge');
    const url = screen.getByLabelText('URL du serveur') as HTMLInputElement;
    expect(url.required).toBe(true);
    await userEvent.type(url, 'http://decider:8080');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/URL http\(s\) attendue/);
    expect(api.appels.find((a) => a.route === 'PUT /api/instance/juge')?.corps).toEqual({
      fournisseur: 'auto_heberge',
      modele: null,
      urlBase: 'http://decider:8080',
    });
  });

  it('revient au mode dégradé en retirant le Juge', async () => {
    const api = fakeApi({
      'GET /api/session': CONNECTE,
      'GET /api/instance/alerte': SANS_DESTINATION_ALERTE,
      'GET /api/instance/juge': {
        status: 200,
        body: { ...SANS_JUGE, fournisseur: 'typesafe', cleConfiguree: true },
      },
      'PUT /api/instance/juge': { status: 200, body: SANS_JUGE },
    });
    renderDashboard('/parametres');

    await userEvent.selectOptions(await screen.findByLabelText('Fournisseur'), '');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await screen.findByText(/Enregistré/);
    expect(api.appels.find((a) => a.route === 'PUT /api/instance/juge')?.corps).toEqual({
      fournisseur: null,
    });
  });
});
