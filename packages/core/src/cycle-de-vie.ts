import type { ActionRevue, EtatRetour } from '@nudge/shared';
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

export { ACTIONS_REVUE, type ActionRevue } from '@nudge/shared';

/**
 * État de départ exigé et état d'arrivée de chaque transition de revue. Valider et
 * réhabiliter rendent le Retour Trié : le Dispatch le fait ensuite passer Dispatché
 * (ou le laisse Trié si aucun Filtre ne le retient), comme un Retour fraîchement trié.
 * Réhabiliter ne s'applique qu'à un Retour Écarté comme Indésirable, pas à un
 * Retour rejeté après revue.
 */
export const TRANSITIONS_REVUE = {
  valider: { depuis: 'en_revue', vers: 'trie' },
  rejeter: { depuis: 'en_revue', vers: 'ecarte' },
  rehabiliter: { depuis: 'ecarte', vers: 'trie' },
} as const satisfies Record<ActionRevue, { depuis: EtatRetour; vers: EtatRetour }>;

export type ResultatRevue =
  | { readonly statut: 'applique'; readonly etat: EtatRetour }
  /** Le Retour n'est pas dans l'état de départ de la transition : rien n'a changé. */
  | { readonly statut: 'refuse'; readonly etat: EtatRetour }
  | { readonly statut: 'introuvable' };
