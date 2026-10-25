import { runMigrations } from '../migrations.js';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing');
  await runMigrations(url);
  console.log('Migrations applied.');
}

void main();
