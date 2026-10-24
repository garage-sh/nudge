import type { DestinationVu, ProjetVu } from '@nudge/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
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

  it('ajoute un salon Discord : l’URL du webhook part comme un secret', async () => {
    const SALON: DestinationVu = {
      ...RECEPTEUR,
      nom: 'Salon #bugs',
      type: 'discord',
      config: {},
      secrets: ['url'],
    };
    const URL_WEBHOOK = 'https://discord.com/api/webhooks/223704706495545344/jeton-du-salon';
    const api = fakeApi({
      ...routesDeBase([]),
      'POST /api/projets/projet-1/destinations': {
        status: 201,
        body: { destination: SALON, secretsGeneres: {} },
      },
    });
    renderDashboard('/projets/projet-1/destinations');

    const formulaire = within(
      (await screen.findByRole('heading', { name: 'Ajouter une Destination' })).closest(
        'form',
      ) as HTMLElement,
    );
    await userEvent.selectOptions(formulaire.getByLabelText('Type'), 'Discord');
    await userEvent.type(formulaire.getByLabelText('Nom'), 'Salon #bugs');
    const champUrl = formulaire.getByLabelText('URL du webhook') as HTMLInputElement;
    expect(champUrl.type).toBe('password');
    await userEvent.type(champUrl, URL_WEBHOOK);
    await userEvent.click(formulaire.getByRole('button', { name: 'Ajouter' }));

    await vi.waitFor(() =>
      expect(
        api.appels.find((a) => a.route === 'POST /api/projets/projet-1/destinations')?.corps,
      ).toEqual({
        type: 'discord',
        nom: 'Salon #bugs',
        config: {},
        secrets: { url: URL_WEBHOOK },
        filtre: { types: ['bug', 'suggestion', 'avis', 'question'], graviteMinimale: null },
      }),
    );
  });

  it('modifie un salon Discord sans ressaisir l’URL enregistrée', async () => {
    const SALON: DestinationVu = {
      ...RECEPTEUR,
      nom: 'Salon #bugs',
      type: 'discord',
      config: {},
      secrets: ['url'],
    };
    const api = fakeApi({
      ...routesDeBase([SALON]),
      'PATCH /api/destinations/destination-1': { status: 200, body: SALON },
    });
    renderDashboard('/projets/projet-1/destinations');

    const salon = await carte('Salon #bugs');
    expect(salon.getByText('Discord')).toBeTruthy();
    await userEvent.click(salon.getByRole('button', { name: 'Modifier' }));
    const formulaire = within(screen.getByRole('form', { name: 'Modifier Salon #bugs' }));
    const champUrl = formulaire.getByLabelText('URL du webhook') as HTMLInputElement;
    expect(champUrl.value).toBe('');
    expect(champUrl.required).toBe(false);
    expect(formulaire.getByText(/enregistrée \(chiffrée\)/)).toBeTruthy();
    await userEvent.click(formulaire.getByRole('button', { name: 'Enregistrer' }));

    await vi.waitFor(() =>
      expect(
        api.appels.find((a) => a.route === 'PATCH /api/destinations/destination-1')?.corps,
      ).not.toHaveProperty('secrets'),
    );
  });

  it('ajoute un canal Slack : l’URL du webhook entrant part comme un secret', async () => {
    const CANAL: DestinationVu = {
      ...RECEPTEUR,
      nom: 'Canal #bugs',
      type: 'slack',
      config: {},
      secrets: ['url'],
    };
    const URL_WEBHOOK = 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXX';
    const api = fakeApi({
      ...routesDeBase([]),
      'POST /api/projets/projet-1/destinations': {
        status: 201,
        body: { destination: CANAL, secretsGeneres: {} },
      },
    });
    renderDashboard('/projets/projet-1/destinations');

    const formulaire = within(
      (await screen.findByRole('heading', { name: 'Ajouter une Destination' })).closest(
        'form',
      ) as HTMLElement,
    );
    await userEvent.selectOptions(formulaire.getByLabelText('Type'), 'Slack');
    await userEvent.type(formulaire.getByLabelText('Nom'), 'Canal #bugs');
    const champUrl = formulaire.getByLabelText('URL du webhook') as HTMLInputElement;
    expect(champUrl.type).toBe('password');
    expect(champUrl.placeholder).toBe('https://hooks.slack.com/services/…');
    await userEvent.type(champUrl, URL_WEBHOOK);
    await userEvent.click(formulaire.getByRole('button', { name: 'Ajouter' }));

    await vi.waitFor(() =>
      expect(
        api.appels.find((a) => a.route === 'POST /api/projets/projet-1/destinations')?.corps,
      ).toEqual({
        type: 'slack',
        nom: 'Canal #bugs',
        config: {},
        secrets: { url: URL_WEBHOOK },
        filtre: { types: ['bug', 'suggestion', 'avis', 'question'], graviteMinimale: null },
      }),
    );
  });

  it('ajoute un dépôt GitHub : jeton en secret, dépôt en configuration', async () => {
    const DEPOT: DestinationVu = {
      ...RECEPTEUR,
      nom: 'Issues boutique-web',
      type: 'github',
      config: { depot: 'boutique-sa/boutique-web' },
      secrets: ['jeton'],
    };
    const api = fakeApi({
      ...routesDeBase([]),
      'POST /api/projets/projet-1/destinations': {
        status: 201,
        body: { destination: DEPOT, secretsGeneres: {} },
      },
    });
    renderDashboard('/projets/projet-1/destinations');

    const formulaire = within(
      (await screen.findByRole('heading', { name: 'Ajouter une Destination' })).closest(
        'form',
      ) as HTMLElement,
    );
    await userEvent.selectOptions(formulaire.getByLabelText('Type'), 'GitHub Issues');
    await userEvent.type(formulaire.getByLabelText('Nom'), 'Issues boutique-web');
    const champJeton = formulaire.getByLabelText('Jeton d’accès') as HTMLInputElement;
    expect(champJeton.type).toBe('password');
    await userEvent.type(champJeton, 'github_pat_secret');
    await userEvent.type(formulaire.getByLabelText('Dépôt'), 'boutique-sa/boutique-web');
    await userEvent.click(formulaire.getByRole('button', { name: 'Ajouter' }));

    await vi.waitFor(() =>
      expect(
        api.appels.find((a) => a.route === 'POST /api/projets/projet-1/destinations')?.corps,
      ).toEqual({
        type: 'github',
        nom: 'Issues boutique-web',
        config: { depot: 'boutique-sa/boutique-web' },
        secrets: { jeton: 'github_pat_secret' },
        filtre: { types: ['bug', 'suggestion', 'avis', 'question'], graviteMinimale: null },
      }),
    );
  });

  it('modifie un dépôt GitHub sans ressaisir le jeton enregistré', async () => {
    const DEPOT: DestinationVu = {
      ...RECEPTEUR,
      nom: 'Issues boutique-web',
      type: 'github',
      config: { depot: 'boutique-sa/boutique-web' },
      secrets: ['jeton'],
    };
    const api = fakeApi({
      ...routesDeBase([DEPOT]),
      'PATCH /api/destinations/destination-1': { status: 200, body: DEPOT },
    });
    renderDashboard('/projets/projet-1/destinations');

    const carteDepot = await carte('Issues boutique-web');
    expect(carteDepot.getByText('GitHub Issues')).toBeTruthy();
    expect(carteDepot.getByText('Dépôt boutique-sa/boutique-web')).toBeTruthy();
    await userEvent.click(carteDepot.getByRole('button', { name: 'Modifier' }));
    const formulaire = within(screen.getByRole('form', { name: 'Modifier Issues boutique-web' }));
    const champJeton = formulaire.getByLabelText('Jeton d’accès') as HTMLInputElement;
    expect(champJeton.value).toBe('');
    expect(champJeton.required).toBe(false);
    await userEvent.clear(formulaire.getByLabelText('Dépôt'));
    await userEvent.type(formulaire.getByLabelText('Dépôt'), 'boutique-sa/api');
    await userEvent.click(formulaire.getByRole('button', { name: 'Enregistrer' }));

    await vi.waitFor(() => {
      const corps = api.appels.find((a) => a.route === 'PATCH /api/destinations/destination-1')
        ?.corps as Record<string, unknown> | undefined;
      expect(corps).not.toHaveProperty('secrets');
      expect(corps?.config).toEqual({ depot: 'boutique-sa/api' });
    });
  });

  it('ajoute une équipe Linear : clé d’API en secret, équipe et labels du Type et de la Gravité', async () => {
    const EQUIPE: DestinationVu = {
      ...RECEPTEUR,
      nom: 'Linear ENG',
      type: 'linear',
      config: {
        equipe: 'ENG',
        labels: { types: { bug: 'Bug' }, gravites: { bloquante: 'Urgent' } },
      },
      secrets: ['cleApi'],
    };
    const api = fakeApi({
      ...routesDeBase([]),
      'POST /api/projets/projet-1/destinations': {
        status: 201,
        body: { destination: EQUIPE, secretsGeneres: {} },
      },
    });
    renderDashboard('/projets/projet-1/destinations');

    const formulaire = within(
      (await screen.findByRole('heading', { name: 'Ajouter une Destination' })).closest(
        'form',
      ) as HTMLElement,
    );
    await userEvent.selectOptions(formulaire.getByLabelText('Type'), 'Linear');
    await userEvent.type(formulaire.getByLabelText('Nom'), 'Linear ENG');
    const champCle = formulaire.getByLabelText('Clé d’API') as HTMLInputElement;
    expect(champCle.type).toBe('password');
    await userEvent.type(champCle, 'lin_api_secret');
    await userEvent.type(formulaire.getByLabelText('Équipe'), 'ENG');
    await userEvent.type(formulaire.getByLabelText('Label du Type Bug'), 'Bug');
    await userEvent.type(formulaire.getByLabelText('Label du Type Avis'), 'x');
    await userEvent.clear(formulaire.getByLabelText('Label du Type Avis'));
    await userEvent.type(formulaire.getByLabelText('Label de la Gravité Bloquante'), 'Urgent');
    await userEvent.click(formulaire.getByRole('button', { name: 'Ajouter' }));

    await vi.waitFor(() =>
      expect(
        api.appels.find((a) => a.route === 'POST /api/projets/projet-1/destinations')?.corps,
      ).toEqual({
        type: 'linear',
        nom: 'Linear ENG',
        config: {
          equipe: 'ENG',
          labels: { types: { bug: 'Bug' }, gravites: { bloquante: 'Urgent' } },
        },
        secrets: { cleApi: 'lin_api_secret' },
        filtre: { types: ['bug', 'suggestion', 'avis', 'question'], graviteMinimale: null },
      }),
    );
  });

  it('modifie une équipe Linear sans ressaisir la clé d’API, labels repris', async () => {
    const EQUIPE: DestinationVu = {
      ...RECEPTEUR,
      nom: 'Linear ENG',
      type: 'linear',
      config: { equipe: 'ENG', labels: { types: { bug: 'Bug' }, gravites: {} } },
      secrets: ['cleApi'],
    };
    const api = fakeApi({
      ...routesDeBase([EQUIPE]),
      'PATCH /api/destinations/destination-1': { status: 200, body: EQUIPE },
    });
    renderDashboard('/projets/projet-1/destinations');

    const carteEquipe = await carte('Linear ENG');
    expect(carteEquipe.getByText('Linear')).toBeTruthy();
    expect(carteEquipe.getByText('Équipe ENG')).toBeTruthy();
    await userEvent.click(carteEquipe.getByRole('button', { name: 'Modifier' }));
    const formulaire = within(screen.getByRole('form', { name: 'Modifier Linear ENG' }));
    const champCle = formulaire.getByLabelText('Clé d’API') as HTMLInputElement;
    expect(champCle.value).toBe('');
    expect(champCle.required).toBe(false);
    expect((formulaire.getByLabelText('Label du Type Bug') as HTMLInputElement).value).toBe('Bug');
    await userEvent.clear(formulaire.getByLabelText('Label du Type Bug'));
    await userEvent.click(formulaire.getByRole('button', { name: 'Enregistrer' }));

    await vi.waitFor(() => {
      const corps = api.appels.find((a) => a.route === 'PATCH /api/destinations/destination-1')
        ?.corps as Record<string, unknown> | undefined;
      expect(corps).not.toHaveProperty('secrets');
      expect(corps?.config).toEqual({ equipe: 'ENG', labels: { types: {}, gravites: {} } });
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
