import { creerClient, ErreurNudge } from '@nudge/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPipeline, type Pipeline } from './harness/index.js';

describe('SDK JS (clé secrète)', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    pipeline = await startPipeline();
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  it('envoie un Retour de Source api, Auteur attesté, que le pipeline trie et dispatche', async () => {
    const { projet, cleSecrete } = await pipeline.createProjet({ nom: 'Support' });
    const { fake } = await pipeline.createDestination(projet.id);
    pipeline.juge.script({ type: 'bug', gravite: 'majeure' });
    const nudge = creerClient({ url: pipeline.url, cleSecrete });

    const recu = await nudge.envoyerRetour({
      texte: 'L’export CSV est vide depuis ce matin',
      type: 'bug',
      auteur: { id: 'u-42', email: 'ada@client.test', nom: 'Ada' },
      contexte: { metadonnees: { canal: 'support', version: '3.1.0' } },
    });

    expect(recu).toEqual({ id: expect.any(String), etat: 'recu' });
    const retour = await pipeline.waitForRetour(recu.id, (r) =>
      r.envois.some((envoi) => envoi.statut === 'livre'),
    );
    expect(retour).toMatchObject({
      etat: 'dispatche',
      source: 'api',
      texte: 'L’export CSV est vide depuis ce matin',
      typeDeclare: 'bug',
      auteur: { id: 'u-42', email: 'ada@client.test', nom: 'Ada' },
      confianceAuteur: 'attestee',
      contexte: { metadonnees: { canal: 'support', version: '3.1.0' } },
    });
    expect(fake.envois).toHaveLength(1);
  });

  it('rejette un Retour refusé par l’Instance avec le code de l’API et le détail des champs', async () => {
    const { cleSecrete } = await pipeline.createProjet({ nom: 'Refus' });
    const nudge = creerClient({ url: `${pipeline.url}/`, cleSecrete });

    const refus = await nudge
      .envoyerRetour({ texte: 'Bonjour', contexte: { url: 'pas une url' } })
      .catch((erreur: unknown) => erreur);

    expect(refus).toBeInstanceOf(ErreurNudge);
    expect(refus).toMatchObject({
      statut: 400,
      code: 'retour_invalide',
      details: [{ chemin: 'contexte.url', message: expect.any(String) }],
    });
  });

  it('rejette une clé secrète inconnue ou révoquée', async () => {
    const nudge = creerClient({ url: pipeline.url, cleSecrete: 'nk_sec_revoquee' });

    await expect(nudge.envoyerRetour({ texte: 'Bonjour' })).rejects.toMatchObject({
      name: 'ErreurNudge',
      statut: 401,
      code: 'cle_invalide',
    });
  });

  it('n’atteste pas un Auteur sans identité', async () => {
    const { cleSecrete } = await pipeline.createProjet({ nom: 'Anonyme' });
    const nudge = creerClient({ url: pipeline.url, cleSecrete });

    const { id } = await nudge.envoyerRetour({ texte: 'Merci pour la mise à jour', auteur: {} });

    expect(await pipeline.readRetour(id)).toMatchObject({ auteur: null, confianceAuteur: null });
  });
});
