import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { connectDb } from './client.js';

/** Dossier des migrations SQL générées par drizzle-kit (même profondeur depuis `src/` et `dist/`). */
export const MIGRATIONS_FOLDER = path.join(__dirname, '..', 'drizzle');

export async function runMigrations(databaseUrl: string): Promise<void> {
  const { db, close } = connectDb(databaseUrl);
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await close();
  }
}
