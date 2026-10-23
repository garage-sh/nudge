import { randomUUID } from 'node:crypto';
import { createApi } from '@nudge/api';
import type { DestinationConfiguree } from '@nudge/core';
import {
  connectDb,
  createDestination,
  createProjet,
  readRetour,
  runMigrations,
  type Projet,
  type RetourLu,
} from '@nudge/database';
import type { RetourEntrant } from '@nudge/shared';
import { createWorker } from '@nudge/worker';
import { Client } from 'pg';
import { inject } from 'vitest';
import { FakeDestination } from './fake-destination.js';
import { FakeJuge } from './fake-juge.js';

export interface PipelineOptions {
  /** `null` : worker en mode dégradé, sans Juge. Par défaut, un `FakeJuge`. */
  readonly juge?: FakeJuge | null;
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
  /** Une Destination du Projet, servie par une `FakeDestination` qui lui est propre. */
  createDestination(
    projetId: string,
    donnees?: { nom?: string; config?: Record<string, unknown> },
  ): Promise<{ destination: DestinationConfiguree; fake: FakeDestination }>;
  /** POST /v1/retours avec la clé secrète du Projet. */
  postRetour(cleSecrete: string, corps: RetourEntrant | Record<string, unknown>): Promise<Response>;
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
  const fakes = new Map<string, FakeDestination>();
  const fakeFor = (destinationId: string) => {
    let fake = fakes.get(destinationId);
    if (!fake) {
      fake = new FakeDestination();
      fakes.set(destinationId, fake);
    }
    return fake;
  };

  const infra = {
    databaseUrl: databaseUrl.toString(),
    redisUrl,
    queuePrefix: `nudge-test-${suffixe}`,
    // Retries rapides : les tests d'échecs transitoires restent courts.
    retryPolicy: { attempts: 8, backoffDelayMs: 10 },
    logger: ['error', 'warn'] as ('error' | 'warn')[],
  };
  const worker = await createWorker({
    ...infra,
    juge,
    resolveDestinationAdapter: (destination) => fakeFor(destination.id),
  });
  const api = await createApi(infra);
  await api.listen(0, '127.0.0.1');
  const url = await api.getUrl();
  const { db, close } = connectDb(databaseUrl.toString());

  const pipeline: Pipeline = {
    url,
    get juge() {
      if (!juge) throw new Error('Ce pipeline tourne sans Juge');
      return juge;
    },
    createProjet: (donnees) => createProjet(db, donnees),
    async createDestination(projetId, donnees = {}) {
      const destination = await createDestination(db, {
        projetId,
        nom: donnees.nom ?? 'Destination de test',
        type: 'fake',
        config: donnees.config ?? {},
      });
      return { destination, fake: fakeFor(destination.id) };
    },
    postRetour: (cleSecrete, corps) =>
      fetch(`${url}/v1/retours`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cleSecrete}` },
        body: JSON.stringify(corps),
      }),
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
      await close();
      await dropDatabase(admin, nomBase);
      await admin.end();
    },
  };
  return pipeline;
}
