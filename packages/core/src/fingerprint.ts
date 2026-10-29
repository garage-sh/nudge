import { createHash } from 'node:crypto';

/**
 * The Fingerprint nudge derives for an Occurrence whose sender gave none: a SHA-256 of
 * the Project, the title and the Environment (the context is left out, so a report
 * carrying a varying host or trace id still lands in the same Incident). The parts are
 * hashed as a JSON array, so no text moved from one part to the next yields the same
 * digest, and a missing Environment never equals a named one.
 */
export function deriveFingerprint(
  projectId: string,
  title: string,
  environment: string | null,
): string {
  return createHash('sha256')
    .update(JSON.stringify([projectId, title, environment]))
    .digest('hex');
}
