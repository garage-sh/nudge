import { eq, inArray } from 'drizzle-orm';
import type { Db } from './client.js';
import { captures, retours } from './schema.js';

/** Un Retour tel qu'un Membre le lit : état, Verdict et Envois. */
export async function readRetour(db: Db, id: string) {
  const retour = await db.query.retours.findFirst({
    where: eq(retours.id, id),
    with: {
      verdict: true,
      envois: { orderBy: (envois, { asc }) => [asc(envois.createdAt)] },
    },
  });
  return retour ?? null;
}

export type RetourLu = NonNullable<Awaited<ReturnType<typeof readRetour>>>;

/** Un Retour gardé parce que l'image de sa Capture n'a pas pu être effacée. */
export interface EchecSuppression {
  readonly retourId: string;
  readonly erreur: unknown;
}

/** Ce que `supprimerRetours` a fait : les Retours supprimés, et ceux gardés. */
export interface SuppressionRetours {
  readonly supprimes: readonly string[];
  readonly echecs: readonly EchecSuppression[];
}

/**
 * Supprime des Retours et leurs Captures (Envois, Verdict et référence de la Capture
 * partent en cascade). L'image de chaque Capture est effacée du stockage **avant** la
 * ligne en base : un Retour dont l'image n'a pas pu être effacée est gardé, pour que
 * la suppression se retente plutôt que de laisser une image que plus rien ne référence.
 */
export async function supprimerRetours(
  db: Db,
  ids: readonly string[],
  supprimerCapture: (cle: string) => Promise<void>,
): Promise<SuppressionRetours> {
  if (ids.length === 0) return { supprimes: [], echecs: [] };
  const aEffacer = await db
    .select({ retourId: captures.retourId, cle: captures.cle })
    .from(captures)
    .where(inArray(captures.retourId, [...ids]));
  const echecs: EchecSuppression[] = [];
  for (const { retourId, cle } of aEffacer) {
    try {
      await supprimerCapture(cle);
    } catch (erreur) {
      echecs.push({ retourId, erreur });
    }
  }
  const gardes = new Set(echecs.map((echec) => echec.retourId));
  const restants = ids.filter((id) => !gardes.has(id));
  const supprimes =
    restants.length === 0
      ? []
      : await db.delete(retours).where(inArray(retours.id, restants)).returning({ id: retours.id });
  return { supprimes: supprimes.map(({ id }) => id), echecs };
}
