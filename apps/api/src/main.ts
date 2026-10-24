import 'reflect-metadata';
import { ENCRYPTION_KEY_VARIABLE } from '@nudge/core';
import { resolveDestinationAdapter } from '@nudge/destinations';
import { createApi } from './api.js';

function requireEnv(nom: string): string {
  const valeur = process.env[nom];
  if (!valeur) throw new Error(`Variable d'environnement manquante : ${nom}`);
  return valeur;
}

async function main() {
  const app = await createApi({
    databaseUrl: requireEnv('DATABASE_URL'),
    redisUrl: requireEnv('REDIS_URL'),
    cleChiffrement: requireEnv(ENCRYPTION_KEY_VARIABLE),
    sessionCookieSecure: process.env.NUDGE_COOKIE_SECURE !== 'false',
    resolveDestinationAdapter,
  });
  app.enableShutdownHooks();
  await app.listen(Number(process.env.NUDGE_API_PORT ?? 3000));
}

void main();
