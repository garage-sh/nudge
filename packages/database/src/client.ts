import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;

/** A transaction opened by `db.transaction`. */
export type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface DbConnection {
  readonly db: Db;
  close(): Promise<void>;
}

export function connectDb(databaseUrl: string): DbConnection {
  const pool = new Pool({ connectionString: databaseUrl });
  return { db: drizzle(pool, { schema }), close: () => pool.end() };
}
