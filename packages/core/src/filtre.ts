import { GRAVITES, type Gravite, type TypeRetour } from '@nudge/shared';
import type { Verdict } from './triage.js';

/**
 * Condition portée par une Destination : elle reçoit un Retour Trié dont le Type
 * retenu est parmi `types` et, si une Gravité minimale est fixée, dont la Gravité
 * l'atteint. Persisté sur la Destination (`destinations.filtre_*`), appliqué au Dispatch.
 */
export interface Filtre {
  readonly types: readonly TypeRetour[];
  /** `null` : pas d'exigence de Gravité. */
  readonly graviteMinimale: Gravite | null;
}

/** Le Filtre retient-il ce Verdict ? Un Retour sans Gravité (mode dégradé) n'atteint aucune Gravité minimale. */
export function filtreRetient(
  filtre: Filtre,
  verdict: Pick<Verdict, 'typeRetenu' | 'gravite'>,
): boolean {
  if (!filtre.types.includes(verdict.typeRetenu)) return false;
  if (filtre.graviteMinimale === null) return true;
  if (verdict.gravite === null) return false;
  return GRAVITES.indexOf(verdict.gravite) >= GRAVITES.indexOf(filtre.graviteMinimale);
}
