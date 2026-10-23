import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPipeline, type Pipeline } from './harness/index.js';

describe('Parcours d’un Retour à travers le pipeline', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    pipeline = await startPipeline();
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  it('Reçu → Trié → Dispatché : le Retour posté avec la clé secrète est livré à la Destination du Projet', async () => {
    const { projet, cleSecrete } = await pipeline.createProjet({ nom: 'Boutique' });
    const { destination, fake } = await pipeline.createDestination(projet.id);
    pipeline.juge.script({ type: 'bug', gravite: 'majeure' });
    const release = pipeline.juge.hold();

    const reponse = await pipeline.postRetour(cleSecrete, {
      texte: 'Le bouton « Payer » ne répond plus',
      contexte: { url: 'https://boutique.test/panier' },
    });

    expect(reponse.status).toBe(202);
    const { id } = (await reponse.json()) as { id: string };
    expect(await pipeline.readRetour(id)).toMatchObject({
      etat: 'recu',
      source: 'api',
      envois: [],
    });

    release();
    const retour = await pipeline.waitForRetour(id, (r) =>
      r.envois.some((envoi) => envoi.statut === 'livre'),
    );

    expect(retour).toMatchObject({
      etat: 'dispatche',
      verdict: { typeRetenu: 'bug', gravite: 'majeure' },
      envois: [{ destinationId: destination.id, statut: 'livre', lienExterne: expect.any(String) }],
    });
    expect(fake.envois).toHaveLength(1);
    expect(fake.envois[0]).toMatchObject({
      projet: { id: projet.id, nom: 'Boutique' },
      retour: {
        id,
        texte: 'Le bouton « Payer » ne répond plus',
        typeRetenu: 'bug',
        gravite: 'majeure',
      },
    });
  });

  it('Reçu → Trié : sans Destination, le Retour reste Trié avec son Verdict et sans Envoi', async () => {
    const { cleSecrete } = await pipeline.createProjet({ nom: 'Sans Destination' });
    pipeline.juge.script({ type: 'question', gravite: 'cosmetique' });

    const reponse = await pipeline.postRetour(cleSecrete, { texte: 'Où trouver mes factures ?' });
    const { id } = (await reponse.json()) as { id: string };

    const retour = await pipeline.waitForRetour(id, (r) => r.verdict !== null);
    expect(retour).toMatchObject({
      etat: 'trie',
      verdict: { typeRetenu: 'question', gravite: 'cosmetique' },
      envois: [],
    });
  });

  it('une exception de l’adaptateur est un échec transitoire : l’Envoi est retenté puis livré', async () => {
    const { projet, cleSecrete } = await pipeline.createProjet({ nom: 'Réseau capricieux' });
    const { fake } = await pipeline.createDestination(projet.id);
    fake.scriptSends(new Error('ECONNRESET'));

    const reponse = await pipeline.postRetour(cleSecrete, { texte: 'La page se fige' });
    const { id } = (await reponse.json()) as { id: string };

    const retour = await pipeline.waitForRetour(id, (r) =>
      r.envois.some((envoi) => envoi.statut === 'livre'),
    );
    expect(retour.envois).toMatchObject([{ statut: 'livre', tentatives: 2 }]);
    expect(fake.attempts).toHaveLength(2);
    expect(fake.envois).toHaveLength(1);
  });
});
