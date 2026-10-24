import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { echec, startPipeline, type Pipeline } from './harness/index.js';

/**
 * Échecs d'Envoi et Suspension d'une Destination (forme reprise des connecteurs
 * d'alliances-pa) : un échec transient est retenté et compte pour la Suspension, un
 * échec auth suspend sans retry, un échec permanent n'échoue que l'Envoi. Une
 * Destination Suspendue retient ses Envois sans appel sortant, jusqu'à ce qu'une
 * sonde la trouve joignable.
 */
describe('Échecs d’Envoi et Suspension des Destinations', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    pipeline = await startPipeline({
      suspension: { seuilEchecs: 3, refroidissementMs: 300, intervalleSondeMs: 100 },
      repliquesWorker: 2,
    });
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  async function projetAvecDestination(nom: string) {
    const { projet, cleSecrete } = await pipeline.createProjet({ nom });
    const { destination, fake } = await pipeline.createDestination(projet.id);
    const poster = async (texte: string) => {
      pipeline.juge.script({ type: 'bug', gravite: 'majeure' });
      const reponse = await pipeline.postRetour(cleSecrete, { texte });
      return ((await reponse.json()) as { id: string }).id;
    };
    return { projet, destination, fake, poster };
  }

  const etatDestination = async (id: string) => (await pipeline.ligneDestination(id))?.etat;

  it('échec auth : la Destination est Suspendue aussitôt, sans retry, et l’Envoi est retenu', async () => {
    const { destination, fake, poster } = await projetAvecDestination('Jeton révoqué');
    fake.scriptSends(echec('auth', 'HTTP 401 : jeton refusé'));
    fake.scriptHealth({ joignable: false, classe: 'auth', message: 'HTTP 401' });

    const id = await poster('Le paiement échoue');

    const retour = await pipeline.waitForRetour(id, (r) =>
      r.envois.some((e) => e.statut === 'retenu'),
    );
    expect(retour.envois).toMatchObject([
      { statut: 'retenu', tentatives: 1, derniereErreur: 'auth: HTTP 401 : jeton refusé' },
    ]);
    expect(await etatDestination(destination.id)).toBe('suspendue');
    expect(fake.attempts).toHaveLength(1);
    expect(pipeline.suspensions).toEqual([
      {
        destinationId: destination.id,
        projetId: destination.projetId,
        nom: destination.nom,
        classe: 'auth',
        message: 'HTTP 401 : jeton refusé',
        suspendueLe: expect.any(Date),
      },
    ]);
  });

  it('échec permanent : l’Envoi est en échec, sans retry, et la Destination reste active', async () => {
    const { destination, fake, poster } = await projetAvecDestination('Requête refusée');
    fake.scriptSends(echec('permanent', 'HTTP 422 : titre trop long'));

    const id = await poster('Un texte que la Destination refuse');

    const retour = await pipeline.waitForRetour(id, (r) =>
      r.envois.some((e) => e.statut === 'echec'),
    );
    expect(retour.envois).toMatchObject([
      { statut: 'echec', tentatives: 1, derniereErreur: 'permanent: HTTP 422 : titre trop long' },
    ]);
    // Le job n'est pas retenté : un seul appel, même après le backoff.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(fake.attempts).toHaveLength(1);
    expect(await etatDestination(destination.id)).toBe('active');
    expect(pipeline.suspensions.map((s) => s.destinationId)).not.toContain(destination.id);
  });

  it('échec transient : retenté avec backoff, puis livré ; une livraison remet la série à zéro', async () => {
    const { destination, fake, poster } = await projetAvecDestination('Destination capricieuse');
    fake.scriptSends(echec('transient', 'HTTP 503'), echec('transient', 'HTTP 429'));

    const premier = await poster('Premier Retour');
    const livre = await pipeline.waitForRetour(premier, (r) =>
      r.envois.some((e) => e.statut === 'livre'),
    );
    expect(livre.envois).toMatchObject([{ statut: 'livre', tentatives: 3, derniereErreur: null }]);

    // Deux nouveaux échecs : sans remise à zéro, la série atteindrait le seuil (3).
    fake.scriptSends(echec('transient', 'HTTP 502'), echec('transient', 'HTTP 504'));
    const second = await poster('Second Retour');
    await pipeline.waitForRetour(second, (r) => r.envois.some((e) => e.statut === 'livre'));
    expect(fake.attempts).toHaveLength(6);
    expect(await etatDestination(destination.id)).toBe('active');
  });

  it('au seuil d’échecs transient consécutifs, la Destination est Suspendue et ses nouveaux Envois sont retenus sans appel sortant', async () => {
    const { destination, fake, poster } = await projetAvecDestination('Destination en panne');
    fake.scriptSends(...Array.from({ length: 3 }, () => echec('transient', 'HTTP 503')));
    fake.scriptHealth(
      ...Array.from({ length: 50 }, () => ({
        joignable: false as const,
        classe: 'transient' as const,
        message: 'HTTP 503',
      })),
    );

    const premier = await poster('Avant la panne');
    const retenu = await pipeline.waitForRetour(premier, (r) =>
      r.envois.some((e) => e.statut === 'retenu'),
    );
    expect(retenu.envois).toMatchObject([
      { statut: 'retenu', tentatives: 3, derniereErreur: 'transient: HTTP 503' },
    ]);
    expect(await etatDestination(destination.id)).toBe('suspendue');
    expect(pipeline.suspensions).toContainEqual(
      expect.objectContaining({ destinationId: destination.id, classe: 'transient' }),
    );

    const second = await poster('Pendant la panne');
    const nouveau = await pipeline.waitForRetour(second, (r) => r.envois.length > 0);
    expect(nouveau).toMatchObject({
      etat: 'dispatche',
      envois: [{ statut: 'retenu', tentatives: 0 }],
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(fake.attempts).toHaveLength(3);
  });

  it('après refroidissement, la sonde teste la Destination : injoignable, elle reste Suspendue ; joignable, elle redevient active et ses Envois retenus repartent', async () => {
    const { destination, fake, poster } = await projetAvecDestination('Panne puis retour');
    fake.scriptSends(echec('auth', 'HTTP 403'));
    fake.scriptHealth({ joignable: false, classe: 'auth', message: 'HTTP 403' });

    const premier = await poster('Retenu par la Suspension');
    await pipeline.waitForRetour(premier, (r) => r.envois.some((e) => e.statut === 'retenu'));
    const second = await poster('Arrivé pendant la Suspension');
    await pipeline.waitForRetour(second, (r) => r.envois.some((e) => e.statut === 'retenu'));
    expect(fake.healthChecks).toBe(0);

    // Première sonde après le refroidissement (300 ms) : toujours refusée.
    await expect.poll(() => fake.healthChecks, { timeout: 2000 }).toBe(1);
    expect(await etatDestination(destination.id)).toBe('suspendue');

    // Sonde suivante, un refroidissement plus tard : la Destination répond.
    for (const id of [premier, second]) {
      const retour = await pipeline.waitForRetour(
        id,
        (r) => r.envois.some((e) => e.statut === 'livre'),
        5000,
      );
      expect(retour.envois).toMatchObject([{ statut: 'livre', derniereErreur: null }]);
    }
    expect(fake.healthChecks).toBe(2);
    expect(await etatDestination(destination.id)).toBe('active');
    expect(fake.envois.map((e) => e.retour.id).sort()).toEqual([premier, second].sort());
  });

  it('des échecs auth simultanés sur deux répliques du worker ne suspendent la Destination qu’une fois', async () => {
    const { destination, fake, poster } = await projetAvecDestination('Échecs simultanés');
    fake.scriptSends(echec('auth', 'HTTP 401'), echec('auth', 'HTTP 401'));
    fake.scriptHealth(
      ...Array.from({ length: 50 }, () => ({
        joignable: false as const,
        classe: 'auth' as const,
        message: 'HTTP 401',
      })),
    );
    const release = fake.hold();

    const ids = await Promise.all([poster('Retour simultané 1'), poster('Retour simultané 2')]);
    // Les deux Envois sont en vol en même temps, un par réplique.
    await expect.poll(() => fake.attempts.length, { timeout: 5000 }).toBe(2);
    release();

    for (const id of ids) {
      await pipeline.waitForRetour(id, (r) => r.envois.some((e) => e.statut === 'retenu'));
    }
    expect(pipeline.suspensions.filter((s) => s.destinationId === destination.id)).toHaveLength(1);
  });
});

describe('Échecs transient sous le seuil de Suspension', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    // Seuil hors d'atteinte : les 8 tentatives du job s'épuisent avant la Suspension.
    pipeline = await startPipeline({
      suspension: { seuilEchecs: 100, refroidissementMs: 300, intervalleSondeMs: 100 },
    });
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  it('un Envoi dont les tentatives s’épuisent passe en échec au lieu de rester en attente', async () => {
    const { projet, cleSecrete } = await pipeline.createProjet({ nom: 'Tentatives épuisées' });
    const { destination, fake } = await pipeline.createDestination(projet.id);
    fake.scriptSends(...Array.from({ length: 8 }, () => echec('transient', 'HTTP 503')));
    pipeline.juge.script({ type: 'bug', gravite: 'majeure' });

    const reponse = await pipeline.postRetour(cleSecrete, { texte: 'Jamais livré' });
    const { id } = (await reponse.json()) as { id: string };

    const retour = await pipeline.waitForRetour(
      id,
      (r) => r.envois.some((e) => e.statut === 'echec'),
      10_000,
    );
    expect(retour.envois).toMatchObject([
      { statut: 'echec', tentatives: 8, derniereErreur: 'transient: HTTP 503' },
    ]);
    expect(fake.attempts).toHaveLength(8);
    expect((await pipeline.ligneDestination(destination.id))?.etat).toBe('active');
  });
});
