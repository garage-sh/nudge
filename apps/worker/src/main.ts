import 'reflect-metadata';
import { VARIABLE_CLE_CHIFFREMENT } from '@nudge/core';
import { resolveDestinationAdapter } from '@nudge/destinations';
import { configJugeDepuisEnv } from '@nudge/judge';
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
    cleChiffrement: requireEnv(VARIABLE_CLE_CHIFFREMENT),
    // Repli quand l'Instance n'a pas choisi de Juge dans le dashboard.
    jugeParDefaut: configJugeDepuisEnv(process.env),
    resolveDestinationAdapter,
  });
  app.enableShutdownHooks();
}

void main();
