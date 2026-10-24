import { TRANSITIONS_REVUE, type ActionRevue, type ResultatRevue } from '@nudge/core';
import type { CorrectionVerdict } from '@nudge/shared';
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
  const { depuis, vers, horsManipulation } = TRANSITIONS_REVUE[action];
  const conditions = [eq(retours.id, retourId), eq(retours.etat, depuis)];
  if (horsManipulation) {
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

/**
 * Annule une transition de revue tant que rien ne l'a suivie (le Retour est encore
 * dans son état d'arrivée) : sert quand l'effet attendu, la mise en queue, a échoué.
 */
export async function annulerRevue(db: Db, retourId: string, action: ActionRevue): Promise<void> {
  const { depuis, vers } = TRANSITIONS_REVUE[action];
  await db
    .update(retours)
    .set({ etat: depuis })
    .where(and(eq(retours.id, retourId), eq(retours.etat, vers)));
}

/**
 * Corrige le Type retenu et / ou la Gravité du Verdict d'un Retour. Vérifié par un
 * Membre, le Verdict n'est plus Incertain ; les réponses brutes du Juge restent telles
 * quelles. Rien n'est remis en queue : seuls le rejeu d'un Envoi et le redispatch du
 * Retour (D22) propagent la correction.
 * Rend faux si le Retour n'a pas (encore) de Verdict.
 */
export async function corrigerVerdict(
  db: Db,
  retourId: string,
  correction: CorrectionVerdict,
): Promise<boolean> {
  const corriges = await db
    .update(verdicts)
    .set({ ...correction, incertain: false })
    .where(eq(verdicts.retourId, retourId))
    .returning({ id: verdicts.id });
  return corriges.length > 0;
}
