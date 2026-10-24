import type { StockageCaptures } from '@nudge/stockage';
import {
  OCTETS_CAPTURE_MAX,
  urlCapture,
  type ApiErrorBody,
  type PageRetours,
  type RetourDetailVu,
} from '@nudge/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPipeline, type DashboardClient, type Pipeline } from './harness/index.js';

const ORIGINE = 'https://boutique.exemple';

/** Une image PNG de 1 × 1 pixel. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const SIGNATURE_PNG = PNG.subarray(0, 8);
const SIGNATURE_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);

const capturePng = { contentType: 'image/png', data: PNG.toString('base64') } as const;

describe('Captures', () => {
  let pipeline: Pipeline;
  let clePublique: string;
  let cleSecrete: string;
  let membre: DashboardClient;

  beforeAll(async () => {
    pipeline = await startPipeline();
    ({ clePublique, cleSecrete } = await pipeline.createProjet({
      nom: 'Boutique',
      originesAutorisees: [ORIGINE],
    }));
    membre = await pipeline.signIn();
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  async function posterAvecCapture(texte: string, capture: object = capturePng) {
    const reponse = await pipeline.postRetourWidget(clePublique, ORIGINE, { texte, capture });
    expect(reponse.status).toBe(202);
    const { id } = (await reponse.json()) as { id: string };
    return id;
  }

  it('stocke la Capture jointe par le Widget et la montre au Membre, octet pour octet', async () => {
    const id = await posterAvecCapture('Le panier déborde de l’écran');

    const detail = await membre.get<RetourDetailVu>(`/api/retours/${id}`);
    expect(detail.body.capture).toEqual({ contentType: 'image/png', octets: PNG.length });
    const image = await membre.telecharger(urlCapture(id));
    expect(image.status).toBe(200);
    expect(image.enTetes.get('content-type')).toBe('image/png');
    expect(image.enTetes.get('x-content-type-options')).toBe('nosniff');
    expect(image.octets).toEqual(new Uint8Array(PNG));
  });

  it('accepte aussi une Capture postée avec la clé secrète', async () => {
    const reponse = await pipeline.postRetour(cleSecrete, {
      texte: 'Capture envoyée par le backend',
      capture: { contentType: 'image/jpeg', data: SIGNATURE_JPEG.toString('base64') },
    });
    expect(reponse.status).toBe(202);
    const { id } = (await reponse.json()) as { id: string };

    expect((await membre.get<RetourDetailVu>(`/api/retours/${id}`)).body.capture).toEqual({
      contentType: 'image/jpeg',
      octets: SIGNATURE_JPEG.length,
    });
  });

  it('un Retour sans Capture n’en montre aucune', async () => {
    const reponse = await pipeline.postRetourWidget(clePublique, ORIGINE, { texte: 'Sans image' });
    const { id } = (await reponse.json()) as { id: string };

    expect((await membre.get<RetourDetailVu>(`/api/retours/${id}`)).body.capture).toBeNull();
    const image = await membre.telecharger(urlCapture(id));
    expect(image.status).toBe(404);
    expect(image.json<ApiErrorBody>()).toEqual({ erreur: 'capture_introuvable' });
  });

  it('ne montre la Capture qu’à un Membre connecté', async () => {
    const id = await posterAvecCapture('Réservé aux Membres');

    expect((await pipeline.dashboard().telecharger(urlCapture(id))).status).toBe(401);
  });

  it('ne transmet jamais la Capture au Juge', async () => {
    const texte = 'Le logo est pixelisé sur mobile';
    const id = await posterAvecCapture(texte);
    await pipeline.waitForRetour(id, (retour) => retour.etat !== 'recu');

    const requetes = pipeline.juge.requests.filter((requete) => requete.state.texte === texte);
    expect(requetes).toHaveLength(1);
    const brut = JSON.stringify(requetes);
    expect(brut).not.toContain(capturePng.data);
    expect(brut).not.toMatch(/capture/i);
  });

  it('joint la Capture à chaque Envoi, et rien à un Retour qui n’en a pas', async () => {
    const { projet, clePublique: cle } = await pipeline.createProjet({
      nom: 'Dispatch des Captures',
      originesAutorisees: [ORIGINE],
    });
    const { fake } = await pipeline.createDestination(projet.id);
    const avec = (await (
      await pipeline.postRetourWidget(cle, ORIGINE, { texte: 'Avec Capture', capture: capturePng })
    ).json()) as { id: string };
    const sans = (await (
      await pipeline.postRetourWidget(cle, ORIGINE, { texte: 'Sans Capture' })
    ).json()) as { id: string };
    await pipeline.waitForRetour(avec.id, (retour) => retour.etat === 'dispatche');
    await pipeline.waitForRetour(sans.id, (retour) => retour.etat === 'dispatche');
    await expect.poll(() => fake.envois.length).toBe(2);

    const envoiAvec = fake.envois.find((envoi) => envoi.retour.id === avec.id)!;
    const envoiSans = fake.envois.find((envoi) => envoi.retour.id === sans.id)!;
    expect(envoiAvec.retour.capture).toMatchObject({
      contentType: 'image/png',
      octets: PNG.length,
    });
    expect(await envoiAvec.retour.capture!.lire()).toEqual(new Uint8Array(PNG));
    expect(envoiSans.retour.capture).toBeNull();
  });

  it.each([
    ['un format non pris en charge', { contentType: 'image/gif', data: 'R0lGODlhAQABAAAAACw=' }],
    [
      'un PNG annoncé qui n’en est pas un',
      { contentType: 'image/png', data: SIGNATURE_JPEG.toString('base64') },
    ],
    [
      'du HTML déguisé en image',
      {
        contentType: 'image/png',
        data: Buffer.from('<script>alert(1)</script>').toString('base64'),
      },
    ],
    ['un contenu qui n’est pas du base64', { contentType: 'image/png', data: 'pas du base64 !' }],
    ['une Capture vide', { contentType: 'image/png', data: '' }],
    [
      'une Capture trop lourde',
      {
        contentType: 'image/png',
        data: Buffer.concat([SIGNATURE_PNG, Buffer.alloc(OCTETS_CAPTURE_MAX)]).toString('base64'),
      },
    ],
  ])('refuse %s, sans rien enregistrer', async (_cas, capture) => {
    const texte = `Capture refusée ${crypto.randomUUID()}`;
    const reponse = await pipeline.postRetourWidget(clePublique, ORIGINE, { texte, capture });

    expect(reponse.status).toBe(400);
    const corps = (await reponse.json()) as ApiErrorBody;
    expect(corps.erreur).toBe('retour_invalide');
    expect(corps.details?.every((detail) => detail.chemin.startsWith('capture'))).toBe(true);
    const page = await membre.get<PageRetours>('/api/retours?limite=100');
    expect(page.body.retours.some((retour) => retour.apercu === texte)).toBe(false);
  });
});

describe('Captures, stockage indisponible', () => {
  let pipeline: Pipeline;

  const stockageEnPanne: StockageCaptures = {
    enregistrer: () => Promise.reject(new Error('disque plein')),
    lire: () => Promise.reject(new Error('disque illisible')),
    supprimer: () => Promise.resolve(),
  };

  beforeAll(async () => {
    pipeline = await startPipeline({ stockage: stockageEnPanne });
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  it('refuse le Retour plutôt que de perdre sa Capture en silence', async () => {
    const { projet, clePublique } = await pipeline.createProjet({
      nom: 'Stockage en panne',
      originesAutorisees: [ORIGINE],
    });

    const reponse = await pipeline.postRetourWidget(clePublique, ORIGINE, {
      texte: 'Ma Capture ne sera pas perdue',
      capture: capturePng,
    });

    expect(reponse.status).toBe(500);
    const membre = await pipeline.signIn();
    const page = await membre.get<PageRetours>(`/api/retours?projet=${projet.id}`);
    expect(page.body.retours).toEqual([]);
  });
});
