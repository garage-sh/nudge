import type { DestinationConfiguree, SecretCipher } from '@nudge/core';
import type { FournisseurJuge } from '@nudge/shared';
import { eq } from 'drizzle-orm';
import type { Db } from './client.js';
import type { SecretsDestination } from './destinations.js';
import { parametresInstance } from './schema.js';

/** Contexte de chiffrement de la clé du Juge : elle ne se déchiffre que pour cet usage. */
export const JUGE_KEY_CONTEXT = 'parametres_instance.juge_cle';

const LIGNE = 1;

/** Le Juge tel qu'enregistré pour l'Instance, clé encore chiffrée. */
export interface JugeEnregistre {
  readonly fournisseur: FournisseurJuge | null;
  readonly modele: string | null;
  readonly urlBase: string | null;
  readonly cleChiffree: string | null;
}

/** Aucun Juge choisi : l'Instance se replie sur l'environnement, sinon le mode dégradé. */
export const AUCUN_JUGE: JugeEnregistre = {
  fournisseur: null,
  modele: null,
  urlBase: null,
  cleChiffree: null,
};

export async function readJugeInstance(db: Db): Promise<JugeEnregistre> {
  const [ligne] = await db
    .select({
      fournisseur: parametresInstance.jugeFournisseur,
      modele: parametresInstance.jugeModele,
      urlBase: parametresInstance.jugeUrlBase,
      cleChiffree: parametresInstance.jugeCleChiffree,
    })
    .from(parametresInstance)
    .where(eq(parametresInstance.id, LIGNE));
  return ligne ?? AUCUN_JUGE;
}

/** Crée la ligne des paramètres d'Instance au premier enregistrement. */
export async function writeJugeInstance(db: Db, juge: JugeEnregistre): Promise<void> {
  const valeurs = {
    jugeFournisseur: juge.fournisseur,
    jugeModele: juge.modele,
    jugeUrlBase: juge.urlBase,
    jugeCleChiffree: juge.cleChiffree,
  };
  await db
    .insert(parametresInstance)
    .values({ id: LIGNE, ...valeurs })
    .onConflictDoUpdate({ target: parametresInstance.id, set: valeurs });
}

/** Contexte de chiffrement des secrets de la Destination d'alerte. */
export const ALERTE_SECRETS_CONTEXT = 'parametres_instance.alerte_secrets';

/**
 * Identifiant de la Destination d'alerte auprès des adaptateurs (messages, caches) :
 * elle est unique pour l'Instance et n'a pas de ligne dans `destinations`.
 */
export const DESTINATION_ALERTE_ID = 'alerte-instance';

/** La Destination d'alerte telle qu'enregistrée, secrets encore chiffrés. */
export interface DestinationAlerteEnregistree {
  readonly type: string;
  readonly config: Record<string, unknown>;
  readonly secretsChiffres: string | null;
}

/** `null` : l'Instance n'a pas de Destination d'alerte. */
export async function readDestinationAlerte(db: Db): Promise<DestinationAlerteEnregistree | null> {
  const [ligne] = await db
    .select({
      type: parametresInstance.alerteType,
      config: parametresInstance.alerteConfig,
      secretsChiffres: parametresInstance.alerteSecretsChiffres,
    })
    .from(parametresInstance)
    .where(eq(parametresInstance.id, LIGNE));
  if (!ligne?.type) return null;
  return { type: ligne.type, config: ligne.config ?? {}, secretsChiffres: ligne.secretsChiffres };
}

/** Enregistre (ou retire, `null`) la Destination d'alerte ; crée la ligne au besoin. */
export async function writeDestinationAlerte(
  db: Db,
  alerte: DestinationAlerteEnregistree | null,
): Promise<void> {
  const valeurs = {
    alerteType: alerte?.type ?? null,
    alerteConfig: alerte?.config ?? null,
    alerteSecretsChiffres: alerte?.secretsChiffres ?? null,
    updatedAt: new Date(),
  };
  await db
    .insert(parametresInstance)
    .values({ id: LIGNE, ...valeurs })
    .onConflictDoUpdate({ target: parametresInstance.id, set: valeurs });
}

/** `null` quand il n'y a aucun secret à garder. */
export function chiffrerSecretsAlerte(
  cipher: SecretCipher,
  secrets: SecretsDestination,
): string | null {
  if (Object.keys(secrets).length === 0) return null;
  return cipher.encrypt(JSON.stringify(secrets), ALERTE_SECRETS_CONTEXT);
}

/** Lève `SecretDecryptionError` si les secrets ne se déchiffrent plus (clé d'Instance changée). */
export function dechiffrerSecretsAlerte(
  cipher: SecretCipher,
  alerte: Pick<DestinationAlerteEnregistree, 'secretsChiffres'>,
): SecretsDestination {
  if (!alerte.secretsChiffres) return {};
  return JSON.parse(
    cipher.decrypt(alerte.secretsChiffres, ALERTE_SECRETS_CONTEXT),
  ) as SecretsDestination;
}

/** La Destination d'alerte, secrets déchiffrés, telle que la reçoit un `DestinationAdapterResolver`. */
export function destinationAlerteConfiguree(
  alerte: DestinationAlerteEnregistree,
  cipher: SecretCipher,
): DestinationConfiguree {
  return {
    id: DESTINATION_ALERTE_ID,
    projetId: null,
    nom: 'Destination d’alerte',
    type: alerte.type,
    config: alerte.config,
    secrets: dechiffrerSecretsAlerte(cipher, alerte),
  };
}
