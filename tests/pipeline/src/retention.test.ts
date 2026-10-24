import { urlCapture, type ApiErrorBody, type PageRetours } from '@nudge/shared';
import type { StockageCaptures } from '@nudge/stockage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPipeline, type DashboardClient, type Pipeline } from './harness/index.js';

const ORIGINE = 'https://boutique.exemple';

/** Une image PNG de 1 × 1 pixel. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const capturePng = { contentType: 'image/png', data: PNG.toString('base64') } as const;

/**
 * Stockage des Captures en mémoire : le test voit les objets qu'il garde, comme un
 * Self-hoster verrait les fichiers de son volume.
 */
function stockageMemoire() {
  const objets = new Map<string, Uint8Array>();
  const stockage: StockageCaptures = {
    enregistrer: async (cle, contenu) => {
      objets.set(cle, contenu);
    },
    lire: async (cle) => objets.get(cle) ?? null,
    supprimer: async (cle) => {
      objets.delete(cle);
    },
  };
  /** Les objets du stockage qui appartiennent au Retour `id` (sa clé le nomme). */
  const objetsDe = (id: string) => [...objets.keys()].filter((cle) => cle.includes(id));
  return { stockage, objetsDe };
}

/** La Capture du Retour telle que le Membre la télécharge : 200 tant qu'elle existe. */
const statutCapture = (membre: DashboardClient, id: string) =>
  membre.telecharger(urlCapture(id)).then((reponse) => reponse.status);

