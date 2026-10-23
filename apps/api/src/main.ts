import 'reflect-metadata';
import { creerApi } from './api.js';

function exiger(nom: string): string {
  const valeur = process.env[nom];
  if (!valeur) throw new Error(`Variable d'environnement manquante : ${nom}`);
  return valeur;
}

async function main() {
  const app = await creerApi({
    databaseUrl: exiger('DATABASE_URL'),
    redisUrl: exiger('REDIS_URL'),
  });
  app.enableShutdownHooks();
  await app.listen(Number(process.env.NUDGE_API_PORT ?? 3000));
}

void main();
