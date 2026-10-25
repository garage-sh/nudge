import { SEVERITIES, type Severity, type FeedbackType } from '@nudge/shared';
import type { Verdict } from './triage.js';

/**
 * The condition carried by a Destination: it receives a Triaged Feedback whose resolved
 * type is among `types` and, if a minimum Severity is set, whose Severity reaches it.
 * Persisted on the Destination (`destinations.filter_*`), applied at Dispatch.
 */
export interface Filter {
  readonly types: readonly FeedbackType[];
  /** `null`: no Severity requirement. */
  readonly minimumSeverity: Severity | null;
}

/** Does the Filter accept this Verdict? A Feedback without a Severity (degraded mode) reaches no minimum Severity. */
export function filterAccepts(
  filter: Filter,
  verdict: Pick<Verdict, 'resolvedType' | 'severity'>,
): boolean {
  if (!filter.types.includes(verdict.resolvedType)) return false;
  if (filter.minimumSeverity === null) return true;
  if (verdict.severity === null) return false;
  return SEVERITIES.indexOf(verdict.severity) >= SEVERITIES.indexOf(filter.minimumSeverity);
}
