import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EnvoiVu, RetourDetailVu } from '@nudge/shared';
import { echec, startPipeline, type DashboardClient, type Pipeline } from './harness/index.js';

/** Un Membre agit sur un Retour depuis le dashboard : revue, correction du Verdict, rejeu. */
describe('Revue et corrections par l’API du dashboard', () => {
  let pipeline: Pipeline;
  let membre: DashboardClient;

  beforeAll(async () => {
    pipeline = await startPipeline();
    membre = await pipeline.signIn();
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  async function retourEn(etat: 'en_revue' | 'ecarte') {
    const { projet, cleSecrete } = await pipeline.createProjet({ nom: `Projet ${etat}` });
    const { fake } = await pipeline.createDestination(projet.id);
    pipeline.juge.script(
      etat === 'en_revue'
        ? { type: 'bug', manipulation: 0.9, gravite: 'majeure' }
        : { type: 'avis', indesirable: 0.9, gravite: 'cosmetique' },
    );
    const reponse = await pipeline.postRetour(cleSecrete, { texte: `Retour ${etat}` });
    const { id } = (await reponse.json()) as { id: string };
    await pipeline.waitForRetour(id, (r) => r.etat === etat);
    return { id, fake };
  }

  it('sans session, une revue est refusée et ne change rien', async () => {
    const { id, fake } = await retourEn('en_revue');

    const reponse = await pipeline
      .dashboard()
      .post(`/api/retours/${id}/revue`, { action: 'valider' });

    expect(reponse.status).toBe(401);
    expect(await pipeline.readRetour(id)).toMatchObject({ etat: 'en_revue', envois: [] });
    expect(fake.attempts).toHaveLength(0);
  });

  it('une action de revue inconnue est refusée', async () => {
    const { id } = await retourEn('en_revue');

    const reponse = await membre.post(`/api/retours/${id}/revue`, { action: 'dispatcher' });

    expect(reponse.status).toBe(400);
    expect(await pipeline.readRetour(id)).toMatchObject({ etat: 'en_revue' });
  });

  /** Un Retour Bug majeur, dispatché et livré à sa Destination ; Incertain si `incertain`. */
  async function retourLivre(nom: string, { incertain = false } = {}) {
    const { projet, cleSecrete } = await pipeline.createProjet({ nom });
    const { destination, fake } = await pipeline.createDestination(projet.id);
    pipeline.juge.script(
      { type: 'bug', gravite: 'majeure' },
      incertain ? { confidence: 0.4 } : undefined,
    );
    const reponse = await pipeline.postRetour(cleSecrete, { texte: `Retour de ${nom}` });
    const { id } = (await reponse.json()) as { id: string };
    const retour = await pipeline.waitForRetour(id, (r) =>
      r.envois.some((envoi) => envoi.statut === 'livre'),
    );
    return { retour, destination, fake };
  }

  /** Laisse au worker le temps de passer, pour constater qu'il ne s'est rien passé. */
  const laisserPasser = () => new Promise((resolve) => setTimeout(resolve, 300));

  it('corriger le Type et la Gravité met à jour le Verdict, sans rien changer chez les Destinations déjà servies', async () => {
    const { retour, fake } = await retourLivre('Correction', { incertain: true });

    const reponse = await membre.patch<RetourDetailVu>(`/api/retours/${retour.id}/verdict`, {
      typeRetenu: 'question',
      gravite: 'cosmetique',
    });

    expect(reponse.status).toBe(200);
    // Corrigé par un Membre : le Verdict est vérifié, il n'est plus Incertain.
    expect(reponse.body.verdict).toEqual({
      typeRetenu: 'question',
      gravite: 'cosmetique',
      indesirable: false,
      manipulation: false,
      incertain: false,
    });
    expect(reponse.body.etat).toBe('dispatche');
    await laisserPasser();
    const apres = await pipeline.readRetour(retour.id);
    expect(apres?.envois).toEqual(retour.envois);
    expect(fake.attempts).toHaveLength(1);
  });

  it('un Retour pas encore trié n’a pas de Verdict à corriger, et une correction vide est refusée', async () => {
    const { projet } = await pipeline.createProjet({ nom: 'Pas trié' });
    const recu = await pipeline.insererRetourSansTriage(projet.id, { texte: 'En attente' });
    const { retour } = await retourLivre('Correction vide');

    const nonTrie = await membre.patch(`/api/retours/${recu}/verdict`, { typeRetenu: 'bug' });
    const vide = await membre.patch(`/api/retours/${retour.id}/verdict`, {});

    expect(nonTrie).toMatchObject({ status: 409, body: { erreur: 'retour_non_trie' } });
    expect(vide).toMatchObject({ status: 400, body: { erreur: 'requete_invalide' } });
    expect((await pipeline.readRetour(recu))?.verdict).toBeNull();
    expect((await pipeline.readRetour(retour.id))?.verdict).toEqual(retour.verdict);
  });

  it('rejouer un Envoi en échec le livre : le même Envoi, avec le lien vers l’objet créé', async () => {
    const { projet, cleSecrete } = await pipeline.createProjet({ nom: 'Rejeu d’un échec' });
    const { fake } = await pipeline.createDestination(projet.id);
    fake.scriptSends(echec('permanent', 'HTTP 422'));
    pipeline.juge.script({ type: 'bug', gravite: 'majeure' });
    const { id } = (await (
      await pipeline.postRetour(cleSecrete, { texte: 'Échoue puis passe' })
    ).json()) as { id: string };
    const { envois } = await pipeline.waitForRetour(id, (r) =>
      r.envois.some((envoi) => envoi.statut === 'echec'),
    );
    const [envoi] = envois;

    const reponse = await membre.post<EnvoiVu>(`/api/envois/${envoi!.id}/rejeu`);

    expect(reponse.status).toBe(202);
    expect(reponse.body).toMatchObject({ id: envoi!.id, statut: 'en_attente' });
    const apres = await pipeline.waitForRetour(id, (r) =>
      r.envois.some((e) => e.statut === 'livre'),
    );
    expect(apres.envois).toHaveLength(1);
    expect(apres.envois[0]).toMatchObject({
      id: envoi!.id,
      statut: 'livre',
      lienExterne: `https://destination.test/envois/${envoi!.id}`,
      tentatives: 2,
      derniereErreur: null,
    });
    expect(fake.attempts).toHaveLength(2);
    const detail = await membre.get<RetourDetailVu>(`/api/retours/${id}`);
    expect(detail.body.envois[0]).toMatchObject({
      statut: 'livre',
      lienExterne: `https://destination.test/envois/${envoi!.id}`,
    });
  });

  it('rejouer un Envoi livré propage la correction du Verdict, sans second Envoi', async () => {
    const { retour, fake } = await retourLivre('Propagation');
    const [envoi] = retour.envois;
    await membre.patch(`/api/retours/${retour.id}/verdict`, { typeRetenu: 'suggestion' });

    const reponse = await membre.post(`/api/envois/${envoi!.id}/rejeu`);

    expect(reponse.status).toBe(202);
    await expect.poll(() => fake.envois.length).toBe(2);
    expect(fake.envois[1]?.retour).toMatchObject({ typeRetenu: 'suggestion', gravite: 'majeure' });
    const apres = await pipeline.waitForRetour(retour.id, (r) =>
      r.envois.every((e) => e.statut === 'livre'),
    );
    expect(apres.envois.map((e) => e.id)).toEqual([envoi!.id]);
    expect(apres.envois[0]?.tentatives).toBe(2);
  });

  it('deux rejeux simultanés ne livrent qu’une fois de plus', async () => {
    const { retour, fake } = await retourLivre('Rejeux simultanés');
    const [envoi] = retour.envois;
    // Le rejeu gagnant reste en cours le temps que l'autre arrive.
    const relacher = fake.hold();

    const reponses = await Promise.all([
      membre.post(`/api/envois/${envoi!.id}/rejeu`),
      membre.post(`/api/envois/${envoi!.id}/rejeu`),
    ]);
    relacher();

    expect(reponses.map((r) => r.status).sort()).toEqual([202, 409]);
    await pipeline.waitForRetour(retour.id, (r) => r.envois.every((e) => e.statut === 'livre'));
    await laisserPasser();
    expect(fake.attempts).toHaveLength(2);
  });

  it('un Envoi en attente ne se rejoue pas ; un Envoi inconnu est introuvable', async () => {
    const { projet, cleSecrete } = await pipeline.createProjet({ nom: 'Pas rejouable' });
    const { fake } = await pipeline.createDestination(projet.id);
    const relacher = fake.hold();
    pipeline.juge.script({ type: 'bug', gravite: 'majeure' });
    const { id } = (await (
      await pipeline.postRetour(cleSecrete, { texte: 'Envoi en cours' })
    ).json()) as { id: string };
    await expect.poll(() => fake.attempts.length).toBe(1);
    const [envoi] = (await pipeline.readRetour(id))!.envois;

    const enAttente = await membre.post(`/api/envois/${envoi!.id}/rejeu`);
    const inconnu = await membre.post('/api/envois/00000000-0000-4000-8000-000000000000/rejeu');
    relacher();

    expect(enAttente).toMatchObject({
      status: 409,
      body: { erreur: 'envoi_non_rejouable', statut: 'en_attente' },
    });
    expect(inconnu).toMatchObject({ status: 404, body: { erreur: 'envoi_introuvable' } });
    await pipeline.waitForRetour(id, (r) => r.envois.every((e) => e.statut === 'livre'));
    expect(fake.attempts).toHaveLength(1);
  });

  it('un Envoi retenu par sa Destination Suspendue ne se rejoue pas : la sonde le libérera', async () => {
    const { projet, cleSecrete } = await pipeline.createProjet({ nom: 'Retenu' });
    const { fake } = await pipeline.createDestination(projet.id);
    fake.scriptSends(echec('auth', 'HTTP 401'));
    pipeline.juge.script({ type: 'bug', gravite: 'majeure' });
    const { id } = (await (
      await pipeline.postRetour(cleSecrete, { texte: 'Identifiants refusés' })
    ).json()) as { id: string };
    const { envois } = await pipeline.waitForRetour(id, (r) =>
      r.envois.some((e) => e.statut === 'retenu'),
    );

    const reponse = await membre.post(`/api/envois/${envois[0]!.id}/rejeu`);

    expect(reponse).toMatchObject({
      status: 409,
      body: { erreur: 'envoi_non_rejouable', statut: 'retenu' },
    });
    await laisserPasser();
    expect(fake.attempts).toHaveLength(1);
  });
});
