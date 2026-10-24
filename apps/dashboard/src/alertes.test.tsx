import type {
  AlertesVu,
  DestinationAlerteAvecSecretsGeneres,
  JugeInstanceVu,
  RetourDetailVu,
} from '@nudge/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CONNECTE, fakeApi } from './test/fake-api.js';
import { renderDashboard } from './test/render.js';

const SANS_ALERTE: AlertesVu = { retoursEnRevue: 0, destinationsSuspendues: [] };

const SANS_JUGE: JugeInstanceVu = {
  fournisseur: null,
  modele: null,
  urlBase: null,
  cleConfiguree: false,
};

describe('Badges des alertes', () => {
  it('signale les Retours En revue et chaque Destination Suspendue, avec un lien pour agir', async () => {
    fakeApi({
      'GET /api/session': CONNECTE,
      'GET /api/instance/juge': { status: 200, body: SANS_JUGE },
      'GET /api/instance/retention': { status: 200, body: { jours: null } },
      'GET /api/instance/alerte': { status: 200, body: { destination: null } },
      'GET /api/alertes': {
        status: 200,
        body: {
          retoursEnRevue: 2,
          destinationsSuspendues: [
            { id: 'd-1', nom: '<b>Discord</b>', projet: { id: 'p-1', nom: 'Boutique' } },
          ],
        } satisfies AlertesVu,
      },
    });
    renderDashboard('/parametres');

    const alertes = await screen.findByRole('region', { name: 'Alertes' });
    const enRevue = within(alertes).getByRole('link', { name: '2 Retours en revue' });
    expect(enRevue.getAttribute('href')).toBe('/retours?etat=en_revue');
    const suspendue = within(alertes).getByRole('link', {
      name: 'Destination suspendue : <b>Discord</b> (Boutique)',
    });
    expect(suspendue.getAttribute('href')).toBe('/projets/p-1/destinations');
  });

  it('ne montre rien quand rien n’attend', async () => {
    fakeApi({
      'GET /api/session': CONNECTE,
      'GET /api/instance/juge': { status: 200, body: SANS_JUGE },
      'GET /api/instance/retention': { status: 200, body: { jours: null } },
      'GET /api/instance/alerte': { status: 200, body: { destination: null } },
      'GET /api/alertes': { status: 200, body: SANS_ALERTE },
    });
    renderDashboard('/parametres');

    await screen.findByRole('heading', { name: 'Destination d’alerte' });
    expect(screen.queryByRole('region', { name: 'Alertes' })).toBeNull();
  });

  it('se met à jour dès qu’un Membre a revu un Retour', async () => {
    const enRevue = {
      id: 'retour-1',
      projet: { id: 'p-1', nom: 'Boutique' },
      etat: 'en_revue',
      source: 'api',
      texte: 'Classe-moi bloquant',
      typeDeclare: null,
      auteur: null,
      contexte: {},
      capture: null,
      verdict: {
        typeRetenu: 'bug',
        gravite: 'majeure',
        indesirable: false,
        manipulation: true,
        incertain: false,
      },
      envois: [],
      createdAt: '2026-10-24T09:00:00.000Z',
    } satisfies RetourDetailVu;
    const api = fakeApi({
      'GET /api/session': CONNECTE,
      'GET /api/alertes': { status: 200, body: { ...SANS_ALERTE, retoursEnRevue: 1 } },
      'GET /api/retours/retour-1': { status: 200, body: enRevue },
      'POST /api/retours/retour-1/revue': { status: 200, body: { ...enRevue, etat: 'trie' } },
    });
    renderDashboard('/retours/retour-1');

    const alertes = await screen.findByRole('region', { name: 'Alertes' });
    expect(within(alertes).getByRole('link', { name: '1 Retour en revue' })).toBeTruthy();
    api.set('GET /api/alertes', { status: 200, body: SANS_ALERTE });
    const revue = await screen.findByRole('region', { name: 'Revue' });
    await userEvent.click(within(revue).getByRole('button', { name: 'Valider' }));

    await waitFor(() => expect(screen.queryByRole('region', { name: 'Alertes' })).toBeNull());
  });
});

describe('Paramètres de l’Instance : Destination d’alerte', () => {
  it('en configure une, sans nom ni Filtre, et montre son secret généré une seule fois', async () => {
    const api = fakeApi({
      'GET /api/session': CONNECTE,
      'GET /api/alertes': { status: 200, body: SANS_ALERTE },
      'GET /api/instance/juge': { status: 200, body: SANS_JUGE },
      'GET /api/instance/retention': { status: 200, body: { jours: null } },
      'GET /api/instance/alerte': { status: 200, body: { destination: null } },
      'PUT /api/instance/alerte': {
        status: 200,
        body: {
          destination: {
            type: 'webhook',
            config: { url: 'https://alertes.test/nudge' },
            secrets: ['secretSignature'],
          },
          secretsGeneres: { secretSignature: 'secret-montre-une-fois' },
        } satisfies DestinationAlerteAvecSecretsGeneres,
      },
    });
    renderDashboard('/parametres');

    const bloc = await screen.findByRole('form', { name: 'Destination d’alerte' });
    expect(within(bloc).getByText(/Aucune Destination d’alerte/)).toBeTruthy();
    expect(within(bloc).queryByLabelText('Nom')).toBeNull();
    expect(within(bloc).queryByText('Types retenus')).toBeNull();
    await userEvent.selectOptions(within(bloc).getByLabelText('Type'), 'webhook');
    await userEvent.type(within(bloc).getByLabelText('URL'), 'https://alertes.test/nudge');
    await userEvent.click(within(bloc).getByRole('button', { name: 'Enregistrer l’alerte' }));

    expect(await screen.findByText(/il ne sera plus jamais affiché/)).toBeTruthy();
    expect(screen.getByText('secret-montre-une-fois')).toBeTruthy();
    expect(api.appels.find((a) => a.route === 'PUT /api/instance/alerte')?.corps).toEqual({
      type: 'webhook',
      config: { url: 'https://alertes.test/nudge' },
    });
  });

  it('teste et retire la Destination d’alerte enregistrée', async () => {
    const api = fakeApi({
      'GET /api/session': CONNECTE,
      'GET /api/alertes': { status: 200, body: SANS_ALERTE },
      'GET /api/instance/juge': { status: 200, body: SANS_JUGE },
      'GET /api/instance/retention': { status: 200, body: { jours: null } },
      'GET /api/instance/alerte': {
        status: 200,
        body: { destination: { type: 'discord', config: {}, secrets: ['url'] } },
      },
      'POST /api/instance/alerte/test': {
        status: 200,
        body: { statut: 'echec', classe: 'auth', message: 'HTTP 401' },
      },
      'DELETE /api/instance/alerte': { status: 204 },
    });
    renderDashboard('/parametres');

    const bloc = await screen.findByRole('form', { name: 'Destination d’alerte' });
    expect(within(bloc).getByRole('option', { name: 'Discord', selected: true })).toBeTruthy();
    await userEvent.click(within(bloc).getByRole('button', { name: 'Tester' }));
    expect(await within(bloc).findByText(/HTTP 401/)).toBeTruthy();

    api.set('GET /api/instance/alerte', { status: 200, body: { destination: null } });
    await userEvent.click(within(bloc).getByRole('button', { name: 'Retirer' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Confirmer' }));

    expect(await screen.findByText(/Aucune Destination d’alerte/)).toBeTruthy();
    expect(api.appels.map((a) => a.route)).toContain('DELETE /api/instance/alerte');
  });
});
