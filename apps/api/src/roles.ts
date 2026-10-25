import { optionalEnv, type Env } from '@nudge/core';

/**
 * Ce qu'un processus nudge fait : servir l'api (ingestion et dashboard), faire tourner
 * le worker (Triage, Dispatch, purge, Suspension), ou les deux.
 */
export type Role = 'api' | 'worker';

const ROLES: readonly Role[] = ['api', 'worker'];

/**
 * `NUDGE_ROLES`, une liste séparée par des virgules (`api`, `worker`, `api,worker`).
 * Absente : les deux, dans le même processus. Une petite Instance n'a besoin de rien
 * d'autre ; une grosse sépare les rôles pour répliquer le worker à part.
 */
export function rolesFromEnv(env: Env): ReadonlySet<Role> {
  const valeur = optionalEnv(env, 'NUDGE_ROLES');
  if (valeur === null) return new Set(ROLES);
  const demandes = valeur.split(',').map((role) => role.trim());
  const inconnus = demandes.filter((role) => !ROLES.includes(role as Role));
  if (inconnus.length > 0 || demandes.every((role) => role === '')) {
    throw new Error(`NUDGE_ROLES invalide : « ${valeur} » (api, worker ou api,worker attendu)`);
  }
  return new Set(demandes as Role[]);
}
