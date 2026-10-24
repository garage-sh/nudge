import type { PageRetours, ProjetVu, RetourDetailVu, RetourResumeVu } from '@nudge/shared';
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

const RETOUR: RetourResumeVu = {
  id: 'retour-1',
  projet: { id: 'projet-1', nom: 'Boutique' },
  etat: 'dispatche',
  source: 'api',
  apercu: 'Le paiement plante',
  typeDeclare: null,
  verdict: {
    typeRetenu: 'bug',
    gravite: 'bloquante',
    indesirable: false,
    manipulation: false,
    incertain: false,
  },
  createdAt: '2026-10-24T09:00:00.000Z',
};

const page = (retours: RetourResumeVu[], suivant: string | null = null) => ({
  status: 200,
  body: { retours, suivant } satisfies PageRetours,
});

const PROJETS = { status: 200, body: [BOUTIQUE] };

describe('Boîte de réception', () => {
  it('est l’écran d’accueil et liste les Retours avec leur Verdict, Incertains repérables', async () => {
    fakeApi({
      'GET /api/session': CONNECTE,
      'GET /api/projets': PROJETS,
      'GET /api/retours': page([
        RETOUR,
        {
          ...RETOUR,
          id: 'retour-2',
          apercu: 'Bonjour',
          etat: 'trie',
          verdict: { ...RETOUR.verdict!, typeRetenu: 'avis', gravite: null, incertain: true },
        },
        { ...RETOUR, id: 'retour-3', apercu: 'Tout juste arrivé', etat: 'recu', verdict: null },
      ]),
    });

    renderDashboard('/');

    expect(await screen.findByRole('heading', { name: 'Boîte de réception' })).toBeTruthy();
    await screen.findByText('Le paiement plante');
    const [bug, incertain, recu] = screen
      .getAllByRole('listitem')
      .filter((li) => li.querySelector('a[href^="/retours/"]')) as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    expect(within(bug).getByRole('link', { name: 'Le paiement plante' })).toHaveProperty(
      'pathname',
      '/retours/retour-1',
    );
    expect(bug.textContent).toMatch(/Boutique/);
    expect(bug.textContent).toMatch(/Bug/);
    expect(bug.textContent).toMatch(/Bloquante/);
    expect(bug.textContent).toMatch(/Dispatché/);
    expect(bug.textContent).not.toMatch(/Incertain/);
    expect(within(incertain).getByText('Incertain')).toBeTruthy();
    expect(recu.textContent).toMatch(/Reçu/);
    expect(recu.textContent).toMatch(/Non trié/);
  });

  it('filtre par Projet, Type, Gravité, état, Source et Verdict Incertain', async () => {
    const base = 'GET /api/retours?projet=projet-1&type=bug&gravite=bloquante&etat=dispatche';
    const api = fakeApi({
      'GET /api/session': CONNECTE,
      'GET /api/projets': PROJETS,
      'GET /api/retours': page([RETOUR]),
      'GET /api/retours?projet=projet-1': page([RETOUR]),
      'GET /api/retours?projet=projet-1&type=bug': page([RETOUR]),
      'GET /api/retours?projet=projet-1&type=bug&gravite=bloquante': page([RETOUR]),
      [base]: page([RETOUR]),
      [`${base}&source=api`]: page([RETOUR]),
      [`${base}&source=api&incertain=true`]: page([]),
    });
    renderDashboard('/retours');
    await screen.findByText('Le paiement plante');

    await userEvent.selectOptions(await screen.findByLabelText('Projet'), 'Boutique');
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'Bug');
    await userEvent.selectOptions(screen.getByLabelText('Gravité'), 'Bloquante');
    await userEvent.click(screen.getByRole('link', { name: 'Dispatchés' }));
    await userEvent.selectOptions(screen.getByLabelText('Source'), 'API');
    await userEvent.selectOptions(screen.getByLabelText('Verdict'), 'Incertains seulement');

    expect(await screen.findByText(/Aucun Retour ne correspond/)).toBeTruthy();
    expect(api.appels.map((a) => a.route)).toContain(`${base}&source=api&incertain=true`);
  });

  it('charge la page suivante à la demande', async () => {
    fakeApi({
      'GET /api/session': CONNECTE,
      'GET /api/projets': PROJETS,
      'GET /api/retours?type=bug': page([RETOUR], 'curseur-2'),
      'GET /api/retours?type=bug&curseur=curseur-2': page([
        { ...RETOUR, id: 'retour-ancien', apercu: 'Un plus ancien' },
      ]),
    });
    renderDashboard('/retours?type=bug');

    await userEvent.click(await screen.findByRole('button', { name: 'Afficher plus' }));

    expect(await screen.findByText('Un plus ancien')).toBeTruthy();
    expect(screen.getByText('Le paiement plante')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Afficher plus' })).toBeNull();
  });

  it('affiche le texte d’un Retour comme du texte, jamais comme du HTML', async () => {
    const malveillant = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    fakeApi({
      'GET /api/session': CONNECTE,
      'GET /api/projets': PROJETS,
      'GET /api/retours': page([{ ...RETOUR, apercu: malveillant }]),
    });

    renderDashboard('/retours');

    expect(await screen.findByText(malveillant)).toBeTruthy();
    expect(document.querySelector('img, script')).toBeNull();
  });
});

