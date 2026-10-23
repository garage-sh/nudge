import type { ProjetAvecCleSecrete, ProjetVu } from '@nudge/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPipeline, type DashboardClient, type Pipeline } from './harness/index.js';

describe('Projets dans le dashboard', () => {
  let pipeline: Pipeline;
  let membre: DashboardClient;

  beforeAll(async () => {
    pipeline = await startPipeline();
    membre = await pipeline.signIn();
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  const creer = async (corps: Record<string, unknown>) => {
    const reponse = await membre.post<ProjetAvecCleSecrete>('/api/projets', corps);
    expect(reponse.status).toBe(201);
    return reponse.body;
  };

  it('crée un Projet avec une clé publique et une clé secrète qui ingère des Retours', async () => {
    const { projet, cleSecrete } = await creer({
      nom: 'Boutique',
      description: 'Le tunnel de paiement est critique.',
      originesAutorisees: ['https://boutique.exemple'],
    });

    expect(projet).toMatchObject({
      nom: 'Boutique',
      description: 'Le tunnel de paiement est critique.',
      originesAutorisees: ['https://boutique.exemple'],
      clePublique: expect.stringMatching(/^nk_pub_/),
    });
    expect(cleSecrete).toMatch(/^nk_sec_/);
    expect((await pipeline.postRetour(cleSecrete, { texte: 'Bonjour' })).status).toBe(202);
  });

  it('montre tous les Projets à tous les Membres, sans jamais la clé secrète', async () => {
    const { projet } = await creer({ nom: 'Partagé' });
    const invitation = await membre.post<{ jeton: string }>('/api/invitations');
    const autre = pipeline.dashboard();
    await autre.post(`/api/invitations/${invitation.body.jeton}/acceptation`, {
      email: 'autre@nudge.test',
      motDePasse: 'le mot de passe de l’autre',
    });

    const liste = await autre.get<ProjetVu[]>('/api/projets');
    const detail = await autre.get<ProjetVu>(`/api/projets/${projet.id}`);

    expect(liste.status).toBe(200);
    expect(liste.body.map((p) => p.id)).toContain(projet.id);
    expect(detail).toMatchObject({ status: 200, body: { id: projet.id, nom: 'Partagé' } });
    expect(JSON.stringify([liste.body, detail.body])).not.toMatch(/nk_sec_|empreinte/);
  });

  it('régénère la clé secrète : l’ancienne est révoquée, la nouvelle ingère', async () => {
    const { projet, cleSecrete: ancienne } = await creer({ nom: 'Fuite' });

    const regeneration = await membre.post<ProjetAvecCleSecrete>(
      `/api/projets/${projet.id}/cle-secrete`,
    );

    expect(regeneration.status).toBe(201);
    const nouvelle = regeneration.body.cleSecrete;
    expect(nouvelle).toMatch(/^nk_sec_/);
    expect(nouvelle).not.toBe(ancienne);
    expect((await pipeline.postRetour(ancienne, { texte: 'Encore moi' })).status).toBe(401);
    expect((await pipeline.postRetour(nouvelle, { texte: 'Bonjour' })).status).toBe(202);
    expect(regeneration.body.projet.clePublique).toBe(projet.clePublique);
  });

  it('régénère la clé publique : l’ancienne disparaît, la clé secrète reste valide', async () => {
    const { projet, cleSecrete } = await creer({ nom: 'Widget' });

    const regeneration = await membre.post<ProjetVu>(`/api/projets/${projet.id}/cle-publique`);

    expect(regeneration.status).toBe(201);
    expect(regeneration.body.clePublique).toMatch(/^nk_pub_/);
    expect(regeneration.body.clePublique).not.toBe(projet.clePublique);
    const liste = await membre.get<ProjetVu[]>('/api/projets');
    expect(liste.body.map((p) => p.clePublique)).not.toContain(projet.clePublique);
    expect((await pipeline.postRetour(cleSecrete, { texte: 'Bonjour' })).status).toBe(202);
  });

  it('édite les origines autorisées (normalisées) et la Description du Projet', async () => {
    const { projet } = await creer({ nom: 'Édition', description: 'Ancienne description' });

    const edition = await membre.patch<ProjetVu>(`/api/projets/${projet.id}`, {
      originesAutorisees: ['https://App.Exemple/', 'http://localhost:5173', 'https://app.exemple'],
      description: '',
    });

    expect(edition).toMatchObject({
      status: 200,
      body: {
        nom: 'Édition',
        originesAutorisees: ['https://app.exemple', 'http://localhost:5173'],
        description: null,
      },
    });
    expect(await membre.get(`/api/projets/${projet.id}`)).toMatchObject({ body: edition.body });
  });

  it.each([
    ['une origine avec un chemin', { originesAutorisees: ['https://app.exemple/page'] }],
    ['une origine sans schéma http(s)', { originesAutorisees: ['ftp://app.exemple'] }],
    ['un nom vide', { nom: '  ' }],
    ['une description trop longue', { description: 'a'.repeat(2001) }],
    ['un champ inconnu', { cleSecrete: 'nk_sec_choisie' }],
  ])('refuse %s', async (_cas, corps) => {
    const { projet } = await creer({ nom: 'Validation' });

    const reponse = await membre.patch(`/api/projets/${projet.id}`, corps);

    expect(reponse).toMatchObject({ status: 400, body: { erreur: 'requete_invalide' } });
  });

  it('répond 404 pour un Projet inconnu', async () => {
    const inconnu = '00000000-0000-4000-8000-000000000000';

    expect(await membre.get(`/api/projets/${inconnu}`)).toMatchObject({
      status: 404,
      body: { erreur: 'projet_introuvable' },
    });
    expect(await membre.get('/api/projets/pas-un-uuid')).toMatchObject({ status: 404 });
    expect(await membre.post(`/api/projets/${inconnu}/cle-secrete`)).toMatchObject({
      status: 404,
    });
  });
});
