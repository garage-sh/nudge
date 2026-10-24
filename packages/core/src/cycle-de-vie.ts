import type { EtatRetour } from '@nudge/shared';
import type { Verdict } from './triage.js';

/**
 * Cycle de vie d'un Retour (spec #1) :
 *
 *   Reçu ──▶ Trié ──┬──▶ Dispatché        (≥ 1 Destination retenue)
 *                   ├──▶ Écarté           (Indésirable) ── réhabiliter ──▶ Dispatché
 *                   └──▶ En revue         (Manipulation) ── valider ──────▶ Dispatché
 *                                                        └─ rejeter ──────▶ Écarté
 */

/** L'état d'un Retour juste après son Triage, selon son Verdict. */
export function etatApresTriage(
  verdict: Verdict,
): Extract<EtatRetour, 'trie' | 'ecarte' | 'en_revue'> {
  // La Manipulation l'emporte : un humain doit voir la tentative.
  if (verdict.manipulation) return 'en_revue';
  if (verdict.indesirable) return 'ecarte';
  return 'trie';
}

/** Règle de revue partagée avec le dashboard (`actionsDeRevuePermises`). */
export { ACTIONS_REVUE, TRANSITIONS_REVUE, type ActionRevue } from '@nudge/shared';

export type ResultatRevue =
  | { readonly statut: 'applique'; readonly etat: EtatRetour }
  /** Le Retour n'est pas dans l'état de départ de la transition : rien n'a changé. */
  | { readonly statut: 'refuse'; readonly etat: EtatRetour }
  | { readonly statut: 'introuvable' };
