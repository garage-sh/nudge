import 'reflect-metadata';
import { resoudreAdaptateur } from '@nudge/destinations';
import { creerWorker } from './worker.js';

function exiger(nom: string): string {
  const valeur = process.env[nom];
  if (!valeur) throw new Error(`Variable d'environnement manquante : ${nom}`);
  return valeur;
}

async function main() {
  const app = await creerWorker({
    databaseUrl: exiger('DATABASE_URL'),
    redisUrl: exiger('REDIS_URL'),
    // Les adaptateurs Juge arrivent avec #6 : en attendant, mode dégradé.
    juge: null,
    resoudreAdaptateur,
  });
  app.enableShutdownHooks();
}

void main();
