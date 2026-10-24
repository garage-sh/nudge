import { estEnvoiRejouable, type StatutEnvoi } from '@nudge/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { envois } from './schema.js';

/** Ce qu'un Envoi rouvert pour un rejeu était avant : de quoi annuler le rejeu. */
export interface EnvoiAvantRejeu {
  readonly statut: StatutEnvoi;
  readonly derniereErreur: string | null;
}

export type ResultatRouverture =
  | { readonly statut: 'rouvert'; readonly avant: EnvoiAvantRejeu }
  /** L'Envoi n'est ni livré ni en échec : il a déjà un job, ou il est retenu. */
  | { readonly statut: 'refuse'; readonly statutEnvoi: StatutEnvoi }
  | { readonly statut: 'introuvable' };

/**
 * Rouvre un Envoi livré ou en échec pour le rejouer (D9) : le même Envoi repasse en
 * attente, jamais un second. La ligne est verrouillée le temps de la lire et de la
 * modifier : deux rejeux simultanés ne la rouvrent qu'une fois. Le lien vers l'objet
 * déjà créé reste jusqu'à la livraison suivante. L'appelant met l'Envoi en queue.
 */
export async function rouvrirEnvoi(db: Db, envoiId: string): Promise<ResultatRouverture> {
  return db.transaction(async (tx) => {
    const [envoi] = await tx
      .select({ statut: envois.statut, derniereErreur: envois.derniereErreur })
      .from(envois)
      .where(eq(envois.id, envoiId))
      .for('update');
    if (!envoi) return { statut: 'introuvable' };
    if (!estEnvoiRejouable(envoi.statut)) return { statut: 'refuse', statutEnvoi: envoi.statut };
    await tx
      .update(envois)
      .set({ statut: 'en_attente', derniereErreur: null })
      .where(eq(envois.id, envoiId));
    return { statut: 'rouvert', avant: envoi };
  });
}

/**
 * Annule la réouverture tant que rien ne l'a suivie (l'Envoi est encore en attente) :
 * sert quand la mise en queue du rejeu a échoué.
 */
export async function annulerRejeu(db: Db, envoiId: string, avant: EnvoiAvantRejeu): Promise<void> {
  await db
    .update(envois)
    .set(avant)
    .where(and(eq(envois.id, envoiId), eq(envois.statut, 'en_attente')));
}
