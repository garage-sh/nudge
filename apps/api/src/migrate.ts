/**
 * Applies the database migrations then stops: the docker-compose `migrate` service
 * runs it before the api and the worker (`node dist/migrate.js`).
 */
import { requireEnv } from '@nudge/core';
import { runMigrations } from '@nudge/database';

async function main() {
  await runMigrations(requireEnv(process.env, 'DATABASE_URL'));
  console.log('Migrations applied.');
}

void main();
