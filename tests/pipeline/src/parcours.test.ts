import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demarrerPipeline, type Pipeline } from './harness/index.js';

describe('Parcours d’un Retour à travers le pipeline', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    pipeline = await demarrerPipeline();
  });

  afterAll(async () => {
    await pipeline?.arreter();
  });

  it('Reçu → Trié → Dispatché : le Retour posté avec la clé secrète est livré à la Destination du Projet', async () => {
    const { projet, cleSecrete } = await pipeline.creerProjet({ nom: 'Boutique' });
    const { destination, fake } = await pipeline.creerDestination(projet.id);
    pipeline.juge.scripter({ type: 'bug', gravite: 'majeure' });
    const liberer = pipeline.juge.retenir();

    const reponse = await pipeline.posterRetour(cleSecrete, {
      texte: 'Le bouton « Payer » ne répond plus',
      contexte: { url: 'https://boutique.test/panier' },
    });

    expect(reponse.status).toBe(202);
    const { id } = (await reponse.json()) as { id: string };
    expect(await pipeline.lireRetour(id)).toMatchObject({
      etat: 'recu',
      source: 'api',
      envois: [],
    });

    liberer();
    const retour = await pipeline.attendreRetour(id, (r) =>
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
});
