import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPipeline, type Pipeline } from './harness/index.js';

/**
 * Filet contre la perte d'un Retour entre son insertion et sa mise en queue (pas
 * d'outbox) ou après l'épuisement des retries du Triage : un balayage périodique
 * remet au Triage les Retours restés Reçu au-delà d'un délai.
 */
describe('Balayage des Retours restés Reçu', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    pipeline = await startPipeline({ balayage: { delaiMs: 300, intervalleMs: 100 } });
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  it('un Retour enregistré mais jamais mis en queue finit trié et dispatché', async () => {
    const { projet } = await pipeline.createProjet({ nom: 'Mise en queue perdue' });
    const { fake } = await pipeline.createDestination(projet.id);
    pipeline.juge.script({ type: 'bug', gravite: 'majeure' });

    const id = await pipeline.insererRetourSansTriage(projet.id, { texte: 'Perdu en route' });

    const retour = await pipeline.waitForRetour(
      id,
      (r) => r.envois.some((envoi) => envoi.statut === 'livre'),
      10_000,
    );
    expect(retour).toMatchObject({ etat: 'dispatche', verdict: { typeRetenu: 'bug' } });
    expect(fake.envois).toHaveLength(1);
  });

  it('un Retour dont le Triage a épuisé ses retries est retenté quand le Juge revient', async () => {
    const { projet, cleSecrete } = await pipeline.createProjet({ nom: 'Juge longtemps absent' });
    await pipeline.createDestination(projet.id);
    pipeline.juge.script({ type: 'suggestion', gravite: 'mineure' });
    pipeline.juge.fail(1000);
    const texte = 'Le Juge revient plus tard';

    const reponse = await pipeline.postRetour(cleSecrete, { texte });
    const { id } = (await reponse.json()) as { id: string };
    // Les 8 tentatives du job échouent : sans balayage, le Retour resterait Reçu.
    await expect
      .poll(() => pipeline.juge.requests.filter((r) => r.state.texte === texte).length, {
        timeout: 10_000,
      })
      .toBeGreaterThanOrEqual(8);
    expect(await pipeline.readRetour(id)).toMatchObject({ etat: 'recu' });

    pipeline.juge.fail(0);
    const retour = await pipeline.waitForRetour(id, (r) => r.etat === 'dispatche', 10_000);
    expect(retour.verdict).toMatchObject({ typeRetenu: 'suggestion' });
  });

  it('un Retour Reçu récent n’est pas remis en queue : un seul Triage', async () => {
    const { cleSecrete } = await pipeline.createProjet({ nom: 'Pas de doublon' });
    const release = pipeline.juge.hold();
    const texte = 'Triage lent mais en cours';

    const reponse = await pipeline.postRetour(cleSecrete, { texte });
    const { id } = (await reponse.json()) as { id: string };
    // Plusieurs balayages passent pendant que le job est actif.
    await new Promise((resolve) => setTimeout(resolve, 800));
    release();

    await pipeline.waitForRetour(id, (r) => r.etat === 'trie');
    expect(pipeline.juge.requests.filter((r) => r.state.texte === texte)).toHaveLength(1);
  });
});

/**
 * Filet contre un Envoi bloqué en attente (D26) : sa mise en queue a échoué après le
 * commit (Redis tombé pendant le dispatch) ou son job a échoué sans le terminer
 * (Postgres tombé). Le balayage le remet au dispatch, sans doubler un job en cours.
 */
describe('Balayage des Envois restés en attente', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    pipeline = await startPipeline({ balayage: { delaiMs: 300, intervalleMs: 100 } });
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  it('un Envoi enregistré mais jamais mis en queue finit livré', async () => {
    const { projet, cleSecrete } = await pipeline.createProjet({ nom: 'Envoi orphelin' });
    // Le Filtre ne retient pas le Retour : il reste Trié, sans Envoi ni job.
    const { destination, fake } = await pipeline.createDestination(projet.id, {
      filtre: { types: ['question'], graviteMinimale: null },
    });
    pipeline.juge.script({ type: 'bug', gravite: 'majeure' });
    const reponse = await pipeline.postRetour(cleSecrete, { texte: 'Envoi perdu en route' });
    const { id } = (await reponse.json()) as { id: string };
    await pipeline.waitForRetour(id, (r) => r.etat === 'trie');

    const envoiId = await pipeline.insererEnvoiSansDispatch(id, destination.id);

    const retour = await pipeline.waitForRetour(
      id,
      (r) => r.envois.some((envoi) => envoi.id === envoiId && envoi.statut === 'livre'),
      10_000,
    );
    expect(retour.envois).toHaveLength(1);
    expect(fake.envois.map((envoi) => envoi.envoiId)).toEqual([envoiId]);
  });

  it('un Envoi dont le job est en cours n’est pas remis en queue : un seul appel', async () => {
    const { projet, cleSecrete } = await pipeline.createProjet({ nom: 'Envoi lent' });
    const { fake } = await pipeline.createDestination(projet.id);
    pipeline.juge.script({ type: 'bug', gravite: 'majeure' });
    const release = fake.hold();

    const reponse = await pipeline.postRetour(cleSecrete, { texte: 'Destination lente' });
    const { id } = (await reponse.json()) as { id: string };
    await expect.poll(() => fake.attempts.length).toBe(1);
    // Plusieurs balayages passent pendant que le job attend la Destination.
    await new Promise((resolve) => setTimeout(resolve, 800));
    release();

    await pipeline.waitForRetour(id, (r) => r.envois.every((envoi) => envoi.statut === 'livre'));
    expect(fake.attempts).toHaveLength(1);
  });
});
