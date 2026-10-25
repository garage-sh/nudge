import { optionalEnv, type Env } from '@nudge/core';

/**
 * What a nudge process does: serve the api (ingestion and dashboard), run the worker
 * (Triage, Dispatch, purge, Suspension), or both.
 */
export type Role = 'api' | 'worker';

const ROLES: readonly Role[] = ['api', 'worker'];

/**
 * `NUDGE_ROLES`, a comma-separated list (`api`, `worker`, `api,worker`). Absent: both,
 * in the same process. A small Instance needs nothing else; a large one splits the
 * roles to replicate the worker separately.
 */
export function rolesFromEnv(env: Env): ReadonlySet<Role> {
  const value = optionalEnv(env, 'NUDGE_ROLES');
  if (value === null) return new Set(ROLES);
  const requested = value.split(',').map((role) => role.trim());
  const unknown = requested.filter((role) => !ROLES.includes(role as Role));
  if (unknown.length > 0 || requested.every((role) => role === '')) {
    throw new Error(`Invalid NUDGE_ROLES: "${value}" (expected api, worker or api,worker)`);
  }
  return new Set(requested as Role[]);
}
