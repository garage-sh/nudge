import { randomUUID } from 'node:crypto';
import type { DestinationConfiguree, Filtre, SecretCipher } from '@nudge/core';
import { FILTRE_TOUT } from '@nudge/shared';
import type { Db } from './client.js';
import { destinations } from './schema.js';

export type DestinationRow = typeof destinations.$inferSelect;
export type SecretsDestination = Readonly<Record<string, string>>;

/**
 * Contexte de chiffrement des secrets d'une Destination : ils ne se déchiffrent que
 * pour cette Destination, jamais recopiés sur une autre ligne.
 */
export const secretsDestinationContext = (destinationId: string): string =>
  `destinations.${destinationId}.secrets`;

/** `null` quand il n'y a aucun secret à garder. */
export function chiffrerSecretsDestination(
  cipher: SecretCipher,
  destinationId: string,
  secrets: SecretsDestination,
): string | null {
  if (Object.keys(secrets).length === 0) return null;
  return cipher.encrypt(JSON.stringify(secrets), secretsDestinationContext(destinationId));
}

/** Lève `SecretDecryptionError` si les secrets ne se déchiffrent plus (clé d'Instance changée). */
export function dechiffrerSecretsDestination(
  cipher: SecretCipher,
  destination: Pick<DestinationRow, 'id' | 'secretsChiffres'>,
): SecretsDestination {
  if (!destination.secretsChiffres) return {};
  return JSON.parse(
    cipher.decrypt(destination.secretsChiffres, secretsDestinationContext(destination.id)),
  ) as SecretsDestination;
}

export const filtreDe = (
  destination: Pick<DestinationRow, 'filtreTypes' | 'filtreGraviteMinimale'>,
): Filtre => ({
  types: destination.filtreTypes,
  graviteMinimale: destination.filtreGraviteMinimale,
});

/** Une Destination lue en base, secrets déchiffrés, telle que la reçoit un `DestinationAdapterResolver`. */
export function toDestinationConfiguree(
  destination: DestinationRow,
  cipher: SecretCipher,
): DestinationConfiguree {
  return {
    id: destination.id,
    projetId: destination.projetId,
    nom: destination.nom,
    type: destination.type,
    config: destination.config,
    secrets: dechiffrerSecretsDestination(cipher, destination),
  };
}

/** Crée une Destination ; ses secrets sont chiffrés avant d'entrer en base. */
export async function createDestination(
  db: Db,
  cipher: SecretCipher,
  donnees: {
    projetId: string;
    nom: string;
    type: string;
    config?: Record<string, unknown>;
    secrets?: SecretsDestination;
    filtre?: Filtre;
  },
): Promise<DestinationRow> {
  // L'id est tiré avant l'insertion : il entre dans le contexte de chiffrement.
  const id = randomUUID();
  const filtre = donnees.filtre ?? FILTRE_TOUT;
  const [destination] = await db
    .insert(destinations)
    .values({
      id,
      projetId: donnees.projetId,
      nom: donnees.nom,
      type: donnees.type,
      config: donnees.config ?? {},
      secretsChiffres: chiffrerSecretsDestination(cipher, id, donnees.secrets ?? {}),
      filtreTypes: [...filtre.types],
      filtreGraviteMinimale: filtre.graviteMinimale,
    })
    .returning();
  if (!destination) throw new Error('Destination non créée');
  return destination;
}
