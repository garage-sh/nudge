import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { connecterDb } from './client.js';

/** Dossier des migrations SQL générées par drizzle-kit (même profondeur depuis `src/` et `dist/`). */
export const DOSSIER_MIGRATIONS = path.join(__dirname, '..', 'drizzle');

export async function migrer(databaseUrl: string): Promise<void> {
  const { db, fermer } = connecterDb(databaseUrl);
  try {
    await migrate(db, { migrationsFolder: DOSSIER_MIGRATIONS });
  } finally {
    await fermer();
  }
}
