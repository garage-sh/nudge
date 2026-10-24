import 'reflect-metadata';
import { ENCRYPTION_KEY_VARIABLE } from '@nudge/core';
import { resolveDestinationAdapter } from '@nudge/destinations';
import { configStockageDepuisEnv, createStockage } from '@nudge/stockage';
import { configJugeFromEnv } from '@nudge/judge';
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
    cleChiffrement: requireEnv(ENCRYPTION_KEY_VARIABLE),
    // Repli quand l'Instance n'a pas choisi de Juge dans le dashboard.
    jugeParDefaut: configJugeFromEnv(process.env),
    resolveDestinationAdapter,
    // Le même stockage que l'${'worker' if app=='api' else 'api'} : un volume partagé, ou un bucket S3.
    stockageCaptures: createStockage(configStockageDepuisEnv(process.env)),
    dashboardUrl: process.env.NUDGE_DASHBOARD_URL || null,
  });
  app.enableShutdownHooks();
}

void main();
