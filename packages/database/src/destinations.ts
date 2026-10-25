import { randomUUID } from 'node:crypto';
import type { ConfiguredDestination, Filter, SecretCipher } from '@nudge/core';
import { FILTER_ALL } from '@nudge/shared';
import type { Db } from './client.js';
import { destinations } from './schema.js';

export type DestinationRow = typeof destinations.$inferSelect;
export type DestinationSecrets = Readonly<Record<string, string>>;

/**
 * Encryption context of a Destination's secrets: they decrypt only for this
 * Destination, never when copied onto another row.
 */
export const destinationSecretsContext = (destinationId: string): string =>
  `destinations.${destinationId}.secrets`;

/** `null` when there is no secret to keep. */
export function encryptDestinationSecrets(
  cipher: SecretCipher,
  destinationId: string,
  secrets: DestinationSecrets,
): string | null {
  if (Object.keys(secrets).length === 0) return null;
  return cipher.encrypt(JSON.stringify(secrets), destinationSecretsContext(destinationId));
}

/** Throws `SecretDecryptionError` if the secrets no longer decrypt (Instance key changed). */
export function decryptDestinationSecrets(
  cipher: SecretCipher,
  destination: Pick<DestinationRow, 'id' | 'encryptedSecrets'>,
): DestinationSecrets {
  if (!destination.encryptedSecrets) return {};
  return JSON.parse(
    cipher.decrypt(destination.encryptedSecrets, destinationSecretsContext(destination.id)),
  ) as DestinationSecrets;
}

export const filterOf = (
  destination: Pick<DestinationRow, 'filterTypes' | 'filterMinimumSeverity'>,
): Filter => ({
  types: destination.filterTypes,
  minimumSeverity: destination.filterMinimumSeverity,
});

/** A Destination read from the database, secrets decrypted, as a `DestinationAdapterResolver` receives it. */
export function toConfiguredDestination(
  destination: DestinationRow,
  cipher: SecretCipher,
): ConfiguredDestination {
  return {
    id: destination.id,
    projectId: destination.projectId,
    name: destination.name,
    type: destination.type,
    config: destination.config,
    secrets: decryptDestinationSecrets(cipher, destination),
  };
}

/** Creates a Destination; its secrets are encrypted before entering the database. */
export async function createDestination(
  db: Db,
  cipher: SecretCipher,
  data: {
    projectId: string;
    name: string;
    type: string;
    config?: Record<string, unknown>;
    secrets?: DestinationSecrets;
    filter?: Filter;
  },
): Promise<DestinationRow> {
  // The id is drawn before the insert: it is part of the encryption context.
  const id = randomUUID();
  const filter = data.filter ?? FILTER_ALL;
  const [destination] = await db
    .insert(destinations)
    .values({
      id,
      projectId: data.projectId,
      name: data.name,
      type: data.type,
      config: data.config ?? {},
      encryptedSecrets: encryptDestinationSecrets(cipher, id, data.secrets ?? {}),
      filterTypes: [...filter.types],
      filterMinimumSeverity: filter.minimumSeverity,
    })
    .returning();
  if (!destination) throw new Error('Destination not created');
  return destination;
}
