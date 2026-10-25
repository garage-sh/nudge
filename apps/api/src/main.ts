import 'reflect-metadata';
import type { INestApplicationContext } from '@nestjs/common';
import { resolveDestinationAdapter } from '@nudge/destinations';
import { createStockage } from '@nudge/stockage';
import { configWorkerFromEnv, createWorker } from '@nudge/worker';
import { createApi } from './api.js';
import { configApiFromEnv } from './env.js';
import { rolesFromEnv } from './roles.js';

/**
 * Un processus nudge : l'api, le worker, ou les deux selon `NUDGE_ROLES`. Toute la
 * configuration est lue avant de démarrer quoi que ce soit, pour qu'une variable
 * invalide arrête le processus avant qu'il n'écoute ou ne consomme une queue.
 */
async function main() {
  const roles = rolesFromEnv(process.env);
  const api = roles.has('api') ? configApiFromEnv(process.env) : null;
  const worker = roles.has('worker') ? configWorkerFromEnv(process.env) : null;
  // L'api et le worker d'un même processus partagent le stockage des Captures.
  const stockageCaptures = createStockage((api ?? worker)!.stockage);

  // Dans l'ordre d'arrêt : l'api cesse d'accepter des Retours avant que le worker ne
  // termine ses jobs en cours.
  const demarres: INestApplicationContext[] = [];
  if (api) {
    const { port, stockage: _stockage, ...config } = api;
    const app = await createApi({ ...config, resolveDestinationAdapter, stockageCaptures });
    await app.listen(port);
    demarres.push(app);
  }
  if (worker) {
    const { stockage: _stockage, ...config } = worker;
    demarres.push(await createWorker({ ...config, resolveDestinationAdapter, stockageCaptures }));
  }

  // Pas de `enableShutdownHooks` : chaque contexte Nest tuerait le processus dès sa
  // propre fermeture, sans attendre l'autre.
  let enArret = false;
  const arreter = async (signal: NodeJS.Signals) => {
    if (enArret) return;
    enArret = true;
    try {
      for (const app of demarres) await app.close();
    } finally {
      // Rendu au signal pour le code de sortie habituel ; en PID 1 d'un conteneur, où
      // il serait ignoré, le processus sort de lui-même.
      process.kill(process.pid, signal);
      setTimeout(() => process.exit(0), 1000).unref();
    }
  };
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, (recu) => void arreter(recu));
  }
}

void main();
