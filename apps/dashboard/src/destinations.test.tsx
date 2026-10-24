import type { DestinationVu, ProjetVu } from '@nudge/shared';
import { screen, within } from '@testing-library/react';
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

const RECEPTEUR: DestinationVu = {
  id: 'destination-1',
  projetId: 'projet-1',
  nom: 'Récepteur interne',
  type: 'webhook',
  config: { url: 'https://recepteur.test/nudge' },
  filtre: { types: ['bug', 'question'], graviteMinimale: 'majeure' },
  etat: 'active',
  secrets: ['secretSignature'],
  createdAt: '2026-10-24T08:10:00.000Z',
};

const routesDeBase = (destinations: DestinationVu[] = [RECEPTEUR]) => ({
  'GET /api/session': CONNECTE,
  'GET /api/projets/projet-1': { status: 200, body: BOUTIQUE },
  'GET /api/projets/projet-1/destinations': { status: 200, body: destinations },
});

const carte = async (nom: string) =>
  within((await screen.findByRole('heading', { name: nom })).closest('article') as HTMLElement);

describe('Destinations d’un Projet', () => {
  it('s’ouvre depuis le Projet', async () => {
    fakeApi(routesDeBase());
    renderDashboard('/projets/projet-1');

    await userEvent.click(await screen.findByRole('link', { name: 'Destinations' }));

    expect(await screen.findByRole('heading', { name: 'Destinations de Boutique' })).toBeTruthy();
  });

  it('liste les Destinations avec leur type, leur état et leur Filtre', async () => {
    fakeApi(routesDeBase());
    renderDashboard('/projets/projet-1/destinations');

    const recepteur = await carte('Récepteur interne');
    expect(recepteur.getByText('Webhook')).toBeTruthy();
    expect(recepteur.getByText('Active')).toBeTruthy();
    expect(recepteur.getByText('https://recepteur.test/nudge')).toBeTruthy();
    expect(recepteur.getByText('Bug, Question · Gravité Majeure ou plus')).toBeTruthy();
  });

  it('annonce un Projet sans Destination', async () => {
    fakeApi(routesDeBase([]));
    renderDashboard('/projets/projet-1/destinations');

    expect(await screen.findByText(/Aucune Destination/)).toBeTruthy();
  });

  it('ajoute un webhook et montre son secret de signature une seule fois', async () => {
    const api = fakeApi({
      ...routesDeBase([]),
      'POST /api/projets/projet-1/destinations': {
        status: 201,
        body: { destination: RECEPTEUR, secretsGeneres: { secretSignature: 'whsec-unique' } },
      },
    });
    renderDashboard('/projets/projet-1/destinations');

    const formulaire = within(
      (await screen.findByRole('heading', { name: 'Ajouter une Destination' })).closest(
        'form',
      ) as HTMLElement,
    );
    expect(
      (formulaire.getByRole('option', { name: 'Webhook' }) as HTMLOptionElement).selected,
    ).toBe(true);
    await userEvent.type(formulaire.getByLabelText('Nom'), 'Récepteur interne');
    await userEvent.type(formulaire.getByLabelText('URL'), 'https://recepteur.test/nudge');
    await userEvent.click(formulaire.getByLabelText('Suggestion'));
    await userEvent.click(formulaire.getByLabelText('Avis'));
    await userEvent.selectOptions(formulaire.getByLabelText('Gravité minimale'), 'majeure');
    await userEvent.click(formulaire.getByRole('button', { name: 'Ajouter' }));

    expect((await screen.findByLabelText('Secret de signature')).textContent).toBe('whsec-unique');
    expect(screen.getByText(/ne sera plus jamais affiché/)).toBeTruthy();
    expect(
      api.appels.find((a) => a.route === 'POST /api/projets/projet-1/destinations')?.corps,
    ).toEqual({
      type: 'webhook',
      nom: 'Récepteur interne',
      config: { url: 'https://recepteur.test/nudge' },
      filtre: { types: ['bug', 'question'], graviteMinimale: 'majeure' },
    });
  });

  it('affiche le refus de l’API à l’ajout', async () => {
    fakeApi({
      ...routesDeBase([]),
      'POST /api/projets/projet-1/destinations': {
        status: 400,
        body: {
          erreur: 'requete_invalide',
          details: [{ chemin: 'config.url', message: 'URL http(s) attendue, sans identifiants' }],
        },
      },
    });
    renderDashboard('/projets/projet-1/destinations');

    await userEvent.type(await screen.findByLabelText('Nom'), 'Récepteur');
    await userEvent.type(screen.getByLabelText('URL'), 'ftp://recepteur.test');
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/URL http\(s\) attendue/);
  });

  it('modifie le Filtre d’une Destination', async () => {
    const api = fakeApi({
      ...routesDeBase(),
      'PATCH /api/destinations/destination-1': (corps) => ({
        status: 200,
        body: { ...RECEPTEUR, ...(corps as object) },
      }),
    });
    renderDashboard('/projets/projet-1/destinations');

    await userEvent.click(
      (await carte('Récepteur interne')).getByRole('button', { name: 'Modifier' }),
    );
    const formulaire = within(screen.getByRole('form', { name: 'Modifier Récepteur interne' }));
    expect((formulaire.getByLabelText('URL') as HTMLInputElement).value).toBe(
      'https://recepteur.test/nudge',
    );
    await userEvent.click(formulaire.getByLabelText('Question'));
    await userEvent.selectOptions(formulaire.getByLabelText('Gravité minimale'), '');
    await userEvent.click(formulaire.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByText('Bug · toute Gravité')).toBeTruthy();
    expect(
      api.appels.find((a) => a.route === 'PATCH /api/destinations/destination-1')?.corps,
    ).toEqual({
      nom: 'Récepteur interne',
      config: { url: 'https://recepteur.test/nudge' },
      filtre: { types: ['bug'], graviteMinimale: null },
    });
  });

  it('teste une Destination et montre le résultat', async () => {
    const api = fakeApi({
      ...routesDeBase(),
      'POST /api/destinations/destination-1/test': {
        status: 200,
        body: { statut: 'echec', classe: 'auth', message: 'HTTP 401 : signature inconnue' },
      },
    });
    renderDashboard('/projets/projet-1/destinations');

    const recepteur = await carte('Récepteur interne');
    await userEvent.click(recepteur.getByRole('button', { name: 'Tester' }));

    expect((await recepteur.findByRole('status')).textContent).toBe(
      'Échec (identifiants refusés) : HTTP 401 : signature inconnue',
    );

    api.set('POST /api/destinations/destination-1/test', {
      status: 200,
      body: { statut: 'livre', lienExterne: null },
    });
    await userEvent.click(recepteur.getByRole('button', { name: 'Tester' }));
    expect((await recepteur.findByRole('status')).textContent).toBe('Retour d’exemple livré.');
  });

  it('régénère le secret de signature après confirmation', async () => {
    fakeApi({
      ...routesDeBase(),
      'POST /api/destinations/destination-1/secrets-generes': {
        status: 201,
        body: { destination: RECEPTEUR, secretsGeneres: { secretSignature: 'whsec-nouveau' } },
      },
    });
    renderDashboard('/projets/projet-1/destinations');

    const recepteur = await carte('Récepteur interne');
    await userEvent.click(
      recepteur.getByRole('button', { name: 'Régénérer le secret de signature' }),
    );
    await userEvent.click(recepteur.getByRole('button', { name: 'Confirmer' }));

    expect((await screen.findByLabelText('Secret de signature')).textContent).toBe('whsec-nouveau');
  });

  it('supprime une Destination après confirmation', async () => {
    const api = fakeApi({
      ...routesDeBase(),
      'DELETE /api/destinations/destination-1': { status: 204 },
    });
    renderDashboard('/projets/projet-1/destinations');

    const recepteur = await carte('Récepteur interne');
    await userEvent.click(recepteur.getByRole('button', { name: 'Supprimer' }));
    expect(api.appels.map((a) => a.route)).not.toContain('DELETE /api/destinations/destination-1');
    api.set('GET /api/projets/projet-1/destinations', { status: 200, body: [] });
    await userEvent.click(recepteur.getByRole('button', { name: 'Confirmer' }));

    expect(await screen.findByText(/Aucune Destination/)).toBeTruthy();
    expect(api.appels.map((a) => a.route)).toContain('DELETE /api/destinations/destination-1');
  });

  it('affiche le nom et l’URL comme du texte, jamais comme du HTML', async () => {
    fakeApi(
      routesDeBase([
        {
          ...RECEPTEUR,
          nom: '<img src=x onerror="alert(1)">',
          config: { url: 'javascript:alert(1)' },
        },
      ]),
    );
    renderDashboard('/projets/projet-1/destinations');

    expect(await screen.findByText('<img src=x onerror="alert(1)">')).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('a[href^="javascript"]')).toBeNull();
  });
});
