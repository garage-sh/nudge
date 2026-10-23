import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPipeline, type Pipeline } from './harness/index.js';

describe('Ingestion par clé secrète', () => {
  let pipeline: Pipeline;
  let cleSecrete: string;

  beforeAll(async () => {
    pipeline = await startPipeline();
    ({ cleSecrete } = await pipeline.createProjet({ nom: 'Ingestion' }));
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  it('refuse un appel sans clé secrète ou avec une clé inconnue', async () => {
    const sansCle = await fetch(`${pipeline.url}/v1/retours`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ texte: 'Bonjour' }),
    });
    const cleInconnue = await pipeline.postRetour('nk_sec_inconnue', { texte: 'Bonjour' });

    expect(sansCle.status).toBe(401);
    expect(cleInconnue.status).toBe(401);
  });

  it.each([
    ['un texte vide', { texte: '   ' }],
    ['un texte trop long', { texte: 'a'.repeat(5001) }],
    ['un champ inconnu', { texte: 'Bonjour', priorite: 'haute' }],
    ['un Type inconnu', { texte: 'Bonjour', type: 'plainte' }],
    ['une URL de contexte invalide', { texte: 'Bonjour', contexte: { url: 'pas une url' } }],
    [
      'trop de métadonnées',
      {
        texte: 'Bonjour',
        contexte: {
          metadonnees: Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, i])),
        },
      },
    ],
  ])('refuse %s', async (_cas, corps) => {
    const reponse = await pipeline.postRetour(cleSecrete, corps);

    expect(reponse.status).toBe(400);
    expect(await reponse.json()).toMatchObject({ erreur: 'retour_invalide' });
  });

  it('stocke le texte tel quel, sans ses caractères de contrôle, et marque l’Auteur comme attesté', async () => {
    const reponse = await pipeline.postRetour(cleSecrete, {
      texte: '  Ligne 1\u0000\u0007\nLigne 2\u001b\u009b',
      type: 'suggestion',
      auteur: { id: 'u-42', email: 'ada@exemple.test', nom: 'Ada\u0008' },
      contexte: {
        userAgent: 'Mozilla/5.0',
        viewport: { largeur: 1280, hauteur: 800 },
        metadonnees: { version: '2.3.1', beta: true },
      },
    });

    expect(reponse.status).toBe(202);
    const { id } = (await reponse.json()) as { id: string };
    expect(await pipeline.readRetour(id)).toMatchObject({
      source: 'api',
      texte: '  Ligne 1\nLigne 2',
      typeDeclare: 'suggestion',
      auteur: { id: 'u-42', email: 'ada@exemple.test', nom: 'Ada' },
      confianceAuteur: 'attestee',
      contexte: {
        userAgent: 'Mozilla/5.0',
        viewport: { largeur: 1280, hauteur: 800 },
        metadonnees: { version: '2.3.1', beta: true },
      },
    });
  });
});
