import 'reflect-metadata';
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
    sessionCookieSecure: process.env.NUDGE_COOKIE_SECURE !== 'false',
  });
  app.enableShutdownHooks();
  await app.listen(Number(process.env.NUDGE_API_PORT ?? 3000));
}

void main();