describe('Suppression d’un Retour', () => {
  let pipeline: Pipeline;
  let membre: DashboardClient;
  let clePublique: string;
  let projetId: string;
  const { stockage, objetsDe } = stockageMemoire();

  beforeAll(async () => {
    pipeline = await startPipeline({ stockage });
    const cree = await pipeline.createProjet({ nom: 'Effacement', originesAutorisees: [ORIGINE] });
    ({ clePublique } = cree);
    projetId = cree.projet.id;
    membre = await pipeline.signIn();
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  async function posterAvecCapture(texte: string) {
    const reponse = await pipeline.postRetourWidget(clePublique, ORIGINE, {
      texte,
      capture: capturePng,
    });
    expect(reponse.status).toBe(202);
    return ((await reponse.json()) as { id: string }).id;
  }

  it('supprime le Retour et sa Capture, du dashboard comme du stockage', async () => {
    const texte = 'Effacez mon Retour, s’il vous plaît';
    const id = await posterAvecCapture(texte);
    await pipeline.waitForRetour(id, (retour) => retour.etat !== 'recu');
    expect(await statutCapture(membre, id)).toBe(200);
    expect(objetsDe(id)).toHaveLength(1);

    const suppression = await membre.delete(`/api/retours/${id}`);

    expect(suppression.status).toBe(204);
    expect((await membre.get<ApiErrorBody>(`/api/retours/${id}`)).status).toBe(404);
    expect(await statutCapture(membre, id)).toBe(404);
    const page = await membre.get<PageRetours>(`/api/retours?projet=${projetId}`);
    expect(page.body.retours.some((retour) => retour.apercu === texte)).toBe(false);
    // L'image elle-même a quitté le stockage, pas seulement sa référence en base.
    expect(objetsDe(id)).toEqual([]);
  });

  it('supprime aussi un Retour sans Capture, et ses Envois', async () => {
    const { fake } = await pipeline.createDestination(projetId);
    const reponse = await pipeline.postRetourWidget(clePublique, ORIGINE, { texte: 'Sans image' });
    const { id } = (await reponse.json()) as { id: string };
    await pipeline.waitForRetour(id, (retour) => retour.envois.some((e) => e.statut === 'livre'));

    expect((await membre.delete(`/api/retours/${id}`)).status).toBe(204);

    expect(await pipeline.readRetour(id)).toBeNull();
    expect(fake.envois.filter((envoi) => envoi.retour.id === id)).toHaveLength(1);
  });

  it('rend 404 pour un Retour inconnu ou déjà supprimé', async () => {
    const id = await posterAvecCapture('Supprimé deux fois');
    expect((await membre.delete(`/api/retours/${id}`)).status).toBe(204);

    const deuxieme = await membre.delete<ApiErrorBody>(`/api/retours/${id}`);
    expect(deuxieme).toEqual({ status: 404, body: { erreur: 'retour_introuvable' } });
    expect((await membre.delete('/api/retours/pas-un-uuid')).status).toBe(404);
  });

  it('réservé à un Membre connecté', async () => {
    const id = await posterAvecCapture('Pas touche');

    expect((await pipeline.dashboard().delete(`/api/retours/${id}`)).status).toBe(401);
    expect((await membre.get(`/api/retours/${id}`)).status).toBe(200);
    expect(objetsDe(id)).toHaveLength(1);
  });
});

describe('Suppression d’un Retour, stockage indisponible', () => {
  let pipeline: Pipeline;
  let enPanne = false;
  const memoire = stockageMemoire();
  const stockage: StockageCaptures = {
    ...memoire.stockage,
    supprimer: (cle) =>
      enPanne ? Promise.reject(new Error('stockage injoignable')) : memoire.stockage.supprimer(cle),
  };

  beforeAll(async () => {
    pipeline = await startPipeline({ stockage });
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  it('garde le Retour tant que sa Capture n’est pas effacée, et la suppression se retente', async () => {
    const { clePublique } = await pipeline.createProjet({
      nom: 'Stockage capricieux',
      originesAutorisees: [ORIGINE],
    });
    const membre = await pipeline.signIn();
    const reponse = await pipeline.postRetourWidget(clePublique, ORIGINE, {
      texte: 'Effacement à retenter',
      capture: capturePng,
    });
    const { id } = (await reponse.json()) as { id: string };
    enPanne = true;

    const refus = await membre.delete<ApiErrorBody>(`/api/retours/${id}`);

    expect(refus).toEqual({ status: 503, body: { erreur: 'stockage_indisponible' } });
    expect((await membre.get(`/api/retours/${id}`)).status).toBe(200);
    expect(await statutCapture(membre, id)).toBe(200);

    enPanne = false;
    expect((await membre.delete(`/api/retours/${id}`)).status).toBe(204);
    expect(memoire.objetsDe(id)).toEqual([]);
  });
});

describe('Rétention des Retours', () => {
  let pipeline: Pipeline;
  let membre: DashboardClient;
  const { stockage, objetsDe } = stockageMemoire();

  beforeAll(async () => {
    pipeline = await startPipeline({ stockage, purge: { intervalleMs: 100 } });
    membre = await pipeline.signIn();
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  it('illimitée par défaut : un Retour ancien reste', async () => {
    expect(await membre.get('/api/instance/retention')).toEqual({
      status: 200,
      body: { jours: null },
    });
    const { clePublique } = await pipeline.createProjet({
      nom: 'Sans rétention',
      originesAutorisees: [ORIGINE],
    });
    const reponse = await pipeline.postRetourWidget(clePublique, ORIGINE, {
      texte: 'Vieux mais gardé',
      capture: capturePng,
    });
    const { id } = (await reponse.json()) as { id: string };
    await pipeline.vieillirRetour(id, 3650);

    // Plusieurs passages de la purge : rien ne bouge.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect((await membre.get(`/api/retours/${id}`)).status).toBe(200);
    expect(objetsDe(id)).toHaveLength(1);
  });

  it('purge les Retours plus anciens que la durée choisie, avec leurs Captures', async () => {
    const { projet, clePublique } = await pipeline.createProjet({
      nom: 'Rétention de 30 jours',
      originesAutorisees: [ORIGINE],
    });
    await pipeline.createDestination(projet.id);
    const poster = async (texte: string) => {
      const reponse = await pipeline.postRetourWidget(clePublique, ORIGINE, {
        texte,
        capture: capturePng,
      });
      const { id } = (await reponse.json()) as { id: string };
      await pipeline.waitForRetour(id, (r) => r.envois.some((e) => e.statut === 'livre'));
      return id;
    };
    const perime = await poster('Trente et un jours');
    const recent = await poster('Vingt-neuf jours');
    const neuf = await poster('Du jour');
    await pipeline.vieillirRetour(perime, 31);
    await pipeline.vieillirRetour(recent, 29);

    const reglage = await membre.put('/api/instance/retention', { jours: 30 });
    expect(reglage).toEqual({ status: 200, body: { jours: 30 } });
    expect((await membre.get('/api/instance/retention')).body).toEqual({ jours: 30 });

    await expect
      .poll(async () => (await membre.get(`/api/retours/${perime}`)).status, { timeout: 5000 })
      .toBe(404);
    expect(objetsDe(perime)).toEqual([]);
    for (const garde of [recent, neuf]) {
      expect((await membre.get(`/api/retours/${garde}`)).status).toBe(200);
      expect(objetsDe(garde)).toHaveLength(1);
    }
  });

  it('refuse une durée qui n’est pas un nombre de jours entier et positif', async () => {
    for (const jours of [0, -1, 1.5, '30', 36_501]) {
      const refus = await membre.put<ApiErrorBody>('/api/instance/retention', { jours });
      expect(refus.status).toBe(400);
      expect(refus.body.erreur).toBe('requete_invalide');
    }
    expect((await pipeline.dashboard().put('/api/instance/retention', { jours: 1 })).status).toBe(
      401,
    );
  });

  it('revient à une rétention illimitée', async () => {
    expect(await membre.put('/api/instance/retention', { jours: null })).toEqual({
      status: 200,
      body: { jours: null },
    });
    expect((await membre.get('/api/instance/retention')).body).toEqual({ jours: null });
  });
});

describe('Rétention des Retours, stockage capricieux', () => {
  let pipeline: Pipeline;
  const memoire = stockageMemoire();
  /** Clés que le stockage refuse d'effacer. */
  const refusees = new Set<string>();
  const stockage: StockageCaptures = {
    ...memoire.stockage,
    supprimer: (cle) =>
      refusees.has(cle)
        ? Promise.reject(new Error('objet verrouillé'))
        : memoire.stockage.supprimer(cle),
  };

  beforeAll(async () => {
    pipeline = await startPipeline({ stockage, purge: { intervalleMs: 100 } });
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  it('garde le Retour dont la Capture résiste, purge les autres, et le purge quand elle cède', async () => {
    const membre = await pipeline.signIn();
    const { clePublique } = await pipeline.createProjet({
      nom: 'Purge partielle',
      originesAutorisees: [ORIGINE],
    });
    const poster = async (texte: string) => {
      const reponse = await pipeline.postRetourWidget(clePublique, ORIGINE, {
        texte,
        capture: capturePng,
      });
      const { id } = (await reponse.json()) as { id: string };
      await pipeline.waitForRetour(id, (r) => r.etat !== 'recu');
      return id;
    };
    // Le plus ancien résiste : il ne doit pas bloquer la purge des suivants.
    const resistant = await poster('Capture verrouillée');
    const purgeable = await poster('Capture effaçable');
    await pipeline.vieillirRetour(resistant, 40);
    await pipeline.vieillirRetour(purgeable, 35);
    for (const cle of memoire.objetsDe(resistant)) refusees.add(cle);

    await membre.put('/api/instance/retention', { jours: 30 });

    await expect
      .poll(async () => (await membre.get(`/api/retours/${purgeable}`)).status, { timeout: 5000 })
      .toBe(404);
    expect(memoire.objetsDe(purgeable)).toEqual([]);
    expect((await membre.get(`/api/retours/${resistant}`)).status).toBe(200);
    expect(await statutCapture(membre, resistant)).toBe(200);

    refusees.clear();
    await expect
      .poll(async () => (await membre.get(`/api/retours/${resistant}`)).status, { timeout: 5000 })
      .toBe(404);
    expect(memoire.objetsDe(resistant)).toEqual([]);
  });
});
