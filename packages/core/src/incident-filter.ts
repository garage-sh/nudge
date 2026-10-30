import { LEVELS, type IncidentContext, type Level } from '@nudge/shared';

/** A condition of an Incident Filter: the context `key` holds one of `values`. */
export interface IncidentCondition {
  readonly key: string;
  readonly values: readonly string[];
}

/**
 * The Incident Filter carried by a Destination, beside its Feedback Filter: it receives
 * an Incident whose Level reaches `minimumLevel`, whose Environment is among
 * `environments` (an empty list accepts every Environment, and none), and whose context
 * meets every condition. Persisted on the Destination (`destinations.incident_filter_*`),
 * applied at Dispatch. `null` where a Filter is expected: the Filter is off.
 */
export interface IncidentFilter {
  readonly minimumLevel: Level;
  readonly environments: readonly string[];
  readonly conditions: readonly IncidentCondition[];
}

/** What an Incident Filter looks at: the Incident's current Level, its Environment and context. */
export interface IncidentToFilter {
  readonly level: Level;
  /** `null`: the sender named none. */
  readonly environment: string | null;
  readonly context: IncidentContext;
}

/**
 * Does the Incident Filter accept this Incident? Off (`null`), it accepts none. An
 * Incident without an Environment passes only a Filter that lists none. A context key a
 * condition requires and the context lacks (or holds `null`) refuses the Incident; a
 * number or a boolean is compared as its text (`2` matches `"2"`).
 */
export function incidentFilterAccepts(
  filter: IncidentFilter | null,
  incident: IncidentToFilter,
): boolean {
  if (!filter) return false;
  if (LEVELS.indexOf(incident.level) < LEVELS.indexOf(filter.minimumLevel)) return false;
  if (filter.environments.length > 0) {
    if (incident.environment === null) return false;
    if (!filter.environments.includes(incident.environment)) return false;
  }
  return filter.conditions.every(({ key, values }) => {
    const value = Object.hasOwn(incident.context, key) ? incident.context[key] : undefined;
    if (value === undefined || value === null) return false;
    return values.includes(String(value));
  });
}
