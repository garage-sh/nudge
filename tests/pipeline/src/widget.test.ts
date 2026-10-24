import type { ProjetVu } from '@nudge/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPipeline, type Pipeline } from './harness/index.js';

const ORIGINE = 'https://boutique.exemple';

describe('Ingestion par clé publique (Widget)', () => {
  let pipeline: Pipeline;
  let clePublique: string;

  beforeAll(async () => {
    pipeline = await startPipeline();
    ({ clePublique } = await pipeline.createProjet({
      nom: 'Boutique',
      originesAutorisees: [ORIGINE, 'http://localhost:5173'],
    }));
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  it('enregistre un Retour de Source widget, Auteur déclaré, puis le trie', async () => {
    const reponse = await pipeline.postRetourWidget(clePublique, ORIGINE, {
      texte: 'Le bouton payer ne répond pas',
      type: 'bug',
      auteur: { id: 'u-7', email: 'ada@exemple.test', nom: 'Ada' },
      contexte: {
        url: 'https://boutique.exemple/panier',
        userAgent: 'Mozilla/5.0',
        viewport: { largeur: 390, hauteur: 844 },
        metadonnees: { version: '4.2.0' },
      },
    });

    expect(reponse.status).toBe(202);
    expect(reponse.headers.get('access-control-allow-origin')).toBe(ORIGINE);
    const { id } = (await reponse.json()) as { id: string };
    expect(
      await pipeline.waitForRetour(id, (r) => r.etat === 'dispatche' || r.etat === 'trie'),
    ).toMatchObject({
      source: 'widget',
      texte: 'Le bouton payer ne répond pas',
      typeDeclare: 'bug',
      auteur: { id: 'u-7', email: 'ada@exemple.test', nom: 'Ada' },
      confianceAuteur: 'declaree',
      contexte: { url: 'https://boutique.exemple/panier', metadonnees: { version: '4.2.0' } },
    });
  });

  it('répond au preflight CORS du navigateur', async () => {
    const reponse = await fetch(`${pipeline.url}/v1/retours`, {
      method: 'OPTIONS',
      headers: {
        origin: ORIGINE,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization, content-type',
      },
    });

    expect(reponse.status).toBe(204);
    expect(reponse.headers.get('access-control-allow-origin')).toBe(ORIGINE);
    expect(reponse.headers.get('access-control-allow-methods')).toContain('POST');
    expect(reponse.headers.get('access-control-allow-headers')?.toLowerCase()).toContain(
      'authorization',
    );
  });

  it.each([
    ['une origine absente de la liste du Projet', 'https://pirate.exemple'],
    ['une origine voisine (sous-domaine)', 'https://www.boutique.exemple'],
    ['une origine au port différent', 'http://localhost:5174'],
    ['une requête sans origine', null],
  ])('refuse %s', async (_cas, origine) => {
    const reponse = await pipeline.postRetourWidget(clePublique, origine, { texte: 'Bonjour' });

    expect(reponse.status).toBe(403);
    expect(await reponse.json()).toMatchObject({ erreur: 'origine_refusee' });
  });

  it('refuse une clé publique inconnue', async () => {
    const reponse = await pipeline.postRetourWidget('nk_pub_inconnue', ORIGINE, {
      texte: 'Bonjour',
    });

    expect(reponse.status).toBe(401);
    expect(await reponse.json()).toMatchObject({ erreur: 'cle_invalide' });
  });

  it('refuse un Retour malformé', async () => {
    const reponse = await pipeline.postRetourWidget(clePublique, ORIGINE, { texte: '  ' });

    expect(reponse.status).toBe(400);
    expect(await reponse.json()).toMatchObject({ erreur: 'retour_invalide' });
  });

  it.each([
    ['dans l’Auteur', { auteur: { id: 'u-7', confiance: 'attestee' } }],
    ['à la racine du Retour', { auteur: { id: 'u-7' }, confianceAuteur: 'attestee' }],
  ])('refuse un navigateur qui prétend attester l’Auteur %s', async (_cas, champs) => {
    const reponse = await pipeline.postRetourWidget(clePublique, ORIGINE, {
      texte: 'Bonjour',
      ...champs,
    });

    expect(reponse.status).toBe(400);
    expect(await reponse.json()).toMatchObject({ erreur: 'retour_invalide' });
  });

  it('refuse l’ancienne clé publique après régénération, accepte la nouvelle', async () => {
    const membre = await pipeline.signIn();
    const { body } = await membre.post<{ projet: ProjetVu }>('/api/projets', {
      nom: 'Régénérée',
      originesAutorisees: [ORIGINE],
    });
    const ancienne = body.projet.clePublique;

    const regeneration = await membre.post<ProjetVu>(`/api/projets/${body.projet.id}/cle-publique`);

    const nouvelle = regeneration.body.clePublique;
    expect((await pipeline.postRetourWidget(ancienne, ORIGINE, { texte: 'Ancienne' })).status).toBe(
      401,
    );
    expect((await pipeline.postRetourWidget(nouvelle, ORIGINE, { texte: 'Nouvelle' })).status).toBe(
      202,
    );
  });
});

describe('Rate limit de l’ingestion par clé publique', () => {
  describe('par Projet', () => {
    let pipeline: Pipeline;

    beforeAll(async () => {
      pipeline = await startPipeline({
        limitesWidget: {
          parIp: { limit: 100, windowMs: 60_000 },
          parProjet: { limit: 2, windowMs: 60_000 },
        },
      });
    });

    afterAll(async () => {
      await pipeline?.stop();
    });

    it('refuse au-delà de la limite du Projet, sans toucher aux autres Projets', async () => {
      const { clePublique: inonde } = await pipeline.createProjet({
        nom: 'Inondé',
        originesAutorisees: [ORIGINE],
      });
      const { clePublique: voisin } = await pipeline.createProjet({
        nom: 'Voisin',
        originesAutorisees: [ORIGINE],
      });
      const poster = (cle: string) => pipeline.postRetourWidget(cle, ORIGINE, { texte: 'Encore' });

      const statuts = [(await poster(inonde)).status, (await poster(inonde)).status];
      const refus = await poster(inonde);

      expect(statuts).toEqual([202, 202]);
      expect(refus.status).toBe(429);
      expect(refus.headers.get('retry-after')).toMatch(/^\d+$/);
      // Le Widget lit Retry-After depuis une autre origine : l'en-tête doit être exposé.
      expect(refus.headers.get('access-control-allow-origin')).toBe(ORIGINE);
      expect(refus.headers.get('access-control-expose-headers')).toMatch(/retry-after/i);
      expect(await refus.json()).toMatchObject({ erreur: 'trop_de_retours' });
      expect((await poster(voisin)).status).toBe(202);
    });

    it('ne compte pas la clé secrète dans la limite du Widget', async () => {
      const { clePublique, cleSecrete } = await pipeline.createProjet({
        nom: 'Serveur',
        originesAutorisees: [ORIGINE],
      });
      const widget = () => pipeline.postRetourWidget(clePublique, ORIGINE, { texte: 'Widget' });
      await widget();
      await widget();

      expect((await widget()).status).toBe(429);
      expect((await pipeline.postRetour(cleSecrete, { texte: 'Serveur' })).status).toBe(202);
    });
  });

  describe('par IP', () => {
    let pipeline: Pipeline;

    beforeAll(async () => {
      pipeline = await startPipeline({
        limitesWidget: {
          parIp: { limit: 2, windowMs: 60_000 },
          parProjet: { limit: 100, windowMs: 60_000 },
        },
      });
    });

    afterAll(async () => {
      await pipeline?.stop();
    });

    it('refuse une IP au-delà de sa limite, tous Projets confondus', async () => {
      const [a, b] = await Promise.all(
        ['A', 'B'].map((nom) => pipeline.createProjet({ nom, originesAutorisees: [ORIGINE] })),
      );
      const poster = (cle: string) => pipeline.postRetourWidget(cle, ORIGINE, { texte: 'Encore' });

      const statuts = [
        (await poster(a!.clePublique)).status,
        (await poster(b!.clePublique)).status,
      ];
      const refus = await poster(b!.clePublique);

      expect(statuts).toEqual([202, 202]);
      expect(refus.status).toBe(429);
      expect(await refus.json()).toMatchObject({ erreur: 'trop_de_retours' });
    });
  });
});
