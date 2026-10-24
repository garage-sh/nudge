import type { RedispatchVu } from '@nudge/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPipeline, type DashboardClient, type Pipeline } from './harness/index.js';

/**
 * Redispatcher (D22) : un Membre propage une correction du Verdict vers les
 * Destinations dont le Filtre retient désormais le Retour, en créant les Envois
 * manquants ; les Envois existants ne sont jamais touchés.
 */
describe('Redispatcher un Retour depuis le dashboard', () => {
  let pipeline: Pipeline;
  let membre: DashboardClient;

  beforeAll(async () => {
    pipeline = await startPipeline();
    membre = await pipeline.signIn();
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  const poster = async (cleSecrete: string, texte: string) => {
    const reponse = await pipeline.postRetour(cleSecrete, { texte });
    return ((await reponse.json()) as { id: string }).id;
  };

  it('un Retour Trié qu’aucun Filtre ne retenait part après correction et passe Dispatché', async () => {
    const { projet, cleSecrete } = await pipeline.createProjet({ nom: 'Trié sans Envoi' });
    const { destination, fake } = await pipeline.createDestination(projet.id, {
      filtre: { types: ['bug'], graviteMinimale: 'majeure' },
    });
    pipeline.juge.script({ type: 'avis', gravite: 'cosmetique' });
    const id = await poster(cleSecrete, 'Le paiement plante à chaque fois');
    await pipeline.waitForRetour(id, (r) => r.etat === 'trie');
    await membre.patch(`/api/retours/${id}/verdict`, { typeRetenu: 'bug', gravite: 'bloquante' });

    const reponse = await membre.post<RedispatchVu>(`/api/retours/${id}/redispatch`);

    expect(reponse.status).toBe(200);
    expect(reponse.body.envoisCrees).toBe(1);
    expect(reponse.body.retour).toMatchObject({
      etat: 'dispatche',
      envois: [{ destination: { id: destination.id } }],
    });
    await pipeline.waitForRetour(id, (r) => r.envois.every((e) => e.statut === 'livre'));
    expect(fake.envois).toHaveLength(1);
    expect(fake.envois[0]?.retour).toMatchObject({ typeRetenu: 'bug', gravite: 'bloquante' });
  });

  /** Un Projet avec deux Destinations : A retient les Bugs, B les Suggestions. */
  const projetBugsEtSuggestions = async (nom: string) => {
    const { projet, cleSecrete } = await pipeline.createProjet({ nom });
    const a = await pipeline.createDestination(projet.id, {
      nom: 'A',
      filtre: { types: ['bug'], graviteMinimale: null },
    });
    const b = await pipeline.createDestination(projet.id, {
      nom: 'B',
      filtre: { types: ['suggestion'], graviteMinimale: null },
    });
    return { cleSecrete, a, b };
  };

  /** Un Retour Bug dispatché et livré à A seulement. */
  const bugLivreA = async (nom: string) => {
    const { cleSecrete, a, b } = await projetBugsEtSuggestions(nom);
    pipeline.juge.script({ type: 'bug', gravite: 'mineure' });
    const id = await poster(cleSecrete, 'Un mode sombre serait bien');
    const retour = await pipeline.waitForRetour(id, (r) =>
      r.envois.some((e) => e.statut === 'livre'),
    );
    return { id, retour, a, b };
  };

  /** Laisse au worker le temps de passer, pour constater qu'il ne s'est rien passé. */
  const laisserPasser = () => new Promise((resolve) => setTimeout(resolve, 300));

  it('un Retour Dispatché vers A part vers B après correction, sans rien changer pour A', async () => {
    const { id, retour, a, b } = await bugLivreA('Dispatché vers A');
    const [envoiA] = retour.envois;
    await membre.patch(`/api/retours/${id}/verdict`, { typeRetenu: 'suggestion' });

    const reponse = await membre.post<RedispatchVu>(`/api/retours/${id}/redispatch`);

    expect(reponse).toMatchObject({ status: 200, body: { envoisCrees: 1 } });
    const apres = await pipeline.waitForRetour(
      id,
      (r) => r.envois.length === 2 && r.envois.every((e) => e.statut === 'livre'),
    );
    expect(apres.envois.find((e) => e.destinationId === a.destination.id)).toEqual(envoiA);
    expect(a.fake.attempts).toHaveLength(1);
    expect(b.fake.envois).toHaveLength(1);
    expect(b.fake.envois[0]?.retour).toMatchObject({ typeRetenu: 'suggestion' });
  });

  it('une Destination Suspendue reçoit son Envoi retenu, sans appel sortant', async () => {
    const { id, b } = await bugLivreA('Vers une Suspendue');
    await pipeline.suspendre(b.destination.id);
    await membre.patch(`/api/retours/${id}/verdict`, { typeRetenu: 'suggestion' });

    const reponse = await membre.post<RedispatchVu>(`/api/retours/${id}/redispatch`);

    expect(reponse).toMatchObject({ status: 200, body: { envoisCrees: 1 } });
    expect(
      reponse.body.retour.envois.find((e) => e.destination.id === b.destination.id),
    ).toMatchObject({ statut: 'retenu' });
    await laisserPasser();
    expect(b.fake.attempts).toHaveLength(0);
  });

  it('redispatcher deux fois, ou deux fois en même temps, ne crée qu’un Envoi par Destination', async () => {
    const { id, b } = await bugLivreA('Idempotence');
    await membre.patch(`/api/retours/${id}/verdict`, { typeRetenu: 'suggestion' });

    const simultanes = await Promise.all([
      membre.post<RedispatchVu>(`/api/retours/${id}/redispatch`),
      membre.post<RedispatchVu>(`/api/retours/${id}/redispatch`),
    ]);
    await pipeline.waitForRetour(id, (r) => r.envois.every((e) => e.statut === 'livre'));
    const encore = await membre.post<RedispatchVu>(`/api/retours/${id}/redispatch`);

    expect(simultanes.map((r) => r.status)).toEqual([200, 200]);
    expect(simultanes.map((r) => r.body.envoisCrees).sort()).toEqual([0, 1]);
    expect(encore).toMatchObject({ status: 200, body: { envoisCrees: 0 } });
    await laisserPasser();
    expect((await pipeline.readRetour(id))?.envois).toHaveLength(2);
    expect(b.fake.attempts).toHaveLength(1);
  });

  it('un Retour qu’aucune Destination de plus ne retient reste tel quel', async () => {
    const { projet, cleSecrete } = await pipeline.createProjet({ nom: 'Rien de plus' });
    await pipeline.createDestination(projet.id, {
      filtre: { types: ['bug'], graviteMinimale: null },
    });
    pipeline.juge.script({ type: 'avis', gravite: 'mineure' });
    const id = await poster(cleSecrete, 'Joli site');
    await pipeline.waitForRetour(id, (r) => r.etat === 'trie');

    const reponse = await membre.post<RedispatchVu>(`/api/retours/${id}/redispatch`);

    expect(reponse).toMatchObject({
      status: 200,
      body: { envoisCrees: 0, retour: { etat: 'trie', envois: [] } },
    });
  });

  it.each([
    ['Reçu', 'recu'],
    ['Écarté', 'ecarte'],
    ['En revue', 'en_revue'],
  ] as const)('refuse un Retour %s, sans créer d’Envoi', async (_libelle, etat) => {
    const { projet, cleSecrete } = await pipeline.createProjet({ nom: `Refus ${etat}` });
    const { fake } = await pipeline.createDestination(projet.id);
    let id: string;
    if (etat === 'recu') {
      id = await pipeline.insererRetourSansTriage(projet.id, { texte: 'En attente' });
    } else {
      pipeline.juge.script(
        etat === 'en_revue'
          ? { type: 'bug', manipulation: 0.9, gravite: 'bloquante' }
          : { type: 'avis', indesirable: 0.9, gravite: 'cosmetique' },
      );
      id = await poster(cleSecrete, `Retour ${etat}`);
      await pipeline.waitForRetour(id, (r) => r.etat === etat);
    }

    const reponse = await membre.post(`/api/retours/${id}/redispatch`);

    expect(reponse).toMatchObject({
      status: 409,
      body: { erreur: 'retour_non_redispatchable', etat },
    });
    await laisserPasser();
    expect(await pipeline.readRetour(id)).toMatchObject({ etat, envois: [] });
    expect(fake.attempts).toHaveLength(0);
  });

  it('un Retour inconnu est introuvable, et une session est exigée', async () => {
    const inconnu = await membre.post(
      '/api/retours/00000000-0000-4000-8000-000000000000/redispatch',
    );
    const pasUnId = await membre.post('/api/retours/pas-un-uuid/redispatch');
    const anonyme = await pipeline
      .dashboard()
      .post('/api/retours/00000000-0000-4000-8000-000000000000/redispatch');

    expect(inconnu).toMatchObject({ status: 404, body: { erreur: 'retour_introuvable' } });
    expect(pasUnId).toMatchObject({ status: 404, body: { erreur: 'retour_introuvable' } });
    expect(anonyme).toMatchObject({ status: 401, body: { erreur: 'session_requise' } });
  });
});
