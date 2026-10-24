import { filtreRetient } from '@nudge/core';
import { estRetourRedispatchable, type EtatRetour, type StatutEnvoi } from '@nudge/shared';
import { and, eq, inArray, notExists, sql } from 'drizzle-orm';
import type { Db, Transaction } from './client.js';
import { filtreDe } from './destinations.js';
import { destinations, envois, retours, verdicts } from './schema.js';

/** Un Envoi que le Dispatch vient de créer : `en_attente` attend son job, `retenu` la sonde. */
export interface EnvoiCree {
  readonly id: string;
  readonly statut: Extract<StatutEnvoi, 'en_attente' | 'retenu'>;
}

/**
 * Crée, selon le Verdict courant, les Envois manquants vers les Destinations du Projet
 * dont le Filtre retient le Retour : un seul par (Retour, Destination), les Envois
 * existants ne sont jamais touchés. Un Envoi vers une Destination Suspendue est retenu
 * d'emblée, sans job ni appel sortant. Un Retour Trié passe Dispatché dès qu'un Filtre
 * le retient. Rend les seuls Envois créés par cet appel ; l'appelant met en queue ceux
 * qui sont en attente, après le commit.
 */
export async function creerEnvoisManquants(
  tx: Transaction,
  retourId: string,
  projetId: string,
): Promise<EnvoiCree[]> {
  const [verdict] = await tx
    .select({ typeRetenu: verdicts.typeRetenu, gravite: verdicts.gravite })
    .from(verdicts)
    .where(eq(verdicts.retourId, retourId));
  if (!verdict) throw new Error(`Retour ${retourId} Trié sans Verdict`);
  const destinationsDuProjet = await tx
    .select({
      id: destinations.id,
      etat: destinations.etat,
      filtreTypes: destinations.filtreTypes,
      filtreGraviteMinimale: destinations.filtreGraviteMinimale,
    })
    .from(destinations)
    .where(eq(destinations.projetId, projetId));
  const cibles = destinationsDuProjet.filter((d) => filtreRetient(filtreDe(d), verdict));
  if (cibles.length === 0) return [];
  const crees = await tx
    .insert(envois)
    .values(
      cibles.map((d) => ({
        retourId,
        destinationId: d.id,
        ...(d.etat === 'suspendue' ? { statut: 'retenu' as const, retenuLe: sql`now()` } : {}),
      })),
    )
    .onConflictDoNothing({ target: [envois.retourId, envois.destinationId] })
    .returning({ id: envois.id, statut: envois.statut });
  await tx
    .update(retours)
    .set({ etat: 'dispatche' })
    .where(and(eq(retours.id, retourId), eq(retours.etat, 'trie')));
  return crees as EnvoiCree[];
}

export type ResultatRedispatch =
  | { readonly statut: 'applique'; readonly envois: readonly EnvoiCree[] }
  /** Le Retour n'est ni Trié ni Dispatché : rien n'a changé. */
  | { readonly statut: 'refuse'; readonly etat: EtatRetour }
  | { readonly statut: 'introuvable' };

/**
 * Redispatch manuel d'un Retour Trié ou Dispatché (D22) : les Envois manquants selon
 * le Verdict courant, pour propager une correction ou servir une Destination ajoutée
 * depuis. La ligne du Retour est verrouillée le temps de la lire et de créer les
 * Envois : il ne change pas d'état ni ne disparaît entre-temps. L'appelant met en queue
 * les Envois en attente rendus.
 */
export async function redispatcherRetour(db: Db, retourId: string): Promise<ResultatRedispatch> {
  return db.transaction(async (tx) => {
    const [retour] = await tx
      .select({ etat: retours.etat, projetId: retours.projetId })
      .from(retours)
      .where(eq(retours.id, retourId))
      .for('update');
    if (!retour) return { statut: 'introuvable' };
    if (!estRetourRedispatchable(retour.etat)) return { statut: 'refuse', etat: retour.etat };
    return {
      statut: 'applique',
      envois: await creerEnvoisManquants(tx, retourId, retour.projetId),
    };
  });
}

/**
 * Annule un redispatch dont la mise en queue a échoué : retire les Envois créés encore
 * en attente (sans job, rien ne les enverrait), et rend Trié un Retour qu'il ne reste
 * plus aucun Envoi pour dire Dispatché. Le Membre peut alors réessayer.
 */
export async function annulerRedispatch(
  db: Db,
  retourId: string,
  envoiIds: readonly string[],
): Promise<void> {
  if (envoiIds.length === 0) return;
  await db.transaction(async (tx) => {
    await tx
      .delete(envois)
      .where(and(inArray(envois.id, [...envoiIds]), eq(envois.statut, 'en_attente')));
    await tx
      .update(retours)
      .set({ etat: 'trie' })
      .where(
        and(
          eq(retours.id, retourId),
          eq(retours.etat, 'dispatche'),
          notExists(tx.select({ id: envois.id }).from(envois).where(eq(envois.retourId, retourId))),
        ),
      );
  });
}
