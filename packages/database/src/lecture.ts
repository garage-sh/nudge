import { eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { retours } from './schema.js';

/** Un Retour tel qu'un Membre le lit : état, Verdict et Envois. */
export async function lireRetour(db: Db, id: string) {
  const retour = await db.query.retours.findFirst({
    where: eq(retours.id, id),
    with: {
      verdict: true,
      envois: { orderBy: (envois, { asc }) => [asc(envois.creeLe)] },
    },
  });
  return retour ?? null;
}

export type RetourLu = NonNullable<Awaited<ReturnType<typeof lireRetour>>>;
