import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;

export interface ConnexionDb {
  readonly db: Db;
  fermer(): Promise<void>;
}

export function connecterDb(databaseUrl: string): ConnexionDb {
  const pool = new Pool({ connectionString: databaseUrl });
  return { db: drizzle(pool, { schema }), fermer: () => pool.end() };
}
