import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPipeline, type Pipeline } from './harness/index.js';

/** Un Retour Trié part vers chaque Destination dont le Filtre le retient, et vers elles seules. */
describe('Filtre des Destinations', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    pipeline = await startPipeline();
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  /** Un Projet avec deux Destinations : les Bugs graves seulement, et tout. */
  async function projetADeuxDestinations(nom: string) {
    const { projet, cleSecrete } = await pipeline.createProjet({ nom });
    const bugsGraves = await pipeline.createDestination(projet.id, {
      nom: 'Bugs graves',
      filtre: { types: ['bug'], graviteMinimale: 'majeure' },
    });
    const suggestions = await pipeline.createDestination(projet.id, {
      nom: 'Suggestions et Questions',
      filtre: { types: ['suggestion', 'question'], graviteMinimale: null },
    });
    return { cleSecrete, bugsGraves, suggestions };
  }

  async function poster(cleSecrete: string, texte: string) {
    const reponse = await pipeline.postRetour(cleSecrete, { texte });
    return ((await reponse.json()) as { id: string }).id;
  }

  it('un Bug bloquant part vers la Destination des Bugs graves seulement', async () => {
    const { cleSecrete, bugsGraves, suggestions } = await projetADeuxDestinations('Bloquant');
    pipeline.juge.script({ type: 'bug', gravite: 'bloquante' });

    const id = await poster(cleSecrete, 'Plus personne ne peut payer');

    const retour = await pipeline.waitForRetour(id, (r) =>
      r.envois.some((e) => e.statut === 'livre'),
    );
    expect(retour.etat).toBe('dispatche');
    expect(retour.envois.map((e) => e.destinationId)).toEqual([bugsGraves.destination.id]);
    expect(suggestions.fake.attempts).toHaveLength(0);
  });

  it('un Retour part vers toutes les Destinations dont le Filtre le retient, et y est livré', async () => {
    const { projet, cleSecrete } = await pipeline.createProjet({ nom: 'Plusieurs outils' });
    const bugsGraves = await pipeline.createDestination(projet.id, {
      nom: 'Bugs graves',
      filtre: { types: ['bug'], graviteMinimale: 'majeure' },
    });
    const tout = await pipeline.createDestination(projet.id, { nom: 'Tout' });
    const suggestions = await pipeline.createDestination(projet.id, {
      nom: 'Suggestions',
      filtre: { types: ['suggestion'], graviteMinimale: null },
    });
    pipeline.juge.script({ type: 'bug', gravite: 'bloquante' });

    const id = await poster(cleSecrete, 'Le site est inaccessible');

    const retour = await pipeline.waitForRetour(
      id,
      (r) => r.envois.length === 2 && r.envois.every((e) => e.statut === 'livre'),
    );
    expect(retour.etat).toBe('dispatche');
    expect(retour.envois.map((e) => e.destinationId).sort()).toEqual(
      [bugsGraves.destination.id, tout.destination.id].sort(),
    );
    for (const { fake } of [bugsGraves, tout]) {
      expect(fake.envois.map((envoi) => envoi.retour.id)).toEqual([id]);
    }
    expect(suggestions.fake.attempts).toHaveLength(0);
  });

  it('la Gravité minimale est un seuil inclusif', async () => {
    const { cleSecrete, bugsGraves } = await projetADeuxDestinations('Seuil');
    pipeline.juge.script({ type: 'bug', gravite: 'majeure' });

    const id = await poster(cleSecrete, 'Le paiement échoue une fois sur deux');

    const retour = await pipeline.waitForRetour(id, (r) => r.etat === 'dispatche');
    expect(retour.envois.map((e) => e.destinationId)).toEqual([bugsGraves.destination.id]);
  });

  it('une Suggestion part vers la Destination qui retient son Type', async () => {
    const { cleSecrete, bugsGraves, suggestions } = await projetADeuxDestinations('Suggestion');
    pipeline.juge.script({ type: 'suggestion', gravite: 'bloquante' });

    const id = await poster(cleSecrete, 'Un export CSV serait utile');

    const retour = await pipeline.waitForRetour(id, (r) => r.etat === 'dispatche');
    expect(retour.envois.map((e) => e.destinationId)).toEqual([suggestions.destination.id]);
    expect(bugsGraves.fake.attempts).toHaveLength(0);
  });

  it('aucun Filtre ne retient le Retour : il reste Trié, sans Envoi', async () => {
    const { cleSecrete, bugsGraves, suggestions } = await projetADeuxDestinations('Personne');
    pipeline.juge.script({ type: 'bug', gravite: 'mineure' });

    const id = await poster(cleSecrete, 'Une faute de frappe dans le pied de page');

    const retour = await pipeline.waitForRetour(id, (r) => r.verdict !== null);
    // Le Triage et le Dispatch se suivent dans le même job : rien ne part ensuite.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await pipeline.readRetour(id)).toMatchObject({ etat: 'trie', envois: [] });
    expect(retour.verdict).toMatchObject({ typeRetenu: 'bug', gravite: 'mineure' });
    expect(bugsGraves.fake.attempts).toHaveLength(0);
    expect(suggestions.fake.attempts).toHaveLength(0);
  });

  it('un Filtre modifié depuis le dashboard vaut pour le Retour suivant', async () => {
    const { projet, cleSecrete } = await pipeline.createProjet({ nom: 'Filtre modifié' });
    const membre = await pipeline.signIn();
    const creation = await membre.post<{ destination: { id: string } }>(
      `/api/projets/${projet.id}/destinations`,
      {
        type: 'webhook',
        nom: 'Avis seulement',
        config: { url: 'https://recepteur.test/avis' },
        filtre: { types: ['avis'], graviteMinimale: null },
      },
    );
    const destinationId = creation.body.destination.id;
    const modification = await membre.patch(`/api/destinations/${destinationId}`, {
      filtre: { types: ['bug'], graviteMinimale: 'mineure' },
    });
    expect(modification.status).toBe(200);
    pipeline.juge.script({ type: 'bug', gravite: 'mineure' });

    const id = await poster(cleSecrete, 'Le bouton Retour ne fait rien');

    const retour = await pipeline.waitForRetour(id, (r) =>
      r.envois.some((e) => e.statut === 'livre'),
    );
    expect(retour.envois.map((e) => e.destinationId)).toEqual([destinationId]);
    expect(pipeline.fakeDestination(destinationId).envois).toHaveLength(1);
  });
});

describe('Filtre en mode dégradé, sans Juge', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    pipeline = await startPipeline({ juge: null });
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  it('un Retour sans Gravité n’atteint aucune Gravité minimale', async () => {
    const { projet, cleSecrete } = await pipeline.createProjet({ nom: 'Dégradé' });
    const exigeante = await pipeline.createDestination(projet.id, {
      filtre: { types: ['bug'], graviteMinimale: 'cosmetique' },
    });
    const sansGravite = await pipeline.createDestination(projet.id, {
      filtre: { types: ['bug'], graviteMinimale: null },
    });

    const reponse = await pipeline.postRetour(cleSecrete, { texte: 'Ça plante', type: 'bug' });
    const { id } = (await reponse.json()) as { id: string };

    const retour = await pipeline.waitForRetour(id, (r) =>
      r.envois.some((e) => e.statut === 'livre'),
    );
    expect(retour.verdict).toMatchObject({ typeRetenu: 'bug', gravite: null });
    expect(retour.envois.map((e) => e.destinationId)).toEqual([sansGravite.destination.id]);
    expect(exigeante.fake.attempts).toHaveLength(0);
  });
});
