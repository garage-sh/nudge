import { randomUUID } from 'node:crypto';
import type { ConfiguredDestination, Filter, IncidentFilter, SecretCipher } from '@nudge/core';
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

/** The Destination's Feedback Filter; `null`: off. */
export const filterOf = (
  destination: Pick<DestinationRow, 'filterEnabled' | 'filterTypes' | 'filterMinimumSeverity'>,
): Filter | null =>
  destination.filterEnabled
    ? { types: destination.filterTypes, minimumSeverity: destination.filterMinimumSeverity }
    : null;

/** The Destination's Incident Filter; `null`: off. */
export const incidentFilterOf = (
  destination: Pick<
    DestinationRow,
    | 'incidentFilterEnabled'
    | 'incidentFilterMinimumLevel'
    | 'incidentFilterEnvironments'
    | 'incidentFilterConditions'
  >,
): IncidentFilter | null =>
  destination.incidentFilterEnabled
    ? {
        minimumLevel: destination.incidentFilterMinimumLevel,
        environments: destination.incidentFilterEnvironments,
        conditions: destination.incidentFilterConditions,
      }
    : null;

/**
 * The columns of a Destination's Feedback Filter. Turned off (`null`), the Filter keeps
 * its last Types and Severity: they come back if it is turned on again unchanged.
 */
export const filterColumns = (filter: Filter | null) =>
  filter
    ? {
        filterEnabled: true,
        filterTypes: [...filter.types],
        filterMinimumSeverity: filter.minimumSeverity,
      }
    : { filterEnabled: false };

/** The columns of a Destination's Incident Filter; turned off, it keeps its last settings. */
export const incidentFilterColumns = (filter: IncidentFilter | null) =>
  filter
    ? {
        incidentFilterEnabled: true,
        incidentFilterMinimumLevel: filter.minimumLevel,
        incidentFilterEnvironments: [...filter.environments],
        incidentFilterConditions: filter.conditions.map(({ key, values }) => ({
          key,
          values: [...values],
        })),
      }
    : { incidentFilterEnabled: false };

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
    /** `null`: off. Absent: every Triaged Feedback. */
    filter?: Filter | null;
    /** `null` or absent: off. */
    incidentFilter?: IncidentFilter | null;
  },
): Promise<DestinationRow> {
  // The id is drawn before the insert: it is part of the encryption context.
  const id = randomUUID();
  const filter = data.filter === undefined ? FILTER_ALL : data.filter;
  const [destination] = await db
    .insert(destinations)
    .values({
      id,
      projectId: data.projectId,
      name: data.name,
      type: data.type,
      config: data.config ?? {},
      encryptedSecrets: encryptDestinationSecrets(cipher, id, data.secrets ?? {}),
      ...filterColumns(filter),
      ...incidentFilterColumns(data.incidentFilter ?? null),
    })
    .returning();
  if (!destination) throw new Error('Destination not created');
  return destination;
}
