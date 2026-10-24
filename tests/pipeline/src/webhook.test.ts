import { createHmac, timingSafeEqual } from 'node:crypto';
import type { DestinationAvecSecretsGeneres } from '@nudge/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  RecepteurWebhook,
  startPipeline,
  type DashboardClient,
  type Pipeline,
  type RequeteWebhook,
} from './harness/index.js';

/** Ce que ferait un récepteur : recalculer la signature avec le secret montré à la création. */
function signatureValide(requete: RequeteWebhook, secret: string): boolean {
  const horodatage = requete.entetes['x-nudge-timestamp'];
  const recue = String(requete.entetes['x-nudge-signature'] ?? '');
  const attendue = `sha256=${createHmac('sha256', secret).update(`${horodatage}.${requete.corps}`).digest('hex')}`;
  return (
    recue.length === attendue.length && timingSafeEqual(Buffer.from(recue), Buffer.from(attendue))
  );
}

/** Les vrais adaptateurs de `@nudge/destinations`, contre un récepteur HTTP local. */
describe('Destination webhook de bout en bout', () => {
  let pipeline: Pipeline;
  let recepteur: RecepteurWebhook;
  let membre: DashboardClient;

  beforeAll(async () => {
    [pipeline, recepteur] = await Promise.all([
      startPipeline({ destinations: 'reelles' }),
      RecepteurWebhook.demarrer(),
    ]);
    membre = await pipeline.signIn();
  });

  afterAll(async () => {
    await Promise.all([pipeline?.stop(), recepteur?.arreter()]);
  });

  async function destinationWebhook(nom: string) {
    const { projet, cleSecrete } = await pipeline.createProjet({ nom });
    const chemin = `/${encodeURIComponent(nom)}`;
    const creation = await membre.post<DestinationAvecSecretsGeneres>(
      `/api/projets/${projet.id}/destinations`,
      {
        type: 'webhook',
        nom: 'Récepteur local',
        config: { url: `${recepteur.url}${chemin}` },
        filtre: { types: ['bug'], graviteMinimale: null },
      },
    );
    expect(creation.status).toBe(201);
    return { projet, cleSecrete, chemin, ...creation.body };
  }

  it('un Retour Trié arrive signé chez le récepteur, et l’Envoi est livré', async () => {
    const { projet, cleSecrete, chemin, destination, secretsGeneres } =
      await destinationWebhook('Signé');
    pipeline.juge.script({ type: 'bug', gravite: 'majeure' });

    const reponse = await pipeline.postRetour(cleSecrete, { texte: '@everyone le panier plante' });
    const { id } = (await reponse.json()) as { id: string };

    const retour = await pipeline.waitForRetour(id, (r) =>
      r.envois.some((e) => e.statut === 'livre'),
    );
    const recues = recepteur.requetes.filter((r) => r.chemin === chemin);
    expect(recues).toHaveLength(1);
    expect(signatureValide(recues[0]!, secretsGeneres.secretSignature!)).toBe(true);
    expect(JSON.parse(recues[0]!.corps)).toMatchObject({
      evenement: 'retour',
      essai: false,
      envoi: { id: retour.envois[0]!.id },
      projet: { id: projet.id },
      retour: { id, texte: '@everyone le panier plante', type: 'bug', gravite: 'majeure' },
    });
    expect(retour.envois).toMatchObject([{ destinationId: destination.id, statut: 'livre' }]);
  });

  it('la Capture du Retour part en base64 dans le corps signé', async () => {
    const { cleSecrete, chemin, secretsGeneres } = await destinationWebhook('Avec Capture');
    pipeline.juge.script({ type: 'bug', gravite: 'majeure' });
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x2a, 0x2a]);

    const reponse = await pipeline.postRetour(cleSecrete, {
      texte: 'Voir la capture',
      capture: { contentType: 'image/png', data: png.toString('base64') },
    });
    const { id } = (await reponse.json()) as { id: string };

    await pipeline.waitForRetour(id, (r) => r.envois.some((e) => e.statut === 'livre'));
    const [recue] = recepteur.requetes.filter((r) => r.chemin === chemin);
    expect(signatureValide(recue!, secretsGeneres.secretSignature!)).toBe(true);
    expect(JSON.parse(recue!.corps).retour.capture).toEqual({
      contentType: 'image/png',
      data: png.toString('base64'),
    });
  });

  it('« tester » envoie un Retour d’exemple signé, et rend le refus du récepteur', async () => {
    const { chemin, destination, secretsGeneres } = await destinationWebhook('Essai');

    const livre = await membre.post(`/api/destinations/${destination.id}/test`);

    expect(livre.body).toEqual({ statut: 'livre', lienExterne: null });
    const [essai] = recepteur.requetes.filter((r) => r.chemin === chemin);
    expect(JSON.parse(essai!.corps)).toMatchObject({ evenement: 'retour', essai: true });
    expect(signatureValide(essai!, secretsGeneres.secretSignature!)).toBe(true);

    recepteur.repondre(chemin, 401, 'signature inconnue');
    expect((await membre.post(`/api/destinations/${destination.id}/test`)).body).toEqual({
      statut: 'echec',
      classe: 'auth',
      message: 'HTTP 401 : signature inconnue',
    });
  });

  it('après régénération, seul le nouveau secret vérifie la signature', async () => {
    const { chemin, destination, secretsGeneres } = await destinationWebhook('Rotation');
    const regeneration = await membre.post<DestinationAvecSecretsGeneres>(
      `/api/destinations/${destination.id}/secrets-generes`,
    );

    await membre.post(`/api/destinations/${destination.id}/test`);

    const [essai] = recepteur.requetes.filter((r) => r.chemin === chemin);
    expect(signatureValide(essai!, regeneration.body.secretsGeneres.secretSignature!)).toBe(true);
    expect(signatureValide(essai!, secretsGeneres.secretSignature!)).toBe(false);
  });
});
