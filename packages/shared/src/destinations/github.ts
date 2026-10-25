import { z } from 'zod';
import type { DestinationDefinition } from './definition.js';

/**
 * `owner/repository`: a GitHub account (letters, digits, hyphens, at most 39
 * characters, no leading hyphen) and a repository name (letters, digits, `.`, `-`, `_`).
 */
const REPOSITORY = /^([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})$/;

export interface GitHubRepository {
  readonly owner: string;
  readonly name: string;
}

/** The owner and name of an `owner/repository` repository, or `null`. */
export function parseGitHubRepository(value: string): GitHubRepository | null {
  const parts = REPOSITORY.exec(value.trim());
  if (!parts) return null;
  const name = parts[2]!;
  if (name === '.' || name === '..' || name.endsWith('.git')) return null;
  return { owner: parts[1]!, name };
}

/**
 * GitHub Issues: an issue created in the configured repository, through the REST API
 * with a personal access token (secret, encrypted in the database, never returned). A
 * "fine-grained" token limited to the repository is enough, with the "Issues: read and
 * write" permission.
 */
export const gitHubDefinition = {
  config: z.strictObject({
    repository: z
      .string()
      .trim()
      .refine((value) => parseGitHubRepository(value) !== null, {
        message: 'Expected a GitHub repository in the form owner/repository',
      }),
  }),
  secrets: z.strictObject({
    token: z.string().trim().min(1, { message: 'Expected a GitHub access token' }),
  }),
  generatedSecrets: [],
} as const satisfies DestinationDefinition;

export type GitHubConfig = z.output<typeof gitHubDefinition.config>;
export type GitHubSecrets = z.output<typeof gitHubDefinition.secrets>;
