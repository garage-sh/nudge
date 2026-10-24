import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPipeline, type Pipeline } from './harness/index.js';

/** Un Envoi est identifié par (Retour, Destination) : rejouer un job ne crée pas de doublon. */
describe('Idempotence des Envois', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    pipeline = await startPipeline();
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  async function retourLivre(nom: string) {
    const { projet, cleSecrete } = await pipeline.createProjet({ nom });
    const { fake } = await pipeline.createDestination(projet.id);
    pipeline.juge.script({ type: 'bug', gravite: 'majeure' });
    const reponse = await pipeline.postRetour(cleSecrete, { texte: `Retour de ${nom}` });
    const { id } = (await reponse.json()) as { id: string };
    const retour = await pipeline.waitForRetour(id, (r) =>
      r.envois.some((e) => e.statut === 'livre'),
    );
    return { retour, fake };
  }

  it('un job de Triage rejoué ne crée ni second Envoi ni second appel à la Destination', async () => {
    const { retour, fake } = await retourLivre('Triage rejoué');

    await pipeline.rejouerTriage(retour.id);

    const apres = await pipeline.readRetour(retour.id);
    expect(apres?.envois).toEqual(retour.envois);
    expect(fake.attempts).toHaveLength(1);
  });

  it('un job de Triage rejoué après le Dispatch ne sert pas une Destination ajoutée depuis', async () => {
    const { retour, fake } = await retourLivre('Destination ajoutée après');
    const ajoutee = await pipeline.createDestination(retour.projetId, { nom: 'Ajoutée après' });

    await pipeline.rejouerTriage(retour.id);

    expect((await pipeline.readRetour(retour.id))?.envois).toEqual(retour.envois);
    expect(ajoutee.fake.attempts).toHaveLength(0);
    expect(fake.attempts).toHaveLength(1);
  });

  it('un job de Dispatch rejoué ne livre pas une seconde fois un Envoi déjà livré', async () => {
    const { retour, fake } = await retourLivre('Dispatch rejoué');
    const [envoi] = retour.envois;

    await pipeline.rejouerDispatch(envoi!.id);

    expect((await pipeline.readRetour(retour.id))?.envois).toEqual(retour.envois);
    expect(fake.attempts).toHaveLength(1);
  });
});
