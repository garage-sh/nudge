/**
 * Applique les migrations de la base puis s'arrête : le service `migrate` du
 * docker-compose le lance avant l'api et le worker (`node dist/migrate.js`).
 */
import { requireEnv } from '@nudge/core';
import { runMigrations } from '@nudge/database';

async function main() {
  await runMigrations(requireEnv(process.env, 'DATABASE_URL'));
  console.log('Migrations appliquées.');
}

void main();
