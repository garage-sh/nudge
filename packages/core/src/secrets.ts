import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Clé d'Instance (D7) : 32 octets en base64, fournie par l'environnement et jamais
 * stockée en base. Générer : `openssl rand -base64 32`.
 */
export const ENCRYPTION_KEY_VARIABLE = 'NUDGE_ENCRYPTION_KEY';

const ALGORITHME = 'aes-256-gcm';
const VERSION = 'v1';
const OCTETS_CLE = 32;
const OCTETS_IV = 12;

/** Un secret chiffré illisible : mauvaise clé, autre usage, valeur altérée ou mal formée. */
export class SecretDecryptionError extends Error {
  override readonly name = 'SecretDecryptionError';
}

/**
 * Chiffre les secrets stockés en base (clé du Juge, jetons des Destinations, secrets
 * HMAC). Le `context` nomme l'usage du secret (`parametres_instance.juge_cle`,
 * `destination.<id>.jeton`…) : il est authentifié avec lui, si bien qu'un secret
 * recopié dans une autre colonne ou une autre ligne ne se déchiffre pas.
 */
export interface SecretCipher {
  /** `v1:<iv>:<tag>:<données>`, en base64. */
  encrypt(plaintext: string, context: string): string;
  /** Lève `SecretDecryptionError` si le secret ne se déchiffre pas pour ce contexte. */
  decrypt(encrypted: string, context: string): string;
}

/** Lève si la clé n'est pas 32 octets en base64. */
export function createSecretCipher(keyBase64: string): SecretCipher {
  const cle = Buffer.from(keyBase64, 'base64');
  if (cle.length !== OCTETS_CLE) {
    throw new Error(
      `${ENCRYPTION_KEY_VARIABLE} doit contenir 32 octets en base64 (${cle.length} lus) : openssl rand -base64 32`,
    );
  }
  return {
    encrypt(plaintext, context) {
      const iv = randomBytes(OCTETS_IV);
      const chiffreur = createCipheriv(ALGORITHME, cle, iv);
      chiffreur.setAAD(Buffer.from(context, 'utf8'));
      const donnees = Buffer.concat([chiffreur.update(plaintext, 'utf8'), chiffreur.final()]);
      return [VERSION, iv, chiffreur.getAuthTag(), donnees]
        .map((partie) => (typeof partie === 'string' ? partie : partie.toString('base64')))
        .join(':');
    },
    decrypt(encrypted, context) {
      const [version, iv, tag, donnees, ...reste] = encrypted.split(':');
      if (version !== VERSION || !iv || !tag || donnees === undefined || reste.length > 0) {
        throw new SecretDecryptionError('Secret chiffré mal formé');
      }
      try {
        const dechiffreur = createDecipheriv(ALGORITHME, cle, Buffer.from(iv, 'base64'));
        dechiffreur.setAAD(Buffer.from(context, 'utf8'));
        dechiffreur.setAuthTag(Buffer.from(tag, 'base64'));
        return Buffer.concat([
          dechiffreur.update(Buffer.from(donnees, 'base64')),
          dechiffreur.final(),
        ]).toString('utf8');
      } catch (cause) {
        throw new SecretDecryptionError(
          `Secret indéchiffrable (« ${context} ») : autre clé d'Instance, autre usage ou valeur altérée`,
          { cause },
        );
      }
    },
  };
}