const DETAIL: RetourDetailVu = {
  id: 'retour-1',
  projet: { id: 'projet-1', nom: 'Boutique' },
  etat: 'dispatche',
  source: 'api',
  texte: 'Le paiement plante\nà chaque fois',
  typeDeclare: 'bug',
  auteur: { id: 'u-42', email: 'ada@client.test', nom: null, confiance: 'attestee' },
  contexte: {
    url: 'https://boutique.test/panier',
    userAgent: 'Firefox 140',
    viewport: { largeur: 1280, hauteur: 800 },
    metadonnees: { version: '2.3.1' },
  },
  capture: null,
  verdict: {
    typeRetenu: 'bug',
    gravite: 'majeure',
    indesirable: false,
    manipulation: false,
    incertain: true,
  },
  envois: [
    {
      id: 'envoi-1',
      destination: { id: 'dest-1', nom: 'Linear produit', type: 'linear', etat: 'active' },
      statut: 'livre',
      lienExterne: 'https://linear.app/nudge/issue/NUD-1',
      tentatives: 1,
      derniereErreur: null,
      createdAt: '2026-10-24T09:00:01.000Z',
      updatedAt: '2026-10-24T09:00:02.000Z',
    },
    {
      id: 'envoi-2',
      destination: { id: 'dest-2', nom: 'Webhook', type: 'webhook', etat: 'suspendue' },
      statut: 'echec',
      lienExterne: null,
      tentatives: 3,
      derniereErreur: '503 Service Unavailable',
      createdAt: '2026-10-24T09:00:01.000Z',
      updatedAt: '2026-10-24T09:00:05.000Z',
    },
  ],
  createdAt: '2026-10-24T09:00:00.000Z',
};

