import type { DestinationAvecSecretsGeneres, DestinationVu } from '@nudge/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { echec, startPipeline, type DashboardClient, type Pipeline } from './harness/index.js';

describe('Destinations d’un Projet depuis le dashboard', () => {
  let pipeline: Pipeline;
  let membre: DashboardClient;

  beforeAll(async () => {
    pipeline = await startPipeline();
    membre = await pipeline.signIn();
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  const webhook = (url = 'https://recepteur.test/nudge') => ({
    type: 'webhook',
    nom: 'Récepteur interne',
    config: { url },
    filtre: { types: ['bug'], graviteMinimale: 'majeure' },
  });

  async function creer(projetId: string, corps: unknown = webhook()) {
    const reponse = await membre.post<DestinationAvecSecretsGeneres>(
      `/api/projets/${projetId}/destinations`,
      corps,
    );
    expect(reponse.status).toBe(201);
    return reponse.body;
  }

  it('ajoute, liste, modifie puis supprime une Destination webhook', async () => {
    const { projet } = await pipeline.createProjet({ nom: 'Boutique' });

    const { destination, secretsGeneres } = await creer(projet.id);

    expect(destination).toEqual({
      id: expect.any(String),
      projetId: projet.id,
      nom: 'Récepteur interne',
      type: 'webhook',
      config: { url: 'https://recepteur.test/nudge' },
      filtre: { types: ['bug'], graviteMinimale: 'majeure' },
      etat: 'active',
      secrets: ['secretSignature'],
      createdAt: expect.any(String),
    });
    // Le secret de signature, généré par l'Instance, n'est montré qu'à la création.
    expect(secretsGeneres.secretSignature).toMatch(/^[\w-]{40,}$/);
    expect(await membre.get(`/api/projets/${projet.id}/destinations`)).toEqual({
      status: 200,
      body: [destination],
    });

    const modification = await membre.patch<DestinationVu>(`/api/destinations/${destination.id}`, {
      nom: 'Récepteur v2',
      config: { url: 'https://autre.test/hook' },
      filtre: { types: ['question', 'bug'], graviteMinimale: null },
    });
    const modifiee = {
      ...destination,
      nom: 'Récepteur v2',
      config: { url: 'https://autre.test/hook' },
      filtre: { types: ['bug', 'question'], graviteMinimale: null },
    };
    expect(modification).toEqual({ status: 200, body: modifiee });
    expect(await membre.get(`/api/destinations/${destination.id}`)).toEqual({
      status: 200,
      body: modifiee,
    });

    expect((await membre.delete(`/api/destinations/${destination.id}`)).status).toBe(204);
    expect(await membre.get(`/api/projets/${projet.id}/destinations`)).toEqual({
      status: 200,
      body: [],
    });
    expect((await membre.get(`/api/destinations/${destination.id}`)).status).toBe(404);
  });

  it('chiffre les secrets en base et ne les rend jamais', async () => {
    const { projet } = await pipeline.createProjet({ nom: 'Secrets' });
    const { destination, secretsGeneres } = await creer(projet.id);
    const secret = secretsGeneres.secretSignature!;

    const ligne = await pipeline.ligneDestination(destination.id);
    expect(ligne?.secretsChiffres).toMatch(/^v1:/);
    expect(JSON.stringify(ligne)).not.toContain(secret);
    const lue = await membre.get(`/api/destinations/${destination.id}`);
    const liste = await membre.get(`/api/projets/${projet.id}/destinations`);
    expect(JSON.stringify([lue.body, liste.body])).not.toContain(secret);
  });

  it('ajoute un salon Discord : l’URL du webhook, qui porte son jeton, est un secret validé', async () => {
    const { projet } = await pipeline.createProjet({ nom: 'Discord' });
    const jeton = 'jeton-du-salon-3d89bb7572e0fb30d8128367b3b1b44f';
    const salon = (url?: string) => ({
      type: 'discord',
      nom: 'Salon #bugs',
      config: {},
      ...(url === undefined ? {} : { secrets: { url } }),
    });

    for (const url of [
      undefined,
      'https://hooks.slack.com/services/T000/B000/XXXX',
      'http://discord.com/api/webhooks/223704706495545344/jeton',
      'https://discord.com/api/webhooks/223704706495545344/jeton?thread_id=1',
      'https://discord.com.piege.test/api/webhooks/223704706495545344/jeton',
    ]) {
      const refus = await membre.post(`/api/projets/${projet.id}/destinations`, salon(url));
      expect(refus).toMatchObject({
        status: 400,
        body: {
          erreur: 'requete_invalide',
          details: [{ chemin: expect.stringMatching(/^secrets/) }],
        },
      });
    }

    const { destination, secretsGeneres } = await creer(
      projet.id,
      salon(`https://discord.com/api/webhooks/223704706495545344/${jeton}`),
    );
    expect(destination).toMatchObject({ type: 'discord', config: {}, secrets: ['url'] });
    expect(secretsGeneres).toEqual({});
    const ligne = await pipeline.ligneDestination(destination.id);
    expect(JSON.stringify(ligne)).not.toContain(jeton);
    const renomme = await membre.patch<DestinationVu>(`/api/destinations/${destination.id}`, {
      nom: 'Salon #support',
    });
    expect(renomme.body).toMatchObject({ nom: 'Salon #support', secrets: ['url'] });
    expect(JSON.stringify(renomme.body)).not.toContain(jeton);
  });

  it('ajoute une équipe Linear : la clé d’API est un secret, l’équipe et les labels sont validés', async () => {
    const { projet } = await pipeline.createProjet({ nom: 'Linear' });
    const cle = 'lin_api_9f8e7d6c5b4a39281706f5e4d3c2b1a0';
    const equipe = (config: unknown, secrets?: unknown) => ({
      type: 'linear',
      nom: 'Linear ENG',
      config,
      ...(secrets === undefined ? {} : { secrets }),
    });
    const labels = { types: { bug: ' Bug ' }, gravites: { bloquante: 'Urgent' } };

    for (const [corps, chemin] of [
      [equipe({ equipe: 'ENG', labels }), /^secrets/],
      [equipe({ equipe: 'ENG', labels }, { cleApi: '  ' }), /^secrets/],
      [equipe({ equipe: 'ENG-1', labels }, { cleApi: cle }), /^config\.equipe/],
      [
        equipe({ equipe: 'ENG', labels: { types: { bogue: 'Bug' } } }, { cleApi: cle }),
        /^config\.labels/,
      ],
      [
        equipe({ equipe: 'ENG', labels: { types: { bug: '' } } }, { cleApi: cle }),
        /^config\.labels/,
      ],
    ] as const) {
      const refus = await membre.post(`/api/projets/${projet.id}/destinations`, corps);
      expect(refus).toMatchObject({
        status: 400,
        body: { erreur: 'requete_invalide', details: [{ chemin: expect.stringMatching(chemin) }] },
      });
    }

    const { destination, secretsGeneres } = await creer(
      projet.id,
      equipe({ equipe: 'eng', labels }, { cleApi: cle }),
    );
    expect(destination).toMatchObject({
      type: 'linear',
      config: {
        equipe: 'ENG',
        labels: { types: { bug: 'Bug' }, gravites: { bloquante: 'Urgent' } },
      },
      secrets: ['cleApi'],
    });
    expect(secretsGeneres).toEqual({});
    const ligne = await pipeline.ligneDestination(destination.id);
    expect(JSON.stringify(ligne)).not.toContain(cle);
    const sansLabels = await membre.patch<DestinationVu>(`/api/destinations/${destination.id}`, {
      config: { equipe: 'OPS' },
    });
    expect(sansLabels.body).toMatchObject({
      config: { equipe: 'OPS', labels: { types: {}, gravites: {} } },
      secrets: ['cleApi'],
    });
    expect(JSON.stringify(sansLabels.body)).not.toContain(cle);
  });

  it('des secrets indéchiffrables (clé d’Instance changée) n’empêchent ni de lister ni de régénérer', async () => {
    const { projet } = await pipeline.createProjet({ nom: 'Clé changée' });
    const { destination } = await creer(projet.id);
    await pipeline.rendreSecretsIndechiffrables(destination.id);

    expect(await membre.get(`/api/projets/${projet.id}/destinations`)).toEqual({
      status: 200,
      body: [{ ...destination, secrets: [] }],
    });
    const renomme = await membre.patch(`/api/destinations/${destination.id}`, { nom: 'Renommé' });
    expect(renomme.status).toBe(200);
    const regeneration = await membre.post<DestinationAvecSecretsGeneres>(
      `/api/destinations/${destination.id}/secrets-generes`,
    );
    expect(regeneration.status).toBe(201);
    expect(regeneration.body.destination.secrets).toEqual(['secretSignature']);
  });

  it('régénère le secret de signature et montre le nouveau une seule fois', async () => {
    const { projet } = await pipeline.createProjet({ nom: 'Rotation' });
    const { destination, secretsGeneres } = await creer(projet.id);

    const regeneration = await membre.post<DestinationAvecSecretsGeneres>(
      `/api/destinations/${destination.id}/secrets-generes`,
    );

    expect(regeneration.status).toBe(201);
    expect(regeneration.body.destination).toEqual(destination);
    expect(regeneration.body.secretsGeneres.secretSignature).toMatch(/^[\w-]{40,}$/);
    expect(regeneration.body.secretsGeneres.secretSignature).not.toBe(
      secretsGeneres.secretSignature,
    );
  });

  it('« tester » envoie un Retour d’exemple par l’adaptateur et rend le résultat, sans Envoi', async () => {
    const { projet } = await pipeline.createProjet({ nom: 'Essai' });
    const { destination } = await creer(projet.id);
    const fake = pipeline.fakeDestination(destination.id);

    const livre = await membre.post(`/api/destinations/${destination.id}/test`);

    expect(livre).toEqual({
      status: 200,
      body: { statut: 'livre', lienExterne: expect.stringContaining('https://') },
    });
    expect(fake.envois).toHaveLength(1);
    expect(fake.envois[0]).toMatchObject({
      essai: true,
      projet: { id: projet.id, nom: 'Essai' },
      retour: { texte: expect.stringContaining('exemple') },
    });
    expect(await pipeline.readRetour(fake.envois[0]!.retour.id)).toBeNull();

    fake.scriptSends(echec('auth', 'jeton refusé'), new Error('ECONNREFUSED'));
    expect((await membre.post(`/api/destinations/${destination.id}/test`)).body).toEqual({
      statut: 'echec',
      classe: 'auth',
      message: 'jeton refusé',
    });
    expect((await membre.post(`/api/destinations/${destination.id}/test`)).body).toEqual({
      statut: 'echec',
      classe: 'transient',
      message: 'ECONNREFUSED',
    });
    expect((await membre.get(`/api/destinations/${destination.id}`)).body).toMatchObject({
      etat: 'active',
    });
  });

  it.each([
    ['un type inconnu', { ...webhook(), type: 'pigeon' }, 'type'],
    ['une URL qui n’est pas http(s)', webhook('ftp://recepteur.test'), 'config.url'],
    ['une URL avec identifiants', webhook('https://moi:secret@recepteur.test'), 'config.url'],
    ['une URL avec mot de passe', webhook('https://:secret@recepteur.test'), 'config.url'],
    [
      'un champ de config inconnu',
      { ...webhook(), config: { url: 'https://a.test', x: 1 } },
      'config',
    ],
    ['un secret que le type ne connaît pas', { ...webhook(), secrets: { jeton: 'x' } }, 'secrets'],
    [
      'un Filtre sans Type',
      { ...webhook(), filtre: { types: [], graviteMinimale: null } },
      'filtre.types',
    ],
    [
      'une Gravité inconnue',
      { ...webhook(), filtre: { types: ['bug'], graviteMinimale: 'grave' } },
      'filtre.graviteMinimale',
    ],
  ])('refuse %s', async (_cas, corps, chemin) => {
    const { projet } = await pipeline.createProjet({ nom: 'Refus' });

    const reponse = await membre.post<{ erreur: string; details: { chemin: string }[] }>(
      `/api/projets/${projet.id}/destinations`,
      corps,
    );

    expect(reponse.status).toBe(400);
    expect(reponse.body.erreur).toBe('requete_invalide');
    expect(reponse.body.details.map((d) => d.chemin)).toContainEqual(
      expect.stringMatching(new RegExp(`^${chemin.replace('.', '\\.')}`)),
    );
  });

  it('refuse une modification invalide sans rien changer', async () => {
    const { projet } = await pipeline.createProjet({ nom: 'Modification refusée' });
    const { destination } = await creer(projet.id);

    const reponse = await membre.patch(`/api/destinations/${destination.id}`, {
      config: { url: 'pas une url' },
    });

    expect(reponse.status).toBe(400);
    expect((await membre.get(`/api/destinations/${destination.id}`)).body).toEqual(destination);
  });

  it('404 pour un Projet ou une Destination inconnus, 401 sans session', async () => {
    const inconnu = '00000000-0000-4000-8000-000000000000';
    expect(await membre.post(`/api/projets/${inconnu}/destinations`, webhook())).toMatchObject({
      status: 404,
      body: { erreur: 'projet_introuvable' },
    });
    expect(await membre.get(`/api/projets/${inconnu}/destinations`)).toMatchObject({
      status: 404,
      body: { erreur: 'projet_introuvable' },
    });
    for (const reponse of [
      await membre.get(`/api/destinations/${inconnu}`),
      await membre.patch(`/api/destinations/pas-un-id`, { nom: 'x' }),
      await membre.delete(`/api/destinations/${inconnu}`),
      await membre.post(`/api/destinations/${inconnu}/test`),
    ]) {
      expect(reponse).toMatchObject({ status: 404, body: { erreur: 'destination_introuvable' } });
    }
    const { projet } = await pipeline.createProjet({ nom: 'Anonyme' });
    expect((await pipeline.dashboard().get(`/api/projets/${projet.id}/destinations`)).status).toBe(
      401,
    );
  });
});
