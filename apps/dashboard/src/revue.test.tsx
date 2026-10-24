import type { EnvoiVu, RetourDetailVu } from '@nudge/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CONNECTE, fakeApi } from './test/fake-api.js';
import { renderDashboard } from './test/render.js';

const LIVRE: EnvoiVu = {
  id: 'envoi-1',
  destination: { id: 'dest-1', nom: 'Linear produit', type: 'linear', etat: 'active' },
  statut: 'livre',
  lienExterne: 'https://linear.app/nudge/issue/NUD-1',
  tentatives: 1,
  derniereErreur: null,
  createdAt: '2026-10-24T09:00:01.000Z',
  updatedAt: '2026-10-24T09:00:02.000Z',
};

const RETOUR: RetourDetailVu = {
  id: 'retour-1',
  projet: { id: 'projet-1', nom: 'Boutique' },
  etat: 'dispatche',
  source: 'api',
  texte: 'Le paiement plante',
  typeDeclare: null,
  auteur: null,
  contexte: {},
  capture: null,
  verdict: {
    typeRetenu: 'bug',
    gravite: 'majeure',
    indesirable: false,
    manipulation: false,
    incertain: false,
  },
  envois: [LIVRE],
  createdAt: '2026-10-24T09:00:00.000Z',
};

const EN_REVUE: RetourDetailVu = {
  ...RETOUR,
  etat: 'en_revue',
  verdict: { ...RETOUR.verdict!, manipulation: true },
  envois: [],
};

const ECARTE: RetourDetailVu = {
  ...RETOUR,
  etat: 'ecarte',
  verdict: { ...RETOUR.verdict!, typeRetenu: 'avis', indesirable: true },
  envois: [],
};

const detail = (retour: RetourDetailVu) => ({ status: 200, body: retour });

