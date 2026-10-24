import { randomBytes, randomUUID } from 'node:crypto';
import { createApi, RevueService } from '@nudge/api';
import {
  createSecretCipher,
  DISPATCH_QUEUE,
  TRIAGE_QUEUE,
  type ActionRevue,
  type DestinationAdapterResolver,
  type Filtre,
  type ResultatRevue,
  type SeuilsTriage,
} from '@nudge/core';
import {
  connectDb,
  createDestination,
  createProjet,
  destinations,
  parametresInstance,
  readRetour,
  retours,
  runMigrations,
  type DestinationRow,
  type Projet,
  type RetourLu,
} from '@nudge/database';
import type { ConfigJuge } from '@nudge/judge';
import { resolveDestinationAdapter as adaptateursReels } from '@nudge/destinations';
import type { RetourEntrant } from '@nudge/shared';
import { createWorker, type OptionsBalayage } from '@nudge/worker';
import { Queue, QueueEvents } from 'bullmq';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { Client } from 'pg';
import { inject } from 'vitest';
import { DashboardClient } from './dashboard-client.js';
import { FakeDestination } from './fake-destination.js';
import { FakeJuge } from './fake-juge.js';

export interface PipelineOptions {
  /**
   * `null` : worker en mode dégradé, sans Juge. `'instance'` : le Juge choisi pour
   * l'Instance (paramètres en base, puis `jugeParDefaut`), comme en production.
   * Par défaut, un `FakeJuge`.
   */
  readonly juge?: FakeJuge | null | 'instance';
  /** Avec `juge: 'instance'` : le Juge des variables `NUDGE_JUDGE_*`. */
  readonly jugeParDefaut?: ConfigJuge;
  /** Seuils de la politique de Verdict du worker ; ceux par défaut sinon. */
  readonly seuilsTriage?: SeuilsTriage;
  /** Délai de réponse du Juge avant abandon et retry ; celui du worker sinon. */
  readonly delaiJugeMs?: number;
  /** Balayage des Retours restés Reçu ; celui du worker (5 min) sinon. */
  readonly balayage?: OptionsBalayage;
  /**
   * `'reelles'` : les adaptateurs de `@nudge/destinations` (webhook…), contre de vrais
   * récepteurs. Par défaut, chaque Destination est servie par sa `FakeDestination`.
   */
  readonly destinations?: 'fakes' | 'reelles';
}

export interface Pipeline {
  /** URL de base de l'api démarrée. */
  readonly url: string;
  /** Le Juge branché sur le worker (lève si le pipeline tourne sans Juge). */
  readonly juge: FakeJuge;
  /** Le Projet est créé directement en base (seed) ; ses clés sont rendues en clair. */
  createProjet(donnees: {
    nom: string;
    description?: string | null;
  }): Promise<{ projet: Projet; clePublique: string; cleSecrete: string }>;
  /**
   * Une Destination du Projet créée directement en base (seed), servie par une
   * `FakeDestination` qui lui est propre. Sans Filtre, elle retient tout Retour Trié.
   */
  createDestination(
    projetId: string,
    donnees?: { nom?: string; config?: Record<string, unknown>; filtre?: Filtre },
  ): Promise<{ destination: DestinationRow; fake: FakeDestination }>;
  /** La `FakeDestination` qui sert cette Destination (créée par le dashboard, par exemple). */
  fakeDestination(destinationId: string): FakeDestination;
  /** La ligne d'une Destination telle qu'en base (secrets chiffrés), ou `null`. */
  ligneDestination(destinationId: string): Promise<DestinationRow | null>;
  /** Un navigateur anonyme sur l'API du dashboard (il garde son cookie de session). */
  dashboard(): DashboardClient;
  /**
   * Un navigateur connecté : le premier appel crée le premier Membre par le
   * setup, les suivants se connectent avec ses identifiants (`MEMBRE_PAR_DEFAUT`).
   */
  signIn(): Promise<DashboardClient>;
  /**
   * Enregistre un Retour Reçu sans le mettre en queue, comme si la mise en queue
   * avait échoué après l'insertion. Rend son id.
   */
  insererRetourSansTriage(projetId: string, donnees: { texte: string }): Promise<string>;
  /** POST /v1/retours avec la clé secrète du Projet. */
  postRetour(cleSecrete: string, corps: RetourEntrant | Record<string, unknown>): Promise<Response>;
  /**
   * Transition de revue (valider, rejeter, réhabiliter) telle que le dashboard la
   * déclenchera (#9) : par le `RevueService` de l'api.
   */
  revoir(retourId: string, action: ActionRevue): Promise<ResultatRevue>;
  /**
   * Remet en queue le job de Triage d'un Retour (nouvel id de job, comme un job
   * rejoué) et attend qu'il soit traité.
   */
  rejouerTriage(retourId: string): Promise<void>;
  /** Remet en queue le job de Dispatch d'un Envoi et attend qu'il soit traité. */
  rejouerDispatch(envoiId: string): Promise<void>;
  /** La ligne des paramètres d'Instance telle qu'en base (secrets chiffrés), ou `null`. */
  parametresInstance(): Promise<typeof parametresInstance.$inferSelect | null>;
  /** Le Retour tel qu'un Membre le lit (état, Verdict, Envois), ou `null`. */
  readRetour(id: string): Promise<RetourLu | null>;
  /** Attend que le Retour satisfasse `condition` (5 s par défaut) et le rend. */
  waitForRetour(
    id: string,
    condition: (retour: RetourLu) => boolean,
    delaiMs?: number,
  ): Promise<RetourLu>;
  stop(): Promise<void>;
}

