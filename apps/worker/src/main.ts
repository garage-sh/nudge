import 'reflect-metadata';
import { resolveDestinationAdapter } from '@nudge/destinations';
import { createWorker } from './worker.js';

function requireEnv(nom: string): string {
  const valeur = process.env[nom];
  if (!valeur) throw new Error(`Variable d'environnement manquante : ${nom}`);
  return valeur;
}

async function main() {
  const app = await createWorker({
    databaseUrl: requireEnv('DATABASE_URL'),
    redisUrl: requireEnv('REDIS_URL'),
    // Les adaptateurs Juge arrivent avec #6 : en attendant, mode dégradé.
    juge: null,
    resolveDestinationAdapter,
  });
  app.enableShutdownHooks();
}

void main();