describe('Revue d’un Retour', () => {
  it('valide un Retour En revue', async () => {
    const api = fakeApi({
      'GET /api/session': CONNECTE,
      'GET /api/retours/retour-1': detail(EN_REVUE),
      'POST /api/retours/retour-1/revue': detail({ ...EN_REVUE, etat: 'trie' }),
    });
    renderDashboard('/retours/retour-1');

    const revue = await screen.findByRole('region', { name: 'Revue' });
    expect(revue.textContent).toMatch(/Manipulation/);
    await userEvent.click(within(revue).getByRole('button', { name: 'Valider' }));

    expect(api.appels).toContainEqual({
      route: 'POST /api/retours/retour-1/revue',
      corps: { action: 'valider' },
    });
    expect(await screen.findByText('Trié')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Revue' })).toBeNull();
  });

  it('rejette un Retour En revue après confirmation', async () => {
    const api = fakeApi({
      'GET /api/session': CONNECTE,
      'GET /api/retours/retour-1': detail(EN_REVUE),
      'POST /api/retours/retour-1/revue': detail({ ...EN_REVUE, etat: 'ecarte' }),
    });
    renderDashboard('/retours/retour-1');

    const revue = await screen.findByRole('region', { name: 'Revue' });
    await userEvent.click(within(revue).getByRole('button', { name: 'Rejeter' }));
    expect(api.appels.map((a) => a.route)).not.toContain('POST /api/retours/retour-1/revue');
    await userEvent.click(within(revue).getByRole('button', { name: 'Confirmer' }));

    expect(api.appels).toContainEqual({
      route: 'POST /api/retours/retour-1/revue',
      corps: { action: 'rejeter' },
    });
    expect(await screen.findByText('Écarté')).toBeTruthy();
    // Rejeté après revue : il ne se réhabilite pas.
    expect(screen.queryByRole('region', { name: 'Revue' })).toBeNull();
  });

  it('réhabilite un Retour Écarté comme Indésirable', async () => {
    const api = fakeApi({
      'GET /api/session': CONNECTE,
      'GET /api/retours/retour-1': detail(ECARTE),
      'POST /api/retours/retour-1/revue': detail({ ...ECARTE, etat: 'trie' }),
    });
    renderDashboard('/retours/retour-1');

    const revue = await screen.findByRole('region', { name: 'Revue' });
    expect(within(revue).queryByRole('button', { name: 'Valider' })).toBeNull();
    await userEvent.click(within(revue).getByRole('button', { name: 'Réhabiliter' }));

    expect(api.appels).toContainEqual({
      route: 'POST /api/retours/retour-1/revue',
      corps: { action: 'rehabiliter' },
    });
    expect(await screen.findByText('Trié')).toBeTruthy();
  });

  it('n’offre aucune revue à un Retour dispatché', async () => {
    fakeApi({ 'GET /api/session': CONNECTE, 'GET /api/retours/retour-1': detail(RETOUR) });
    renderDashboard('/retours/retour-1');

    await screen.findByRole('region', { name: 'Verdict' });
    expect(screen.queryByRole('region', { name: 'Revue' })).toBeNull();
  });

  it('explique un refus : le Retour a changé entre-temps, et il est relu', async () => {
    const api = fakeApi({
      'GET /api/session': CONNECTE,
      'GET /api/retours/retour-1': detail(EN_REVUE),
      'POST /api/retours/retour-1/revue': {
        status: 409,
        body: { erreur: 'transition_refusee', etat: 'dispatche' },
      },
    });
    renderDashboard('/retours/retour-1');

    const revue = await screen.findByRole('region', { name: 'Revue' });
    await userEvent.click(within(revue).getByRole('button', { name: 'Valider' }));

    expect((await within(revue).findByRole('alert')).textContent).toMatch(/a changé entre-temps/);
    expect(
      api.appels.filter((a) => a.route === 'GET /api/retours/retour-1').length,
    ).toBeGreaterThan(1);
  });
});

describe('Correction du Verdict', () => {
  it('corrige le Type et la Gravité, et rappelle que les Destinations servies ne changent pas', async () => {
    const corrige = {
      ...RETOUR,
      verdict: { ...RETOUR.verdict!, typeRetenu: 'question', gravite: 'cosmetique' },
    } satisfies RetourDetailVu;
    const api = fakeApi({
      'GET /api/session': CONNECTE,
      'GET /api/retours/retour-1': detail({
        ...RETOUR,
        verdict: { ...RETOUR.verdict!, incertain: true },
      }),
      'PATCH /api/retours/retour-1/verdict': detail(corrige),
    });
    renderDashboard('/retours/retour-1');

    const verdict = await screen.findByRole('region', { name: 'Verdict' });
    await userEvent.click(within(verdict).getByRole('button', { name: 'Corriger' }));
    expect(verdict.textContent).toMatch(/rejouez un Envoi/);
    await userEvent.selectOptions(within(verdict).getByLabelText('Type retenu'), 'Question');
    await userEvent.selectOptions(within(verdict).getByLabelText('Gravité'), 'Cosmétique');
    await userEvent.click(within(verdict).getByRole('button', { name: 'Enregistrer' }));

    expect(api.appels).toContainEqual({
      route: 'PATCH /api/retours/retour-1/verdict',
      corps: { typeRetenu: 'question', gravite: 'cosmetique' },
    });
    expect(await within(verdict).findByText('Question')).toBeTruthy();
    expect(within(verdict).getByText('Cosmétique')).toBeTruthy();
    expect(within(verdict).queryByText('Incertain')).toBeNull();
    expect(within(verdict).queryByLabelText('Type retenu')).toBeNull();
  });

  it('ne propose pas de correction à un Retour pas encore trié', async () => {
    fakeApi({
      'GET /api/session': CONNECTE,
      'GET /api/retours/retour-1': detail({ ...RETOUR, etat: 'recu', verdict: null, envois: [] }),
    });
    renderDashboard('/retours/retour-1');

    const verdict = await screen.findByRole('region', { name: 'Verdict' });
    expect(within(verdict).queryByRole('button', { name: 'Corriger' })).toBeNull();
  });
});

describe('Rejeu d’un Envoi', () => {
  const ECHEC: EnvoiVu = {
    ...LIVRE,
    id: 'envoi-2',
    destination: { id: 'dest-2', nom: 'Webhook', type: 'webhook', etat: 'active' },
    statut: 'echec',
    lienExterne: null,
    tentatives: 3,
    derniereErreur: 'permanent: HTTP 422',
  };
  const EN_ATTENTE: EnvoiVu = {
    ...LIVRE,
    id: 'envoi-3',
    destination: { id: 'dest-3', nom: 'Discord', type: 'discord', etat: 'active' },
    statut: 'en_attente',
  };
  const RETENU: EnvoiVu = {
    ...LIVRE,
    id: 'envoi-4',
    destination: { id: 'dest-4', nom: 'Slack', type: 'slack', etat: 'suspendue' },
    statut: 'retenu',
  };

  it('rejoue un Envoi livré ou en échec, pas un Envoi en cours ou retenu, puis suit le nouvel essai', async () => {
    const api = fakeApi({
      'GET /api/session': CONNECTE,
      'GET /api/retours/retour-1': detail({
        ...RETOUR,
        envois: [LIVRE, ECHEC, EN_ATTENTE, RETENU],
      }),
    });
    api.set('POST /api/envois/envoi-2/rejeu', () => {
      api.set(
        'GET /api/retours/retour-1',
        detail({
          ...RETOUR,
          envois: [LIVRE, { ...ECHEC, statut: 'en_attente', derniereErreur: null }],
        }),
      );
      return { status: 202, body: { ...ECHEC, statut: 'en_attente', derniereErreur: null } };
    });
    renderDashboard('/retours/retour-1');

    const envois = await screen.findByRole('region', { name: 'Envois' });
    const [livre, echec, enAttente, retenu] = within(envois).getAllByRole('listitem') as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    expect(within(livre).getByRole('link', { name: /NUD-1/ })).toBeTruthy();
    expect(within(livre).getByRole('button', { name: 'Rejouer' })).toBeTruthy();
    expect(within(enAttente).queryByRole('button', { name: 'Rejouer' })).toBeNull();
    expect(within(retenu).queryByRole('button', { name: 'Rejouer' })).toBeNull();
    expect(echec.textContent).toMatch(/HTTP 422/);
    await userEvent.click(within(echec).getByRole('button', { name: 'Rejouer' }));

    expect(api.appels.map((a) => a.route)).toContain('POST /api/envois/envoi-2/rejeu');
    expect(await within(envois).findByText('En attente')).toBeTruthy();
    expect(envois.textContent).not.toMatch(/HTTP 422/);
  });

  it('explique un rejeu refusé', async () => {
    fakeApi({
      'GET /api/session': CONNECTE,
      'GET /api/retours/retour-1': detail({ ...RETOUR, envois: [ECHEC] }),
      'POST /api/envois/envoi-2/rejeu': {
        status: 409,
        body: { erreur: 'envoi_non_rejouable', statut: 'en_attente' },
      },
    });
    renderDashboard('/retours/retour-1');

    const envois = await screen.findByRole('region', { name: 'Envois' });
    await userEvent.click(within(envois).getByRole('button', { name: 'Rejouer' }));

    expect((await within(envois).findByRole('alert')).textContent).toMatch(/ne se rejoue pas/);
  });
});

describe('Redispatch d’un Retour', () => {
  const TRIE: RetourDetailVu = { ...RETOUR, etat: 'trie', envois: [] };

  it('crée les Envois manquants d’un Retour Trié et dit combien', async () => {
    const api = fakeApi({
      'GET /api/session': CONNECTE,
      'GET /api/retours/retour-1': detail(TRIE),
    });
    api.set('POST /api/retours/retour-1/redispatch', () => {
      const apres = { ...TRIE, etat: 'dispatche', envois: [{ ...LIVRE, statut: 'en_attente' }] };
      api.set('GET /api/retours/retour-1', detail(apres as RetourDetailVu));
      return { status: 200, body: { envoisCrees: 1, retour: apres } };
    });
    renderDashboard('/retours/retour-1');

    const envois = await screen.findByRole('region', { name: 'Envois' });
    expect(envois.textContent).toMatch(/Aucun Envoi/);
    await userEvent.click(within(envois).getByRole('button', { name: 'Redispatcher' }));

    expect(api.appels.map((a) => a.route)).toContain('POST /api/retours/retour-1/redispatch');
    expect(await within(envois).findByText('1 Envoi créé.')).toBeTruthy();
    expect(within(envois).getByText('Linear produit')).toBeTruthy();
    expect(await screen.findByText('Dispatché')).toBeTruthy();
  });

  it('dit quand aucune Destination de plus ne retient le Retour', async () => {
    fakeApi({
      'GET /api/session': CONNECTE,
      'GET /api/retours/retour-1': detail(RETOUR),
      'POST /api/retours/retour-1/redispatch': {
        status: 200,
        body: { envoisCrees: 0, retour: RETOUR },
      },
    });
    renderDashboard('/retours/retour-1');

    const envois = await screen.findByRole('region', { name: 'Envois' });
    await userEvent.click(within(envois).getByRole('button', { name: 'Redispatcher' }));

    expect(
      await within(envois).findByText(/Aucune autre Destination ne retient ce Retour/),
    ).toBeTruthy();
  });

  it.each([
    ['Reçu', { ...RETOUR, etat: 'recu', verdict: null, envois: [] }],
    ['Écarté', ECARTE],
    ['En revue', EN_REVUE],
  ] as const)('n’offre pas de redispatch à un Retour %s', async (_libelle, retour) => {
    fakeApi({ 'GET /api/session': CONNECTE, 'GET /api/retours/retour-1': detail(retour) });
    renderDashboard('/retours/retour-1');

    const envois = await screen.findByRole('region', { name: 'Envois' });
    expect(within(envois).queryByRole('button', { name: 'Redispatcher' })).toBeNull();
  });

  it('explique un redispatch refusé', async () => {
    fakeApi({
      'GET /api/session': CONNECTE,
      'GET /api/retours/retour-1': detail(TRIE),
      'POST /api/retours/retour-1/redispatch': {
        status: 409,
        body: { erreur: 'retour_non_redispatchable', etat: 'recu' },
      },
    });
    renderDashboard('/retours/retour-1');

    const envois = await screen.findByRole('region', { name: 'Envois' });
    await userEvent.click(within(envois).getByRole('button', { name: 'Redispatcher' }));

    expect((await within(envois).findByRole('alert')).textContent).toMatch(
      /ne peut pas être redispatché/,
    );
  });
});