/** Identifiants du Membre que `signIn()` crée au setup. */
export const MEMBRE_PAR_DEFAUT = {
  email: 'premier@nudge.test',
  motDePasse: 'mot-de-passe-du-premier-membre',
} as const;

/**
 * `pool.end()` rend la main avant que les sockets soient fermées : un
 * `DROP … WITH (FORCE)` immédiat couperait des connexions en cours de fermeture
 * (erreur non rattrapée côté `pg`). On réessaie un DROP simple tant que la base
 * est encore « en cours d'utilisation » (55006).
 */
async function dropDatabase(admin: Client, nomBase: string): Promise<void> {
  for (let essai = 0; essai < 40; essai += 1) {
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${nomBase}"`);
      return;
    } catch (erreur) {
      if ((erreur as { code?: string }).code !== '55006') throw erreur;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`Base ${nomBase} toujours utilisée après l'arrêt du pipeline`);
}

/**
 * Démarre un pipeline réel et isolé : une base Postgres neuve migrée, un
 * préfixe de queues propre, l'api (écoutant sur un port libre) et le worker.
 */
export async function startPipeline(options: PipelineOptions = {}): Promise<Pipeline> {
  const suffixe = randomUUID().replaceAll('-', '');
  const nomBase = `nudge_${suffixe}`;
  const urlAdmin = inject('postgresUrl');
  const redisUrl = inject('redisUrl');

  const admin = new Client({ connectionString: urlAdmin });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${nomBase}"`);
  const databaseUrl = new URL(urlAdmin);
  databaseUrl.pathname = `/${nomBase}`;
  await runMigrations(databaseUrl.toString());

  const juge = options.juge === undefined ? new FakeJuge() : options.juge;
  const fakeJuge = juge === 'instance' ? null : juge;
  const fakes = new Map<string, FakeDestination>();
  const fakeFor = (destinationId: string) => {
    let fake = fakes.get(destinationId);
    if (!fake) {
      fake = new FakeDestination();
      fakes.set(destinationId, fake);
    }
    return fake;
  };

  const cleChiffrement = randomBytes(32).toString('base64');
  const cipher = createSecretCipher(cleChiffrement);
  const resolveDestinationAdapter: DestinationAdapterResolver =
    options.destinations === 'reelles'
      ? adaptateursReels
      : (destination) => fakeFor(destination.id);
  const infra = {
    databaseUrl: databaseUrl.toString(),
    redisUrl,
    queuePrefix: `nudge-test-${suffixe}`,
    cleChiffrement,
    // Retries rapides : les tests d'échecs transitoires restent courts.
    retryPolicy: { attempts: 8, backoffDelayMs: 10 },
    logger: ['error', 'warn'] as ('error' | 'warn')[],
  };
  const worker = await createWorker({
    ...infra,
    ...(juge === 'instance' ? { jugeParDefaut: options.jugeParDefaut ?? null } : { juge }),
    ...(options.seuilsTriage ? { seuilsTriage: options.seuilsTriage } : {}),
    ...(options.delaiJugeMs ? { delaiJugeMs: options.delaiJugeMs } : {}),
    ...(options.balayage ? { balayage: options.balayage } : {}),
    resolveDestinationAdapter,
  });
  const api = await createApi({ ...infra, sessionCookieSecure: false, resolveDestinationAdapter });
  await api.listen(0, '127.0.0.1');
  const url = await api.getUrl();
  const { db, close } = connectDb(databaseUrl.toString());
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queues = {
    [TRIAGE_QUEUE]: new Queue(TRIAGE_QUEUE, { connection: redis, prefix: infra.queuePrefix }),
    [DISPATCH_QUEUE]: new Queue(DISPATCH_QUEUE, { connection: redis, prefix: infra.queuePrefix }),
  };
  const rejouer = async (nom: typeof TRIAGE_QUEUE | typeof DISPATCH_QUEUE, data: object) => {
    const evenements = new QueueEvents(nom, {
      connection: { host: redis.options.host, port: redis.options.port },
      prefix: infra.queuePrefix,
    });
    try {
      await evenements.waitUntilReady();
      const job = await queues[nom].add(nom, data, { jobId: `rejeu-${randomUUID()}` });
      await job.waitUntilFinished(evenements, 10_000);
    } finally {
      await evenements.close();
    }
  };

  const pipeline: Pipeline = {
    url,
    get juge() {
      if (!fakeJuge) throw new Error('Ce pipeline tourne sans FakeJuge');
      return fakeJuge;
    },
    createProjet: (donnees) => createProjet(db, donnees),
    async createDestination(projetId, donnees = {}) {
      const destination = await createDestination(db, cipher, {
        projetId,
        nom: donnees.nom ?? 'Destination de test',
        type: 'fake',
        config: donnees.config ?? {},
        ...(donnees.filtre ? { filtre: donnees.filtre } : {}),
      });
      return { destination, fake: fakeFor(destination.id) };
    },
    fakeDestination: fakeFor,
    async ligneDestination(destinationId) {
      const [ligne] = await db
        .select()
        .from(destinations)
        .where(eq(destinations.id, destinationId));
      return ligne ?? null;
    },
    dashboard: () => new DashboardClient(url),
    async signIn() {
      const client = new DashboardClient(url);
      const setup = await client.post('/api/setup', MEMBRE_PAR_DEFAUT);
      if (setup.status === 201) return client;
      const connexion = await client.post('/api/session', MEMBRE_PAR_DEFAUT);
      if (connexion.status !== 200) {
        throw new Error(`signIn : connexion refusée (${connexion.status})`);
      }
      return client;
    },
    async insererRetourSansTriage(projetId, { texte }) {
      const [retour] = await db
        .insert(retours)
        .values({ projetId, source: 'api', texte })
        .returning({ id: retours.id });
      if (!retour) throw new Error('Retour non enregistré');
      return retour.id;
    },
    postRetour: (cleSecrete, corps) =>
      fetch(`${url}/v1/retours`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cleSecrete}` },
        body: JSON.stringify(corps),
      }),
    revoir: (retourId, action) => api.get(RevueService).revoir(retourId, action),
    rejouerTriage: (retourId) => rejouer(TRIAGE_QUEUE, { retourId }),
    rejouerDispatch: (envoiId) => rejouer(DISPATCH_QUEUE, { envoiId }),
    async parametresInstance() {
      const [ligne] = await db.select().from(parametresInstance);
      return ligne ?? null;
    },
    readRetour: (id) => readRetour(db, id),
    async waitForRetour(id, condition, delaiMs = 5000) {
      const limite = Date.now() + delaiMs;
      let dernier: RetourLu | null = null;
      while (Date.now() < limite) {
        dernier = await readRetour(db, id);
        if (dernier && condition(dernier)) return dernier;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(
        `Retour ${id} : condition non atteinte en ${delaiMs} ms. Dernier état lu : ${JSON.stringify(dernier, null, 2)}`,
      );
    },
    async stop() {
      await api.close();
      await worker.close();
      await Promise.all(Object.values(queues).map((queue) => queue.close()));
      await redis.quit();
      await close();
      await dropDatabase(admin, nomBase);
      await admin.end();
    },
  };
  return pipeline;
}
