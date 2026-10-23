import { TRANSITIONS_REVUE, type ActionRevue, type ResultatRevue } from '@nudge/core';
import { and, eq, exists } from 'drizzle-orm';
import type { Db } from './client.js';
import { retours, verdicts } from './schema.js';

/**
 * Applique une transition de revue, conditionnelle sur l'état courant : deux Membres
 * qui agissent en même temps ne font passer le Retour qu'une fois. Ne déclenche pas
 * le Dispatch : c'est à l'appelant de remettre en queue un Retour rendu Trié.
 */
export async function revoirRetour(
  db: Db,
  retourId: string,
  action: ActionRevue,
): Promise<ResultatRevue> {
  const { depuis, vers } = TRANSITIONS_REVUE[action];
  const conditions = [eq(retours.id, retourId), eq(retours.etat, depuis)];
  if (action === 'rehabiliter') {
    // Écarté comme Indésirable seulement : un Retour suspect de Manipulation a été rejeté.
    conditions.push(
      exists(
        db
          .select({ id: verdicts.id })
          .from(verdicts)
          .where(and(eq(verdicts.retourId, retours.id), eq(verdicts.manipulation, false))),
      ),
    );
  }
  const [applique] = await db
    .update(retours)
    .set({ etat: vers })
    .where(and(...conditions))
    .returning({ etat: retours.etat });
  if (applique) return { statut: 'applique', etat: applique.etat };

  const [actuel] = await db
    .select({ etat: retours.etat })
    .from(retours)
    .where(eq(retours.id, retourId));
  return actuel ? { statut: 'refuse', etat: actuel.etat } : { statut: 'introuvable' };
}