describe('Détail d’un Retour', () => {
  it('montre le texte, l’Auteur, le contexte, le Verdict et les Envois', async () => {
    fakeApi({
      'GET /api/session': CONNECTE,
      'GET /api/retours/retour-1': { status: 200, body: DETAIL },
    });

    renderDashboard('/retours/retour-1');

    const texte = await screen.findByLabelText('Texte du Retour');
    expect(texte.textContent).toBe('Le paiement plante\nà chaque fois');
    expect(screen.getByRole('link', { name: 'Boutique' })).toHaveProperty(
      'pathname',
      '/projets/projet-1',
    );

    const auteur = screen.getByRole('region', { name: 'Auteur' });
    expect(auteur.textContent).toMatch(/ada@client\.test/);
    expect(auteur.textContent).toMatch(/u-42/);
    expect(auteur.textContent).toMatch(/Attestée/);

    const contexte = screen.getByRole('region', { name: 'Contexte' });
    expect(contexte.textContent).toMatch(/https:\/\/boutique\.test\/panier/);
    expect(contexte.textContent).toMatch(/Firefox 140/);
    expect(contexte.textContent).toMatch(/1280 × 800/);
    expect(contexte.textContent).toMatch(/version/);
    expect(contexte.textContent).toMatch(/2\.3\.1/);

    const verdict = screen.getByRole('region', { name: 'Verdict' });
    expect(verdict.textContent).toMatch(/Bug/);
    expect(verdict.textContent).toMatch(/Majeure/);
    expect(within(verdict).getByText('Incertain')).toBeTruthy();

    const envois = screen.getByRole('region', { name: 'Envois' });
    expect(within(envois).getByRole('link', { name: /NUD-1/ })).toHaveProperty(
      'href',
      'https://linear.app/nudge/issue/NUD-1',
    );
    expect(envois.textContent).toMatch(/Linear produit/);
    expect(envois.textContent).toMatch(/Livré/);
    expect(envois.textContent).toMatch(/Webhook/);
    expect(envois.textContent).toMatch(/Échec/);
    expect(envois.textContent).toMatch(/503 Service Unavailable/);
  });

  it('montre la Capture jointe par l’Auteur, et permet de l’ouvrir en grand', async () => {
    fakeApi({
      'GET /api/session': CONNECTE,
      'GET /api/retours/retour-1': {
        status: 200,
        body: { ...DETAIL, capture: { contentType: 'image/png', octets: 48_213 } },
      },
    });

    renderDashboard('/retours/retour-1');

    const capture = await screen.findByRole('region', { name: 'Capture' });
    expect(
      within(capture).getByRole('img', { name: 'Capture de la page jointe par l’Auteur' }),
    ).toHaveProperty('src', 'http://localhost:3000/api/retours/retour-1/capture');
    const ouvrir = within(capture).getByRole('link', { name: /Ouvrir l’image/ });
    expect(ouvrir.getAttribute('href')).toBe('/api/retours/retour-1/capture');
    expect(ouvrir.getAttribute('target')).toBe('_blank');
    expect(ouvrir.getAttribute('rel')).toBe('noopener noreferrer');
    expect(capture.textContent).toMatch(/PNG · 47 Kio/);
  });

  it('sans Capture, n’en montre aucune', async () => {
    fakeApi({
      'GET /api/session': CONNECTE,
      'GET /api/retours/retour-1': { status: 200, body: DETAIL },
    });

    renderDashboard('/retours/retour-1');

    await screen.findByLabelText('Texte du Retour');
    expect(screen.queryByRole('region', { name: 'Capture' })).toBeNull();
  });

  it('montre un Retour anonyme, pas encore trié, sans Envoi', async () => {
    fakeApi({
      'GET /api/session': CONNECTE,
      'GET /api/retours/retour-1': {
        status: 200,
        body: { ...DETAIL, etat: 'recu', auteur: null, contexte: {}, verdict: null, envois: [] },
      },
    });

    renderDashboard('/retours/retour-1');

    expect((await screen.findByRole('region', { name: 'Auteur' })).textContent).toMatch(/Anonyme/);
    expect(screen.getByRole('region', { name: 'Verdict' }).textContent).toMatch(/pas encore trié/);
    expect(screen.getByRole('region', { name: 'Envois' }).textContent).toMatch(/Aucun Envoi/);
  });

  it('n’interprète jamais le texte ni le contexte de l’Auteur comme du HTML ou un lien actif', async () => {
    fakeApi({
      'GET /api/session': CONNECTE,
      'GET /api/retours/retour-1': {
        status: 200,
        body: {
          ...DETAIL,
          texte: '<script>alert(1)</script><img src=x onerror="alert(2)">',
          contexte: { url: 'javascript:alert(3)', metadonnees: { '<b>cle</b>': '<i>v</i>' } },
          envois: [{ ...DETAIL.envois[0]!, lienExterne: 'javascript:alert(4)' }],
        },
      },
    });

    renderDashboard('/retours/retour-1');

    expect((await screen.findByLabelText('Texte du Retour')).textContent).toBe(
      '<script>alert(1)</script><img src=x onerror="alert(2)">',
    );
    expect(document.querySelector('script, img, b, i')).toBeNull();
    expect(screen.getByText('javascript:alert(3)').closest('a')).toBeNull();
    expect(screen.getByText('javascript:alert(4)').closest('a')).toBeNull();
  });

  it('explique qu’un Retour n’existe pas', async () => {
    fakeApi({
      'GET /api/session': CONNECTE,
      'GET /api/retours/inconnu': { status: 404, body: { erreur: 'retour_introuvable' } },
    });

    renderDashboard('/retours/inconnu');

    expect((await screen.findByRole('alert')).textContent).toMatch(/Ce Retour n’existe pas/);
  });
});
